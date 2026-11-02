# CampusQuiz — Technical Architecture & Developer Handoff Documentation

**Document Version:** 1.0.0 (Phase 1 Baseline & Production Handoff)
**Target Audience:** Core Engineering Team, Backend/Frontend Developers, DevOps, and QA Engineers
**Repository Working Directory:** `D:\Quiz`
**Primary Git Branch:** `main`
**Target Production Database:** Neon Serverless PostgreSQL 18.6 (`campusquiz_db`)
**Runtime Compatibility:** Python 3.14+ / Node.js 20+ LTS
**Security Classification:** Institutional Assessment Engine — Strict Integrity & Least Privilege

---

## Document Status & Verification Index

To prevent confusion between what has been built versus what is designed for upcoming phases, every architectural component in this document is labeled with one of the following statuses:

* **`[IMPLEMENTED & VERIFIED]`**: Fully authored, tested, verified on live Neon PostgreSQL 18.6, and merged into `main`.
* **`[PARTIALLY IMPLEMENTED]`**: Supporting database tables/procedures or utilities exist, but backend API or frontend integration is pending.
* **`[PROPOSED]`**: Formally designed, architected, and specified in this document for upcoming phases; application code has not yet been authored.
* **`[DEFERRED]`**: Explicitly scoped out of immediate development to avoid over-engineering; scheduled for post-MVP.

---

## Table of Contents

