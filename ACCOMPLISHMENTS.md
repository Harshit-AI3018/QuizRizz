# CampusQuiz — Architecture & Database Implementation Milestone Summary

**Status:** Database foundation complete & frozen (Phase 0 in the current project roadmap)
**Target Environment:** Neon Serverless PostgreSQL 15+ / Render Free-Tier Web Service  
**Repository Working Directory:** `D:\Quiz`  
**Generated On:** 2026-11-01  

---

## 1. Executive Summary

CampusQuiz is an institutional assessment platform designed for centralized college classroom quizzes, continuous evaluation, and secure multi-college tenant isolation. 

Over five rigorous design and review cycles, the complete database architecture, PostgreSQL DDL migrations, `SECURITY DEFINER` stored procedures, least-privilege security model, and automated verification suite have been designed, audited, corrected, and frozen.

The architecture is fully implementation-ready, with automated migration and test runners prepared for Neon Serverless PostgreSQL.

---

## 2. Key Accomplishments

### A. Architectural Decisions & Lifecycle Separation
1. **3-Tier Separation**:
   * **`quizzes`**: Reusable quiz blueprints authored by faculty (subject-scoped).
   * **`quiz_sessions`**: Concrete scheduled classroom runs bound to a specific class and academic year, containing a frozen, immutable JSON snapshot (`snapshot_json`) of all questions and options.
   * **`quiz_attempts`**: Individual student sittings with server-authoritative deadlines, versioned autosave state, and idempotent finalization.
2. **Composite Tenant Isolation**:
   * Multi-college isolation is enforced at the database level via composite foreign keys `(college_id, ...)` across all institutional entities (`users`, `departments`, `classes`, `subjects`, `quizzes`, `quiz_questions`, `quiz_sessions`, `quiz_attempts`).
   * Cross-college data leakage is physically prevented by PostgreSQL foreign key constraints.
3. **Academic Infrastructure & Active Enrollment Integrity**:
   * Academic hierarchy: `College → Department → Branch → Academic Year → Class → Subject`.
   * `faculty_assignments`: Validates that faculty are actively assigned to teach the target subject to the target class in the current academic year before session activation.
   * `student_enrollments`: Enforces at most one active `CORE` enrollment per student per academic year via a partial unique index (`WHERE enrollment_type = 'CORE' AND is_active = TRUE`), while allowing multiple concurrent `ELECTIVE` enrollments.

### B. Security & Authentication Architecture
1. **Cryptographic HMAC Authentication Context (`fn_verify_actor_context`)**:
   * Prevents identity spoofing across shared application connection pools (`campusquiz_app`).
   * **Signed Payload**: `<user_id>:<token_version>:<role_or_ANY>:<expires_epoch>`
   * **Ticket Format**: `<expires_epoch>:<hmac_hex>`
   * Validates actor active status, role membership in `user_roles`, and timestamp expiry inside PostgreSQL using `clock_timestamp()`.
   * Token version increment (`token_version = token_version + 1`) immediately invalidates all previously issued tickets.
   * Supports zero-downtime secret rotation via active key (`auth_hmac_secret`) and optional fallback key (`auth_hmac_secret_fallback`) in `app_auth_config` without requiring a separate token-management subsystem.
2. **Least-Privilege Column-Level Security**:
   * Database ownership assigned to `campusquiz_definer`.
   * Table-level `INSERT` and `UPDATE` on `student_responses` are revoked from `campusquiz_app`.
   * Column-level grants restrict `campusquiz_app` to student-editable fields (`selected_option_ids`, `is_marked_for_review`, `client_version`, `client_submitted_at`).
   * `server_received_at` is completely removed from direct `INSERT` and `UPDATE` grants for `campusquiz_app`; it is database-controlled via `DEFAULT clock_timestamp()` or stamped inside the `SECURITY DEFINER` procedure.
   * Evaluation columns (`is_evaluated`, `is_correct`, `awarded_marks`) cannot be written directly; they can only be modified by the trusted `sp_finalize_attempt` procedure.
   * Direct reads of sensitive answers (`question_options.is_correct`), frozen snapshot keys (`quiz_sessions.snapshot_json`), and evaluation fields are excluded from `campusquiz_app` `SELECT` grants.

### C. Execution & Scoring Engine
1. **Two-Tier Negative-Marking Inheritance**:
   * **Enablement Precedence**: `session` → `quiz-question` → `quiz` → `FALSE`.
   * **Penalty Precedence**: `session` → `quiz-question` → `quiz` → `question bank`.
   * **Explicit Zero Preservation**: Distinguishes NULL inheritance from explicit `FALSE` and explicit `0.0000` penalty overrides. If negative marking is disabled, penalty is guaranteed to be `0.000000`. If enabled, an explicit `0.0000` override is preserved.
2. **High-Precision Scoring & Negative Scores**:
   * Intermediate calculations evaluated using `NUMERIC(12,6)`.
   * Proportional multiple-select formula:
     $$\text{Awarded} = \left(\frac{c_{\text{selected}}}{c_{\text{total}}} \times \text{marks}\right) - (i_{\text{selected}} \times \text{penalty})$$
   * Net attempt total score supports negative numbers with no artificial zero floor; final attempt score is rounded to two decimal places (`NUMERIC(8,2)`).
3. **Clean Unanswered Question Handling**:
   * Unattempted questions are evaluated as $0.000000$ directly from `snapshot_json` without inserting blank/dummy rows into `student_responses`.
   * `sp_get_student_attempt_results` performs a `LEFT JOIN` on snapshot questions, returning clean non-null zero values (`awarded_marks = 0.000000`, `is_correct = false`, `selected_option_ids = '{}'`) once results are released.
