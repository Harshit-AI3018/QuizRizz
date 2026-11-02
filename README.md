# CampusQuiz 🎓

> **A high-integrity, multi-tenant institutional assessment and quiz platform designed for centralized college classroom evaluation, strict academic integrity, zero-leak tenant isolation, and reliable real-time autosave.**

---

## 📚 Key Documentation

| Document | Description |
| :--- | :--- |
| 📘 **[Architecture & Developer Handoff](docs/ARCHITECTURE_AND_DEVELOPER_HANDOFF.md)** | **Definitive technical guide** — complete database ERD, stored procedures directory, HMAC authentication, scoring formulas, API contract roadmap, and onboarding checklist. |
| 📋 **[Milestone & Accomplishments Summary](ACCOMPLISHMENTS.md)** | Executive summary of Phase 0 database completion, security audits, and verification test reports. |

---

## 🚦 Project Status

* **Phase 0 — Database Architecture & Hardening**: **`COMPLETED, VERIFIED & FROZEN`**
  * 6 sequential migrations applied to Neon Serverless PostgreSQL 18.6 (`campusquiz_db`).
  * 35 integration assertions (`TEST-01A` through `TEST-14B`) passing inside transactional rollback.
  * 9/9 restricted application role (`campusquiz_app`) least-privilege checks passing.
  * 59/59 Python unit tests passing under `pytest`.
* **Phase 1 — Backend Foundation Scaffold**: **`IMPLEMENTED`** (FastAPI, Pydantic v2, async SQLAlchemy, health checks, and restricted-role connection setup).
* **Phase 2 — Authentication & Identity Service**: **`NEXT`**.
* **Phases 3–9 — Backend APIs**: **`PLANNED`** (administration, quiz authoring, sessions, attempts, submission, and results).
* **Phase 10 — Frontend Application**: **`PLANNED`** (Next.js / React interactive quiz engine).
* **Phases 11–12 — Testing & Deployment**: **`PLANNED`**.

---

## 🛡️ Core Architectural Highlights

* **Multi-College Tenant Isolation**: Physical data segregation enforced by composite foreign keys `(college_id, ...)` across all 21 tables — eliminating cross-institution data leakage at the database level.
* **Least-Privilege Definer Model**: Backend connects via the restricted `campusquiz_app` role. Direct mutations on `quiz_attempts` and `student_responses` are revoked; all state changes flow through trusted `SECURITY DEFINER` stored procedures owned by `campusquiz_definer`.
* **Cryptographic HMAC Actor Context**: Eliminates user spoofing over pooled application connections. Every stored procedure call verifies a signed token payload (`<user_id>:<token_version>:<role>:<expires_epoch>`) with replay expiry and token revocation.
* **Proportional Scoring & Explicit Zero Overrides**: High-precision intermediate calculations (`NUMERIC(12,6)`), proportional partial credit for multiple-select questions, and explicit zero penalty preservation without artificial zero-clamping.
* **Version-Gated Atomic Autosave**: Rejects stale or conflicting responses using monotonic client version counters, while validating option memberships against frozen question bank snapshots.

---

## 🗄️ Database Migrations Registry (`database/`)

The PostgreSQL 15+ database migrations are located in [`database/`](database/):