1. [Executive Repository Inspection & Implementation State Audit](#1-executive-repository-inspection--implementation-state-audit)
2. [Project Overview & Core Mission](#2-project-overview--core-mission)
3. [Functional Requirements Specification](#3-functional-requirements-specification)
4. [Complete System Architecture](#4-complete-system-architecture)
5. [Database Architecture & Data Model](#5-database-architecture--data-model)
6. [Stored Procedures & Database Operations Reference](#6-stored-procedures--database-operations-reference)
7. [Security Architecture & Least-Privilege Definer Model](#7-security-architecture--least-privilege-definer-model)
8. [High-Precision Scoring Engine & Negative Marking Architecture](#8-high-precision-scoring-engine--negative-marking-architecture)
9. [Backend Architecture (FastAPI Core)](#9-backend-architecture-fastapi-core)
10. [Frontend Architecture (Interactive Quiz UI)](#10-frontend-architecture-interactive-quiz-ui)
11. [REST API Contract & Endpoint Roadmap](#11-rest-api-contract--endpoint-roadmap)
12. [Complete User Workflows & Sequence Diagrams](#12-complete-user-workflows--sequence-diagrams)
13. [Testing, Verification & Quality Assurance](#13-testing-verification--quality-assurance)
14. [Developer Environment & Onboarding Guide (Windows / Linux / macOS)](#14-developer-environment--onboarding-guide-windows--linux--macos)
15. [Production Deployment Architecture](#15-production-deployment-architecture)
16. [Step-by-Step Development Roadmap (Phases 0 through 12)](#16-step-by-step-development-roadmap-phases-0-through-12)
17. [Git, Branching & Team Collaboration Conventions](#17-git-branching--team-collaboration-conventions)
18. [Non-Negotiable Architecture Invariants & Rules](#18-non-negotiable-architecture-invariants--rules)
19. [Known Limitations, Incomplete Features & Open Decisions](#19-known-limitations-incomplete-features--open-decisions)
20. [Final Teammate Handoff Checklist](#20-final-teammate-handoff-checklist)

---

## 1. Executive Repository Inspection & Implementation State Audit

A rigorous inspection of the current repository at `D:\Quiz` on branch `main` establishes the exact boundary of what exists today:

### What Is Implemented on Disk and Verified Live `[IMPLEMENTED & VERIFIED]`
* **Database Migrations (`database/01_schema.sql` through `database/06_fix_student_response_record.sql`)**: 6 migration files applied, tracked, and verified on Neon PostgreSQL 18.6.
* **Master SQL Script (`database/campusquiz_complete.sql`)**: 3,300+ line consolidated script containing the full schema, triggers, and procedures for bootstrapping fresh environments.
* **Python Database Runner (`database/verify_and_migrate.py`)**: Production-grade migration and verification tool with transactional execution, connection sanitization, and automated permission auditing.
* **SQL Integration Test Suite (`database/test_suite.sql`)**: 14 test blocks (35 distinct assertions) passing with 100% clean rollback.
* **Python Migration Unit Test Suite (`database/test_verify_and_migrate.py`)**: 59 automated unit tests passing under `pytest`.
* **Backend HMAC Token Utility (`database/auth_utils.py`)**: Cryptographic HMAC-SHA256 actor context ticket generator matching PostgreSQL's `fn_verify_actor_context`.
* **Configuration Files**: `.env.example`, `.gitignore`, `requirements.txt`, `README.md`, `ACCOMPLISHMENTS.md`.

### What Does NOT Exist Yet `[PROPOSED]`
* **Backend Application Code**: There is currently no `app/` or `src/` directory. FastAPI routers, Pydantic schemas, SQLAlchemy database session managers, dependency injection chains, and backend middleware are completely unwritten.
* **Frontend Application Code**: There is currently no frontend directory (e.g., Next.js, React, or Vite). The user interfaces for students, faculty, and administrators have not been scaffolded.

> [!IMPORTANT]
> **To Incoming Developers:** Do not assume backend API endpoints or UI components exist. You are receiving a pristine, bulletproof, fully verified **Database Foundation (Phase 0)**. Your mission begins with **Phase 1: Backend Foundation Scaffold**.

---

## 2. Project Overview & Core Mission

CampusQuiz is an institutional assessment platform engineered for continuous classroom evaluation, quizzes, midterms, and finals in colleges and universities.

### The Problem It Solves
1. **Academic Dishonesty & Session Leaks**: Commercial quiz systems frequently leak answer keys or option correctness through frontend client payloads, inspectable network requests, or weak access controls.
2. **Multi-Tenant College Contamination**: Traditional multi-tenant applications rely on application-level filtering (`WHERE college_id = ?`). A single developer oversight in an API endpoint leaks one college's proprietary question bank or student data to another.
3. **Autosave Race Conditions & Submission Freezes**: Distributed student clients submitting concurrently over campus Wi-Fi experience network drops, stale packet overwrites, and lock contention during mass submissions.
4. **Flawed Negative-Marking Systems**: Assessment platforms often fail to cleanly distinguish between questions where negative marking was explicitly disabled versus inherited, and artificially floor negative marks at zero.

### Intended User Personas
* **Students**: Sit for assigned quizzes under server-enforced time windows, submit answers with atomic version-gated autosave, and view detailed explanations only when results are authorized for release.
* **Faculty**: Author reusable subject-scoped questions, assemble quizzes, configure hierarchical negative marking, schedule concrete classroom sessions, monitor ongoing attempts, and release graded results.
* **Institutional Administrators**: Manage colleges, departments, branches, academic years, classes, and student enrollments with strict validation ensuring students have exactly one active core enrollment per academic year.

---

## 3. Functional Requirements Specification

```
===================================================================================
Feature Capability Matrix: Implemented Database Core vs. Planned Application Layer
===================================================================================
```

| Domain | Capability | Database Tier `[IMPLEMENTED]` | Backend API `[PLANNED]` | Frontend UI `[PLANNED]` |
| :--- | :--- | :--- | :--- | :--- |
| **Identity** | User Registration & Role Assignment | `users`, `roles`, `user_roles` | Auth Router | Login / Signup Screen |
| **Identity** | Password Reset & Token Version Invalidation | `token_version` column | Revocation Endpoint | Settings / Profile |
| **Tenancy** | College Multi-Tenant Isolation | Composite FKs `(college_id, ...)` | Dependency Injection | College Selector / Subdomain |
| **Academic** | Department, Branch, Class, Subject Hierarchy | 6 relational tables + constraints | Admin Academic API | Admin Console |
| **Academic** | Single Active Core Enrollment Enforcement | Partial Unique Index `uq_student_single_core_enrollment` | Enrollment Service | Student Management |
| **Authoring** | Question Bank Creation (MCQ, True/False, Multiple Select) | `questions`, `question_options` | Question API | Rich Question Editor |
| **Authoring** | Quiz Assembly & Sequence Ordering | `quizzes`, `quiz_questions` | Quiz Builder API | Quiz Drafting Canvas |
| **Authoring** | Atomic Publishing Validation | `sp_publish_quiz` | Publishing Endpoint | Publish Confirmation Modal |
| **Lifecycle** | Classroom Session Scheduling | `quiz_sessions` | Session Scheduler API | Faculty Session Form |
| **Lifecycle** | Session Activation & Snapshot Freezing | `sp_activate_quiz_session` | Session Control API | Faculty Live Control Panel |
| **Lifecycle** | Session Pause, Resume, Complete, Cancel | `sp_pause/resume/complete/cancel` | Lifecycle API | Emergency Control Bar |
| **Execution** | Idempotent Student Attempt Start | `sp_start_quiz_attempt` | Attempt Start API | Student Quiz Lobby |
| **Execution** | Version-Gated Autosave & Stale Prevention | `sp_save_student_response` | Autosave API | Live Test Interface |
| **Execution** | Mark for Review & Client Navigation State | `is_marked_for_review`, `client_state` | State Sync API | Question Palette |
| **Execution** | Server-Authoritative Deadlines | `deadline` column + triggers | Timer Validation | Countdown Clock HUD |
| **Scoring** | Proportional Multiple-Select Scoring | `sp_finalize_attempt` | Submission API | Submit Dialog |
| **Scoring** | Explicit Zero Penalty Preservation | `negative_penalty_override` | Scoring Engine | Penalty Configurator |
| **Scoring** | Clean Unanswered Question Handling | Zero-marks without dummy rows | Score Aggregator | Breakdown Table |
| **Analytics** | Visibility Release Enforcement | `sp_get_student_attempt_results` | Results API | Student Results View |
| **Analytics** | Faculty Session Performance Reports | Cross-attempt SQL aggregates | Analytics API | Faculty Analytics Dashboard |

---

## 4. Complete System Architecture

### Logical Architecture & Trust Boundaries

The system is partitioned into three distinct security and operational tiers:
1. **Untrusted Client Tier (Browser / Mobile)**: Never possesses database credentials, never receives correct option flags (`is_correct`), and never communicates directly with PostgreSQL.
2. **Application Tier (FastAPI)**: Connects to PostgreSQL exclusively via the restricted role `campusquiz_app`. Authenticates HTTP requests, generates cryptographic HMAC actor context tickets, and executes database stored procedures.
3. **Database Tier (Neon PostgreSQL 18.6)**: Acts as the ultimate authority on academic integrity, security bounds, and scoring. Stored procedures run with `SECURITY DEFINER` privileges owned by `campusquiz_definer`.

```mermaid
flowchart TD
    subgraph ClientTier["Untrusted Client Tier (Web / Mobile)"]
        UI_Student["Student Quiz UI (React / Next.js)"]
        UI_Faculty["Faculty Assessment Portal"]
        UI_Admin["Institutional Admin Dashboard"]
    end

    subgraph AppTier["FastAPI Application Tier (campusquiz_app role)"]
        Gateway["API Gateway & CORS / Rate Limiter"]
        AuthMiddleware["JWT / Session Auth & Role Gate"]
        HMAC_Gen["auth_utils.py (HMAC Ticket Minter)"]

        subgraph APIRouters["API Routers"]
            R_Auth["/api/v1/auth"]
            R_Academic["/api/v1/academic"]
            R_Quizzes["/api/v1/quizzes"]
            R_Sessions["/api/v1/sessions"]
            R_Attempts["/api/v1/attempts"]
            R_Results["/api/v1/results"]
        end

        subgraph ServiceLayer["Business Service Layer"]
            S_Auth["Identity Service"]
            S_Quiz["Quiz Builder Service"]
            S_Session["Lifecycle Engine"]
            S_Attempt["Attempt & Autosave Service"]
            S_Result["Analytics Service"]
        end

        DB_Pool["SQLAlchemy Connection Pool (campusquiz_app)"]
    end

    subgraph DB_Tier["Database Tier (Neon PostgreSQL 18.6)"]
        direction TB
        AppRole["Role: campusquiz_app\n(Least Privilege: No direct writes to attempts/responses,\nNo access to secrets, is_correct, or snapshots)"]

        subgraph DefinerRoutines["SECURITY DEFINER Stored Procedures (campusquiz_definer)"]
            SP_Pub["sp_publish_quiz"]
            SP_Sess["sp_activate / pause / resume / complete_session"]
            SP_Start["sp_start_quiz_attempt"]
            SP_Save["sp_save_student_response"]
            SP_Fin["sp_finalize_attempt"]
            SP_Res["sp_get_student_attempt_results"]
        end

        subgraph SecTriggers["Active Integrity Triggers"]
            T_Snap["trg_freeze_session_snapshot\n(Immutable snapshot_json)"]
            T_Life["trg_validate_session_status\n(Strict state transitions)"]
            T_Guard["trg_guard_student_responses\n(Blocks mutation on finalized attempts)"]
        end

        subgraph PhysicalTables["Relational Schema (21 Tables)"]
            T_Core["Tenants & Academic Infrastructure\n(colleges, users, departments, classes, subjects)"]
            T_Quiz["Assessment Blueprints\n(quizzes, quiz_questions, questions, question_options)"]
            T_Runtime["Runtime Execution\n(quiz_sessions, quiz_attempts, student_responses)"]
            T_Config["Security Config\n(app_auth_config: auth_hmac_secret)"]
        end
    end

    UI_Student -->|HTTPS / JSON| Gateway
    UI_Faculty -->|HTTPS / JSON| Gateway
    UI_Admin -->|HTTPS / JSON| Gateway

    Gateway --> AuthMiddleware
    AuthMiddleware --> APIRouters
    APIRouters --> ServiceLayer
    ServiceLayer --> HMAC_Gen
    HMAC_Gen -.->|Signs Actor Ticket| ServiceLayer
    ServiceLayer --> DB_Pool

    DB_Pool -->|Direct Unpooled SSL Connection| AppRole
    AppRole -->|Calls Authorized SPs with HMAC Ticket| DefinerRoutines
    DefinerRoutines -->|Executes within hardened search_path| PhysicalTables
    PhysicalTables -.->|Enforces Triggers| SecTriggers
```

---

## 5. Database Architecture & Data Model

The database comprises **21 tables** partitioned into four logical domains. All tables reside in schema `public` and use UUID primary keys generated by `gen_random_uuid()`.

### Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    colleges ||--o{ users : "has"
    colleges ||--o{ departments : "contains"
    colleges ||--o{ academic_years : "schedules"
    departments ||--o{ branches : "offers"
    departments ||--o{ subjects : "owns"
    branches ||--o{ classes : "contains"
    academic_years ||--o{ classes : "runs"
    academic_years ||--o{ faculty_assignments : "scopes"
    academic_years ||--o{ student_enrollments : "scopes"

    users ||--o{ user_roles : "assigned"
    roles ||--o{ user_roles : "categorizes"
    users ||--o| faculty_profiles : "extends"
    users ||--o| student_profiles : "extends"

    users ||--o{ faculty_assignments : "assigned"
    subjects ||--o{ faculty_assignments : "taught_in"
    classes ||--o{ faculty_assignments : "receives"

    users ||--o{ student_enrollments : "enrolled"
    classes ||--o{ student_enrollments : "belongs_to"

    subjects ||--o{ questions : "contains"
    questions ||--o{ question_options : "has"

    users ||--o{ quizzes : "authors"
    subjects ||--o{ quizzes : "categorized_by"
    quizzes ||--o{ quiz_questions : "includes"
    questions ||--o{ quiz_questions : "referenced_in"

    quizzes ||--o{ quiz_sessions : "instantiated_by"
    classes ||--o{ quiz_sessions : "assigned_to"
    users ||--o{ quiz_sessions : "managed_by"

    quiz_sessions ||--o{ quiz_attempts : "yields"
    users ||--o{ quiz_attempts : "sits_for"

    quiz_attempts ||--o{ student_responses : "contains"
    questions ||--o{ student_responses : "answers"
```

### Complete Schema Table Reference

#### 1. System & Authentication
* **`app_auth_config`**: Definer-only configuration table storing internal cryptographic secrets (`auth_hmac_secret`, `auth_hmac_secret_fallback`). Never readable by `campusquiz_app`.
* **`colleges`**: Multi-tenant institutional roots. Contains `name`, `code` (Unique), `is_active`.
* **`roles`**: System role catalog (`ADMIN`, `FACULTY`, `STUDENT`).
* **`users`**: Central identity table. Contains `college_id`, `email`, `password_hash`, `first_name`, `last_name`, `token_version` (revocation counter), `is_active`. Enforces lowercase email.
* **`user_roles`**: Composite role mapping table `(user_id, role_code)`. Enforces multi-college integrity via composite FK `(college_id, user_id)` referencing `users(college_id, id)`.

#### 2. Academic Infrastructure
* **`departments`**: Academic departments within a college (e.g., Computer Science). Enforces `UNIQUE(college_id, code)`.
* **`branches`**: Academic disciplines under a department (e.g., Software Engineering).
* **`academic_years`**: Institutional calendars (e.g., `2025-2026`). Enforces `chk_academic_years_date_range (start_date < end_date)`. Contains partial unique index:
  ```sql
  CREATE UNIQUE INDEX uq_ay_single_current ON academic_years (college_id) WHERE is_current = TRUE;
  ```
* **`classes`**: Concrete student cohorts (e.g., CSE-3A). Bound to `college_id`, `branch_id`, and `academic_year_id`. Enforces semester ranges ($1 \le \text{sem} \le 12$) and year of study ($1 \le \text{year} \le 6$).
* **`subjects`**: Courses taught within departments (e.g., CS101 Algorithms).
* **`faculty_profiles`**: Faculty metadata (`employee_id`, `department_id`, `designation`). Enforces uppercase employee IDs (`chk_faculty_emp_uppercase`).
* **`student_profiles`**: Student metadata (`roll_number`, `registration_number`). Enforces uppercase roll numbers (`chk_student_roll_uppercase`).
* **`faculty_assignments`**: Authoritative record linking faculty to a subject, class, and academic year.
* **`student_enrollments`**: Authoritative student class membership. Contains partial unique index guaranteeing only one active core enrollment per student per academic year:
  ```sql
  CREATE UNIQUE INDEX uq_student_single_core_enrollment
  ON student_enrollments (student_user_id, academic_year_id)
  WHERE enrollment_type = 'CORE' AND is_active = TRUE;
  ```

#### 3. Assessment Blueprint & Question Bank
* **`questions`**: Reusable question repository. Supports `MCQ`, `TRUE_FALSE`, and `MULTIPLE_SELECT`. Stores `default_marks` (default 1.0000) and `default_negative_penalty` (default 0.0000).
* **`question_options`**: Options belonging to questions. Stores `option_text`, `is_correct` (boolean), `display_order`. **Protected:** `campusquiz_app` cannot SELECT `is_correct`.
* **`quizzes`**: Reusable assessment blueprints created by faculty. Stores `title`, `instructions`, `default_duration_minutes`, `total_marks`, `status` (`DRAFT`, `PUBLISHED`, `ARCHIVED`), and `default_result_visibility`.
* **`quiz_questions`**: Junction table ordering questions within a quiz. Supports individual `marks_override` and `negative_penalty_override`.

#### 4. Runtime Execution & Scoring Engine
* **`quiz_sessions`**: The live or scheduled classroom event. Carries `session_code` (unique 6-digit access code), `start_window_time`, `end_window_time`, `duration_minutes`, `status` (`SCHEDULED`, `ACTIVE`, `PAUSED`, `COMPLETED`, `CANCELLED`), and `snapshot_json`.
  * **Protected:** `snapshot_json` is frozen upon activation by `trg_freeze_session_snapshot` and is excluded from `campusquiz_app` SELECT permissions.
* **`quiz_attempts`**: Individual student exam sitting. Stores `started_at`, `deadline`, `submitted_at`, `finalized_at`, `status` (`IN_PROGRESS`, `FINALIZED`, `ABANDONED`), `submission_type` (`MANUAL`, `AUTO_TIME_EXPIRED`, `ADMIN_TERMINATED`, `SESSION_TERMINATED`), and `total_score`.
  * **Protected:** Direct INSERT, UPDATE, DELETE revoked from `campusquiz_app`. Total score supports negative numbers with no check constraint (`total_score >= 0`).
* **`student_responses`**: Student answers to snapshot questions. Stores `selected_option_ids` (UUID array), `client_version`, `client_submitted_at`, `server_received_at` (database-authoritative timestamp), `is_evaluated`, `is_correct`, and `awarded_marks`.
  * **Protected:** Immutable once attempt is finalized via `trg_guard_student_responses`. Direct mutation of `awarded_marks`, `is_evaluated`, `is_correct`, and `server_received_at` blocked for application role.

---

## 6. Stored Procedures & Database Operations Reference

All business logic mutations on assessments execute through PostgreSQL `SECURITY DEFINER` stored procedures. Bypassing these procedures via direct table updates is impossible due to table and column-level permission revocations.

### Stored Procedure Directory

#### 1. `sp_publish_quiz`
* **Signature**: `(p_quiz_id UUID, p_actor_user_id UUID, p_auth_signature TEXT)`
* **Returns**: `TABLE (quiz_id UUID, status VARCHAR(20), total_marks NUMERIC(8,2))`
* **Actor & Auth**: Faculty author or Admin. Verified with role `'ANY'` at gate, verified as quiz creator inside procedure.
* **Validation**:
  * Calls `fn_validate_quiz_for_publishing(p_quiz_id)`.
  * Verifies quiz has at least one question.
  * Verifies every question has at least two options.
  * Verifies every question has at least one correct option.
  * Verifies True/False questions have exactly two options and exactly one correct option.
  * Verifies Single-Choice MCQ has exactly one correct option.
* **Effects**: Atomically sums question marks and marks quiz as `PUBLISHED`.

#### 2. `sp_activate_quiz_session`
* **Signature**: `(p_session_id UUID, p_actor_user_id UUID, p_auth_signature TEXT)`
* **Returns**: `JSONB` (The frozen `snapshot_json`)
* **Actor & Auth**: Assigned Faculty or Admin.
* **Validation**: Session must be in `SCHEDULED` status. Current timestamp must be before `end_window_time`.
* **Effects**:
  * Resolves hierarchical negative marking precedence for every question.
  * Builds the immutable `snapshot_json` capturing all questions, options, marks, and penalties.
  * Transitions session status to `ACTIVE`.
  * Sets `actual_started_at = clock_timestamp()`.

#### 3. `sp_pause_quiz_session` / `sp_resume_quiz_session`
* **Signature**: `(p_session_id UUID, p_actor_user_id UUID, p_auth_signature TEXT)`
* **Returns**: `VARCHAR(20)` (Updated status: `PAUSED` or `ACTIVE`)
* **Effects**: Transitions session state. Validated by transition trigger `trg_validate_session_status`.

#### 4. `sp_complete_quiz_session`
* **Signature**: `(p_session_id UUID, p_actor_user_id UUID, p_auth_signature TEXT)`
* **Returns**: `VARCHAR(20)` (`COMPLETED`)
* **Effects**: Marks session `COMPLETED`, records `actual_ended_at`.

#### 5. `sp_cancel_quiz_session`
* **Signature**: `(p_session_id UUID, p_actor_user_id UUID, p_auth_signature TEXT)`
* **Returns**: `VARCHAR(20)` (`CANCELLED`)
* **Effects**: Marks session `CANCELLED`, rendering all associated in-progress attempts abandonable.

#### 6. `sp_release_session_results`
* **Signature**: `(p_session_id UUID, p_actor_user_id UUID, p_auth_signature TEXT)`
* **Returns**: `TIMESTAMPTZ` (`results_released_at`)
* **Effects**: Stamps `results_released_at = clock_timestamp()` for sessions configured with `UPON_FACULTY_RELEASE`.

#### 7. `sp_start_quiz_attempt`
* **Signature**: `(p_session_id UUID, p_actor_user_id UUID, p_auth_signature TEXT)`
* **Returns**: `TABLE (attempt_id UUID, status VARCHAR(20), deadline TIMESTAMPTZ, duration_minutes INT, snapshot_questions JSONB)`
* **Actor & Auth**: Enrolled student. Must supply signature minted for role `'STUDENT'`.
* **Concurrency Locking**: Executes `SELECT ... FROM quiz_sessions qs JOIN classes c ... FOR SHARE OF qs;` to lock the session row without encountering permission conflicts on `classes`.
* **Idempotency**: If the student already started this session, returns their existing attempt and deadline idempotently without creating duplicates.
* **Sanitization**: Strips all `is_correct` flags and sensitive authoring metadata from `snapshot_questions` before returning payload to the client.

#### 8. `sp_save_student_response`
* **Signature**: `(p_attempt_id UUID, p_question_id UUID, p_selected_option_ids UUID[], p_is_marked_for_review BOOLEAN, p_client_version INT, p_client_submitted_at TIMESTAMPTZ, p_actor_user_id UUID, p_auth_signature TEXT)`
* **Returns**: `TABLE (result_status VARCHAR(25), saved_version INT)`
* **Possible Statuses**:
  * `ACCEPTED`: Answer version was strictly greater than current version; successfully saved.
  * `IDEMPOTENT_RETRY`: Exact same options submitted with identical version; acknowledged cleanly without re-executing.
  * `STALE_REJECTED`: Client submitted a version lower than already saved on server.
  * `VERSION_CONFLICT`: Conflicting options submitted on the same version counter.
* **Validation**:
  * Rejects options not belonging to the question (`INVALID_OPTION_SUBMITTED`).
  * Rejects duplicate option IDs in the array (`DUPLICATE_OPTION_SUBMITTED`).
  * Rejects multiple options for single-choice questions (`CARDINALITY_VIOLATION`).
  * Allows empty array (`'{}'`) to clear an answer.
  * Enforces attempt ownership (`v_attempt.student_user_id = p_actor_user_id`).
  * Enforces deadline ($clock\_timestamp \le v\_attempt.deadline$).

#### 9. `sp_finalize_attempt`
* **Signature**: `(p_attempt_id UUID, p_submission_type VARCHAR(25), p_actor_user_id UUID, p_auth_signature TEXT)`
* **Returns**: `TABLE (final_status VARCHAR(20), total_score NUMERIC(8,2), finalized_at TIMESTAMPTZ)`
* **Submission Types**:
  * `MANUAL`: Initiated by the owning student. Requires `p_actor_user_id = student_id` and role `'STUDENT'`.
  * `AUTO_TIME_EXPIRED`: Invoked when timer elapses. Enforces that current timestamp is past deadline.
  * `ADMIN_TERMINATED`: Requires role `'ADMIN'`.
  * `SESSION_TERMINATED`: Requires session faculty.
* **Execution & Scoring**:
  * Iterates across `snapshot_json->'questions'`.
  * Calculates MCQ and proportional multiple-select marks with high precision (`NUMERIC(12,6)`).
  * Evaluates unattempted questions as zero without inserting dummy response rows.
  * Sums marks and records `total_score` on `quiz_attempts`.
  * Marks attempt `FINALIZED`.
* **Idempotency**: If attempt is already `FINALIZED`, returns existing status and score immediately without re-scoring.

#### 10. `sp_get_student_attempt_results`
* **Signature**: `(p_attempt_id UUID, p_actor_user_id UUID, p_auth_signature TEXT)`
* **Returns**: `TABLE (attempt_id UUID, status VARCHAR(20), is_results_released BOOLEAN, total_score NUMERIC(8,2), question_breakdown JSONB)`
* **Visibility Release Policy**:
  * Session faculty and college admins always receive full results immediately.
  * For students:
    * `IMMEDIATELY`: Released upon attempt finalization.
    * `AFTER_SESSION_ENDS`: Released only when `quiz_sessions.status = 'COMPLETED'`.
    * `UPON_FACULTY_RELEASE`: Released only when `quiz_sessions.results_released_at IS NOT NULL`.
  * If unreleased: Returns `is_results_released = FALSE`, `total_score = NULL`, `question_breakdown = NULL`.

---

## 7. Security Architecture & Least-Privilege Definer Model

The database operates under a hardened separation of privileges between runtime application queries and administrative definer operations.

### Roles and Database Grants

```mermaid
classDiagram
    class campusquiz_definer {
        +Owner of all 21 tables
        +Owner of all stored procedures
        +Owner of all security triggers
        +Full DDL/DML inside SECURITY DEFINER
        -CREATE ON SCHEMA public REVOKED
    }

    class campusquiz_app {
        +Used by FastAPI backend connection pool
        +SELECT on non-sensitive tables
        +EXECUTE on authorized stored procedures
        -NO direct INSERT/UPDATE on quiz_attempts
        -NO direct INSERT/UPDATE on student_responses
        -NO SELECT on question_options.is_correct
        -NO SELECT on quiz_sessions.snapshot_json
        -NO EXECUTE on fn_generate_auth_signature
        -NO access to app_auth_config
    }
```

### Cryptographic HMAC Actor Authentication

To prevent user spoofing across shared application connection pools, database procedures do not trust client-supplied user IDs without cryptographic verification.

#### Token Payload Specification
The backend service constructs a colon-delimited string:
$$\text{Payload} = \text{user\_id} \mathbin{:} \text{token\_version} \mathbin{:} \text{role} \mathbin{:} \text{expires\_epoch}$$

* `user_id`: UUID of the authenticated caller.
* `token_version`: Integer matching `users.token_version`.
* `role`: Enforced role (`STUDENT`, `FACULTY`, `ADMIN`, or `ANY`).
* `expires_epoch`: Unix timestamp (seconds) until ticket expiration (default 300s / 5 minutes).

#### Ticket Structure
$$\text{Ticket} = \text{expires\_epoch} \mathbin{:} \text{HMAC-SHA256}(\text{Payload}, \text{Secret})$$

#### Verification Lifecycle in PostgreSQL (`fn_verify_actor_context`)
1. **Format Validation**: Ensures ticket matches `<expires_epoch>:<hmac_hex>`.
2. **Replay Expiry Check**: Immediately rejects tickets where $\text{EXTRACT(EPOCH FROM clock\_timestamp())} > \text{expires\_epoch}$.
3. **Secret Retrieval**: Reads active secret from `app_auth_config.auth_hmac_secret`.
4. **User Verification**: Queries `users` to confirm user exists, is active, and matches current `token_version`.
5. **HMAC Recalculation**: Computes expected HMAC over `<user_id>:<user.token_version>:<required_role>:<expires_epoch>`.
6. **Zero-Downtime Rotation**: If primary hash fails, recalculates using `auth_hmac_secret_fallback` (if present).
7. **Role Verification**: Validates caller holds required role in `user_roles`.

---

## 8. High-Precision Scoring Engine & Negative Marking Architecture

Scoring is executed exclusively within the database by `sp_finalize_attempt`.

### Negative Marking Precedence Hierarchy
Negative marking rules are inherited through a two-tier hierarchy:

1. **Enablement Inheritance**:
   $$\text{Session Enablement} \longrightarrow \text{Quiz-Question Override} \longrightarrow \text{Quiz Default} \longrightarrow \text{FALSE}$$
2. **Penalty Inheritance**:
   $$\text{Session Penalty} \longrightarrow \text{Quiz-Question Override} \longrightarrow \text{Quiz Default} \longrightarrow \text{Question Bank Default}$$

* **Explicit Zero Preservation**: A penalty of `0.0000` is preserved as an explicit override. If negative marking is disabled, penalty is strictly forced to `0.000000`.

### Scoring Formulas

#### 1. Single-Choice MCQ & True/False
* **Selected Correct Option**: $\text{Awarded} = +\text{Question Marks}$
* **Selected Incorrect Option**: $\text{Awarded} = -1.000000 \times \text{Configured Penalty}$
* **Unattempted / Empty**: $\text{Awarded} = 0.000000$

#### 2. Proportional Multiple-Select
Partial credit is awarded proportionally for each correct option selected, with penalties deducted for incorrect selections:

$$\text{Awarded Marks} = \left( \frac{c_{\text{selected}}}{c_{\text{total}}} \times \text{Question Marks} \right) - \left( i_{\text{selected}} \times \text{Penalty} \right)$$

* $c_{\text{selected}}$: Count of correct options selected by student.
* $c_{\text{total}}$: Total number of correct options defined for the question.
* $i_{\text{selected}}$: Count of incorrect options selected by student.
* If all correct options and no incorrect options are chosen, full marks are awarded.

#### 3. Attempt Total Score
$$\text{Total Score} = \text{ROUND}\left( \sum \text{Awarded Marks}, 2 \right)$$
* **Negative Total Score Allowed**: There is **no artificial zero-floor**. If penalties exceed marks, student total scores can be negative (e.g., `-2.50`), preserving academic integrity.

---

## 9. Backend Architecture (FastAPI Core) `[PROPOSED]`

The backend will be built using **FastAPI**, **Pydantic v2**, and **SQLAlchemy 2.0 (Core / Expression Engine)**.

### Target Directory Layout
```
D:\Quiz\
├── app/
│   ├── __init__.py
│   ├── main.py                  # FastAPI app factory, middleware, exception handlers
│   ├── core/
│   │   ├── config.py            # Pydantic Settings (.env loader)
│   │   ├── security.py          # Password hashing (Argon2 / bcrypt), JWT tokens
│   │   ├── hmac_tickets.py      # Python wrapper calling auth_utils.py
│   │   └── exceptions.py        # Domain-specific HTTP exceptions
│   ├── db/
│   │   ├── session.py           # SQLAlchemy async engine & unpooled connection pool
│   │   └── sp_caller.py         # Type-safe stored procedure execution wrapper
│   ├── schemas/
│   │   ├── auth.py              # Login, token, user profile schemas
│   │   ├── quiz.py              # Quiz creation, question, option schemas
│   │   ├── session.py           # Session scheduling, activation schemas
│   │   ├── attempt.py           # Attempt start, response payload schemas
│   │   └── result.py            # Result breakdown schemas
│   ├── services/
│   │   ├── auth_service.py      # Login authentication & token issuance
│   │   ├── quiz_service.py      # Authoring, question banks, publishing
│   │   ├── session_service.py   # Scheduling, pause/resume, lifecycle
│   │   ├── attempt_service.py   # Start attempt, autosave dispatcher
│   │   └── result_service.py    # Results extraction & analytics
│   └── api/
│       ├── v1/
│       │   ├── api.py           # API router aggregator
│       │   ├── endpoints/
│       │   │   ├── auth.py      # Authentication routes
│       │   │   ├── academic.py  # Colleges, classes, subjects
│       │   │   ├── quizzes.py   # Quiz management
│       │   │   ├── sessions.py  # Session management
│       │   │   ├── attempts.py  # Student attempt & response routes
│       │   │   └── results.py   # Results retrieval
│       └── deps.py              # FastAPI Depends (auth, roles, db connection)
├── database/                    # [IMPLEMENTED] SQL migrations & runners
├── tests/                       # Backend API integration tests
├── requirements.txt             # Python dependencies
└── .env                         # Environment variables (uncommitted)
```

### Stored Procedure Execution Pattern in SQLAlchemy
Backend services must call stored procedures using parameterized `text()` calls.

```python
# Example: app/db/sp_caller.py
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

async def call_start_quiz_attempt(
    conn: AsyncConnection,
    session_id: str,
    user_id: str,
    signature: str
):
    query = text("""
        SELECT attempt_id, status, deadline, duration_minutes, snapshot_questions
        FROM sp_start_quiz_attempt(:session_id, :actor_id, :sig);
    """)
    result = await conn.execute(query, {
        "session_id": session_id,
        "actor_id": user_id,
        "sig": signature
    })
    return result.mappings().one()
```

---

## 10. Frontend Architecture (Interactive Quiz UI) `[PROPOSED]`

The frontend will be built as a Single Page Application (SPA) using **Next.js (App Router)** or **React + Vite**, styled with **Tailwind CSS**, and utilizing **Zustand** for state management.

### Recommended Component Architecture
```
frontend/
├── src/
│   ├── app/ (or routes/)
│   │   ├── (auth)/login/
│   │   ├── (student)/
│   │   │   ├── dashboard/
│   │   │   ├── quiz/[sessionId]/lobby/
│   │   │   ├── quiz/[attemptId]/take/       # Live quiz taking view
│   │   │   └── quiz/[attemptId]/results/    # Results breakdown
│   │   ├── (faculty)/
│   │   │   ├── dashboard/
│   │   │   ├── quizzes/editor/              # Quiz blueprint builder
│   │   │   └── sessions/[sessionId]/live/   # Session control room
│   │   └── (admin)/
│   │       └── institutions/                # Multi-college admin
│   ├── components/
│   │   ├── quiz/
│   │   │   ├── CountdownTimer.tsx           # Syncs with server deadline
│   │   │   ├── QuestionPalette.tsx          # Answered/unanswered/flagged grid
│   │   │   ├── QuestionCard.tsx             # MCQ / Multiple Select renderer
│   │   │   └── AutosaveStatus.tsx           # Synced / Saving / Stale indicator
│   │   └── ui/                              # Buttons, Modals, Cards
│   ├── store/
│   │   ├── authStore.ts                     # JWT & User profile
│   │   └── quizAttemptStore.ts              # Local answers, optimistic versions
│   └── lib/
│       ├── api.ts                           # Axios / Fetch client
│       └── autosaveQueue.ts                 # Debounced autosave queue (300ms)
```

---

## 11. REST API Contract & Endpoint Roadmap `[PROPOSED]`

All endpoints require Bearer Token authorization (JWT) except login.

### 1. Authentication
* `POST /api/v1/auth/login`: Authenticates credentials, returns JWT containing `user_id`, `college_id`, `roles`.
* `POST /api/v1/auth/refresh`: Refreshes session token.
* `POST /api/v1/auth/logout`: Revokes token.

### 2. Quizzes (Faculty / Admin)
* `POST /api/v1/quizzes`: Create draft quiz.
* `GET /api/v1/quizzes/{quiz_id}`: Fetch quiz draft with questions.
* `POST /api/v1/quizzes/{quiz_id}/publish`: Calls `sp_publish_quiz`.

### 3. Sessions (Faculty / Admin)
* `POST /api/v1/sessions`: Schedule quiz session.
* `POST /api/v1/sessions/{session_id}/activate`: Calls `sp_activate_quiz_session`.
* `POST /api/v1/sessions/{session_id}/pause`: Calls `sp_pause_quiz_session`.
* `POST /api/v1/sessions/{session_id}/resume`: Calls `sp_resume_quiz_session`.
* `POST /api/v1/sessions/{session_id}/complete`: Calls `sp_complete_quiz_session`.
* `POST /api/v1/sessions/{session_id}/release-results`: Calls `sp_release_session_results`.

### 4. Quiz Taking (Student)
* `POST /api/v1/sessions/{session_id}/start`: Calls `sp_start_quiz_attempt`. Returns attempt metadata and sanitized questions.
* `PUT /api/v1/attempts/{attempt_id}/responses/{question_id}`: Calls `sp_save_student_response`.
  * **Payload**: `{"selected_option_ids": ["uuid..."], "is_marked_for_review": false, "client_version": 2}`
* `POST /api/v1/attempts/{attempt_id}/submit`: Calls `sp_finalize_attempt` with `submission_type = 'MANUAL'`.
* `GET /api/v1/attempts/{attempt_id}/results`: Calls `sp_get_student_attempt_results`.

---

## 12. Complete User Workflows & Sequence Diagrams

### Workflow 1: Student Attempt Initiation & Idempotent Start

```mermaid
sequenceDiagram
    autonumber
    actor Student
    participant UI as Student UI
    participant API as FastAPI Backend
    participant Token as auth_utils.py
    participant DB as Neon PostgreSQL (sp_start_quiz_attempt)

    Student->>UI: Clicks "Start Quiz" (Session Code)
    UI->>API: POST /api/v1/sessions/{id}/start (Bearer JWT)
    API->>API: Verify Student JWT & Active Status
    API->>Token: generate_auth_signature(user_id, token_version, 'STUDENT', 300)
    Token-->>API: Returns HMAC Ticket
    API->>DB: CALL sp_start_quiz_attempt(session_id, user_id, ticket)
    Note over DB: Locks session FOR SHARE OF qs<br/>Verifies enrollment & active status<br/>Inserts attempt or returns existing (Idempotent)
    DB-->>API: attempt_id, status, deadline, snapshot_questions (Sanitized)
    API-->>UI: 200 OK (Attempt Payload & Timer)
    UI->>Student: Displays Question 1 & Starts Countdown Clock
```

### Workflow 2: Atomic Autosave & Version Gating

```mermaid
sequenceDiagram
    autonumber
    actor Student
    participant UI as Student UI
    participant API as FastAPI Backend
    participant Token as auth_utils.py
    participant DB as Neon PostgreSQL (sp_save_student_response)

    Student->>UI: Selects Option B for Question 3
    UI->>UI: Increments client_version (e.g. v2)
    UI->>API: PUT /attempts/{id}/responses/{q_id} (selected_options, client_version=2)
    API->>Token: generate_auth_signature(user_id, token_version, 'STUDENT', 300)
    Token-->>API: Returns HMAC Ticket
    API->>DB: CALL sp_save_student_response(..., client_version=2, ticket)
    Note over DB: Validates attempt not finalized<br/>Validates options belong to question<br/>Checks client_version > saved_version
    DB-->>API: Returns ('ACCEPTED', 2)
    API-->>UI: 200 OK (Saved Status)
    UI->>Student: Displays green "Saved" badge
```

### Workflow 3: Finalization & Result Release Enforcement

```mermaid
sequenceDiagram
    autonumber
    actor Student
    actor Faculty
    participant API as FastAPI Backend
    participant DB as Neon PostgreSQL

    Student->>API: POST /attempts/{id}/submit (Manual Submission)
    API->>DB: CALL sp_finalize_attempt(attempt_id, 'MANUAL', student_id, ticket)
    Note over DB: Evaluates responses vs snapshot<br/>Scores MCQ & Multiple Select<br/>Updates total_score & status=FINALIZED
    DB-->>API: final_status='FINALIZED', total_score=18.50
    API-->>Student: Submission Confirmed (Results pending)

    Student->>API: GET /attempts/{id}/results
    API->>DB: CALL sp_get_student_attempt_results(...)
    Note over DB: Session still ACTIVE<br/>Visibility = AFTER_SESSION_ENDS
    DB-->>API: is_results_released = FALSE, score = NULL
    API-->>Student: 200 OK (Results Withheld until session ends)

    Faculty->>API: POST /sessions/{id}/complete
    API->>DB: CALL sp_complete_quiz_session(...)
    DB-->>API: Session status = COMPLETED

    Student->>API: GET /attempts/{id}/results
    API->>DB: CALL sp_get_student_attempt_results(...)
    Note over DB: Session COMPLETED -> Release Approved
    DB-->>API: is_results_released = TRUE, total_score = 18.50, breakdown JSON
    API-->>Student: Displays Full Question Breakdown & Explanation
```

---

## 13. Testing, Verification & Quality Assurance

### Verified Test Results on Live Neon PostgreSQL 18.6
All database integration tests execute in an isolated transaction that unconditionally rolls back:

```text
==============================================================================
 DEPLOYMENT & VERIFICATION SUMMARY REPORT (Live Neon Run)
==============================================================================
  Migrations Recorded Applied : 6 / 6 (01_schema through 06_fix_student_response_record)
  Automated SQL Test Notices  : 35 PASSED (TEST-01A through TEST-14B)
  Permission Tests (campusquiz_app) : 9 / 9 PASSED (Expected 42501 on all restricted ops)
  Test Transaction Cleanup    : 100% Rolled back (0 lingering test rows)
  Repeatability               : Verified 2 consecutive clean runs
==============================================================================
```

### Executing the Test Suites Locally

```bash
# 1. Run the local Python unit test suite (59 tests)
.\.venv\Scripts\python.exe -m pytest database\test_verify_and_migrate.py -v

# 2. Run the SQL verification suite against Neon (Read-Only Transactional)
python database/verify_and_migrate.py --tests-only

# 3. Check migration tracking status on Neon
python database/verify_and_migrate.py --status
```

---

## 14. Developer Environment & Onboarding Guide (Windows / Linux / macOS)

### Prerequisites
* **Python**: Version `3.14+` (Python 3.10+ compatible).
* **Git**: `2.40+`.
* **PostgreSQL Client Tools** (optional): `psql` for manual inspection.

### Setup Instructions

```powershell
# 1. Clone repository
git clone https://github.com/pragya-shree/Quiz.git
cd Quiz

# 2. Create virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1   # Windows PowerShell
# source .venv/bin/activate    # Linux / macOS

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure Environment Variables
cp .env.example .env
```

### Environment Configuration (`.env`)
Populate your `.env` file with your staging connection parameters. **Never commit `.env`!**

```env
# Neon Direct (Unpooled) Endpoint — Always use direct, NOT -pooler!
DATABASE_URL=postgresql://neondb_owner:[PASSWORD]@ep-small-shape-b3bddxrz.c-4.ap-southeast-1.aws.neon.tech/campusquiz_db?sslmode=require

# Restricted Application Role Connection (Used for Backend Service)
APP_DATABASE_URL=postgresql://campusquiz_app:[APP_PASSWORD]@ep-small-shape-b3bddxrz.c-4.ap-southeast-1.aws.neon.tech/campusquiz_db?sslmode=require

# Internal HMAC Signing Key (Matches app_auth_config in DB)
AUTH_HMAC_SECRET=your_staging_hmac_secret_key_minimum_32_chars_long

# JWT Settings
JWT_SECRET_KEY=your_jwt_signing_secret_key_minimum_32_chars_long
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
```

> [!WARNING]
> **Neon Connection Notice**: Always connect using the direct unpooled endpoint (`ep-xyz...neon.tech`). Do not use the connection-pooler endpoint (`ep-xyz-pooler...neon.tech`) for migrations or definer execution; PgBouncer in transaction mode breaks session-level `SET ROLE` commands.

---

## 15. Production Deployment Architecture

```mermaid
flowchart LR
    subgraph Edge["Global CDN & Edge"]
        Vercel["Frontend SPA (Vercel / Cloudflare Pages)"]
    end

    subgraph Hosting["Backend Cloud Service"]
        FastAPI_App["FastAPI Service (Render / Railway / Fly.io)\nRole: campusquiz_app\nDirect Connection + SSL require"]
    end

    subgraph NeonDB["Neon Serverless PostgreSQL 18.6"]
        PG_Direct["Direct Compute Endpoint\n(ep-xyz.c-4.aws.neon.tech)"]
        Storage["Neon Distributed Storage Engine"]
    end

    Vercel -->|HTTPS / API Requests| FastAPI_App
    FastAPI_App -->|PostgreSQL TLS 1.3| PG_Direct
    PG_Direct --> Storage
```

* **SSL Mode**: Must always specify `sslmode=require`.
* **Zero-Downtime Secret Rotation**: When rotating `AUTH_HMAC_SECRET`, place the old key in `app_auth_config.auth_hmac_secret_fallback` before updating the primary key.

---

## 16. Step-by-Step Development Roadmap (Phases 0 through 12)

```
===================================================================================
Project Roadmap: Master Implementation Sequence
===================================================================================
```

* **`PHASE 0: Database Architecture & Hardening` `[COMPLETE]`**:
  * Schema DDL, constraints, triggers, HMAC authentication, scoring engine, 6 migrations applied and verified on Neon.
* **`PHASE 1: Backend Foundation Scaffold` `[NEXT]`**:
  * Objective: Establish FastAPI directory structure, Pydantic settings, SQLAlchemy async connection pool under `campusquiz_app`.
* **`PHASE 2: Authentication & Identity Service`**:
  * Objective: User login, Argon2 password verification, JWT issuance, `auth_utils.py` integration for HMAC ticket generation.
* **`PHASE 3: Institutional Administration API`**:
  * Objective: CRUD for colleges, academic years, departments, classes, subjects, faculty profiles, student profiles, and enrollments.
* **`PHASE 4: Question Bank & Quiz Authoring API`**:
  * Objective: Question creation (MCQ, True/False, Multiple Select), option authoring, quiz assembly, marks override configuration.
* **`PHASE 5: Publishing & Session Lifecycle Engine`**:
  * Objective: Service wrappers for `sp_publish_quiz`, session scheduling, and session controls (`sp_activate/pause/resume/complete`).
* **`PHASE 6: Student Quiz Discovery & Lobby`**:
  * Objective: Student dashboard listing active sessions, access code entry, prerequisite eligibility verification.
* **`PHASE 7: Quiz Attempt Engine & Autosave Dispatcher`**:
  * Objective: Endpoints calling `sp_start_quiz_attempt` and `sp_save_student_response` with debounced client sync.
* **`PHASE 8: Submission, Finalization & Scoring`**:
  * Objective: Endpoints for `sp_finalize_attempt` (`MANUAL` and `AUTO_TIME_EXPIRED`), client submission modals.
* **`PHASE 9: Result Visibility & Analytics`**:
  * Objective: Endpoints calling `sp_get_student_attempt_results`, student question-by-question breakdown, faculty class analytics.
* **`PHASE 10: Frontend UI Development & Integration`**:
  * Objective: Next.js / React application connecting all user personas to the verified backend APIs.
* **`PHASE 11: End-to-End, Load & Concurrency Testing`**:
  * Objective: Locust / k6 concurrency tests simulating 500 simultaneous students autosaving and submitting.
* **`PHASE 12: Production Deployment & Staging Handover`**:
  * Objective: Production domain configuration, environment separation, backup validation, institutional onboarding.

---

## 17. Git, Branching & Team Collaboration Conventions

To ensure zero conflicts and clean code reviews:

1. **`main` Branch Protection**:
   * Direct pushes to `main` are strictly prohibited.
   * `main` must always represent tested, working, and deployable code.
2. **Feature Branch Naming Convention**:
   * `feat/backend-scaffold`
   * `feat/auth-jwt-service`
   * `feat/quiz-authoring-api`
   * `fix/session-locking-alias`
3. **Pull Request Protocol**:
   * Every PR must include passing unit and integration tests.
   * At least one teammate code review required before merging.
4. **Migration Discipline**:
   * **Never modify already-applied migrations (01 through 06)**.
   * Any future database change must be authored as a new sequential migration (e.g., `07_new_feature.sql`) and registered in `verify_and_migrate.py`.

---

## 18. Non-Negotiable Architecture Invariants & Rules

1. **Database as the Sole Source of Truth**: Business rules enforced by check constraints, unique indexes, and triggers must never be replicated or relaxed in application code.
2. **Never Bypass Stored Procedures**: Application code must never issue direct `UPDATE` or `DELETE` statements on `quiz_attempts` or `student_responses`. All runtime state changes must flow through `sp_*`.
3. **Least-Privilege Connection Identity**: The backend must connect as `campusquiz_app`. It must never run queries under `neondb_owner` or `campusquiz_definer`.
4. **Answer Confidentiality Guarantee**: The backend must never query or expose `question_options.is_correct` to students prior to official result release.
5. **No Artificial Zero-Floor**: Student net scores must support negative values if penalties exceed marks. Do not clamp scores to zero.
6. **Immutable Finalized Responses**: Once an attempt is finalized, its responses are permanently locked by `trg_guard_student_responses`. Never attempt to edit finalized answers.
7. **Parameterized SQL Only**: Never concatenate SQL strings. Always use parameterized queries (`:param`) to prevent SQL injection.
8. **Zero Secrets in Source Control**: Never commit `.env` files, production passwords, or HMAC keys.

---

## 19. Known Limitations, Incomplete Features & Open Decisions

1. **Backend & Frontend Not Yet Implemented**: As documented in Section 1, the entire API and UI layers remain to be built starting in Phase 1.
2. **WebSocket Real-Time Monitoring `[PROPOSED]`**: Live student attempt monitoring currently relies on REST polling. Implementing a WebSocket or Server-Sent Events (SSE) gateway for live faculty proctoring is scheduled for Phase 9.
3. **Session Reconnect Grace Period `[OPEN DECISION]`**: Current deadline enforcement is absolute based on `deadline TIMESTAMPTZ`. The team must decide whether a 60-second network disconnection grace period should be introduced during final auto-submission.
4. **Question Types Expansion `[DEFERRED]`**: Coding questions, file uploads, and essay evaluations are deferred to Phase 13 (Post-MVP).

---

## 20. Final Teammate Handoff Checklist

Follow this checklist sequentially to start working on CampusQuiz:

- [ ] **Step 1: Environment Setup**: Clone repo, create Python virtual environment, install `requirements.txt`.
- [ ] **Step 2: Database Connectivity**: Configure `.env` with unpooled Neon endpoint and verify connection with `python database/verify_and_migrate.py --status`.
- [ ] **Step 3: Run Baseline Tests**: Execute `.\.venv\Scripts\python.exe -m pytest database\test_verify_and_migrate.py -v` (Confirm 59/59 passing).
- [ ] **Step 4: Run SQL Verification**: Execute `python database/verify_and_migrate.py --tests-only` (Confirm 35/35 notices and 9/9 permissions passing).
- [ ] **Step 5: Review Architecture**: Read this document thoroughly, specifically Sections 6 (Stored Procedures), 7 (Security), and 8 (Scoring).
- [ ] **Step 6: Pick Roadmap Task**: Select the next assigned task from **Phase 1 (Backend Foundation Scaffold)**.
- [ ] **Step 7: Create Feature Branch**: Branch off `main` using `git checkout -b feat/your-feature-name`.
- [ ] **Step 8: Implement with Tests**: Write code with accompanying pytest unit tests.
- [ ] **Step 9: PR Submission**: Open a Pull Request into `main` with detailed verification steps.

---

*Authored by Antigravity AI Engineering Team for CampusQuiz Core Engineering.*
*Maintained under version control in `docs/ARCHITECTURE_AND_DEVELOPER_HANDOFF.md`.*
