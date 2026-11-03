#!/usr/bin/env python3
"""
Unit and integration tests for verify_and_migrate.py.

These tests use unittest.mock to simulate psycopg2 connections.
NO actual database connections are made; NO SQL is executed on Neon.

Run with:
    python -m pytest database/test_verify_and_migrate.py -v
    -- or --
    python database/test_verify_and_migrate.py
"""

import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import os
import psycopg2
import unittest
from io import StringIO
from unittest.mock import MagicMock, patch, call

# ---------------------------------------------------------------------------
# Ensure the database directory is on sys.path so we can import the module
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import verify_and_migrate as vm


# ---------------------------------------------------------------------------
# Helper: build a minimal fake psycopg2 connection
# ---------------------------------------------------------------------------

def make_fake_conn(fetchall_rows=None, fetchone_rows=None, notices=None):
    """Return a MagicMock that behaves like a psycopg2 connection."""
    conn = MagicMock()
    conn.autocommit = True
    conn.notices = notices if notices is not None else []

    cursor = MagicMock()
    cursor.__enter__ = lambda s: cursor
    cursor.__exit__ = MagicMock(return_value=False)

    if fetchone_rows:
        cursor.fetchone.side_effect = fetchone_rows
    else:
        cursor.fetchone.return_value = None

    if fetchall_rows:
        cursor.fetchall.return_value = fetchall_rows
    else:
        cursor.fetchall.return_value = []

    conn.cursor.return_value = cursor
    return conn, cursor


# ===========================================================================
# TEST GROUP 1: URL utilities
# ===========================================================================

class TestUrlUtilities(unittest.TestCase):

    def test_mask_empty_url(self):
        self.assertEqual(vm.mask_connection_url(""), "<EMPTY>")

    def test_mask_hides_password(self):
        url = "postgresql://user:s3cr3t@host.neon.tech/db"
        masked = vm.mask_connection_url(url)
        self.assertNotIn("s3cr3t", masked)
        self.assertIn("******", masked)
        self.assertIn("user", masked)
        self.assertIn("host.neon.tech", masked)

    def test_mask_url_no_password(self):
        url = "postgresql://user@host.neon.tech/db"
        masked = vm.mask_connection_url(url)
        self.assertIn("host.neon.tech", masked)

    def test_postgres_scheme_normalised(self):
        url = vm.validate_and_clean_database_url("postgres://user:pass@host.neon.tech/db")
        self.assertTrue(url.startswith("postgresql://"))

    def test_sslmode_added_for_neon(self):
        url = vm.validate_and_clean_database_url(
            "postgresql://user:pass@ep-abc.neon.tech/db"
        )
        self.assertIn("sslmode=require", url)

    def test_sslmode_not_duplicated(self):
        url = vm.validate_and_clean_database_url(
            "postgresql://user:pass@ep-abc.neon.tech/db?sslmode=require"
        )
        self.assertEqual(url.count("sslmode="), 1)

    def test_invalid_scheme_raises(self):
        with self.assertRaises(ValueError):
            vm.validate_and_clean_database_url("mysql://user:pass@host/db")

    def test_missing_hostname_raises(self):
        with self.assertRaises(ValueError):
            vm.validate_and_clean_database_url("postgresql:///db")

    def test_pooler_url_prints_warning(self):
        url = "postgresql://user:pass@ep-abc-pooler.neon.tech/db"
        with patch("builtins.print") as mock_print:
            result = vm.validate_and_clean_database_url(url)
        # Check a warning was printed
        all_output = " ".join(str(c) for c in mock_print.call_args_list)
        self.assertIn("POOLED", all_output)
        # URL still returned despite warning
        self.assertTrue(result.startswith("postgresql://"))

    def test_quotes_stripped_from_url(self):
        url = vm.validate_and_clean_database_url("'postgresql://user:pass@host.example.com/db'")
        self.assertFalse(url.startswith("'"))


# ===========================================================================
# TEST GROUP 2: --help never connects to the database
# ===========================================================================

class TestHelpNeverConnects(unittest.TestCase):

    def test_help_exits_without_connecting(self):
        """--help must raise SystemExit(0) and must never call psycopg2.connect."""
        with patch("psycopg2.connect") as mock_connect, \
             patch("sys.stdout", new_callable=StringIO):
            with self.assertRaises(SystemExit) as ctx:
                with patch("sys.argv", ["verify_and_migrate.py", "--help"]):
                    vm.build_arg_parser().parse_args(["--help"])
            mock_connect.assert_not_called()
            self.assertEqual(ctx.exception.code, 0)

    def test_help_output_mentions_migrate_flag(self):
        parser = vm.build_arg_parser()
        buf = StringIO()
        with patch("sys.stdout", buf):
            try:
                parser.print_help()
            except SystemExit:
                pass
        help_text = buf.getvalue()
        self.assertIn("--migrate", help_text)
        self.assertIn("--mark-applied", help_text)
        self.assertIn("--tests-only", help_text)
        self.assertIn("--status", help_text)


# ===========================================================================
# TEST GROUP 3: Migration tracking table bootstrap
# ===========================================================================

class TestTrackingTable(unittest.TestCase):

    def test_ensure_tracking_table_executes_create(self):
        conn, cursor = make_fake_conn()
        vm.ensure_tracking_table(conn)
        executed_sql = cursor.execute.call_args[0][0]
        self.assertIn("CREATE TABLE IF NOT EXISTS schema_migrations", executed_sql)

    def test_get_applied_migrations_empty(self):
        conn, cursor = make_fake_conn(fetchall_rows=[])
        result = vm.get_applied_migrations(conn)
        self.assertEqual(result, {})

    def test_get_applied_migrations_with_rows(self):
        conn, cursor = make_fake_conn(
            fetchall_rows=[
                ("01_schema.sql", "2026-11-01 10:00:00+05:30"),
                ("02_procedures.sql", "2026-11-01 10:05:00+05:30"),
            ]
        )
        result = vm.get_applied_migrations(conn)
        self.assertIn("01_schema.sql", result)
        self.assertIn("02_procedures.sql", result)
        self.assertNotIn("03_permissions.sql", result)

    def test_record_migration_inserts_row(self):
        conn, cursor = make_fake_conn()
        vm.record_migration(conn, "01_schema.sql", "Schema DDL")
        executed_sql = cursor.execute.call_args[0][0]
        self.assertIn("INSERT INTO schema_migrations", executed_sql)
        params = cursor.execute.call_args[0][1]
        self.assertEqual(params[0], "01_schema.sql")


# ===========================================================================
# TEST GROUP 4: Already-applied migrations are skipped
# ===========================================================================

class TestMigrationSkipping(unittest.TestCase):

    def test_migration_status_shows_applied(self):
        conn, cursor = make_fake_conn(
            fetchall_rows=[("01_schema.sql", "2026-11-01 10:00:00+05:30")]
        )
        statuses = vm.get_migration_status(conn)
        schema_status = next(s for s in statuses if s.filename == "01_schema.sql")
        self.assertTrue(schema_status.applied)

    def test_migration_status_shows_pending(self):
        conn, cursor = make_fake_conn(fetchall_rows=[])
        statuses = vm.get_migration_status(conn)
        for s in statuses:
            self.assertFalse(s.applied)


# ===========================================================================
# TEST GROUP 5: Transactional migration execution
# ===========================================================================

class TestTransactionalExecution(unittest.TestCase):

    def _make_sql_file(self, tmp_path: str, content: str = "SELECT 1;") -> str:
        """Write a temporary SQL file and return its path."""
        path = os.path.join(tmp_path, "test_migration.sql")
        with open(path, "w") as f:
            f.write(content)
        return path

    def test_successful_migration_commits_and_records(self):
        """A successful migration should COMMIT and call record_migration."""
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            sql_path = self._make_sql_file(tmp)
            conn, cursor = make_fake_conn()
            notices: list = []
            item = vm.MigrationItem("test_migration.sql", "Test migration")

            with patch.object(vm, "record_migration") as mock_record:
                result = vm.execute_migration_transactionally(conn, sql_path, item, notices)

            self.assertTrue(result)
            conn.commit.assert_called_once()
            conn.rollback.assert_not_called()
            mock_record.assert_called_once()
            # autocommit must be restored to True after execution
            self.assertTrue(conn.autocommit)