| File | Type | Description |
| :--- | :--- | :--- |
| **[`01_schema.sql`](database/01_schema.sql)** | Migration 01 | Extensions (`pgcrypto`), roles (`campusquiz_definer`, `campusquiz_app`), 21 tables, composite foreign keys, partial unique indexes, check constraints, and triggers. |
| **[`02_procedures.sql`](database/02_procedures.sql)** | Migration 02 | Initial stored procedures for publishing, session lifecycle, attempt initiation, autosave, and scoring. |
| **[`03_permissions.sql`](database/03_permissions.sql)** | Migration 03 | Function ownership to `campusquiz_definer`, `REVOKE FROM PUBLIC`, and column-level grants for `campusquiz_app`. |
| **[`04_security_hardening.sql`](database/04_security_hardening.sql)** | Migration 04 | Search-path pinning (`SET search_path = pg_catalog, public, pg_temp`), zero-downtime secret rotation, and trigger hardening. |
| **[`05_fix_for_share_of.sql`](database/05_fix_for_share_of.sql)** | Migration 05 | Fix `FOR SHARE OF qs` table-alias row locking in `sp_start_quiz_attempt` (resolving join permission failures on `classes`). |
| **[`06_fix_student_response_record.sql`](database/06_fix_student_response_record.sql)** | Migration 06 | Introduce scalar `v_saved_version INT` in `sp_save_student_response` (preventing unassigned record assignment exceptions). |
| **[`campusquiz_complete.sql`](database/campusquiz_complete.sql)** | Master DDL | Consolidated 3,300+ line master script synchronizing all 6 migrations in sequence for fresh database environments. |
| **[`verify_and_migrate.py`](database/verify_and_migrate.py)** | Runner | Automated deployment runner supporting `--migrate`, `--tests-only`, `--status`, and `--mark-applied`. |
| **[`test_suite.sql`](database/test_suite.sql)** | Test Suite | 35-check transactional integration test file executed under single-transaction rollback. |
| **[`test_verify_and_migrate.py`](database/test_verify_and_migrate.py)** | Unit Tests | 59 unit tests verifying CLI arguments, HMAC generation, migration catalogue, permission simulations, and SQL integrity. |
| **[`auth_utils.py`](database/auth_utils.py)** | Utility | Python HMAC-SHA256 signature generator mirroring PostgreSQL `fn_verify_actor_context`. |

---

## ⚡ Quickstart & Developer Setup

### 1. Prerequisites
* **Python 3.14+** (Python 3.10+ compatible)
* **Git 2.40+**
* Access to a Neon Serverless PostgreSQL instance (or standard PostgreSQL 15+)

### 2. Installation
```powershell
# Clone repository
git clone https://github.com/pragya-shree/Quiz.git
cd Quiz

# Create and activate virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1    # Windows PowerShell
# source .venv/bin/activate     # Linux / macOS

# Install dependencies
pip install -r requirements.txt
```

### Backend Foundation

Configure `.env` using `.env.example`, with a direct PostgreSQL endpoint and the restricted `campusquiz_app` role. Start the API with:

```powershell
python -m uvicorn app.main:app --reload
```

The liveness endpoint is `GET /health/live`; `GET /health/ready` also checks the database connection. Run the backend foundation tests with:

```powershell
python -m unittest discover -s tests -v
```

### 3. Environment Configuration
Copy the template and populate your local credentials:
```powershell
cp .env.example .env
```

Configure your unpooled Neon PostgreSQL endpoint in `.env`:
```env
# Use direct unpooled endpoint (not the -pooler host)
DATABASE_URL=postgresql://neondb_owner:your_password@ep-xyz.neon.tech/campusquiz_db?sslmode=require
AUTH_HMAC_SECRET=your_staging_hmac_secret_key_minimum_32_chars_long
```

### 4. Running Verification Tests

```powershell
# 1. Run the local Python unit test suite (59 tests)
.\.venv\Scripts\python.exe -m pytest database\test_verify_and_migrate.py -v

# 2. Run the SQL verification suite against Neon (Read-Only Transactional Rollback)
python database/verify_and_migrate.py --tests-only

# 3. Check migration status on Neon
python database/verify_and_migrate.py --status
```

---

## ⚙️ Core Stored Procedures Directory

All mutations flow through these hardened PostgreSQL stored procedures:

