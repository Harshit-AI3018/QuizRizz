# CampusQuiz

CampusQuiz is a centralized college classroom quiz and assessment management platform designed for strict academic integrity, zero-leak multi-college isolation, and reliable concurrency.

## Project Status

* **Phase 1 (Database Architecture & Staging Preparation)**: **APPROVED & FROZEN**
* **Detailed Accomplishments & Architecture Reference**: See **[`ACCOMPLISHMENTS.md`](ACCOMPLISHMENTS.md)**.
* **Architecture Specification & DBML Diagram**: See **[`campusquiz_database_architecture.md`](file:///C:/Users/pragy/.gemini/antigravity/brain/7f4513de-2e70-4c7b-b385-c8fb3d0ac1a3/campusquiz_database_architecture.md)**.

## Database Migrations (`database/`)

The PostgreSQL 15+ database migrations are located in [`database/`](database/):

1. **[`01_schema.sql`](database/01_schema.sql)**: Extensions, roles, tables, composite tenant isolation, check constraints, partial unique indexes, and triggers.
2. **[`02_procedures.sql`](database/02_procedures.sql)**: Stored procedures with HMAC replay expiry protection, zero-downtime secret rotation, and two-tier negative-marking inheritance.
3. **[`03_permissions.sql`](database/03_permissions.sql)**: Least-privilege function ownership, column-level security, and sensitive data access restrictions.
4. **[`04_tests.sql`](database/04_tests.sql)**: 14 automated verification test blocks.
5. **[`campusquiz_complete.sql`](database/campusquiz_complete.sql)**: Consolidated master migration script.
6. **[`verify_and_migrate.py`](database/verify_and_migrate.py)**: Automated deployment and test verification runner.

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