# ===========================================================================
# TEST GROUP 11: Cryptographic HMAC Authentication Token Generation (Python)
# ===========================================================================

class TestAuthSignatureGenerator(unittest.TestCase):

    def test_signature_generation_structure(self):
        from auth_utils import generate_auth_signature
        sig = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="STUDENT",
            validity_seconds=300,
            secret="test_secret_key_2026",
            fixed_epoch=1800000000,
        )
        parts = sig.split(":")
        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0], "1800000000")
        self.assertEqual(len(parts[1]), 64)  # SHA-256 hex length

    def test_signature_deterministic_for_same_inputs(self):
        from auth_utils import generate_auth_signature
        sig1 = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=2,
            role="FACULTY",
            secret="shared_secret",
            fixed_epoch=1700000000,
        )
        sig2 = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=2,
            role="FACULTY",
            secret="shared_secret",
            fixed_epoch=1700000000,
        )
        self.assertEqual(sig1, sig2)

    def test_signature_differs_for_different_roles(self):
        from auth_utils import generate_auth_signature
        sig_student = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="STUDENT",
            secret="secret",
            fixed_epoch=1700000000,
        )
        sig_faculty = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="FACULTY",
            secret="secret",
            fixed_epoch=1700000000,
        )
        self.assertNotEqual(sig_student, sig_faculty)

    def test_empty_secret_raises_value_error(self):
        from auth_utils import generate_auth_signature
        with self.assertRaises(ValueError):
            generate_auth_signature(
                user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                token_version=1,
                secret="",
            )


# ===========================================================================
# TEST GROUP 12: Checksum recording in schema_migrations
# ===========================================================================

class TestChecksumRecording(unittest.TestCase):

    def test_record_migration_with_checksum(self):
        conn, cursor = make_fake_conn()
        vm.record_migration(conn, "04_security_hardening.sql", "Hardening", "abc123hash")
        cursor.execute.assert_called_once()
        args = cursor.execute.call_args[0][1]
        self.assertEqual(args, ("04_security_hardening.sql", "Hardening", "abc123hash"))

    def test_failed_migration_rolls_back_and_is_not_recorded(self):
        """A SQL error should ROLLBACK and NOT record the migration."""
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            sql_path = self._make_sql_file(tmp, "INVALID SQL THAT WILL FAIL;")
            conn, cursor = make_fake_conn()
            # Simulate a SQL execution error
            cursor.execute.side_effect = Exception("syntax error at or near 'INVALID'")

            notices: list = []
            item = vm.MigrationItem("test_migration.sql", "Test migration")

            with patch.object(vm, "record_migration") as mock_record, \
                 patch("sys.stderr", new_callable=StringIO):
                result = vm.execute_migration_transactionally(conn, sql_path, item, notices)

            self.assertFalse(result)
            conn.rollback.assert_called_once()
            conn.commit.assert_not_called()
            mock_record.assert_not_called()
            # autocommit must be restored to True even after failure
            self.assertTrue(conn.autocommit)





# ===========================================================================
# TEST GROUP 11: Cryptographic HMAC Authentication Token Generation (Python)
# ===========================================================================

class TestAuthSignatureGenerator(unittest.TestCase):

    def test_signature_generation_structure(self):
        from auth_utils import generate_auth_signature
        sig = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="STUDENT",
            validity_seconds=300,
            secret="test_secret_key_2026",
            fixed_epoch=1800000000,
        )
        parts = sig.split(":")
        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0], "1800000000")
        self.assertEqual(len(parts[1]), 64)  # SHA-256 hex length

    def test_signature_deterministic_for_same_inputs(self):
        from auth_utils import generate_auth_signature
        sig1 = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=2,
            role="FACULTY",
            secret="shared_secret",
            fixed_epoch=1700000000,
        )
        sig2 = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=2,
            role="FACULTY",
            secret="shared_secret",
            fixed_epoch=1700000000,
        )
        self.assertEqual(sig1, sig2)

    def test_signature_differs_for_different_roles(self):
        from auth_utils import generate_auth_signature
        sig_student = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="STUDENT",
            secret="secret",
            fixed_epoch=1700000000,
        )
        sig_faculty = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="FACULTY",
            secret="secret",
            fixed_epoch=1700000000,
        )
        self.assertNotEqual(sig_student, sig_faculty)

    def test_empty_secret_raises_value_error(self):
        from auth_utils import generate_auth_signature
        with self.assertRaises(ValueError):
            generate_auth_signature(
                user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                token_version=1,
                secret="",
            )


# ===========================================================================
# TEST GROUP 12: Checksum recording in schema_migrations
# ===========================================================================

class TestChecksumRecording(unittest.TestCase):

    def test_record_migration_with_checksum(self):
        conn, cursor = make_fake_conn()
        vm.record_migration(conn, "04_security_hardening.sql", "Hardening", "abc123hash")
        cursor.execute.assert_called_once()
        args = cursor.execute.call_args[0][1]
        self.assertEqual(args, ("04_security_hardening.sql", "Hardening", "abc123hash"))

    def test_missing_file_returns_false(self):
        conn, cursor = make_fake_conn()
        item = vm.MigrationItem("nonexistent.sql", "Missing")
        notices: list = []
        with patch("sys.stderr", new_callable=StringIO):
            result = vm.execute_migration_transactionally(
                conn, "/does/not/exist/nonexistent.sql", item, notices
            )
        self.assertFalse(result)
        conn.commit.assert_not_called()
        conn.rollback.assert_not_called()


# ===========================================================================
# TEST GROUP 6: Ambiguous state detection
# ===========================================================================

class TestAmbiguousStateDetection(unittest.TestCase):

    def _make_conn_for_detect(self, has_schema, has_procedures, has_roles, has_tracking):
        """Build a fake connection whose cursor returns controlled values for detect_existing_objects."""
        conn = MagicMock()
        conn.autocommit = True
        conn.notices = []

        cursor = MagicMock()
        cursor.__enter__ = lambda s: cursor
        cursor.__exit__ = MagicMock(return_value=False)

        # detect_existing_objects calls fetchone() 4 times
        cursor.fetchone.side_effect = [
            (1 if has_schema else 0,),      # has_schema
            (1 if has_procedures else 0,),  # has_procedures
            (1 if has_roles else 0,),       # has_roles
            (1 if has_tracking else 0,),    # has_tracking_table
        ]

        conn.cursor.return_value = cursor
        return conn

    def test_ambiguous_when_schema_exists_no_tracking(self):
        conn = self._make_conn_for_detect(
            has_schema=True, has_procedures=False, has_roles=True, has_tracking=False
        )
        self.assertTrue(vm.check_ambiguous_state(conn))

    def test_not_ambiguous_when_tracking_table_exists(self):
        conn = self._make_conn_for_detect(
            has_schema=True, has_procedures=True, has_roles=True, has_tracking=True
        )
        self.assertFalse(vm.check_ambiguous_state(conn))

    def test_not_ambiguous_when_fresh_database(self):
        conn = self._make_conn_for_detect(
            has_schema=False, has_procedures=False, has_roles=False, has_tracking=False
        )
        self.assertFalse(vm.check_ambiguous_state(conn))


# ===========================================================================
# TEST GROUP 7: --mark-applied
# ===========================================================================