| Procedure | Parameters | Role / Access | Purpose |
| :--- | :--- | :--- | :--- |
| `sp_publish_quiz` | `(quiz_id, actor_id, sig)` | Faculty / Admin | Atomically validates questions, calculates `total_marks`, and publishes quiz. |
| `sp_activate_quiz_session` | `(session_id, actor_id, sig)` | Faculty / Admin | Freezes question bank into immutable `snapshot_json` and opens session. |
| `sp_pause_quiz_session` | `(session_id, actor_id, sig)` | Faculty / Admin | Pauses ongoing session; prevents new attempts. |
| `sp_resume_quiz_session` | `(session_id, actor_id, sig)` | Faculty / Admin | Resumes paused session to active state. |
| `sp_complete_quiz_session` | `(session_id, actor_id, sig)` | Faculty / Admin | Completes session; enables `AFTER_SESSION_ENDS` result releases. |
| `sp_start_quiz_attempt` | `(session_id, actor_id, sig)` | Student (`STUDENT`) | Idempotently starts student attempt and returns sanitized questions (no answers). |
| `sp_save_student_response` | `(attempt_id, q_id, opts[], review, ver, ts, actor_id, sig)` | Student (`STUDENT`) | Version-gated autosave; validates option IDs and updates answer state. |
| `sp_finalize_attempt` | `(attempt_id, type, actor_id, sig)` | Student / Faculty / Admin | Evaluates student answers, scores attempt, and permanently locks responses. |
| `sp_get_student_attempt_results` | `(attempt_id, actor_id, sig)` | Student / Faculty / Admin | Returns attempt score and full question breakdown according to session visibility policy. |

---

## 📁 Repository Structure

```text
Quiz/
├── .env.example                               # Environment variable template
├── .gitignore                                 # Git exclusion rules
├── ACCOMPLISHMENTS.md                         # Milestone log and historical accomplishments
├── README.md                                  # Project overview and quickstart guide
├── requirements.txt                           # Python project dependencies
├── app/                                        # Phase 1 FastAPI backend foundation
│   ├── main.py                                 # Application factory and lifespan
│   ├── api/                                    # Health routes and DB dependencies
│   ├── core/config.py                          # Validated application settings
│   └── db/                                     # Async engine and DB-function caller
├── tests/
│   └── test_backend_foundation.py              # Backend scaffold tests
├── docs/
│   └── ARCHITECTURE_AND_DEVELOPER_HANDOFF.md # Definitive engineering architecture and handoff
└── database/
    ├── 01_schema.sql                          # Core schema DDL & constraints
    ├── 02_procedures.sql                      # Stored procedures
    ├── 03_permissions.sql                     # Function ownership & column grants
    ├── 04_security_hardening.sql              # HMAC rotation, definer hardening
    ├── 05_fix_for_share_of.sql                # Table locking concurrency fix
    ├── 06_fix_student_response_record.sql     # Autosave scalar assignment fix
    ├── auth_utils.py                          # HMAC-SHA256 signature generator
    ├── campusquiz_complete.sql                # Consolidated master SQL file
    ├── test_suite.sql                         # 35-assertion integration test suite
    ├── test_verify_and_migrate.py             # 59-test Python pytest suite
    └── verify_and_migrate.py                  # Migration & verification CLI runner
```

---

## 🔒 Non-Negotiable Engineering Invariants

1. **Database as Single Source of Truth**: Business rules enforced by check constraints, unique indexes, and triggers must never be bypassed or weakened.
2. **Never Bypass Stored Procedures**: Direct `INSERT`, `UPDATE`, or `DELETE` on `quiz_attempts` or `student_responses` is revoked for `campusquiz_app`. All runtime mutations must call `sp_*`.
3. **Never Commit Secrets**: Real credentials, `.env` files, or HMAC secrets must never be committed to source control.
4. **Preserve Migration Immutability**: Already-applied migrations (`01` through `06`) must never be modified. Future changes require new sequential migrations (`07_...sql`).

---

## 📄 License & Attribution

CampusQuiz is developed for institutional academic assessment.
Maintained by the CampusQuiz Core Engineering Team.