4. **Atomic Concurrency & Autosave Guarding**:
   * Concurrent attempt creation handled idempotently via `INSERT ... ON CONFLICT (session_id, student_user_id) DO NOTHING`.
   * Autosave implemented as atomic version-gated upsert (`INSERT ... ON CONFLICT (attempt_id, question_id) DO UPDATE ... WHERE EXCLUDED.client_version > student_responses.client_version`).
   * Snapshot question membership check rejects questions outside the attempt's session snapshot.
   * Option ID validation rejects duplicates, single-select cardinality violations, and options belonging to other questions, while preserving empty selections (`'{}'`).

---

## 3. Deliverables & Project Files Index

| File | Purpose | Description |
| :--- | :--- | :--- |
| **[`01_schema.sql`](file:///d:/Quiz/database/01_schema.sql)** | Migration 01: Core DDL | Extensions (`pgcrypto`), roles (`campusquiz_definer`, `campusquiz_app`), 15 tables, composite foreign keys, partial unique indexes, check constraints, and integrity triggers. Includes `GRANT ... TO CURRENT_USER` for Neon compatibility. |
| **[`02_procedures.sql`](file:///d:/Quiz/database/02_procedures.sql)** | Migration 02: Procedures | `SECURITY DEFINER` procedures with minimal HMAC verification, expiry replay protection, secret rotation, quiz publishing, session activation, idempotent attempt start, autosave, finalization, and result retrieval. |
| **[`03_permissions.sql`](file:///d:/Quiz/database/03_permissions.sql)** | Migration 03: Security | Function ownership to `campusquiz_definer`, `REVOKE FROM PUBLIC`, least-privilege column grants for `campusquiz_app`, exclusion of `server_received_at`, and data read restrictions. |
| **[`04_tests.sql`](file:///d:/Quiz/database/04_tests.sql)** | Migration 04: Test Suite | 14 automated verification test blocks validating security, constraints, HMAC expiry, atomicity, concurrency, scoring, and lifecycle transitions. |
| **[`campusquiz_complete.sql`](file:///d:/Quiz/database/campusquiz_complete.sql)** | Master DDL Script | Consolidated 147 KB master script containing all 4 migrations in strict execution order. |
| **[`verify_and_migrate.py`](file:///d:/Quiz/database/verify_and_migrate.py)** | Deployment Runner | Automated Python script that reads `DATABASE_URL`, masks credentials, runs migrations sequentially, executes all 14 tests, and tests `campusquiz_app` role permissions via `SET ROLE`. |
| **[`.env.example`](file:///d:/Quiz/.env.example)** | Configuration Template | Template for Neon Serverless PostgreSQL connection string and HMAC secrets. |
| **[`.gitignore`](file:///d:/Quiz/.gitignore)** | Security Exclusion | Configured to prevent committing `.env`, Python virtual environments, and log files. |

---

## 4. Verification Test Suite Coverage (14 Test Blocks)

1. **TEST-01**: Least-Privilege Permissions (Column-level blocking of `awarded_marks` and `server_received_at`).
2. **TEST-02**: Multi-College Tenant Isolation & Cross-College Foreign Key Rejection.
3. **TEST-03**: Single Current Academic Year Partial Unique Index Enforcement.
4. **TEST-04**: Active Student Enrollment Constraints (Single active CORE vs multiple active ELECTIVEs).
5. **TEST-05**: Minimal HMAC Authentication Context (Forged signature rejection, valid signature acceptance, expired signature rejection, and token version bump revocation).
6. **TEST-06**: Quiz Publishing Validation & Atomicity (Rejection of incomplete quizzes, calculation of total marks).
7. **TEST-07**: Faculty Authorization & Session Creation Guard (Unauthorized publishing/activation rejection, direct ACTIVE session INSERT blocked).
8. **TEST-08**: Negative-Marking Precedence, Explicit Zero Overrides & Snapshot Immutability (Enablement: `session → quiz-question → quiz → FALSE`; Penalty: `session → quiz-question → quiz → question bank`; snapshot immutability trigger).
9. **TEST-09**: Session Lifecycle State Transitions (`SCHEDULED` → `ACTIVE` → `PAUSED` → `ACTIVE` → `COMPLETED`; invalid transitions blocked).
10. **TEST-10**: Student Attempt Creation, Concurrency & Ownership (Idempotent concurrent start, cross-student response mutation rejection).
11. **TEST-11**: Autosave Concurrency, Option Validation & Version Gating (Invalid question rejection, duplicate option rejection, foreign option rejection, idempotent retry, version conflict detection, and empty selection clearing).
12. **TEST-12**: Attempt Finalization, Submission-Type Authorization & Deadline Checks (`MANUAL`, `AUTO_TIME_EXPIRED`, `ADMIN_TERMINATED`, `SESSION_TERMINATED`).
13. **TEST-13**: Comprehensive Scoring Engine (Proportional multiple-select scoring, negative net scores without zero-floor, unattempted questions scored as 0.000000 without dummy rows).
14. **TEST-14**: Result Release Visibility Protection (`AFTER_SESSION_ENDS` withheld while ACTIVE, released on COMPLETED with non-null zero values for unattempted questions).

---

## 5. Next Immediate Action

When you are ready to execute migrations on Neon:
1. Provide the clean staging `DATABASE_URL` (in `.env` or in your response).
2. Execute `python d:\Quiz\database\verify_and_migrate.py`.
3. Review the live test output report.
4. Proceed to backend project scaffolding (FastAPI, Pydantic, SQLAlchemy Core).
