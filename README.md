# CampusQuiz

CampusQuiz is a centralized college classroom quiz and assessment management platform designed for strict academic integrity, zero-leak multi-college isolation, and reliable concurrency.

## Project Status

* **Phase 1 (Database Architecture & Staging Preparation)**: **APPROVED & FROZEN**
* **Detailed Accomplishments & Architecture Reference**: See **[`ACCOMPLISHMENTS.md`](ACCOMPLISHMENTS.md)**.

## Database Migrations (`database/`)

The PostgreSQL 15+ database migrations are located in [`database/`](database/):

1. **[`01_schema.sql`](database/01_schema.sql)**: Extensions, roles, tables, composite tenant isolation, check constraints, partial unique indexes, and triggers.
2. **[`02_procedures.sql`](database/02_procedures.sql)**: Stored procedures with HMAC replay expiry protection, zero-downtime secret rotation, and two-tier negative-marking inheritance.
3. **[`03_permissions.sql`](database/03_permissions.sql)**: Least-privilege function ownership, column-level security, and sensitive data access restrictions.
4. **[`04_security_hardening.sql`](database/04_security_hardening.sql)**: Hardened SECURITY DEFINER functions, search-path pinning, and table-level least-privilege enforcement.
5. **[`05_fix_for_share_of.sql`](database/05_fix_for_share_of.sql)**: Fix `FOR SHARE OF qs` table-alias locking in `sp_start_quiz_attempt`.
6. **[`06_fix_student_response_record.sql`](database/06_fix_student_response_record.sql)**: Fix `v_saved_version` scalar assignment in `sp_save_student_response`.
7. **[`campusquiz_complete.sql`](database/campusquiz_complete.sql)**: Consolidated master migration script.
8. **[`verify_and_migrate.py`](database/verify_and_migrate.py)**: Automated deployment and test verification runner.

## Setup & Staging Deployment

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Configure your Neon PostgreSQL connection string in `.env`:
   ```env
   DATABASE_URL=postgresql://[user]:[password]@[endpoint].neon.tech/[dbname]?sslmode=require
   ```
3. Run the automated migration and test runner:
   ```bash
   python database/verify_and_migrate.py
   ```
4. Run verification tests only (migrations already applied):
   ```bash
   python database/verify_and_migrate.py --tests-only
   ```
5. Run the Python unit test suite:
   ```bash
   python -m pytest database/test_verify_and_migrate.py -v
   ```
