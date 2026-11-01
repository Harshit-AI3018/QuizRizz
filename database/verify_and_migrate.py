#!/usr/bin/env python3
"""
CampusQuiz -- Database Migration and Verification Runner
Target: Neon PostgreSQL 15+ / Render / Standard PostgreSQL

Usage:
    python database/verify_and_migrate.py [options] [DATABASE_URL]

Modes:
    (default)        Show migration status without executing anything.
    --migrate        Apply pending migrations and run verification tests.
    --tests-only     Run verification tests (no migrations).
    --help, -h       Show this help message and exit.

Connection:
    Supply the database URL via:
      1. CLI positional argument: "postgresql://user:pass@host/db?sslmode=require"
      2. --url <url> flag
      3. DATABASE_URL environment variable (or .env file in project root)

IMPORTANT — Neon Users:
    Always use the DIRECT (unpooled) connection endpoint, not the "-pooler" endpoint.
    Pooled connections use transaction-mode PgBouncer and will corrupt SET ROLE state.

Migration Tracking:
    A 'schema_migrations' table records successfully applied migrations.
    Already-applied migrations are skipped on subsequent runs.
    Migrations execute inside a single transaction; failures roll back completely
    and are never recorded as successful.
"""

import argparse
import hashlib
import os
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import textwrap
from typing import List, NamedTuple, Optional, Tuple

from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

# ---------------------------------------------------------------------------
# Dependency imports — clear error messages if virtual env is not activated
# ---------------------------------------------------------------------------
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print(
        "\n[!] ERROR: 'psycopg2' is not installed in the current Python environment.\n"
        "    Activate the project virtual environment first:\n"
        "      .venv\\Scripts\\activate     (Windows PowerShell)\n"
        "    Then install dependencies:\n"
        "      pip install -r requirements.txt\n",
        file=sys.stderr,
    )
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    print(
        "\n[!] ERROR: 'python-dotenv' is not installed in the current Python environment.\n"
        "    Activate the project virtual environment and run:\n"
        "      pip install -r requirements.txt\n",
        file=sys.stderr,
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# Named types
# ---------------------------------------------------------------------------

class MigrationItem(NamedTuple):
    filename: str
    description: str


class MigrationStatus(NamedTuple):
    filename: str
    description: str
    applied: bool          # True = already in schema_migrations
    applied_at: Optional[str]


class PermissionTestResult(NamedTuple):
    code: str
    name: str
    status: str
    detail: str


# ---------------------------------------------------------------------------
# Paths and migration catalogue
# ---------------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

# Load .env from multiple candidate locations (project root first, then db dir)
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))
load_dotenv(os.path.join(SCRIPT_DIR, ".env"))
load_dotenv(".env")

# Production migrations only — tracked in schema_migrations.
MIGRATION_FILES: List[MigrationItem] = [
    MigrationItem("01_schema.sql",    "Schema DDL, Extensions, Constraints & Triggers"),
    MigrationItem("02_procedures.sql", "Stored Functions & SECURITY DEFINER Procedures"),
    MigrationItem("03_permissions.sql", "Function Ownership & Least-Privilege Grants"),
    MigrationItem("04_security_hardening.sql", "HMAC Definer Protection, Search Paths & Table Hardening"),
    MigrationItem("05_fix_for_share_of.sql", "Fix sp_start_quiz_attempt FOR SHARE OF qs (classes join)"),
    MigrationItem("06_fix_student_response_record.sql", "Fix sp_save_student_response v_saved_version record assignment"),
]

# The verification test suite — run separately via --tests-only.
# It is NEVER recorded as a migration and NEVER executed by --migrate.
TEST_SUITE_FILE = "test_suite.sql"