class TestMarkApplied(unittest.TestCase):

    def test_mark_known_migration_inserts_record(self):
        conn, cursor = make_fake_conn(fetchone_rows=[None])  # not yet recorded
        result = vm.mark_migration_applied(conn, "01_schema.sql")
        self.assertTrue(result)
        # Verify an INSERT was executed
        all_calls = [str(c) for c in cursor.execute.call_args_list]
        self.assertTrue(any("INSERT INTO schema_migrations" in c for c in all_calls))

    def test_mark_unknown_migration_returns_false(self):
        conn, cursor = make_fake_conn()
        with patch("sys.stderr", new_callable=StringIO):
            result = vm.mark_migration_applied(conn, "nonexistent.sql")
        self.assertFalse(result)

    def test_mark_already_recorded_migration_is_idempotent(self):
        # fetchone returns a row → migration already exists
        conn, cursor = make_fake_conn(fetchone_rows=[("01_schema.sql",)])
        result = vm.mark_migration_applied(conn, "01_schema.sql")
        self.assertTrue(result)
        # Should NOT have executed an INSERT
        all_calls = [str(c) for c in cursor.execute.call_args_list]
        self.assertFalse(any("INSERT INTO schema_migrations" in c for c in all_calls))


# ===========================================================================
# TEST GROUP 8: Permission verification
# ===========================================================================

class TestPermissionVerification(unittest.TestCase):

    def test_all_tests_pass_when_operations_raise_42501(self):
        """When every prohibited SQL raises insufficient_privilege (42501), all pass."""
        conn, cursor = make_fake_conn()

        error = Exception("permission denied")
        error.pgcode = "42501"

        # First call is SET ROLE (succeeds), subsequent are the test queries
        cursor.execute.side_effect = [
            None,           # SET ROLE campusquiz_app — succeeds
            error, error, error, error, error, error, error, error, error, error, error, error,  # 12 restricted queries — all blocked
            None,           # RESET ROLE
        ]

        results = vm.verify_application_role_permissions(conn)

        self.assertEqual(len(results), 12)
        for r in results:
            self.assertEqual(r.status, "PASSED", msg=f"{r.code} was not PASSED")

    def test_test_fails_when_operation_succeeds(self):
        """If a restricted query does NOT raise an error, the test must report FAILED."""
        conn, cursor = make_fake_conn()

        # SET ROLE succeeds, first restricted query also succeeds (it should have been blocked)
        error_42501 = Exception("permission denied")
        error_42501.pgcode = "42501"

        cursor.execute.side_effect = [
            None,           # SET ROLE
            None,           # PERM-01 query succeeds — should have been blocked
            error_42501, error_42501, error_42501, error_42501,
            error_42501, error_42501, error_42501, error_42501,
            error_42501, error_42501, error_42501,  # remaining 11 blocked
            None,           # RESET ROLE
        ]

        results = vm.verify_application_role_permissions(conn)
        perm01 = next(r for r in results if r.code == "PERM-01")
        self.assertEqual(perm01.status, "FAILED")

    def test_role_switch_failure_marks_all_skipped(self):
        """If SET ROLE fails, all permission tests are SKIPPED."""
        conn, cursor = make_fake_conn()
        cursor.execute.side_effect = Exception("role does not exist")

        results = vm.verify_application_role_permissions(conn)
        self.assertEqual(len(results), 12)
        for r in results:
            self.assertEqual(r.status, "SKIPPED")


# ===========================================================================
# TEST GROUP 9: Migration catalogue completeness
# ===========================================================================

class TestMigrationCatalogue(unittest.TestCase):

    def test_all_seven_migration_files_present(self):
        filenames = [m.filename for m in vm.MIGRATION_FILES]
        self.assertIn("01_schema.sql", filenames)
        self.assertIn("02_procedures.sql", filenames)
        self.assertIn("03_permissions.sql", filenames)
        self.assertIn("04_security_hardening.sql", filenames)
        self.assertIn("05_fix_for_share_of.sql", filenames)
        self.assertIn("06_fix_student_response_record.sql", filenames)
        self.assertIn("07_revoke_app_student_responses_mutation.sql", filenames)
        self.assertNotIn("test_suite.sql", filenames)
        self.assertEqual(len(filenames), 7)
        self.assertEqual(vm.TEST_SUITE_FILE, "test_suite.sql")

    def test_migration_items_have_descriptions(self):
        for item in vm.MIGRATION_FILES:
            self.assertTrue(len(item.description) > 5, f"{item.filename} has no description")

    def test_migration_files_exist_on_disk(self):
        """All migration files and the test suite must be present on disk."""
        for item in vm.MIGRATION_FILES:
            path = os.path.join(SCRIPT_DIR, item.filename)
            self.assertTrue(
                os.path.exists(path),
                f"Migration file not found on disk: {path}"
            )
        test_suite_path = os.path.join(SCRIPT_DIR, vm.TEST_SUITE_FILE)
        self.assertTrue(
            os.path.exists(test_suite_path),
            f"Test suite file not found on disk: {test_suite_path}"
        )


# ===========================================================================
# TEST GROUP 10: Transaction state is always restored
# ===========================================================================

class TestAutocommitRestoration(unittest.TestCase):

    def test_autocommit_restored_after_success(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            sql_path = os.path.join(tmp, "ok.sql")
            with open(sql_path, "w") as f:
                f.write("SELECT 1;")

            conn, cursor = make_fake_conn()
            conn.autocommit = True

            with patch.object(vm, "record_migration"):
                vm.execute_migration_transactionally(
                    conn, sql_path, vm.MigrationItem("ok.sql", "ok"), []
                )

            self.assertTrue(conn.autocommit)





# ===========================================================================
# TEST GROUP 11: Cryptographic HMAC Authentication Token Generation (Python)
# ===========================================================================

class TestAuthSignatureGenerator(unittest.TestCase):

    def test_signature_generation_structure(self):
        from auth_utils import generate_auth_signature
        sig = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="STUDENT",
            validity_seconds=300,
            secret="test_secret_key_2026",
            fixed_epoch=1800000000,
        )
        parts = sig.split(":")
        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0], "1800000000")
        self.assertEqual(len(parts[1]), 64)  # SHA-256 hex length

    def test_signature_deterministic_for_same_inputs(self):
        from auth_utils import generate_auth_signature
        sig1 = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=2,
            role="FACULTY",
            secret="shared_secret",
            fixed_epoch=1700000000,
        )
        sig2 = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=2,
            role="FACULTY",
            secret="shared_secret",
            fixed_epoch=1700000000,
        )
        self.assertEqual(sig1, sig2)

    def test_signature_differs_for_different_roles(self):
        from auth_utils import generate_auth_signature
        sig_student = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="STUDENT",
            secret="secret",
            fixed_epoch=1700000000,
        )
        sig_faculty = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="FACULTY",
            secret="secret",
            fixed_epoch=1700000000,
        )
        self.assertNotEqual(sig_student, sig_faculty)

    def test_empty_secret_raises_value_error(self):
        from auth_utils import generate_auth_signature
        with self.assertRaises(ValueError):
            generate_auth_signature(
                user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                token_version=1,
                secret="",
            )


# ===========================================================================
# TEST GROUP 12: Checksum recording in schema_migrations
# ===========================================================================