# SQL that creates the migration tracking table if it does not already exist.
BOOTSTRAP_SCHEMA_MIGRATIONS = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(255) PRIMARY KEY,
    description TEXT,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    checksum    TEXT
);
"""


# ---------------------------------------------------------------------------
# URL utilities
# ---------------------------------------------------------------------------

def mask_connection_url(url: str) -> str:
    """Return the URL with the password replaced by ******."""
    if not url:
        return "<EMPTY>"
    try:
        parsed = urlparse(url)
        if parsed.password:
            netloc = f"{parsed.username}:******@{parsed.hostname}"
            if parsed.port:
                netloc += f":{parsed.port}"
            return parsed._replace(netloc=netloc).geturl()
    except Exception:
        pass
    return re.sub(r":([^@]+)@", ":******@", url)


def validate_and_clean_database_url(raw_url: str) -> str:
    """Validate, normalise, and add sslmode=require for Neon endpoints."""
    url = raw_url.strip().strip("'\"")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]

    parsed = urlparse(url)
    if parsed.scheme not in ("postgresql", "postgres"):
        raise ValueError(
            f"Invalid database scheme '{parsed.scheme}'. Expected 'postgresql://' or 'postgres://'."
        )
    if not parsed.hostname:
        raise ValueError("Database connection URL is missing a valid hostname.")

    # Warn when the user has accidentally used a pooled Neon endpoint
    hostname = parsed.hostname.lower()
    if "neon.tech" in hostname:
        if "-pooler" in hostname:
            print(
                "\n[!] WARNING: Your DATABASE_URL appears to use the Neon POOLED endpoint\n"
                "    (hostname contains '-pooler'). Pooled connections use transaction-mode\n"
                "    PgBouncer and will corrupt SET ROLE state used by the permission tests.\n"
                "    Switch to the direct (unpooled) endpoint: remove '-pooler' from the host.\n"
            )
        # Automatically append sslmode=require if absent
        query_params = parse_qs(parsed.query)
        if "sslmode" not in query_params:
            query_params["sslmode"] = ["require"]
            new_query = urlencode(query_params, doseq=True)
            url = urlunparse(parsed._replace(query=new_query))

    return url


def get_database_url() -> Optional[str]:
    """Retrieve connection string from already-parsed args or environment."""
    # This function is called AFTER argparse, so args.url / positional are
    # handled in main(). Here we just check the environment as a fallback.
    raw_url = (
        os.getenv("DATABASE_URL")
        or os.getenv("NEON_DATABASE_URL")
        or os.getenv("STAGING_DATABASE_URL")
        or os.getenv("PGDATABASE_URL")
    )
    if not raw_url:
        return None
    return validate_and_clean_database_url(raw_url)


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------

def connect_to_database(db_url: str):
    """Establish a psycopg2 connection with autocommit enabled."""
    masked = mask_connection_url(db_url)
    print(f"[*] Connecting to database at {masked}...")
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        return conn
    except Exception as e:
        print(f"[!] Connection failed: {e}", file=sys.stderr)
        return None


def verify_server_version(conn) -> None:
    """Print PostgreSQL version and database info; warn if < 15."""
    with conn.cursor() as cur:
        cur.execute("SHOW server_version;")
        version_str = cur.fetchone()[0]
        cur.execute("SELECT current_database(), current_user;")
        db_name, db_user = cur.fetchone()

    print(f"[+] Connected to database '{db_name}' as user '{db_user}'")
    print(f"[+] PostgreSQL server version: {version_str}")

    match = re.match(r"^(\d+)", version_str)
    if match and int(match.group(1)) < 15:
        print(f"[!] Warning: CampusQuiz targets PostgreSQL 15+, found {version_str}")


# ---------------------------------------------------------------------------
# Migration tracking table
# ---------------------------------------------------------------------------

def ensure_tracking_table(conn) -> None:
    """
    Create schema_migrations table if it doesn't exist.
    Uses autocommit — safe to call repeatedly.
    """
    with conn.cursor() as cur:
        cur.execute(BOOTSTRAP_SCHEMA_MIGRATIONS)
    print("[+] Migration tracking table verified (schema_migrations).")


def get_applied_migrations(conn) -> dict:
    """Return {version: applied_at_str} for all recorded migrations."""
    with conn.cursor() as cur:
        cur.execute("SELECT version, applied_at FROM schema_migrations ORDER BY applied_at;")
        rows = cur.fetchall()
    return {row[0]: str(row[1]) for row in rows}


def record_migration(conn, filename: str, description: str, checksum: Optional[str] = None) -> None:
    """
    Insert a successful migration record.
    Called INSIDE the migration transaction — uses the transaction's connection.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO schema_migrations (version, description, checksum)
            VALUES (%s, %s, %s)
            ON CONFLICT (version) DO UPDATE
            SET description = EXCLUDED.description,
                checksum = EXCLUDED.checksum;
            """,
            (filename, description, checksum),
        )


def get_migration_status(conn) -> List[MigrationStatus]:
    """Return full status list for all known migrations."""
    applied = get_applied_migrations(conn)
    statuses = []
    for item in MIGRATION_FILES:
        is_applied = item.filename in applied
        statuses.append(
            MigrationStatus(
                filename=item.filename,
                description=item.description,
                applied=is_applied,
                applied_at=applied.get(item.filename),
            )
        )
    return statuses


# ---------------------------------------------------------------------------
# Migration execution
# ---------------------------------------------------------------------------

def execute_migration_transactionally(
    conn,
    file_path: str,
    item: MigrationItem,
    captured_notices: List[str],
) -> bool:
    """
    Execute a single SQL migration file inside a transaction.

    Steps:
      1. Disable autocommit.
      2. Execute the full SQL file.
      3. On success: record in schema_migrations and COMMIT.
      4. On failure: ROLLBACK; leave autocommit restored; return False.
    """
    if not os.path.exists(file_path):
        print(f"[!] Migration file not found: {file_path}", file=sys.stderr)
        return False

    print(f"\n[*] Applying {item.filename}: {item.description}...")

    with open(file_path, "r", encoding="utf-8") as f:
        sql_content = f.read()

    # Switch to transactional mode
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            # Clear notices buffer before execution
            del conn.notices[:]
            cur.execute(sql_content)

            # Record the migration inside the same transaction so it rolls back on failure
            checksum = hashlib.sha256(sql_content.encode("utf-8")).hexdigest()
            record_migration(conn, item.filename, item.description, checksum)

        conn.commit()

        # Harvest notices emitted by DO $$ blocks
        for notice in conn.notices:
            clean = notice.strip()
            if clean:
                captured_notices.append(clean)
                print(f"    {clean}")

        print(f"[+] Successfully applied {item.filename}.")
        return True

    except Exception as e:
        conn.rollback()
        print(f"\n[!] FAILED to apply {item.filename}:", file=sys.stderr)
        print(f"    Error: {e}", file=sys.stderr)
        return False

    finally:
        conn.autocommit = True


# ---------------------------------------------------------------------------
# Reconciliation / bootstrap for partially migrated databases
# ---------------------------------------------------------------------------

RECONCILIATION_HELP = """
╔══════════════════════════════════════════════════════════════════════════════╗
║              AMBIGUOUS MIGRATION STATE — MANUAL ACTION REQUIRED             ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  The schema_migrations tracking table does not exist or is empty, but the   ║
║  target database already contains objects (tables, functions, or roles)      ║
║  that indicate migrations have previously been applied without tracking.      ║
║                                                                              ║
║  Automatically re-executing migrations on top of existing objects is         ║
║  dangerous: it may cause duplicate-object errors, overwrite corrected SQL,   ║
║  or corrupt data.                                                            ║
║                                                                              ║
║  WHAT TO DO:                                                                 ║
║                                                                              ║
║  Option A — Mark a migration as already applied (safe; use when you know    ║
║  it succeeded):                                                              ║
║                                                                              ║
║    psql "$DATABASE_URL" -c "                                                 ║
║      INSERT INTO schema_migrations (version, description)                   ║
║      VALUES ('01_schema.sql', 'Schema DDL, Extensions, Constraints')        ║
║      ON CONFLICT DO NOTHING;"                                                ║
║                                                                              ║
║  Option B — Use --mark-applied to interactively mark known-good migrations: ║
║                                                                              ║
║    python database/verify_and_migrate.py --mark-applied 01_schema.sql       ║
║                                                                              ║
║  Option C — Start with a fresh database (drops all existing objects):        ║
║    Create a new Neon branch or reset the database, then re-run migrations.   ║
║                                                                              ║
║  CURRENT SITUATION (CampusQuiz):                                            ║
║    01_schema.sql  — executed successfully; mark as applied.                 ║
║    02_procedures.sql — failed partway; DO NOT mark as applied.              ║
║                        Fix the SQL, then run --migrate.                     ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""


def detect_existing_objects(conn) -> dict:
    """
    Check the database for CampusQuiz-specific objects without modifying anything.
    Returns a dict with presence flags.
    """
    result = {}
    with conn.cursor() as cur:
        # Tables from 01_schema.sql
        cur.execute(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'colleges';"
        )
        result["has_schema"] = cur.fetchone()[0] > 0

        # Functions from 02_procedures.sql
        cur.execute(
            "SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
            "WHERE n.nspname = 'public' AND p.proname = 'fn_verify_actor_context';"
        )
        result["has_procedures"] = cur.fetchone()[0] > 0

        # campusquiz_app role
        cur.execute(
            "SELECT COUNT(*) FROM pg_roles WHERE rolname = 'campusquiz_app';"
        )
        result["has_roles"] = cur.fetchone()[0] > 0

        # schema_migrations table
        cur.execute(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'schema_migrations';"
        )
        result["has_tracking_table"] = cur.fetchone()[0] > 0

    return result


def check_ambiguous_state(conn) -> bool:
    """
    Return True if the database has CampusQuiz objects but NO tracking table,
    indicating an untracked prior migration run that needs reconciliation.
    """
    objects = detect_existing_objects(conn)
    has_objects = objects["has_schema"] or objects["has_roles"]
    return has_objects and not objects["has_tracking_table"]