class TestChecksumRecording(unittest.TestCase):

    def test_record_migration_with_checksum(self):
        conn, cursor = make_fake_conn()
        vm.record_migration(conn, "04_security_hardening.sql", "Hardening", "abc123hash")
        cursor.execute.assert_called_once()
        args = cursor.execute.call_args[0][1]
        self.assertEqual(args, ("04_security_hardening.sql", "Hardening", "abc123hash"))

    def test_autocommit_restored_after_failure(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            sql_path = os.path.join(tmp, "fail.sql")
            with open(sql_path, "w") as f:
                f.write("BAD SQL;")

            conn, cursor = make_fake_conn()
            conn.autocommit = True
            cursor.execute.side_effect = Exception("syntax error")

            with patch("sys.stderr", new_callable=StringIO):
                vm.execute_migration_transactionally(
                    conn, sql_path, vm.MigrationItem("fail.sql", "fail"), []
                )

            self.assertTrue(conn.autocommit)





# ===========================================================================
# TEST GROUP 11: Cryptographic HMAC Authentication Token Generation (Python)
# ===========================================================================

class TestAuthSignatureGenerator(unittest.TestCase):

    def test_signature_generation_structure(self):
        from auth_utils import generate_auth_signature
        sig = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="STUDENT",
            validity_seconds=300,
            secret="test_secret_key_2026",
            fixed_epoch=1800000000,
        )
        parts = sig.split(":")
        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0], "1800000000")
        self.assertEqual(len(parts[1]), 64)  # SHA-256 hex length

    def test_signature_deterministic_for_same_inputs(self):
        from auth_utils import generate_auth_signature
        sig1 = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=2,
            role="FACULTY",
            secret="shared_secret",
            fixed_epoch=1700000000,
        )
        sig2 = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=2,
            role="FACULTY",
            secret="shared_secret",
            fixed_epoch=1700000000,
        )
        self.assertEqual(sig1, sig2)

    def test_signature_differs_for_different_roles(self):
        from auth_utils import generate_auth_signature
        sig_student = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="STUDENT",
            secret="secret",
            fixed_epoch=1700000000,
        )
        sig_faculty = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="FACULTY",
            secret="secret",
            fixed_epoch=1700000000,
        )
        self.assertNotEqual(sig_student, sig_faculty)

    def test_empty_secret_raises_value_error(self):
        from auth_utils import generate_auth_signature
        with self.assertRaises(ValueError):
            generate_auth_signature(
                user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                token_version=1,
                secret="",
            )


# ===========================================================================
# TEST GROUP 12: Checksum recording in schema_migrations
# ===========================================================================

class TestChecksumRecording(unittest.TestCase):

    def test_record_migration_with_checksum(self):
        conn, cursor = make_fake_conn()
        vm.record_migration(conn, "04_security_hardening.sql", "Hardening", "abc123hash")
        cursor.execute.assert_called_once()
        args = cursor.execute.call_args[0][1]
        self.assertEqual(args, ("04_security_hardening.sql", "Hardening", "abc123hash"))


# ===========================================================================
# Runner
# ===========================================================================


# ===========================================================================
# TEST GROUP 11: Cryptographic HMAC Authentication Token Generation (Python)
# ===========================================================================

class TestAuthSignatureGenerator(unittest.TestCase):

    def test_signature_generation_structure(self):
        from auth_utils import generate_auth_signature
        sig = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="STUDENT",
            validity_seconds=300,
            secret="test_secret_key_2026",
            fixed_epoch=1800000000,
        )
        parts = sig.split(":")
        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0], "1800000000")
        self.assertEqual(len(parts[1]), 64)  # SHA-256 hex length

    def test_signature_deterministic_for_same_inputs(self):
        from auth_utils import generate_auth_signature
        sig1 = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=2,
            role="FACULTY",
            secret="shared_secret",
            fixed_epoch=1700000000,
        )
        sig2 = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=2,
            role="FACULTY",
            secret="shared_secret",
            fixed_epoch=1700000000,
        )
        self.assertEqual(sig1, sig2)

    def test_signature_differs_for_different_roles(self):
        from auth_utils import generate_auth_signature
        sig_student = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="STUDENT",
            secret="secret",
            fixed_epoch=1700000000,
        )
        sig_faculty = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="FACULTY",
            secret="secret",
            fixed_epoch=1700000000,
        )
        self.assertNotEqual(sig_student, sig_faculty)

    def test_empty_secret_raises_value_error(self):
        from auth_utils import generate_auth_signature
        with self.assertRaises(ValueError):
            generate_auth_signature(
                user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                token_version=1,
                secret="",
            )


# ===========================================================================
# TEST GROUP 12: Checksum recording in schema_migrations
# ===========================================================================

class TestChecksumRecording(unittest.TestCase):

    def test_record_migration_with_checksum(self):
        conn, cursor = make_fake_conn()
        vm.record_migration(conn, "04_security_hardening.sql", "Hardening", "abc123hash")
        cursor.execute.assert_called_once()
        args = cursor.execute.call_args[0][1]
        self.assertEqual(args, ("04_security_hardening.sql", "Hardening", "abc123hash"))


# ===========================================================================
# TEST GROUP 11: Cryptographic HMAC Authentication Token Generation (Python)
# ===========================================================================

class TestAuthSignatureGenerator(unittest.TestCase):

    def test_signature_generation_structure(self):
        from auth_utils import generate_auth_signature
        sig = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="STUDENT",
            validity_seconds=300,
            secret="test_secret_key_2026",
            fixed_epoch=1800000000,
        )
        parts = sig.split(":")
        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0], "1800000000")
        self.assertEqual(len(parts[1]), 64)  # SHA-256 hex length

    def test_signature_deterministic_for_same_inputs(self):
        from auth_utils import generate_auth_signature
        sig1 = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=2,
            role="FACULTY",
            secret="shared_secret",
            fixed_epoch=1700000000,
        )
        sig2 = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=2,
            role="FACULTY",
            secret="shared_secret",
            fixed_epoch=1700000000,
        )
        self.assertEqual(sig1, sig2)

    def test_signature_differs_for_different_roles(self):
        from auth_utils import generate_auth_signature
        sig_student = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="STUDENT",
            secret="secret",
            fixed_epoch=1700000000,
        )
        sig_faculty = generate_auth_signature(
            user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
            token_version=1,
            role="FACULTY",
            secret="secret",
            fixed_epoch=1700000000,
        )
        self.assertNotEqual(sig_student, sig_faculty)

    def test_empty_secret_raises_value_error(self):
        from auth_utils import generate_auth_signature
        with self.assertRaises(ValueError):
            generate_auth_signature(
                user_id="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
                token_version=1,
                secret="",
            )


# ===========================================================================
# TEST GROUP 12: Checksum recording in schema_migrations
# ===========================================================================

class TestChecksumRecording(unittest.TestCase):

    def test_record_migration_with_checksum(self):
        conn, cursor = make_fake_conn()
        vm.record_migration(conn, "04_security_hardening.sql", "Hardening", "abc123hash")
        cursor.execute.assert_called_once()
        args = cursor.execute.call_args[0][1]
        self.assertEqual(args, ("04_security_hardening.sql", "Hardening", "abc123hash"))



# ---------------------------------------------------------------------------
# Regression: run_test_file return type and failure flag
# ---------------------------------------------------------------------------

class TestRunTestFileSuccessFlag(unittest.TestCase):
    """Verify run_test_file returns (reports, True) on success and (reports, False) on error."""

    def _make_conn_with_notices(self, notices):
        """Build a fake conn whose .notices list is populated before run_test_file reads it.

        run_test_file clears conn.notices at the start (del conn.notices[:]), then reads
        conn.notices after executing the SQL.  To simulate notices arriving during execution
        we need a real list that cursor.execute() mutates as a side-effect.
        """
        notice_list = list(notices)  # real list so del conn.notices[:] works

        conn = MagicMock()
        conn.autocommit = True
        # Use a real Python list so slice-delete and iteration work correctly.
        conn.notices = notice_list

        cursor = MagicMock()
        cursor.__enter__ = lambda s: cursor
        cursor.__exit__ = MagicMock(return_value=False)
        conn.cursor.return_value = cursor
        return conn, cursor

    def test_returns_tuple_of_two(self):
        """run_test_file must return a (list, bool) tuple."""
        conn, cursor = self._make_conn_with_notices(["NOTICE:  TEST-01 [PASSED]: setup ok\n"])
        with patch("os.path.exists", return_value=True), \
             patch("builtins.open", unittest.mock.mock_open(read_data="SELECT 1;")):
            result = vm.run_test_file(conn, "fake_test.sql")
        self.assertIsInstance(result, tuple)
        self.assertEqual(len(result), 2)
        reports, success = result
        self.assertIsInstance(reports, list)
        self.assertIsInstance(success, bool)

    def test_success_flag_true_when_no_exception(self):
        """success flag must be True when cursor.execute raises no exception.

        Notices are injected as a side-effect of cursor.execute to simulate
        psycopg2 delivering them during SQL execution (after run_test_file's
        initial `del conn.notices[:]` wipe).
        """
        conn, cursor = self._make_conn_with_notices([])  # start empty

        def execute_ok(sql):
            conn.notices.append("NOTICE:  TEST-01 [PASSED]: all good\n")

        cursor.execute.side_effect = execute_ok
        with patch("os.path.exists", return_value=True), \
             patch("builtins.open", unittest.mock.mock_open(read_data="SELECT 1;")):
            reports, success = vm.run_test_file(conn, "fake_test.sql")
        self.assertTrue(success)
        # Notice was appended during execute, so it must be harvested
        self.assertGreater(len(reports), 0)

    def test_success_flag_false_when_exception(self):
        """success flag must be False when cursor.execute raises an exception."""
        conn, cursor = self._make_conn_with_notices(["NOTICE:  TEST-01 [PASSED]: setup\n"])
        cursor.execute.side_effect = Exception("syntax error at or near BEGIN")
        with patch("os.path.exists", return_value=True), \
             patch("builtins.open", unittest.mock.mock_open(read_data="SELECT 1;")):
            reports, success = vm.run_test_file(conn, "fake_test.sql")
        self.assertFalse(success)

    def test_file_not_found_returns_false(self):
        """run_test_file must return ([], False) when the SQL file is missing."""
        conn = MagicMock()
        with patch("os.path.exists", return_value=False):
            reports, success = vm.run_test_file(conn, "nonexistent.sql")
        self.assertEqual(reports, [])
        self.assertFalse(success)

    def test_reports_harvested_even_on_failure(self):
        """Notices collected before a crash must still be returned.

        run_test_file does `del conn.notices[:]` before calling cursor.execute,
        so we must inject notices as a side-effect of cursor.execute (simulating
        psycopg2 appending them mid-run before it raises an exception).
        """
        conn, cursor = self._make_conn_with_notices([])   # start empty; notices added by execute

        pre_loaded = [
            "NOTICE:  TEST-01 [PASSED]: ok\n",
            "NOTICE:  TEST-02 [PASSED]: ok\n",
        ]

        def execute_side_effect(sql):
            # Simulate psycopg2 delivering two notices then aborting
            conn.notices.extend(pre_loaded)
            raise Exception("mid-suite error")

        cursor.execute.side_effect = execute_side_effect
        with patch("os.path.exists", return_value=True), \
             patch("builtins.open", unittest.mock.mock_open(read_data="SELECT 1;")):
            reports, success = vm.run_test_file(conn, "fake_test.sql")
        self.assertFalse(success)
        self.assertEqual(len(reports), 2)


# ---------------------------------------------------------------------------
# Regression: main() exits with code 2 when SQL suite aborts
# ---------------------------------------------------------------------------

def _make_main_mock_conn():
    """Return a simple fake psycopg2 connection for main() integration tests.

    The tests that use this helper also patch verify_server_version and
    check_ambiguous_state, so the connection object only needs to satisfy
    conn.close() and conn.notices.
    """
    conn = MagicMock()
    conn.notices = []
    return conn


class TestMainExitCodeOnSuiteFailure(unittest.TestCase):
    """Verify main() exits with sys.exit(2) when run_test_file reports failure."""

    # Common patches that isolate main() from real DB calls.
    _COMMON_PATCHES = [
        "verify_and_migrate.verify_server_version",
        "verify_and_migrate.check_ambiguous_state",
        "verify_and_migrate.ensure_tracking_table",
        "verify_and_migrate.print_migration_status",
        "verify_and_migrate.get_migration_status",
        "verify_and_migrate.get_applied_migrations",
        "verify_and_migrate.load_dotenv",
    ]

    def test_main_exits_2_on_suite_failure(self):
        """main() must exit with code 2 when suite_success is False."""
        failing_reports = ["TEST-01 [PASSED]: ok"] * 20   # enough notices but suite failed
        mock_conn = _make_main_mock_conn()
        with patch("sys.argv", ["verify_and_migrate.py", "--tests-only", "--url", "postgresql://test:test@localhost:5432/test"]), \
             patch("verify_and_migrate.psycopg2") as mock_psycopg2, \
             patch("verify_and_migrate.load_dotenv"), \
             patch("verify_and_migrate.verify_server_version"), \
             patch("verify_and_migrate.check_ambiguous_state", return_value=False), \
             patch("verify_and_migrate.ensure_tracking_table"), \
             patch("verify_and_migrate.get_applied_migrations", return_value={"03_permissions.sql"}), \
             patch("verify_and_migrate.get_migration_status", return_value=[]), \
             patch("verify_and_migrate.run_test_file", return_value=(failing_reports, False)), \
             patch("verify_and_migrate.verify_application_role_permissions", return_value=[]), \
             patch("verify_and_migrate.print_migration_status"), \
             self.assertRaises(SystemExit) as cm:
            mock_psycopg2.connect.return_value = mock_conn
            vm.main()
        self.assertEqual(cm.exception.code, 2)

    def test_main_no_exit_on_success(self):
        """main() must NOT call sys.exit when suite passes and permissions pass."""
        good_reports = ["TEST-{:02d} [PASSED]: ok".format(i) for i in range(1, 20)]
        passed_perm = vm.PermissionTestResult(
            code="PERM-01", name="ok", status="PASSED", detail="ok"
        )
        mock_conn = _make_main_mock_conn()
        with patch("sys.argv", ["verify_and_migrate.py", "--tests-only", "--url", "postgresql://test:test@localhost:5432/test"]), \
             patch("verify_and_migrate.psycopg2") as mock_psycopg2, \
             patch("verify_and_migrate.load_dotenv"), \
             patch("verify_and_migrate.verify_server_version"), \
             patch("verify_and_migrate.check_ambiguous_state", return_value=False), \
             patch("verify_and_migrate.ensure_tracking_table"), \
             patch("verify_and_migrate.get_applied_migrations", return_value={"03_permissions.sql"}), \
             patch("verify_and_migrate.get_migration_status", return_value=[]), \
             patch("verify_and_migrate.run_test_file", return_value=(good_reports, True)), \
             patch("verify_and_migrate.verify_application_role_permissions", return_value=[passed_perm]), \
             patch("verify_and_migrate.print_migration_status"):
            mock_psycopg2.connect.return_value = mock_conn
            # Should complete without raising SystemExit
            try:
                vm.main()
            except SystemExit as e:
                self.fail(f"main() called sys.exit({e.code}) unexpectedly")


# ---------------------------------------------------------------------------
# Regression: Migration 05 Integrity & PostgreSQL Signature Compatibility
# ---------------------------------------------------------------------------