def mark_migration_applied(conn, filename: str) -> bool:
    """
    Manually record a migration as applied without executing it.
    Used after manual reconciliation of a partially migrated database.
    """
    item = next((m for m in MIGRATION_FILES if m.filename == filename), None)
    if not item:
        valid = ", ".join(m.filename for m in MIGRATION_FILES)
        print(f"[!] Unknown migration: '{filename}'. Valid migrations: {valid}", file=sys.stderr)
        return False

    with conn.cursor() as cur:
        cur.execute(
            "SELECT version FROM schema_migrations WHERE version = %s;", (filename,)
        )
        if cur.fetchone():
            print(f"[=] '{filename}' is already recorded in schema_migrations.")
            return True

    checksum = None
    file_path = os.path.join(SCRIPT_DIR, filename)
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            checksum = hashlib.sha256(f.read().encode("utf-8")).hexdigest()

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO schema_migrations (version, description, checksum)
            VALUES (%s, %s, %s)
            ON CONFLICT (version) DO UPDATE
            SET description = EXCLUDED.description,
                checksum = EXCLUDED.checksum;
            """,
            (filename, item.description, checksum),
        )
    print(f"[+] Marked '{filename}' as applied in schema_migrations.")
    return True


# ---------------------------------------------------------------------------
# Permission verification
# ---------------------------------------------------------------------------

def verify_application_role_permissions(conn) -> List[PermissionTestResult]:
    """Verify least-privilege permissions under the campusquiz_app role."""
    results: List[PermissionTestResult] = []
    print("\n[*] Verifying permissions under the application role (campusquiz_app)...")

    test_cases = [
        (
            "PERM-01",
            "Direct UPDATE on student_responses.awarded_marks",
            "UPDATE student_responses SET awarded_marks = 50.000000 WHERE id = gen_random_uuid();",
            "42501",
        ),
        (
            "PERM-02",
            "Direct UPDATE on student_responses.server_received_at",
            "UPDATE student_responses SET server_received_at = clock_timestamp() WHERE id = gen_random_uuid();",
            "42501",
        ),
        (
            "PERM-03",
            "Direct SELECT on question_options.is_correct",
            "SELECT is_correct FROM question_options LIMIT 1;",
            "42501",
        ),
        (
            "PERM-04",
            "Direct SELECT on quiz_sessions.snapshot_json",
            "SELECT snapshot_json FROM quiz_sessions LIMIT 1;",
            "42501",
        ),
        (
            "PERM-05",
            "Direct SELECT on student_responses evaluation columns",
            "SELECT is_evaluated, is_correct, awarded_marks FROM student_responses LIMIT 1;",
            "42501",
        ),
        (
            "PERM-06",
            "Direct EXECUTE on fn_generate_auth_signature (signature minting)",
            "SELECT fn_generate_auth_signature(gen_random_uuid(), 'FACULTY', 300);",
            "42501",
        ),
        (
            "PERM-07",
            "Direct UPDATE on quiz_attempts.total_score",
            "UPDATE quiz_attempts SET total_score = 100.00 WHERE id = gen_random_uuid();",
            "42501",
        ),
        (
            "PERM-08",
            "Direct UPDATE on quiz_attempts.status",
            "UPDATE quiz_attempts SET status = 'FINALIZED' WHERE id = gen_random_uuid();",
            "42501",
        ),
        (
            "PERM-09",
            "Direct CREATE TABLE on schema public",
            "CREATE TABLE public.tmp_unauthorized_probe (id INT);",
            "42501",
        ),
    ]

    with conn.cursor() as cur:
        try:
            cur.execute("SET ROLE campusquiz_app;")
            role_switched = True
        except Exception as e:
            print(f"[!] Unable to switch to role campusquiz_app: {e}", file=sys.stderr)
            role_switched = False

        if not role_switched:
            for code, name, _, _ in test_cases:
                results.append(
                    PermissionTestResult(
                        code=code, name=name, status="SKIPPED",
                        detail="Could not switch to campusquiz_app role",
                    )
                )
            return results

        for code, name, query, expected_sqlstate in test_cases:
            try:
                cur.execute(query)
                results.append(
                    PermissionTestResult(
                        code=code, name=name, status="FAILED",
                        detail="Operation succeeded when it should have been blocked",
                    )
                )
            except Exception as err:
                pgcode = getattr(err, "pgcode", None)
                if pgcode == expected_sqlstate:
                    results.append(
                        PermissionTestResult(
                            code=code, name=name, status="PASSED",
                            detail=f"Blocked with expected SQLSTATE {expected_sqlstate}",
                        )
                    )
                else:
                    results.append(
                        PermissionTestResult(
                            code=code, name=name, status="FAILED",
                            detail=f"Unexpected error ({pgcode}): {err}",
                        )
                    )

        cur.execute("RESET ROLE;")

    return results


# ---------------------------------------------------------------------------
# Automated test result harvesting
# ---------------------------------------------------------------------------

def run_test_file(conn, file_path: str) -> Tuple[List[str], bool]:
    """
    Execute test_suite.sql inside a single transaction that is ALWAYS rolled back.

    Rationale:
    - Running under a single transaction guarantees that ALL test data is
      cleaned up regardless of whether the tests pass, fail, or abort mid-suite.
    - RAISE NOTICE messages are sent to the client immediately over the wire
      and are NOT subject to transaction rollback, so all captured test results
      remain available after the rollback.
    - If a DO $$ block raises an unhandled exception (deliberate test FAILED
      assertion), the transaction aborts at that point; notices collected up
      to that point are still returned.

    This function never records anything in schema_migrations.
    """
    if not os.path.exists(file_path):
        print(f"[!] Test file not found: {file_path}", file=sys.stderr)
        return [], False

    print(f"\n[*] Executing verification test suite ({os.path.basename(file_path)})...")
    print( "[*] Tests run inside a single transaction (always rolled back — no data persists).")

    with open(file_path, "r", encoding="utf-8") as f:
        sql_content = f.read()

    del conn.notices[:]
    conn.autocommit = False
    suite_error: Optional[Exception] = None

    try:
        with conn.cursor() as cur:
            cur.execute(sql_content)
    except Exception as e:
        suite_error = e
        print(f"\n[!] Test suite aborted mid-run: {e}", file=sys.stderr)
    finally:
        try:
            conn.rollback()
            print("[*] Test transaction rolled back (no test data persists).")
        except Exception:
            pass
        conn.autocommit = True

    test_reports: List[str] = []
    for notice in conn.notices:
        clean = re.sub(r"^NOTICE:\s*", "", notice.strip())
        if "TEST-" in clean:
            test_reports.append(clean)
            print(f"    {clean}")

    if suite_error:
        print(
            f"\n[!] Test suite did not complete fully. "
            f"{len(test_reports)} test result(s) captured before failure.\n"
            f"    Error: {suite_error}",
            file=sys.stderr,
        )

    return test_reports, suite_error is None


# ---------------------------------------------------------------------------
# Status display
# ---------------------------------------------------------------------------

def print_migration_status(statuses: List[MigrationStatus]) -> None:
    print("\n" + "─" * 78)
    print(" MIGRATION STATUS")
    print("─" * 78)
    for s in statuses:
        if s.applied:
            ts = s.applied_at or "unknown time"
            print(f"  [✓] {s.filename:<28}  APPLIED   ({ts})")
        else:
            print(f"  [ ] {s.filename:<28}  PENDING")
    print("─" * 78)


# ---------------------------------------------------------------------------
# CLI argument parsing
# ---------------------------------------------------------------------------

def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="verify_and_migrate.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=textwrap.dedent("""\
            CampusQuiz — PostgreSQL Migration & Verification Runner
            ========================================================
            Safely apply and track schema migrations for a Neon (or standard)
            PostgreSQL 15+ database.

            Migration Tracking
            ------------------
            Migrations are recorded in a 'schema_migrations' table.
            Already-applied migrations are SKIPPED on subsequent runs.
            Each migration runs in a transaction; failures roll back cleanly.

            Neon-Specific Notes
            -------------------
            • Always use the DIRECT (unpooled) endpoint — never the '-pooler' host.
            • The script warns if it detects a pooled URL.
        """),
        epilog=textwrap.dedent("""\
            Examples:
              # Check migration status (no DB writes)
              python database/verify_and_migrate.py "postgresql://user:pass@ep-xyz.neon.tech/db?sslmode=require"

              # Apply pending migrations and run tests
              python database/verify_and_migrate.py --migrate

              # Run verification tests only (migrations already applied)
              python database/verify_and_migrate.py --tests-only

              # Mark a migration as applied without re-executing it
              python database/verify_and_migrate.py --mark-applied 01_schema.sql

              # Mark multiple migrations as applied (for reconciliation)
              python database/verify_and_migrate.py --mark-applied 01_schema.sql --mark-applied 02_procedures.sql
        """),
    )

    parser.add_argument(
        "db_url_positional",
        nargs="?",
        metavar="DATABASE_URL",
        help="PostgreSQL connection URL (overrides environment variable).",
    )
    parser.add_argument(
        "--url",
        metavar="DATABASE_URL",
        help="PostgreSQL connection URL (alternative to positional argument).",
    )
    parser.add_argument(
        "--migrate",
        action="store_true",
        help="Apply pending migrations, then run verification tests.",
    )
    parser.add_argument(
        "--tests-only",
        action="store_true",
        help="Skip migrations; only run the automated verification test suite.",
    )
    parser.add_argument(
        "--mark-applied",
        action="append",
        metavar="FILENAME",
        dest="mark_applied",
        default=[],
        help=(
            "Record a migration as already applied WITHOUT executing it. "
            "Use for reconciling a database that was migrated without tracking. "
            "Can be specified multiple times."
        ),
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Print migration status and exit (no migrations applied).",
    )

    return parser


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def resolve_db_url(args) -> Optional[str]:
    """
    Determine the database URL from CLI args or environment.
    Priority: positional arg > --url flag > environment variable.
    """
    raw: Optional[str] = None
    if args.db_url_positional:
        raw = args.db_url_positional
    elif args.url:
        raw = args.url
    else:
        raw = (
            os.getenv("DATABASE_URL")
            or os.getenv("NEON_DATABASE_URL")
            or os.getenv("STAGING_DATABASE_URL")
            or os.getenv("PGDATABASE_URL")
        )
    if not raw:
        return None
    return validate_and_clean_database_url(raw)


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    print("=" * 78)
    print(" CampusQuiz — PostgreSQL Migration & Verification Runner")
    print(" Target: Neon PostgreSQL 15+ / Standard PostgreSQL")
    print("=" * 78)

    # ------------------------------------------------------------------
    # Resolve database URL (required for every mode that touches the DB)
    # ------------------------------------------------------------------
    try:
        db_url = resolve_db_url(args)
    except ValueError as ex:
        print(f"\n[!] ERROR in database URL: {ex}", file=sys.stderr)
        sys.exit(1)

    if not db_url:
        print("\n[!] ERROR: No database connection URL found.")
        print("    Provide it via:")
        print('      1. Positional arg:   python database/verify_and_migrate.py "postgresql://..."')
        print("      2. Flag:             --url \"postgresql://...\"")
        print("      3. Environment var:  DATABASE_URL in .env or shell")
        print("\n    Example:")
        print("      postgresql://neondb_owner:pass@ep-xyz.neon.tech/neondb?sslmode=require")
        print("\n    See .env.example for reference.")
        sys.exit(1)

    # ------------------------------------------------------------------
    # Connect
    # ------------------------------------------------------------------
    conn = connect_to_database(db_url)
    if not conn:
        sys.exit(1)

    try:
        verify_server_version(conn)

        # ------------------------------------------------------------------
        # Bootstrap tracking table
        # ------------------------------------------------------------------
        # Before doing anything else, check whether the database is in an
        # ambiguous state (has CampusQuiz objects but no tracking table).
        ambiguous = check_ambiguous_state(conn)

        if ambiguous and not args.mark_applied:
            # Ensure the tracking table exists first so --mark-applied works
            ensure_tracking_table(conn)
            print(RECONCILIATION_HELP)
            print(
                "[!] Stopping. Use --mark-applied to reconcile the migration state, "
                "then re-run with --migrate.\n"
                "    Example:\n"
                "      python database/verify_and_migrate.py --mark-applied 01_schema.sql\n"
            )
            sys.exit(3)

        ensure_tracking_table(conn)

        # ------------------------------------------------------------------
        # --mark-applied mode
        # ------------------------------------------------------------------
        if args.mark_applied:
            print("\n[*] Recording migrations as applied (without execution)...")
            success = True
            for filename in args.mark_applied:
                if not mark_migration_applied(conn, filename):
                    success = False
            if not success:
                sys.exit(4)
            print("\n[+] Done. Re-run with --migrate to apply remaining pending migrations.")
            print_migration_status(get_migration_status(conn))
            return

        # ------------------------------------------------------------------
        # --status mode (or default with no --migrate / --tests-only)
        # ------------------------------------------------------------------
        if args.status or (not args.migrate and not args.tests_only):
            print_migration_status(get_migration_status(conn))
            if not args.migrate and not args.tests_only:
                print(
                    "\n[i] Run with --migrate to apply pending migrations.\n"
                    "    Run with --tests-only to run verification tests without migrating.\n"
                    "    Run with --help for full usage.\n"
                )
                return

        # ------------------------------------------------------------------
        # --migrate mode
        # ------------------------------------------------------------------
        applied_count = 0
        skipped_count = 0
        failed_file: Optional[str] = None
        captured_notices: List[str] = []

        if args.migrate:
            print("\n" + "─" * 78)
            print(" APPLYING PENDING MIGRATIONS")
            print("─" * 78)

            applied_set = get_applied_migrations(conn)

            for item in MIGRATION_FILES:
                if item.filename in applied_set:
                    print(f"[=] Skipping {item.filename} (already applied at {applied_set[item.filename]})")
                    skipped_count += 1
                    continue

                file_path = os.path.join(SCRIPT_DIR, item.filename)
                success = execute_migration_transactionally(
                    conn, file_path, item, captured_notices
                )
                if success:
                    applied_count += 1
                else:
                    failed_file = item.filename
                    print(
                        f"\n[!] STOPPING: Migration {item.filename} failed and was rolled back.\n"
                        f"    Fix the SQL error, then re-run with --migrate.",
                        file=sys.stderr,
                    )
                    sys.exit(2)

        # ------------------------------------------------------------------
        # Verification tests (--migrate always runs them; --tests-only only)
        # ------------------------------------------------------------------
        test_reports: List[str] = []
        perm_results: List[PermissionTestResult] = []
        suite_success: bool = True

        if args.migrate or args.tests_only:
            # Check that 03_permissions.sql has been applied before running perm tests
            applied_set = get_applied_migrations(conn)
            if "03_permissions.sql" not in applied_set:
                print(
                    "\n[!] WARNING: 03_permissions.sql has not been applied yet. "
                    "Permission tests will be skipped.\n"
                )
            else:
                test_file = os.path.join(SCRIPT_DIR, TEST_SUITE_FILE)
                test_reports, suite_success = run_test_file(conn, test_file)

                print("\n" + "─" * 78)
                print(" APPLICATION ROLE PERMISSION VERIFICATION")
                print("─" * 78)
                perm_results = verify_application_role_permissions(conn)
                for res in perm_results:
                    icon = "[+]" if res.status == "PASSED" else "[!]"
                    print(f"  {icon} {res.code} [{res.status}]: {res.name}")
                    print(f"       {res.detail}")

        # ------------------------------------------------------------------
        # Final summary report
        # ------------------------------------------------------------------
        final_statuses = get_migration_status(conn)

        print("\n" + "=" * 78)
        print(" DEPLOYMENT & VERIFICATION SUMMARY REPORT")
        print("=" * 78)

        print_migration_status(final_statuses)

        if args.migrate:
            print(f"\n  Migrations applied this run : {applied_count}")
            print(f"  Migrations skipped (done)   : {skipped_count}")
            if failed_file:
                print(f"  Migration FAILED            : {failed_file}")

        if args.migrate or args.tests_only:
            print(f"\n  Automated test notices      : {len(test_reports)}")
            passed_perms = sum(1 for r in perm_results if r.status == "PASSED")
            print(f"  Permission tests passed     : {passed_perms} / {len(perm_results)}")

            all_perms_ok = all(r.status == "PASSED" for r in perm_results)
            tests_ok = suite_success and len(test_reports) >= 14  # expect at least 14 test notice lines

            if all_perms_ok and tests_ok:
                print("\n  [SUCCESS] All migrations and verification tests completed successfully.")
                print("  The database is verified and ready for backend integration.")
            else:
                print("\n  [!] COMPLETED WITH WARNINGS / FAILURES. Review the output above.", file=sys.stderr)
                if not suite_success:
                    print(
                        "      SQL test suite aborted due to an execution error.",
                        file=sys.stderr,
                    )
                elif len(test_reports) < 14:
                    print(
                        f"      Expected ≥ 14 TEST- notices; received {len(test_reports)}. "
                        "Some tests may not have run.",
                        file=sys.stderr,
                    )
                if not all_perms_ok:
                    print(
                        "      One or more application role permission tests failed.",
                        file=sys.stderr,
                    )
                sys.exit(2)

    finally:
        conn.close()
        print("\n[*] Database connection closed.")


if __name__ == "__main__":
    main()