class TestMigration05Integrity(unittest.TestCase):
    """Verify Migration 05 preserves function signature, types, and security."""

    @classmethod
    def setUpClass(cls):
        m05_path = os.path.join(SCRIPT_DIR, "05_fix_for_share_of.sql")
        with open(m05_path, "r", encoding="utf-8") as f:
            cls.m05_sql = f.read()

    def test_sp_start_quiz_attempt_parameter_order_and_types(self):
        """Input parameters must match the deployed function signature:
        (p_session_id UUID, p_actor_user_id UUID, p_auth_signature TEXT)"""
        import re
        sig_pattern = (
            r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+sp_start_quiz_attempt\s*\(\s*"
            r"p_session_id\s+UUID\s*,\s*"
            r"p_actor_user_id\s+UUID\s*,\s*"
            r"p_auth_signature\s+TEXT\s*\)"
        )
        self.assertTrue(
            bool(re.search(sig_pattern, self.m05_sql)),
            "Parameter order must be (p_session_id UUID, p_actor_user_id UUID, p_auth_signature TEXT)"
        )

    def test_return_type_unchanged(self):
        """Returns table schema must exactly match."""
        self.assertIn("RETURNS TABLE (", self.m05_sql)
        self.assertIn("attempt_id UUID,", self.m05_sql)
        self.assertIn("status VARCHAR(20),", self.m05_sql)
        self.assertIn("deadline TIMESTAMPTZ,", self.m05_sql)
        self.assertIn("duration_minutes INT,", self.m05_sql)
        self.assertIn("snapshot_questions JSONB", self.m05_sql)

    def test_security_definer_and_search_path(self):
        """Must retain SECURITY DEFINER and hardened search path."""
        self.assertIn("SECURITY DEFINER", self.m05_sql)
        self.assertIn("SET search_path = pg_catalog, public, pg_temp", self.m05_sql)

    def test_for_share_of_qs_locking_clause(self):
        """Must use 'FOR SHARE OF qs;' and not unqualified 'FOR SHARE;' in executable SQL."""
        self.assertIn("FOR SHARE OF qs;", self.m05_sql)
        import re
        # Strip single-line comments
        executable_sql = "\n".join(
            line for line in self.m05_sql.splitlines() if not line.strip().startswith("--")
        )
        naked_for_share = re.findall(r"FOR\s+SHARE\s*;", executable_sql, re.IGNORECASE)
        self.assertEqual(len(naked_for_share), 0, "Found unqualified FOR SHARE; in executable SQL of migration 05")

    def test_authorization_checks_preserved(self):
        """Must retain actor verification and student role enforcement."""
        self.assertIn("fn_verify_actor_context(p_actor_user_id, 'STUDENT', p_auth_signature)", self.m05_sql)
        self.assertIn("FROM student_profiles WHERE user_id = p_actor_user_id", self.m05_sql)
        self.assertIn("FROM student_enrollments se", self.m05_sql)

    def test_no_drop_or_unnecessary_grants(self):
        """Must NOT contain DROP FUNCTION or GRANT/REVOKE statements in executable SQL."""
        import re
        executable_sql = "\n".join(
            line for line in self.m05_sql.splitlines() if not line.strip().startswith("--")
        )
        self.assertFalse(bool(re.search(r"\bDROP\s+FUNCTION\b", executable_sql, re.IGNORECASE)))
        self.assertFalse(bool(re.search(r"\bGRANT\b", executable_sql, re.IGNORECASE)))
        self.assertFalse(bool(re.search(r"\bREVOKE\b", executable_sql, re.IGNORECASE)))




# ---------------------------------------------------------------------------
# Regression: Migration 06 Integrity & sp_save_student_response Fix
# ---------------------------------------------------------------------------

class TestMigration06Integrity(unittest.TestCase):
    """Verify Migration 06 preserves function signature, types, and security."""

    @classmethod
    def setUpClass(cls):
        m06_path = os.path.join(SCRIPT_DIR, "06_fix_student_response_record.sql")
        with open(m06_path, "r", encoding="utf-8") as f:
            cls.m06_sql = f.read()

    def test_sp_save_student_response_signature_and_params(self):
        """Input parameters and types must match the existing deployed procedure."""
        import re
        sig_pattern = (
            r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+sp_save_student_response\s*\(\s*"
            r"p_attempt_id\s+UUID\s*,\s*"
            r"p_question_id\s+UUID\s*,\s*"
            r"p_selected_option_ids\s+UUID\[\]\s*,\s*"
            r"p_is_marked_for_review\s+BOOLEAN\s*,\s*"
            r"p_client_version\s+INT\s*,\s*"
            r"p_client_submitted_at\s+TIMESTAMPTZ\s*,\s*"
            r"p_actor_user_id\s+UUID\s*,\s*"
            r"p_auth_signature\s+TEXT\s*\)"
        )
        self.assertTrue(
            bool(re.search(sig_pattern, self.m06_sql)),
            "sp_save_student_response signature must match exact parameter list and types"
        )

    def test_return_type_unchanged(self):
        """Returns table schema must exactly match (result_status VARCHAR(25), saved_version INT)."""
        self.assertIn("RETURNS TABLE (", self.m06_sql)
        self.assertIn("result_status VARCHAR(25),", self.m06_sql)
        self.assertIn("saved_version INT", self.m06_sql)

    def test_security_definer_and_search_path(self):
        """Must retain SECURITY DEFINER and hardened search path."""
        self.assertIn("SECURITY DEFINER", self.m06_sql)
        self.assertIn("SET search_path = pg_catalog, public, pg_temp", self.m06_sql)

    def test_v_saved_version_used_and_no_unassigned_record_access(self):
        """Must use scalar v_saved_version in RETURNING, avoiding unassigned record assignment."""
        self.assertIn("v_saved_version INT;", self.m06_sql)
        self.assertIn("RETURNING client_version INTO v_saved_version;", self.m06_sql)
        self.assertNotIn("v_existing.client_version;", self.m06_sql.split("RETURNING")[1].split(";")[0])

    def test_step_7_guards_unassigned_record_with_not_found(self):
        """Step 7 must assign to v_existing as a whole and guard with IF NOT FOUND."""
        self.assertIn("INTO v_existing", self.m06_sql)
        self.assertIn("IF NOT FOUND THEN", self.m06_sql)

    def test_authorization_and_validations_preserved(self):
        """Must retain cryptographic check, attempt ownership, and option validations."""
        self.assertIn("fn_verify_actor_context(p_actor_user_id, 'STUDENT', p_auth_signature)", self.m06_sql)
        self.assertIn("v_attempt.student_user_id <> p_actor_user_id", self.m06_sql)
        self.assertIn("Duplicate option IDs submitted in response array", self.m06_sql)
        self.assertIn("STALE_REJECTED", self.m06_sql)
        self.assertIn("IDEMPOTENT_RETRY", self.m06_sql)
        self.assertIn("VERSION_CONFLICT", self.m06_sql)

    def test_no_drop_or_unnecessary_grants(self):
        """Must NOT contain DROP FUNCTION or GRANT/REVOKE in executable SQL."""
        import re
        executable_sql = "\n".join(
            line for line in self.m06_sql.splitlines() if not line.strip().startswith("--")
        )
        self.assertFalse(bool(re.search(r"\bDROP\s+FUNCTION\b", executable_sql, re.IGNORECASE)))
        self.assertFalse(bool(re.search(r"\bGRANT\b", executable_sql, re.IGNORECASE)))
        self.assertFalse(bool(re.search(r"\bREVOKE\b", executable_sql, re.IGNORECASE)))


# ===========================================================================
# TEST GROUP 17: Test Suite Auth Signatures Integrity
# ===========================================================================

class TestTestSuiteAuthSignatures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        suite_path = os.path.join(SCRIPT_DIR, "test_suite.sql")
        with open(suite_path, "r", encoding="utf-8") as f:
            cls.test_suite_sql = f.read()

    def test_sp_get_student_attempt_results_uses_any_signature(self):
        """sp_get_student_attempt_results verifies with NULL role (requiring ANY signature)."""
        self.assertIn("sp_get_student_attempt_results(v_att, v_student, v_stud_any_sig)", self.test_suite_sql)
        self.assertNotIn("sp_get_student_attempt_results(v_att, v_student, v_stud_sig)", self.test_suite_sql)

    def test_stud_any_sig_generated_with_any_role(self):
        """v_stud_any_sig must be minted with ANY role."""
        self.assertIn("v_stud_any_sig := fn_generate_auth_signature(v_student, 'ANY', 300);", self.test_suite_sql)



# ---------------------------------------------------------------------------
# Regression: Migration 07 Integrity (student_responses least-privilege)
# ---------------------------------------------------------------------------

class TestMigration07Integrity(unittest.TestCase):
    """Verify Migration 07 revokes direct mutations and preserves SELECT."""

    @classmethod
    def setUpClass(cls):
        m07_path = os.path.join(SCRIPT_DIR, "07_revoke_app_student_responses_mutation.sql")
        with open(m07_path, "r", encoding="utf-8") as f:
            cls.m07_sql = f.read()

    def test_revokes_all_from_public_and_app_role(self):
        """Must revoke ALL on student_responses from PUBLIC and campusquiz_app."""
        self.assertIn(
            "REVOKE ALL ON student_responses FROM PUBLIC, campusquiz_app;",
            self.m07_sql
        )

    def test_explicit_column_level_insert_revocations(self):
        """Must explicitly revoke column-level INSERT on all student_responses columns."""
        self.assertIn("REVOKE INSERT (", self.m07_sql)
        expected_insert_cols = [
            "id",
            "attempt_id",
            "question_id",
            "selected_option_ids",
            "is_marked_for_review",
            "client_version",
            "client_submitted_at",
            "created_at",
            "updated_at",
        ]
        for col in expected_insert_cols:
            self.assertIn(col, self.m07_sql)
        self.assertIn(") ON TABLE public.student_responses FROM campusquiz_app;", self.m07_sql)

    def test_explicit_column_level_update_revocations(self):
        """Must explicitly revoke column-level UPDATE on all student_responses columns."""
        self.assertIn("REVOKE UPDATE (", self.m07_sql)
        expected_update_cols = [
            "selected_option_ids",
            "is_marked_for_review",
            "client_version",
            "client_submitted_at",
            "updated_at",
        ]
        for col in expected_update_cols:
            self.assertIn(col, self.m07_sql)
        self.assertIn(") ON TABLE public.student_responses FROM campusquiz_app;", self.m07_sql)

    def test_restores_approved_columns_select_only(self):
        """Must grant SELECT only on approved non-evaluative columns."""
        expected_columns = [
            "id",
            "attempt_id",
            "question_id",
            "selected_option_ids",
            "is_marked_for_review",
            "client_version",
            "client_submitted_at",
            "server_received_at",
            "created_at",
            "updated_at",
        ]
        for col in expected_columns:
            self.assertIn(col, self.m07_sql)
        self.assertIn(") ON student_responses TO campusquiz_app;", self.m07_sql)

    def test_excludes_evaluative_columns_from_select(self):
        """Must NOT grant SELECT on evaluation/scoring columns."""
        import re
        executable_sql = "\n".join(
            line for line in self.m07_sql.splitlines() if not line.strip().startswith("--")
        )
        for col in ["is_evaluated", "is_correct", "awarded_marks"]:
            self.assertFalse(
                bool(re.search(r"\b" + col + r"\b", executable_sql, re.IGNORECASE)),
                f"Evaluative column {col} must not appear in executable SQL grants"
            )

    def test_no_mutation_grants_to_app_role(self):
        """Must NOT grant INSERT, UPDATE, DELETE, or TRUNCATE to campusquiz_app."""
        import re
        executable_sql = "\n".join(
            line for line in self.m07_sql.splitlines() if not line.strip().startswith("--")
        )
        self.assertFalse(bool(re.search(r"\bGRANT\s+INSERT\b", executable_sql, re.IGNORECASE)))
        self.assertFalse(bool(re.search(r"\bGRANT\s+UPDATE\b", executable_sql, re.IGNORECASE)))
        self.assertFalse(bool(re.search(r"\bGRANT\s+DELETE\b", executable_sql, re.IGNORECASE)))
        self.assertFalse(bool(re.search(r"\bGRANT\s+TRUNCATE\b", executable_sql, re.IGNORECASE)))

    def test_definer_permissions_untouched(self):
        """Must NOT revoke or modify privileges for campusquiz_definer."""
        import re
        executable_sql = "\n".join(
            line for line in self.m07_sql.splitlines() if not line.strip().startswith("--")
        )
        self.assertFalse(
            bool(re.search(r"\bcampusquiz_definer\b", executable_sql, re.IGNORECASE)),
            "Migration 07 must not alter campusquiz_definer privileges"
        )


# ===========================================================================
# TEST GROUP 15: Migration Connection & Read-Only Status Handling
# ===========================================================================

class TestMigrationConnectionAndReadOnlyStatus(unittest.TestCase):
    """
    Verify least-privilege migration connection separation and read-only status behavior:
    1. --status never executes DDL (CREATE, ALTER, DROP, TRUNCATE, INSERT, UPDATE, DELETE).
    2. Missing migration tracking table is handled safely by --status.
    3. Migration execution refuses to proceed without a privileged migration connection.
    4. Migration execution refuses to proceed when connected as campusquiz_app.
    5. Application and migration connections are resolved independently and not confused.
    6. BOOTSTRAP_SCHEMA_MIGRATIONS grants SELECT on schema_migrations to campusquiz_app.
    """

    def test_status_does_not_execute_ddl(self):
        """--status must be genuinely read-only: no CREATE, ALTER, DROP, TRUNCATE, INSERT, UPDATE, DELETE."""
        executed_sqls = []

        mock_conn = MagicMock()
        mock_conn.autocommit = True
        mock_conn.notices = []

        mock_cursor = MagicMock()
        mock_cursor.__enter__ = lambda s: mock_cursor
        mock_cursor.__exit__ = MagicMock(return_value=False)

        def record_execute(sql, *args, **kwargs):
            executed_sqls.append(str(sql).strip())

        mock_cursor.execute.side_effect = record_execute
        mock_cursor.fetchone.side_effect = [
            ("15.4",),
            ("campusquiz", "campusquiz_app"),
            (1,),
        ]
        mock_cursor.fetchall.return_value = [("01_schema.sql", "2026-11-01 10:00:00+05:30")]
        mock_conn.cursor.return_value = mock_cursor

        with patch("sys.argv", ["verify_and_migrate.py", "--status", "--url", "postgresql://campusquiz_app:pass@localhost:5432/campusquiz"]), \
             patch("verify_and_migrate.psycopg2.connect", return_value=mock_conn), \
             patch("verify_and_migrate.ensure_tracking_table") as mock_ensure, \
             patch("sys.stdout", new_callable=StringIO):
            vm.main()

        mock_ensure.assert_not_called()

        ddl_keywords = ["CREATE", "ALTER", "DROP", "TRUNCATE", "INSERT", "UPDATE", "DELETE"]
        for sql in executed_sqls:
            first_word = sql.split()[0].upper() if sql.split() else ""
            for kw in ddl_keywords:
                self.assertNotEqual(
                    first_word, kw,
                    f"--status must not execute mutation statement: {sql}"
                )

    def test_status_handles_missing_tracking_table_safely(self):
        """When schema_migrations does not exist, --status reports clearly and shows all pending without DDL."""
        mock_conn = MagicMock()
        mock_conn.autocommit = True
        mock_conn.notices = []

        mock_cursor = MagicMock()
        mock_cursor.__enter__ = lambda s: mock_cursor
        mock_cursor.__exit__ = MagicMock(return_value=False)

        mock_cursor.fetchone.side_effect = [
            ("15.4",),
            ("campusquiz", "campusquiz_app"),
            (0,),
        ]
        mock_cursor.fetchall.return_value = []
        mock_conn.cursor.return_value = mock_cursor

        stdout_buf = StringIO()
        with patch("sys.argv", ["verify_and_migrate.py", "--status", "--url", "postgresql://campusquiz_app:pass@localhost:5432/campusquiz"]), \
             patch("verify_and_migrate.psycopg2.connect", return_value=mock_conn), \
             patch("verify_and_migrate.ensure_tracking_table") as mock_ensure, \
             patch("sys.stdout", stdout_buf):
            vm.main()

        mock_ensure.assert_not_called()
        output = stdout_buf.getvalue()
        self.assertIn("schema_migrations", output)
        self.assertIn("PENDING", output)

    def test_migrate_refuses_without_migration_url(self):
        """--migrate must exit with code 1 if MIGRATION_DATABASE_URL is not set, even if DATABASE_URL is set."""
        env = {
            "DATABASE_URL": "postgresql://campusquiz_app:secret@localhost:5432/campusquiz",
        }
        stderr_buf = StringIO()
        with patch.dict(os.environ, env, clear=True), \
             patch("sys.argv", ["verify_and_migrate.py", "--migrate"]), \
             patch("verify_and_migrate.psycopg2.connect") as mock_connect, \
             patch("sys.stderr", stderr_buf), \
             self.assertRaises(SystemExit) as cm:
            vm.main()

        self.assertEqual(cm.exception.code, 1)
        mock_connect.assert_not_called()
        self.assertIn("MIGRATION_DATABASE_URL", stderr_buf.getvalue())
        self.assertIn("campusquiz_app", stderr_buf.getvalue())

    def test_migrate_refuses_when_connected_as_campusquiz_app(self):
        """--migrate must exit with code 1 if the connected user is campusquiz_app."""
        mock_conn = MagicMock()
        mock_conn.autocommit = True
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = lambda s: mock_cursor
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchone.side_effect = [
            ("15.4",),
            ("campusquiz", "campusquiz_app"),
            ("campusquiz_app",),
        ]
        mock_conn.cursor.return_value = mock_cursor

        stderr_buf = StringIO()
        with patch("sys.argv", ["verify_and_migrate.py", "--migrate", "--migration-url", "postgresql://campusquiz_app:secret@localhost:5432/campusquiz"]), \
             patch("verify_and_migrate.psycopg2.connect", return_value=mock_conn), \
             patch("verify_and_migrate.ensure_tracking_table") as mock_ensure, \
             patch("sys.stderr", stderr_buf), \
             self.assertRaises(SystemExit) as cm:
            vm.main()

        self.assertEqual(cm.exception.code, 1)
        mock_ensure.assert_not_called()
        self.assertIn("Migration execution refused: connected as restricted role 'campusquiz_app'", stderr_buf.getvalue())

    def test_app_and_migration_urls_not_confused(self):
        """resolve_app_url and resolve_migration_url must resolve their respective variables without cross-talk."""
        parser = vm.build_arg_parser()

        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://app:pass@localhost:5432/db"}, clear=True):
            args = parser.parse_args([])
            self.assertIsNotNone(vm.resolve_app_url(args))
            self.assertIn("app", vm.resolve_app_url(args))
            self.assertIsNone(vm.resolve_migration_url(args))

        with patch.dict(os.environ, {"MIGRATION_DATABASE_URL": "postgresql://owner:pass@localhost:5432/db"}, clear=True):
            args = parser.parse_args([])
            self.assertIsNone(vm.resolve_app_url(args))
            self.assertIsNotNone(vm.resolve_migration_url(args))
            self.assertIn("owner", vm.resolve_migration_url(args))

        with patch.dict(os.environ, {
            "DATABASE_URL": "postgresql://app_user:pass@localhost:5432/db",
            "MIGRATION_DATABASE_URL": "postgresql://owner_user:pass@localhost:5432/db"
        }, clear=True):
            args = parser.parse_args([])
            self.assertIn("app_user", vm.resolve_app_url(args))
            self.assertIn("owner_user", vm.resolve_migration_url(args))

        with patch.dict(os.environ, {
            "DATABASE_URL": "postgresql://env_app:pass@localhost:5432/db",
            "MIGRATION_DATABASE_URL": "postgresql://env_owner:pass@localhost:5432/db"
        }, clear=True):
            args = parser.parse_args(["--url", "postgresql://cli_app:pass@localhost:5432/db", "--migration-url", "postgresql://cli_owner:pass@localhost:5432/db"])
            self.assertIn("cli_app", vm.resolve_app_url(args))
            self.assertIn("cli_owner", vm.resolve_migration_url(args))

    def test_bootstrap_schema_migrations_grants_select_to_app(self):
        """BOOTSTRAP_SCHEMA_MIGRATIONS must grant SELECT on schema_migrations to campusquiz_app."""
        self.assertIn("GRANT SELECT ON schema_migrations TO campusquiz_app", vm.BOOTSTRAP_SCHEMA_MIGRATIONS)
        self.assertIn("CREATE TABLE IF NOT EXISTS schema_migrations", vm.BOOTSTRAP_SCHEMA_MIGRATIONS)

    def test_check_tracking_table_exists_uses_to_regclass(self):
        """check_tracking_table_exists must query to_regclass to avoid privilege-filtered information_schema."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = lambda s: mock_cursor
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchone.return_value = (True,)
        mock_conn.cursor.return_value = mock_cursor

        result = vm.check_tracking_table_exists(mock_conn)
        self.assertTrue(result)
        executed_sql = mock_cursor.execute.call_args[0][0]
        self.assertIn("to_regclass", executed_sql)
        self.assertNotIn("information_schema", executed_sql)

    def test_status_prefers_migration_url_when_configured(self):
        """--status must prefer MIGRATION_DATABASE_URL over DATABASE_URL when configured."""
        parser = vm.build_arg_parser()
        env = {
            "DATABASE_URL": "postgresql://campusquiz_app:pass@localhost:5432/db",
            "MIGRATION_DATABASE_URL": "postgresql://neondb_owner:pass@localhost:5432/db",
        }
        with patch.dict(os.environ, env, clear=True):
            args = parser.parse_args(["--status"])
            status_url = vm.resolve_status_url(args)
            self.assertIn("neondb_owner", status_url)
            self.assertNotIn("campusquiz_app", status_url)

    def test_status_falls_back_to_app_url_when_migration_url_not_configured(self):
        """--status falls back to DATABASE_URL when MIGRATION_DATABASE_URL is not set."""
        parser = vm.build_arg_parser()
        env = {
            "DATABASE_URL": "postgresql://campusquiz_app:pass@localhost:5432/db",
        }
        with patch.dict(os.environ, env, clear=True):
            args = parser.parse_args(["--status"])
            status_url = vm.resolve_status_url(args)
            self.assertIn("campusquiz_app", status_url)

    def test_get_applied_migrations_raises_on_permission_error(self):
        """get_applied_migrations must NOT swallow permission errors as an empty migration history."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = lambda s: mock_cursor
        mock_cursor.__exit__ = MagicMock(return_value=False)

        # Simulate PostgreSQL 42501 InsufficientPrivilege
        err = psycopg2.errors.InsufficientPrivilege("permission denied for table schema_migrations")
        mock_cursor.execute.side_effect = err
        mock_conn.cursor.return_value = mock_cursor

        with self.assertRaises(psycopg2.errors.InsufficientPrivilege) as cm:
            vm.get_applied_migrations(mock_conn)
        self.assertIn("permission denied", str(cm.exception))

    def test_get_applied_migrations_returns_empty_when_table_does_not_exist(self):
        """get_applied_migrations returns empty dict only when relation truly does not exist (42P01)."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = lambda s: mock_cursor
        mock_cursor.__exit__ = MagicMock(return_value=False)

        err = psycopg2.errors.UndefinedTable('relation "schema_migrations" does not exist')
        mock_cursor.execute.side_effect = err
        mock_conn.cursor.return_value = mock_cursor

        result = vm.get_applied_migrations(mock_conn)
        self.assertEqual(result, {})

    def test_get_applied_migrations_handles_null_checksums_safely(self):
        """Historical records with NULL checksums (e.g. migrations 01 and 02) must be returned safely."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = lambda s: mock_cursor
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchall.return_value = [
            ("01_schema.sql", "2026-11-01 09:40:43+00"),
            ("02_procedures.sql", "2026-11-01 11:32:46+00"),
            ("03_permissions.sql", "2026-11-01 12:07:34+00"),
        ]
        mock_conn.cursor.return_value = mock_cursor

        applied = vm.get_applied_migrations(mock_conn)
        self.assertEqual(len(applied), 3)
        self.assertIn("01_schema.sql", applied)
        self.assertIn("02_procedures.sql", applied)
        self.assertIn("03_permissions.sql", applied)


if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(sys.modules[__name__])

    runner = unittest.TextTestRunner(verbosity=2, stream=sys.stdout)
    result = runner.run(suite)

    passed = result.testsRun - len(result.failures) - len(result.errors)
    print(f"\n{'='*60}")
    print(f" Test Results: {passed} passed / {result.testsRun} total")
    if result.failures or result.errors:
        print(f" Failures: {len(result.failures)}  Errors: {len(result.errors)}")
        sys.exit(1)
    else:
        print(" All tests passed.")
    print("=" * 60)

