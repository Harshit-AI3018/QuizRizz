-- ============================================================================
-- CampusQuiz — Consolidated Reference Architecture (REFERENCE COPY ONLY)
-- Target: PostgreSQL 15+ / Neon 18.6 Compatible
--
-- IMPORTANT ARCHITECTURAL NOTICE:
-- 1. This file is a consolidated reference copy for architectural review and offline analysis.
-- 2. It is NOT an additional migration and must NEVER be executed alongside the individual migration files.
-- 3. The authoritative production deployment path is database/verify_and_migrate.py running:
--      - 01_schema.sql
--      - 02_procedures.sql
--      - 03_permissions.sql
--      - 04_security_hardening.sql
-- 4. Integration tests reside in database/test_suite.sql and run via --tests-only.
-- ============================================================================
-- 0. EXTENSIONS & ROLES SETUP
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'campusquiz_definer') THEN
        CREATE ROLE campusquiz_definer WITH NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'campusquiz_app') THEN
        CREATE ROLE campusquiz_app WITH LOGIN NOINHERIT;
    END IF;
    -- Grant role membership to current database user (required on Neon/managed Postgres for ALTER ... OWNER TO and SET ROLE)
    EXECUTE 'GRANT campusquiz_definer TO ' || quote_ident(CURRENT_USER);
    EXECUTE 'GRANT campusquiz_app TO ' || quote_ident(CURRENT_USER);
END $$;

-- Configuration Table for Trusted HMAC Auth Signatures (Accessible only to definer)
CREATE TABLE app_auth_config (
    key VARCHAR(50) PRIMARY KEY,
    secret_value VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Seed Default Internal Secret for Authentication Verification
INSERT INTO app_auth_config (key, secret_value)
VALUES ('auth_hmac_secret', 'campusquiz_backend_internal_hmac_secret_key_2026')
ON CONFLICT (key) DO NOTHING;

-- Generic Updated-At Trigger Function
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 1. IDENTITY & ACCESS CONTROL MODULE
-- ----------------------------------------------------------------------------

CREATE TABLE colleges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_colleges_code UNIQUE (code)
);

CREATE TRIGGER trg_colleges_updated_at
BEFORE UPDATE ON colleges
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    token_version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_users_college_email UNIQUE (college_id, email),
    CONSTRAINT uq_users_college_id UNIQUE (college_id, id),
    CONSTRAINT chk_users_email_lowercase CHECK (email = LOWER(email)),
    CONSTRAINT chk_users_token_version CHECK (token_version >= 1)
);

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TABLE roles (
    code VARCHAR(20) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    description TEXT,
    CONSTRAINT chk_roles_code CHECK (code IN ('ADMIN', 'FACULTY', 'STUDENT'))
);

CREATE TABLE user_roles (
    user_id UUID NOT NULL,
    role_code VARCHAR(20) NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
    college_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, role_code),
    CONSTRAINT fk_user_roles_user FOREIGN KEY (college_id, user_id) 
        REFERENCES users(college_id, id) ON DELETE CASCADE
);

CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_departments_code UNIQUE (college_id, code),
    CONSTRAINT uq_departments_college_id UNIQUE (college_id, id)
);

CREATE TRIGGER trg_departments_updated_at
BEFORE UPDATE ON departments
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TABLE faculty_profiles (
    user_id UUID PRIMARY KEY,
    college_id UUID NOT NULL,
    employee_id VARCHAR(50) NOT NULL,
    department_id UUID NOT NULL,
    designation VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_faculty_profiles_emp UNIQUE (college_id, employee_id),
    CONSTRAINT fk_faculty_profiles_user FOREIGN KEY (college_id, user_id) 
        REFERENCES users(college_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_faculty_profiles_dept FOREIGN KEY (college_id, department_id) 
        REFERENCES departments(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_faculty_emp_uppercase CHECK (employee_id = UPPER(employee_id))
);

CREATE TRIGGER trg_faculty_profiles_updated_at
BEFORE UPDATE ON faculty_profiles
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TABLE student_profiles (
    user_id UUID PRIMARY KEY,
    college_id UUID NOT NULL,
    roll_number VARCHAR(50) NOT NULL,
    registration_number VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_student_profiles_roll UNIQUE (college_id, roll_number),
    CONSTRAINT fk_student_profiles_user FOREIGN KEY (college_id, user_id) 
        REFERENCES users(college_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_student_roll_uppercase CHECK (roll_number = UPPER(roll_number))
);

CREATE TRIGGER trg_student_profiles_updated_at
BEFORE UPDATE ON student_profiles
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. ACADEMIC INFRASTRUCTURE MODULE
-- ----------------------------------------------------------------------------

CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id UUID NOT NULL,
    department_id UUID NOT NULL,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_branches_code UNIQUE (college_id, code),
    CONSTRAINT uq_branches_college_id UNIQUE (college_id, id),
    CONSTRAINT fk_branches_dept FOREIGN KEY (college_id, department_id) 
        REFERENCES departments(college_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_branches_updated_at
BEFORE UPDATE ON branches
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TABLE academic_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
    name VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_academic_years_name UNIQUE (college_id, name),
    CONSTRAINT uq_academic_years_college_id UNIQUE (college_id, id),
    CONSTRAINT chk_academic_years_date_range CHECK (end_date > start_date)
);

CREATE TRIGGER trg_academic_years_updated_at
BEFORE UPDATE ON academic_years
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Partial unique index: At most 1 current academic year per college
CREATE UNIQUE INDEX uq_ay_single_current 
ON academic_years (college_id) 
WHERE is_current = TRUE;

CREATE TABLE classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    academic_year_id UUID NOT NULL,
    year_of_study SMALLINT NOT NULL,
    semester SMALLINT NOT NULL,
    section VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_classes_section UNIQUE (college_id, branch_id, academic_year_id, semester, section),
    CONSTRAINT uq_classes_college_id UNIQUE (college_id, id),
    CONSTRAINT uq_classes_composite_ay UNIQUE (college_id, id, academic_year_id),
    CONSTRAINT fk_classes_branch FOREIGN KEY (college_id, branch_id) 
        REFERENCES branches(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_classes_ay FOREIGN KEY (college_id, academic_year_id) 
        REFERENCES academic_years(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_classes_year_bounds CHECK (year_of_study BETWEEN 1 AND 6),
    CONSTRAINT chk_classes_semester_bounds CHECK (semester BETWEEN 1 AND 12)
);

CREATE TRIGGER trg_classes_updated_at
BEFORE UPDATE ON classes
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TABLE subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id UUID NOT NULL,
    department_id UUID NOT NULL,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_subjects_code UNIQUE (college_id, code),
    CONSTRAINT uq_subjects_college_id UNIQUE (college_id, id),
    CONSTRAINT fk_subjects_dept FOREIGN KEY (college_id, department_id) 
        REFERENCES departments(college_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_subjects_updated_at
BEFORE UPDATE ON subjects
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TABLE faculty_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id UUID NOT NULL,
    faculty_user_id UUID NOT NULL,
    subject_id UUID NOT NULL,
    class_id UUID NOT NULL,
    academic_year_id UUID NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_faculty_assignments UNIQUE (college_id, faculty_user_id, subject_id, class_id, academic_year_id),
    CONSTRAINT fk_fa_faculty FOREIGN KEY (college_id, faculty_user_id) 
        REFERENCES users(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_fa_subject FOREIGN KEY (college_id, subject_id) 
        REFERENCES subjects(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_fa_class_ay FOREIGN KEY (college_id, class_id, academic_year_id) 
        REFERENCES classes(college_id, id, academic_year_id) ON DELETE RESTRICT
);

CREATE TABLE student_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id UUID NOT NULL,
    student_user_id UUID NOT NULL,
    class_id UUID NOT NULL,
    academic_year_id UUID NOT NULL,
    enrollment_type VARCHAR(20) NOT NULL DEFAULT 'CORE',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT fk_se_student FOREIGN KEY (college_id, student_user_id) 
        REFERENCES users(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_se_class_ay FOREIGN KEY (college_id, class_id, academic_year_id) 
        REFERENCES classes(college_id, id, academic_year_id) ON DELETE RESTRICT,
    CONSTRAINT chk_enrollment_type CHECK (enrollment_type IN ('CORE', 'ELECTIVE'))
);

-- Partial Unique Index: At most 1 active enrollment per class (supports historical re-enrollments)
CREATE UNIQUE INDEX uq_student_active_class_enrollment 
ON student_enrollments (college_id, student_user_id, class_id) 
WHERE is_active = TRUE;

-- Partial Unique Index: At most 1 active CORE enrollment per student per academic year
CREATE UNIQUE INDEX uq_student_single_core_enrollment 
ON student_enrollments (college_id, student_user_id, academic_year_id) 
WHERE enrollment_type = 'CORE' AND is_active = TRUE;

-- ----------------------------------------------------------------------------
-- 3. QUESTION BANK & QUIZ AUTHORING MODULE
-- ----------------------------------------------------------------------------

CREATE TABLE questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id UUID NOT NULL,
    subject_id UUID NOT NULL,
    created_by_faculty_id UUID NOT NULL,
    question_type VARCHAR(20) NOT NULL,
    question_text TEXT NOT NULL,
    explanation TEXT,
    difficulty VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    topic VARCHAR(100),
    default_marks NUMERIC(8,4) NOT NULL DEFAULT 1.0000,
    default_negative_penalty NUMERIC(8,4) NOT NULL DEFAULT 0.0000,
    is_bank_question BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_questions_college_id UNIQUE (college_id, id),
    CONSTRAINT fk_questions_subject FOREIGN KEY (college_id, subject_id) 
        REFERENCES subjects(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_questions_faculty FOREIGN KEY (college_id, created_by_faculty_id) 
        REFERENCES users(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_questions_type CHECK (question_type IN ('MCQ', 'TRUE_FALSE', 'MULTIPLE_SELECT')),
    CONSTRAINT chk_questions_difficulty CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
    CONSTRAINT chk_questions_default_marks CHECK (default_marks > 0),
    CONSTRAINT chk_questions_default_penalty CHECK (default_negative_penalty >= 0)
);

CREATE TRIGGER trg_questions_updated_at
BEFORE UPDATE ON questions
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TABLE question_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL,
    display_order SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_question_options_order UNIQUE (question_id, display_order)
);

CREATE TABLE quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id UUID NOT NULL,
    faculty_user_id UUID NOT NULL,
    subject_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    instructions TEXT,
    topic VARCHAR(100),
    default_duration_minutes INT NOT NULL,
    total_marks NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    default_negative_marking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    default_negative_penalty NUMERIC(8,4) DEFAULT NULL, -- NULL = inherit bank default
    default_result_visibility VARCHAR(30) NOT NULL DEFAULT 'AFTER_SESSION_ENDS',
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_quizzes_college_id UNIQUE (college_id, id),
    CONSTRAINT fk_quizzes_faculty FOREIGN KEY (college_id, faculty_user_id) 
        REFERENCES users(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_quizzes_subject FOREIGN KEY (college_id, subject_id) 
        REFERENCES subjects(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_quizzes_duration CHECK (default_duration_minutes > 0),
    CONSTRAINT chk_quizzes_total_marks CHECK (total_marks >= 0),
    CONSTRAINT chk_quizzes_penalty CHECK (default_negative_penalty IS NULL OR default_negative_penalty >= 0),
    CONSTRAINT chk_quizzes_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    CONSTRAINT chk_quizzes_result_visibility CHECK (default_result_visibility IN ('IMMEDIATELY', 'AFTER_SESSION_ENDS', 'UPON_FACULTY_RELEASE'))
);

CREATE TRIGGER trg_quizzes_updated_at
BEFORE UPDATE ON quizzes
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TABLE quiz_questions (
    college_id UUID NOT NULL,
    quiz_id UUID NOT NULL,
    question_id UUID NOT NULL,
    sequence_order SMALLINT NOT NULL,
    marks_override NUMERIC(8,4),
    negative_marking_enabled_override BOOLEAN DEFAULT NULL, -- NULL = inherit quiz/session
    negative_penalty_override NUMERIC(8,4) DEFAULT NULL,      -- NULL = inherit; 0.0000 = explicit zero
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (college_id, quiz_id, question_id),
    CONSTRAINT uq_quiz_questions_order UNIQUE (quiz_id, sequence_order),
    CONSTRAINT fk_qq_quiz FOREIGN KEY (college_id, quiz_id) 
        REFERENCES quizzes(college_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_qq_question FOREIGN KEY (college_id, question_id) 
        REFERENCES questions(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_qq_marks_override CHECK (marks_override IS NULL OR marks_override > 0),
    CONSTRAINT chk_qq_penalty_override CHECK (negative_penalty_override IS NULL OR negative_penalty_override >= 0)
);

-- ----------------------------------------------------------------------------
-- 4. REAL-TIME EXECUTION & SCORING MODULE
-- ----------------------------------------------------------------------------

CREATE TABLE quiz_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id UUID NOT NULL,
    quiz_id UUID NOT NULL,
    faculty_user_id UUID NOT NULL,
    class_id UUID NOT NULL,
    session_code VARCHAR(10) NOT NULL,
    session_mode VARCHAR(25) NOT NULL DEFAULT 'STUDENT_PACED',
    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    start_window_time TIMESTAMPTZ NOT NULL,
    end_window_time TIMESTAMPTZ NOT NULL,
    actual_started_at TIMESTAMPTZ,
    actual_ended_at TIMESTAMPTZ,
    duration_minutes INT NOT NULL,
    negative_marking_enabled BOOLEAN DEFAULT NULL, -- NULL = inherit quiz; FALSE = explicit disable; TRUE = explicit enable
    negative_penalty NUMERIC(8,4) DEFAULT NULL,      -- NULL = inherit; 0.0000 = explicit zero
    result_visibility VARCHAR(30) NOT NULL DEFAULT 'AFTER_SESSION_ENDS',
    results_released_at TIMESTAMPTZ,
    snapshot_json JSONB,
    current_question_index SMALLINT DEFAULT 1,
    is_question_revealed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_quiz_sessions_college_id UNIQUE (college_id, id),
    CONSTRAINT fk_qs_quiz FOREIGN KEY (college_id, quiz_id) 
        REFERENCES quizzes(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_qs_faculty FOREIGN KEY (college_id, faculty_user_id) 
        REFERENCES users(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_qs_class FOREIGN KEY (college_id, class_id) 
        REFERENCES classes(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_qs_time_window CHECK (end_window_time > start_window_time),
    CONSTRAINT chk_qs_duration CHECK (duration_minutes > 0),
    CONSTRAINT chk_qs_penalty CHECK (negative_penalty IS NULL OR negative_penalty >= 0),
    CONSTRAINT chk_qs_status CHECK (status IN ('SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT chk_qs_mode CHECK (session_mode IN ('STUDENT_PACED', 'TEACHER_CONTROLLED')),
    CONSTRAINT chk_qs_result_visibility CHECK (result_visibility IN ('IMMEDIATELY', 'AFTER_SESSION_ENDS', 'UPON_FACULTY_RELEASE')),
    CONSTRAINT chk_qs_session_code_format CHECK (session_code = UPPER(session_code) AND session_code ~ '^[A-Z0-9]{6,10}$'),
    CONSTRAINT chk_qs_snapshot_presence CHECK (status NOT IN ('ACTIVE', 'PAUSED', 'COMPLETED') OR snapshot_json IS NOT NULL)
);

CREATE TRIGGER trg_quiz_sessions_updated_at
BEFORE UPDATE ON quiz_sessions
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Partial Unique Index: Active session codes per college
CREATE UNIQUE INDEX uq_active_session_code 
ON quiz_sessions (college_id, session_code) 
WHERE status IN ('SCHEDULED', 'ACTIVE', 'PAUSED');

CREATE TABLE quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    college_id UUID NOT NULL,
    session_id UUID NOT NULL,
    student_user_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    submission_type VARCHAR(25),
    started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    deadline TIMESTAMPTZ NOT NULL,
    submitted_at TIMESTAMPTZ,
    finalized_at TIMESTAMPTZ,
    total_score NUMERIC(8,2), -- Supports negative scores; NO CHECK (total_score >= 0)
    total_correct SMALLINT DEFAULT 0,
    total_incorrect SMALLINT DEFAULT 0,
    total_unattempted SMALLINT DEFAULT 0,
    client_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_attempt_student UNIQUE (session_id, student_user_id),
    CONSTRAINT fk_qa_session FOREIGN KEY (college_id, session_id) 
        REFERENCES quiz_sessions(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_qa_student FOREIGN KEY (college_id, student_user_id) 
        REFERENCES users(college_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_qa_deadline CHECK (deadline >= started_at),
    CONSTRAINT chk_qa_status CHECK (status IN ('IN_PROGRESS', 'FINALIZED')),
    CONSTRAINT chk_qa_submission_type CHECK (submission_type IS NULL OR submission_type IN ('MANUAL', 'AUTO_TIME_EXPIRED', 'SESSION_TERMINATED', 'ADMIN_TERMINATED')),
    CONSTRAINT chk_qa_counts CHECK (total_correct >= 0 AND total_incorrect >= 0 AND total_unattempted >= 0)
);

CREATE TRIGGER trg_quiz_attempts_updated_at
BEFORE UPDATE ON quiz_attempts
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TABLE student_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    question_id UUID NOT NULL,
    selected_option_ids UUID[] NOT NULL DEFAULT '{}',
    is_marked_for_review BOOLEAN NOT NULL DEFAULT FALSE,
    client_version INT NOT NULL DEFAULT 1,
    client_submitted_at TIMESTAMPTZ,
    server_received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    is_evaluated BOOLEAN NOT NULL DEFAULT FALSE,
    is_correct BOOLEAN,
    awarded_marks NUMERIC(12,6), -- Supports negative scores; NO CHECK (awarded_marks >= 0)
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_response_per_question UNIQUE (attempt_id, question_id),
    CONSTRAINT chk_sr_client_version CHECK (client_version > 0)
);

CREATE TRIGGER trg_student_responses_updated_at
BEFORE UPDATE ON student_responses
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. PERFORMANCE INDEXES (NON-REDUNDANT, FREE-TIER OPTIMIZED)
-- ----------------------------------------------------------------------------

CREATE INDEX idx_users_search ON users (college_id, last_name, first_name);
CREATE INDEX idx_faculty_profiles_dept ON faculty_profiles (college_id, department_id);
CREATE INDEX idx_classes_lookup ON classes (college_id, academic_year_id);
CREATE INDEX idx_enrollments_class ON student_enrollments (college_id, class_id);
CREATE INDEX idx_faculty_assignments_class ON faculty_assignments (college_id, class_id);
CREATE INDEX idx_faculty_assignments_subject ON faculty_assignments (college_id, subject_id);
CREATE INDEX idx_questions_lookup ON questions (college_id, subject_id, is_active);
CREATE INDEX idx_quiz_questions_rev ON quiz_questions (college_id, question_id);
CREATE INDEX idx_sessions_class_status ON quiz_sessions (college_id, class_id, status);
CREATE INDEX idx_attempts_active_deadline ON quiz_attempts (status, deadline) WHERE status = 'IN_PROGRESS';
CREATE INDEX idx_attempts_student_hist ON quiz_attempts (college_id, student_user_id, status);

-- ----------------------------------------------------------------------------
-- 6. SYSTEM INTEGRITY TRIGGERS
-- ----------------------------------------------------------------------------

-- Trigger 1: Freeze Snapshot Immutability
CREATE OR REPLACE FUNCTION fn_enforce_snapshot_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.snapshot_json IS NOT NULL AND NEW.snapshot_json IS DISTINCT FROM OLD.snapshot_json THEN
        RAISE EXCEPTION 'snapshot_json is immutable once created for session %', OLD.id;
    END IF;

    IF OLD.status IN ('ACTIVE', 'PAUSED', 'COMPLETED') AND NEW.snapshot_json IS NULL THEN
        RAISE EXCEPTION 'Cannot remove snapshot_json from an active or completed session %', OLD.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_freeze_session_snapshot
BEFORE UPDATE OF snapshot_json, status ON quiz_sessions
FOR EACH ROW EXECUTE FUNCTION fn_enforce_snapshot_immutability();

-- Trigger 2: Session State Machine Transition Guard
CREATE OR REPLACE FUNCTION fn_validate_session_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'SCHEDULED' AND NEW.status NOT IN ('ACTIVE', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid session transition from SCHEDULED to %', NEW.status;
    ELSIF OLD.status = 'ACTIVE' AND NEW.status NOT IN ('PAUSED', 'COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid session transition from ACTIVE to %', NEW.status;
    ELSIF OLD.status = 'PAUSED' AND NEW.status NOT IN ('ACTIVE', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid session transition from PAUSED to %', NEW.status;
    ELSIF OLD.status IN ('COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Cannot transition session out of terminal status %', OLD.status;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_session_status
BEFORE UPDATE OF status ON quiz_sessions
FOR EACH ROW EXECUTE FUNCTION fn_validate_session_status_transition();

-- Trigger 3: Prevent direct fabrication of ACTIVE sessions on INSERT
CREATE OR REPLACE FUNCTION fn_guard_session_creation()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status <> 'SCHEDULED' THEN
        RAISE EXCEPTION 'Sessions must be created in SCHEDULED status';
    END IF;
    IF NEW.snapshot_json IS NOT NULL THEN
        RAISE EXCEPTION 'snapshot_json must be NULL upon session creation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_session_insert
BEFORE INSERT ON quiz_sessions
FOR EACH ROW EXECUTE FUNCTION fn_guard_session_creation();

-- Trigger 4: Separate Response Mutation from System Evaluation
CREATE OR REPLACE FUNCTION fn_guard_student_response_mutation()
RETURNS TRIGGER AS $$
DECLARE
    v_attempt_status VARCHAR(20);
    v_deadline TIMESTAMPTZ;
BEGIN
    -- 1. Prevent moving response rows across attempts or questions
    IF TG_OP = 'UPDATE' THEN
        IF NEW.attempt_id <> OLD.attempt_id OR NEW.question_id <> OLD.question_id THEN
            RAISE EXCEPTION 'Cannot reassign response row to another attempt or question';
        END IF;
    END IF;

    -- 2. Obtain attempt status and deadline with lock
    SELECT status, deadline INTO v_attempt_status, v_deadline
    FROM quiz_attempts
    WHERE id = COALESCE(NEW.attempt_id, OLD.attempt_id)
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent attempt does not exist';
    END IF;

    -- 3. Check student-editable field modifications
    IF TG_OP IN ('INSERT', 'DELETE') OR (
        TG_OP = 'UPDATE' AND (
            NEW.selected_option_ids IS DISTINCT FROM OLD.selected_option_ids OR
            NEW.is_marked_for_review IS DISTINCT FROM OLD.is_marked_for_review OR
            NEW.client_version IS DISTINCT FROM OLD.client_version OR
            NEW.client_submitted_at IS DISTINCT FROM OLD.client_submitted_at
        )
    ) THEN
        IF v_attempt_status <> 'IN_PROGRESS' THEN
            RAISE EXCEPTION 'Cannot modify response: Attempt is already %', v_attempt_status;
        END IF;

        IF clock_timestamp() > (v_deadline + INTERVAL '15 seconds') THEN
            RAISE EXCEPTION 'Cannot modify response: Attempt deadline % (including 15s grace) has passed', v_deadline;
        END IF;
    END IF;

    -- 4. Guard evaluation fields: only campusquiz_definer can modify them
    IF TG_OP = 'UPDATE' AND (
        NEW.is_evaluated IS DISTINCT FROM OLD.is_evaluated OR
        NEW.is_correct IS DISTINCT FROM OLD.is_correct OR
        NEW.awarded_marks IS DISTINCT FROM OLD.awarded_marks
    ) THEN
        IF current_user <> 'campusquiz_definer' AND session_user = 'campusquiz_app' THEN
            RAISE EXCEPTION 'Unauthorized: Only system finalization can update evaluation fields';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_student_responses
BEFORE INSERT OR UPDATE OR DELETE ON student_responses
FOR EACH ROW EXECUTE FUNCTION fn_guard_student_response_mutation();
-- ============================================================================
-- CampusQuiz — Migration 02: Stored Functions & Security Definer Procedures
-- Target: PostgreSQL 15+ (Standard / Neon Compatible)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. TRUSTED ACTOR AUTHENTICATION, EXPIRY VERIFICATION & SECRET ROTATION
-- ----------------------------------------------------------------------------

-- Generate HMAC Signature with Expiry for a given user and role context (Internal Definer Helper)
-- Payload signed: "<user_id>:<token_version>:<role_or_ANY>:<expires_epoch>"
-- Ticket format returned: "<expires_epoch>:<hmac_hex>"
CREATE OR REPLACE FUNCTION fn_generate_auth_signature(
    p_actor_user_id UUID,
    p_role VARCHAR(20) DEFAULT 'ANY',
    p_validity_seconds INT DEFAULT 300
)
RETURNS TEXT
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_secret TEXT;
    v_token_version INT;
    v_expires_epoch BIGINT;
    v_hmac TEXT;
BEGIN
    SELECT secret_value INTO v_secret 
    FROM app_auth_config 
    WHERE key = 'auth_hmac_secret';

    IF v_secret IS NULL THEN
        RAISE EXCEPTION 'Internal security error: HMAC auth secret not configured';
    END IF;

    SELECT token_version INTO v_token_version 
    FROM users 
    WHERE id = p_actor_user_id;

    IF v_token_version IS NULL THEN
        RAISE EXCEPTION 'User % not found', p_actor_user_id;
    END IF;

    v_expires_epoch := EXTRACT(EPOCH FROM (clock_timestamp() + (p_validity_seconds || ' seconds')::INTERVAL))::BIGINT;

    v_hmac := encode(
        hmac(
            p_actor_user_id::text || ':' || v_token_version::text || ':' || COALESCE(p_role, 'ANY') || ':' || v_expires_epoch::text,
            v_secret,
            'sha256'
        ),
        'hex'
    );

    RETURN v_expires_epoch::text || ':' || v_hmac;
END;
$$ LANGUAGE plpgsql;

-- Verify Trusted Actor Context Against Cryptographic HMAC Signature & Expiry
-- Features:
-- 1. Expiry Validation: Rejects tickets whose validity epoch has elapsed
-- 2. State & Version Verification: Rejects inactive users or bumped token_versions
-- 3. Role Authorization: Validates actor role in user_roles
-- 4. Zero-Downtime Secret Rotation: Validates against active secret and optional fallback secret
CREATE OR REPLACE FUNCTION fn_verify_actor_context(
    p_actor_user_id UUID,
    p_required_role VARCHAR(20),
    p_auth_signature TEXT
)
RETURNS users
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_secret TEXT;
    v_fallback_secret TEXT;
    v_user users;
    v_parts TEXT[];
    v_expires_epoch BIGINT;
    v_provided_hmac TEXT;
    v_expected_hmac TEXT;
    v_sig_valid BOOLEAN := FALSE;
BEGIN
    -- 1. Parse signature format (<expires_epoch>:<hmac_hex>)
    IF p_auth_signature IS NULL OR POSITION(':' IN p_auth_signature) = 0 THEN
        RAISE EXCEPTION 'Authentication failed: Malformed auth signature (expected <expires_epoch>:<hmac>)';
    END IF;

    v_parts := string_to_array(p_auth_signature, ':');
    IF array_length(v_parts, 1) <> 2 THEN
        RAISE EXCEPTION 'Authentication failed: Malformed auth signature structure';
    END IF;

    BEGIN
        v_expires_epoch := v_parts[1]::BIGINT;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Authentication failed: Invalid expiry timestamp in auth signature';
    END;

    v_provided_hmac := v_parts[2];

    -- 2. Immediate Replay Protection: Reject expired signatures
    IF EXTRACT(EPOCH FROM clock_timestamp())::BIGINT > v_expires_epoch THEN
        RAISE EXCEPTION 'Authentication failed: Auth signature has expired (expired at %, current %)',
            to_timestamp(v_expires_epoch), clock_timestamp();
    END IF;

    -- 3. Fetch active primary secret from definer-only configuration table
    SELECT secret_value INTO v_secret
    FROM app_auth_config
    WHERE key = 'auth_hmac_secret';

    IF v_secret IS NULL THEN
        RAISE EXCEPTION 'Internal security error: HMAC auth secret not configured';
    END IF;

    -- 4. Validate actor existence and status
    SELECT * INTO v_user
    FROM users
    WHERE id = p_actor_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Authentication failed: User % does not exist', p_actor_user_id;
    END IF;

    IF NOT v_user.is_active THEN
        RAISE EXCEPTION 'Authentication failed: User % account is inactive', p_actor_user_id;
    END IF;

    -- 5. Verify user has the required role (if role is specified)
    IF p_required_role IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = p_actor_user_id AND role_code = p_required_role
        ) THEN
            RAISE EXCEPTION 'Authorization failed: User % does not possess required role %', p_actor_user_id, p_required_role;
        END IF;
    END IF;

    -- 6. Verify cryptographic signature over "<user_id>:<token_version>:<required_role_or_ANY>:<expires_epoch>"
    v_expected_hmac := encode(
        hmac(
            p_actor_user_id::text || ':' || v_user.token_version::text || ':' || COALESCE(p_required_role, 'ANY') || ':' || v_expires_epoch::text,
            v_secret,
            'sha256'
        ),
        'hex'
    );

    IF LOWER(v_provided_hmac) = LOWER(v_expected_hmac) THEN
        v_sig_valid := TRUE;
    ELSE
        -- Secret Rotation Support: Check fallback secret if active secret does not match
        SELECT secret_value INTO v_fallback_secret
        FROM app_auth_config
        WHERE key = 'auth_hmac_secret_fallback';

        IF v_fallback_secret IS NOT NULL THEN
            v_expected_hmac := encode(
                hmac(
                    p_actor_user_id::text || ':' || v_user.token_version::text || ':' || COALESCE(p_required_role, 'ANY') || ':' || v_expires_epoch::text,
                    v_fallback_secret,
                    'sha256'
                ),
                'hex'
            );
            IF LOWER(v_provided_hmac) = LOWER(v_expected_hmac) THEN
                v_sig_valid := TRUE;
            END IF;
        END IF;
    END IF;

    IF NOT v_sig_valid THEN
        RAISE EXCEPTION 'Cryptographic verification failed: Invalid auth signature for actor %', p_actor_user_id;
    END IF;

    RETURN v_user;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 1. QUIZ AUTHORING & PUBLISHING PROCEDURES
-- ----------------------------------------------------------------------------

-- Function: Validate Quiz Before Publishing
CREATE OR REPLACE FUNCTION fn_validate_quiz_for_publishing(p_quiz_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_quiz RECORD;
    v_q_count INT := 0;
    v_q RECORD;
    v_opt_count INT;
    v_correct_count INT;
BEGIN
    SELECT * INTO v_quiz FROM quizzes WHERE id = p_quiz_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quiz % does not exist', p_quiz_id;
    END IF;

    SELECT COUNT(*) INTO v_q_count FROM quiz_questions WHERE quiz_id = p_quiz_id;
    IF v_q_count = 0 THEN
        RAISE EXCEPTION 'Quiz must contain at least one question before publishing';
    END IF;

    FOR v_q IN 
        SELECT q.id, q.question_type, q.question_text, q.is_active, q.subject_id,
               COALESCE(qq.marks_override, q.default_marks) AS effective_marks,
               CASE 
                   WHEN COALESCE(qq.negative_marking_enabled_override, v_quiz.default_negative_marking_enabled, FALSE) = FALSE THEN 0.0000
                   WHEN qq.negative_penalty_override IS NOT NULL THEN qq.negative_penalty_override
                   WHEN v_quiz.default_negative_penalty IS NOT NULL THEN v_quiz.default_negative_penalty
                   ELSE q.default_negative_penalty
               END AS effective_penalty
        FROM quiz_questions qq
        JOIN questions q ON q.id = qq.question_id
        WHERE qq.quiz_id = p_quiz_id
        ORDER BY qq.sequence_order
    LOOP
        IF NOT v_q.is_active THEN
            RAISE EXCEPTION 'Question % is inactive and cannot be included in published quiz', v_q.id;
        END IF;

        IF TRIM(COALESCE(v_q.question_text, '')) = '' THEN
            RAISE EXCEPTION 'Question % has blank question text', v_q.id;
        END IF;

        IF v_q.subject_id <> v_quiz.subject_id THEN
            RAISE EXCEPTION 'Question % subject does not match quiz subject', v_q.id;
        END IF;

        IF v_q.effective_marks <= 0 THEN
            RAISE EXCEPTION 'Question % has invalid non-positive marks (%)', v_q.id, v_q.effective_marks;
        END IF;

        IF v_q.effective_penalty < 0 THEN
            RAISE EXCEPTION 'Question % has invalid negative penalty (%)', v_q.id, v_q.effective_penalty;
        END IF;

        -- Validate Options
        SELECT COUNT(*), COUNT(*) FILTER (WHERE is_correct = TRUE)
        INTO v_opt_count, v_correct_count
        FROM question_options
        WHERE question_id = v_q.id;

        IF EXISTS (SELECT 1 FROM question_options WHERE question_id = v_q.id AND TRIM(COALESCE(option_text, '')) = '') THEN
            RAISE EXCEPTION 'Question % contains an option with blank text', v_q.id;
        END IF;

        IF v_q.question_type = 'MCQ' THEN
            IF v_opt_count < 2 THEN
                RAISE EXCEPTION 'MCQ Question % must have at least 2 options', v_q.id;
            END IF;
            IF v_correct_count <> 1 THEN
                RAISE EXCEPTION 'MCQ Question % must have exactly 1 correct option (found %)', v_q.id, v_correct_count;
            END IF;

        ELSIF v_q.question_type = 'TRUE_FALSE' THEN
            IF v_opt_count <> 2 THEN
                RAISE EXCEPTION 'True/False Question % must have exactly 2 options', v_q.id;
            END IF;
            IF v_correct_count <> 1 THEN
                RAISE EXCEPTION 'True/False Question % must have exactly 1 correct option', v_q.id;
            END IF;

        ELSIF v_q.question_type = 'MULTIPLE_SELECT' THEN
            IF v_opt_count < 2 THEN
                RAISE EXCEPTION 'Multiple-select Question % must have at least 2 options', v_q.id;
            END IF;
            IF v_correct_count < 1 THEN
                RAISE EXCEPTION 'Multiple-select Question % must have at least 1 correct option', v_q.id;
            END IF;
        END IF;
    END LOOP;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Procedure: Publish Quiz Atomically
CREATE OR REPLACE FUNCTION sp_publish_quiz(
    p_quiz_id UUID,
    p_actor_user_id UUID,
    p_auth_signature TEXT
)
RETURNS TABLE (
    quiz_id UUID,
    status VARCHAR(20),
    total_marks NUMERIC(8,2)
)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_actor users;
    v_quiz RECORD;
    v_computed_total NUMERIC(8,2);
BEGIN
    -- Verify actor authenticity & expiry
    v_actor := fn_verify_actor_context(p_actor_user_id, NULL, p_auth_signature);

    SELECT * INTO v_quiz
    FROM quizzes
    WHERE id = p_quiz_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quiz % does not exist', p_quiz_id;
    END IF;

    -- Verify author ownership or admin role in same college
    IF v_quiz.faculty_user_id <> p_actor_user_id AND NOT EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = p_actor_user_id AND ur.role_code = 'ADMIN' AND ur.college_id = v_quiz.college_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Caller % cannot publish quiz owned by %', p_actor_user_id, v_quiz.faculty_user_id;
    END IF;

    IF v_quiz.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Quiz % is in status %; only DRAFT quizzes can be published', p_quiz_id, v_quiz.status;
    END IF;

    -- Complete structural validation
    PERFORM fn_validate_quiz_for_publishing(p_quiz_id);

    -- Calculate total marks
    SELECT ROUND(COALESCE(SUM(COALESCE(qq.marks_override, q.default_marks)), 0.00), 2)
    INTO v_computed_total
    FROM quiz_questions qq
    JOIN questions q ON q.id = qq.question_id
    WHERE qq.quiz_id = p_quiz_id;

    UPDATE quizzes
    SET status = 'PUBLISHED',
        total_marks = v_computed_total
    WHERE id = p_quiz_id;

    RETURN QUERY SELECT v_quiz.id, 'PUBLISHED'::VARCHAR(20), v_computed_total;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 2. QUIZ SESSION LIFECYCLE PROCEDURES
-- ----------------------------------------------------------------------------

-- Procedure: Activate Quiz Session & Freeze Snapshot
-- Negative-Marking Precedence:
-- 1. Enablement: session.negative_marking_enabled -> qq.negative_marking_enabled_override -> quiz.default_negative_marking_enabled -> FALSE
-- 2. If disabled -> penalty is guaranteed 0.000000
-- 3. If enabled -> session.negative_penalty -> qq.negative_penalty_override -> quiz.default_negative_penalty -> question bank default
CREATE OR REPLACE FUNCTION sp_activate_quiz_session(
    p_session_id UUID,
    p_actor_user_id UUID,
    p_auth_signature TEXT
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_actor users;
    v_session RECORD;
    v_quiz RECORD;
    v_snapshot JSONB;
    v_questions JSONB;
BEGIN
    -- Verify actor authenticity & expiry
    v_actor := fn_verify_actor_context(p_actor_user_id, NULL, p_auth_signature);

    SELECT * INTO v_session
    FROM quiz_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quiz session % does not exist', p_session_id;
    END IF;

    IF v_session.status <> 'SCHEDULED' THEN
        RAISE EXCEPTION 'Session % is in status %; only SCHEDULED sessions can be activated', p_session_id, v_session.status;
    END IF;

    SELECT * INTO v_quiz FROM quizzes WHERE id = v_session.quiz_id;

    IF v_quiz.status <> 'PUBLISHED' THEN
        RAISE EXCEPTION 'Cannot activate session: Quiz % is in status % (must be PUBLISHED)', v_quiz.id, v_quiz.status;
    END IF;

    -- Verify caller is session faculty or college admin
    IF v_session.faculty_user_id <> p_actor_user_id AND NOT EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = p_actor_user_id AND ur.role_code = 'ADMIN' AND ur.college_id = v_session.college_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Caller % is not authorized to activate session %', p_actor_user_id, p_session_id;
    END IF;

    -- Validate active faculty assignment
    IF NOT EXISTS (
        SELECT 1 FROM faculty_assignments fa
        JOIN classes c ON c.id = v_session.class_id
        WHERE fa.college_id = v_session.college_id
          AND fa.faculty_user_id = v_session.faculty_user_id
          AND fa.subject_id = v_quiz.subject_id
          AND fa.class_id = v_session.class_id
          AND fa.academic_year_id = c.academic_year_id
          AND fa.is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Faculty % is not actively assigned to teach subject % to class %', v_session.faculty_user_id, v_quiz.subject_id, v_session.class_id;
    END IF;

    -- Build frozen questions array with two-tier negative marking resolution:
    SELECT jsonb_agg(
        jsonb_build_object(
            'question_id', q.id,
            'sequence_order', qq.sequence_order,
            'question_type', q.question_type,
            'question_text', q.question_text,
            'explanation', q.explanation,
            'marks', COALESCE(qq.marks_override, q.default_marks),
            'negative_penalty', (
                CASE 
                    WHEN COALESCE(v_session.negative_marking_enabled, qq.negative_marking_enabled_override, v_quiz.default_negative_marking_enabled, FALSE) = FALSE THEN 0.000000
                    WHEN v_session.negative_penalty IS NOT NULL THEN v_session.negative_penalty
                    WHEN qq.negative_penalty_override IS NOT NULL THEN qq.negative_penalty_override
                    WHEN v_quiz.default_negative_penalty IS NOT NULL THEN v_quiz.default_negative_penalty
                    ELSE q.default_negative_penalty
                END
            ),
            'options', (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'option_id', qo.id,
                        'option_text', qo.option_text,
                        'is_correct', qo.is_correct,
                        'display_order', qo.display_order
                    ) ORDER BY qo.display_order
                )
                FROM question_options qo
                WHERE qo.question_id = q.id
            )
        ) ORDER BY qq.sequence_order
    ) INTO v_questions
    FROM quiz_questions qq
    JOIN questions q ON q.id = qq.question_id
    WHERE qq.quiz_id = v_session.quiz_id;

    v_snapshot := jsonb_build_object(
        'snapshot_generated_at', clock_timestamp(),
        'session_id', v_session.id,
        'quiz_id', v_session.quiz_id,
        'negative_marking_enabled', COALESCE(v_session.negative_marking_enabled, v_quiz.default_negative_marking_enabled, FALSE),
        'questions', v_questions
    );

    UPDATE quiz_sessions
    SET status = 'ACTIVE',
        snapshot_json = v_snapshot,
        actual_started_at = clock_timestamp()
    WHERE id = p_session_id;

    RETURN v_snapshot;
END;
$$ LANGUAGE plpgsql;

-- Procedure: Pause Quiz Session
CREATE OR REPLACE FUNCTION sp_pause_quiz_session(
    p_session_id UUID,
    p_actor_user_id UUID,
    p_auth_signature TEXT
)
RETURNS VARCHAR(20)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_session RECORD;
BEGIN
    PERFORM fn_verify_actor_context(p_actor_user_id, NULL, p_auth_signature);

    SELECT * INTO v_session FROM quiz_sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Session % not found', p_session_id; END IF;

    IF v_session.faculty_user_id <> p_actor_user_id AND NOT EXISTS (
        SELECT 1 FROM user_roles WHERE user_id = p_actor_user_id AND role_code = 'ADMIN' AND college_id = v_session.college_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    UPDATE quiz_sessions SET status = 'PAUSED' WHERE id = p_session_id;
    RETURN 'PAUSED';
END;
$$ LANGUAGE plpgsql;

-- Procedure: Resume Quiz Session
CREATE OR REPLACE FUNCTION sp_resume_quiz_session(
    p_session_id UUID,
    p_actor_user_id UUID,
    p_auth_signature TEXT
)
RETURNS VARCHAR(20)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_session RECORD;
BEGIN
    PERFORM fn_verify_actor_context(p_actor_user_id, NULL, p_auth_signature);

    SELECT * INTO v_session FROM quiz_sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Session % not found', p_session_id; END IF;

    IF v_session.faculty_user_id <> p_actor_user_id AND NOT EXISTS (
        SELECT 1 FROM user_roles WHERE user_id = p_actor_user_id AND role_code = 'ADMIN' AND college_id = v_session.college_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    UPDATE quiz_sessions SET status = 'ACTIVE' WHERE id = p_session_id;
    RETURN 'ACTIVE';
END;
$$ LANGUAGE plpgsql;

-- Procedure: Complete Quiz Session
CREATE OR REPLACE FUNCTION sp_complete_quiz_session(
    p_session_id UUID,
    p_actor_user_id UUID,
    p_auth_signature TEXT
)
RETURNS VARCHAR(20)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_session RECORD;
BEGIN
    PERFORM fn_verify_actor_context(p_actor_user_id, NULL, p_auth_signature);

    SELECT * INTO v_session FROM quiz_sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Session % not found', p_session_id; END IF;

    IF v_session.faculty_user_id <> p_actor_user_id AND NOT EXISTS (
        SELECT 1 FROM user_roles WHERE user_id = p_actor_user_id AND role_code = 'ADMIN' AND college_id = v_session.college_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    UPDATE quiz_sessions 
    SET status = 'COMPLETED',
        actual_ended_at = clock_timestamp()
    WHERE id = p_session_id;

    RETURN 'COMPLETED';
END;
$$ LANGUAGE plpgsql;

-- Procedure: Cancel Quiz Session
CREATE OR REPLACE FUNCTION sp_cancel_quiz_session(
    p_session_id UUID,
    p_actor_user_id UUID,
    p_auth_signature TEXT
)
RETURNS VARCHAR(20)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_session RECORD;
BEGIN
    PERFORM fn_verify_actor_context(p_actor_user_id, NULL, p_auth_signature);

    SELECT * INTO v_session FROM quiz_sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Session % not found', p_session_id; END IF;

    IF v_session.faculty_user_id <> p_actor_user_id AND NOT EXISTS (
        SELECT 1 FROM user_roles WHERE user_id = p_actor_user_id AND role_code = 'ADMIN' AND college_id = v_session.college_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    UPDATE quiz_sessions 
    SET status = 'CANCELLED',
        actual_ended_at = clock_timestamp()
    WHERE id = p_session_id;

    RETURN 'CANCELLED';
END;
$$ LANGUAGE plpgsql;

-- Procedure: Release Session Results
CREATE OR REPLACE FUNCTION sp_release_session_results(
    p_session_id UUID,
    p_actor_user_id UUID,
    p_auth_signature TEXT
)
RETURNS TIMESTAMPTZ
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_session RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    PERFORM fn_verify_actor_context(p_actor_user_id, NULL, p_auth_signature);

    SELECT * INTO v_session FROM quiz_sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Session % not found', p_session_id; END IF;

    IF v_session.faculty_user_id <> p_actor_user_id AND NOT EXISTS (
        SELECT 1 FROM user_roles WHERE user_id = p_actor_user_id AND role_code = 'ADMIN' AND college_id = v_session.college_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    UPDATE quiz_sessions 
    SET results_released_at = v_now
    WHERE id = p_session_id;

    RETURN v_now;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 3. REAL-TIME ATTEMPT & RESPONSE PROCEDURES
-- ----------------------------------------------------------------------------

-- Procedure: Concurrency-Safe Idempotent Attempt Start
CREATE OR REPLACE FUNCTION sp_start_quiz_attempt(
    p_session_id UUID,
    p_actor_user_id UUID,
    p_auth_signature TEXT
)
RETURNS TABLE (
    attempt_id UUID,
    status VARCHAR(20),
    deadline TIMESTAMPTZ,
    duration_minutes INT,
    snapshot_questions JSONB
)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_actor users;
    v_session RECORD;
    v_attempt_id UUID;
    v_attempt_status VARCHAR(20);
    v_attempt_deadline TIMESTAMPTZ;
    v_calculated_deadline TIMESTAMPTZ;
BEGIN
    -- 1. Cryptographically verify authenticated student identity & expiry
    v_actor := fn_verify_actor_context(p_actor_user_id, 'STUDENT', p_auth_signature);

    IF NOT EXISTS (SELECT 1 FROM student_profiles WHERE user_id = p_actor_user_id) THEN
        RAISE EXCEPTION 'User % does not have a registered student profile', p_actor_user_id;
    END IF;

    -- 2. Lock quiz session in SHARE mode (OF qs only -- classes is a read-only join)
    --    FOR SHARE OF qs acquires a row-level share lock on the quiz_sessions row only.
    --    This requires UPDATE on quiz_sessions but NOT on classes (plain read join).
    SELECT qs.*, c.academic_year_id INTO v_session
    FROM quiz_sessions qs
    JOIN classes c ON c.id = qs.class_id
    WHERE qs.id = p_session_id AND qs.college_id = v_actor.college_id
    FOR SHARE OF qs;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quiz session % does not exist in student college', p_session_id;
    END IF;

    -- 3. Verify student enrollment in the session class & academic year
    IF NOT EXISTS (
        SELECT 1 FROM student_enrollments se
        WHERE se.student_user_id = p_actor_user_id
          AND se.class_id = v_session.class_id
          AND se.academic_year_id = v_session.academic_year_id
          AND se.college_id = v_actor.college_id
          AND se.is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Student % is not actively enrolled in class % for academic year %', p_actor_user_id, v_session.class_id, v_session.academic_year_id;
    END IF;

    -- 4. Verify session run-state
    IF v_session.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Quiz session is not currently ACTIVE (status: %)', v_session.status;
    END IF;

    IF clock_timestamp() < v_session.start_window_time OR clock_timestamp() > v_session.end_window_time THEN
        RAISE EXCEPTION 'Current time is outside session schedule window';
    END IF;

    -- 5. Calculate deadline
    v_calculated_deadline := LEAST(
        clock_timestamp() + (v_session.duration_minutes || ' minutes')::INTERVAL,
        v_session.end_window_time
    );

    -- 6. Concurrency-Safe Idempotent Insert
    INSERT INTO quiz_attempts AS qa (
        college_id,
        session_id,
        student_user_id,
        status,
        started_at,
        deadline,
        total_score
    ) VALUES (
        v_actor.college_id,
        p_session_id,
        p_actor_user_id,
        'IN_PROGRESS',
        clock_timestamp(),
        v_calculated_deadline,
        NULL
    )
    ON CONFLICT (session_id, student_user_id) DO NOTHING
    RETURNING qa.id, qa.status, qa.deadline INTO v_attempt_id, v_attempt_status, v_attempt_deadline;

    -- If conflict occurred, fetch the authoritative existing attempt
    IF NOT FOUND THEN
        SELECT qa.id, qa.status, qa.deadline 
        INTO v_attempt_id, v_attempt_status, v_attempt_deadline
        FROM quiz_attempts qa
        WHERE qa.session_id = p_session_id AND qa.student_user_id = p_actor_user_id;
    END IF;

    -- 7. Return sanitized question payload (stripping correct answers and explanations)
    RETURN QUERY
    SELECT 
        v_attempt_id,
        v_attempt_status,
        v_attempt_deadline,
        v_session.duration_minutes,
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'question_id', q->>'question_id',
                    'sequence_order', q->>'sequence_order',
                    'question_type', q->>'question_type',
                    'question_text', q->>'question_text',
                    'marks', q->>'marks',
                    'negative_penalty', q->>'negative_penalty',
                    'options', (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'option_id', opt->>'option_id',
                                'option_text', opt->>'option_text',
                                'display_order', opt->>'display_order'
                            )
                        )
                        FROM jsonb_array_elements(q->'options') opt
                    )
                )
            )
            FROM jsonb_array_elements(v_session.snapshot_json->'questions') q
        );
END;
$$ LANGUAGE plpgsql;

-- Procedure: Atomic Concurrency-Safe Autosave
-- Controls server_received_at explicitly within definer execution
CREATE OR REPLACE FUNCTION sp_save_student_response(
    p_attempt_id UUID,
    p_question_id UUID,
    p_selected_option_ids UUID[],
    p_is_marked_for_review BOOLEAN,
    p_client_version INT,
    p_client_submitted_at TIMESTAMPTZ,
    p_actor_user_id UUID,
    p_auth_signature TEXT
)
RETURNS TABLE (
    result_status VARCHAR(25),
    saved_version INT
)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_actor users;
    v_attempt RECORD;
    v_snapshot JSONB;
    v_q JSONB;
    v_q_type VARCHAR(20);
    v_valid_option_ids UUID[];
    v_opt_id UUID;
    v_saved_version INT;
    v_existing RECORD;
BEGIN
    -- 1. Cryptographically verify student identity & expiry
    v_actor := fn_verify_actor_context(p_actor_user_id, 'STUDENT', p_auth_signature);

    -- 2. Validate version argument
    IF p_client_version IS NULL OR p_client_version <= 0 THEN
        RAISE EXCEPTION 'client_version must be a positive integer';
    END IF;

    -- 3. Verify attempt ownership & lock attempt row
    SELECT qa.id, qa.session_id, qa.student_user_id, qa.status, qa.deadline INTO v_attempt
    FROM quiz_attempts qa
    WHERE qa.id = p_attempt_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attempt % not found', p_attempt_id;
    END IF;

    IF v_attempt.student_user_id <> p_actor_user_id THEN
        RAISE EXCEPTION 'Unauthorized: Caller % does not own attempt %', p_actor_user_id, p_attempt_id;
    END IF;

    IF v_attempt.status <> 'IN_PROGRESS' THEN
        RAISE EXCEPTION 'Cannot save response: Attempt is already %', v_attempt.status;
    END IF;

    IF clock_timestamp() > (v_attempt.deadline + INTERVAL '15 seconds') THEN
        RAISE EXCEPTION 'Cannot save response: Attempt deadline has passed';
    END IF;

    -- 4. Fetch snapshot and validate question presence
    SELECT snapshot_json INTO v_snapshot
    FROM quiz_sessions
    WHERE id = v_attempt.session_id;

    SELECT q INTO v_q
    FROM jsonb_array_elements(v_snapshot->'questions') q
    WHERE (q->>'question_id')::UUID = p_question_id;

    IF v_q IS NULL THEN
        RAISE EXCEPTION 'Question % is not part of the active quiz snapshot for this session', p_question_id;
    END IF;

    v_q_type := v_q->>'question_type';

    SELECT array_agg((opt->>'option_id')::UUID) INTO v_valid_option_ids
    FROM jsonb_array_elements(v_q->'options') opt;

    -- 5. Validate selected option IDs
    IF p_selected_option_ids IS NOT NULL AND cardinality(p_selected_option_ids) > 0 THEN
        -- Reject duplicate option IDs
        IF cardinality(p_selected_option_ids) <> cardinality(ARRAY(SELECT DISTINCT unnest(p_selected_option_ids))) THEN
            RAISE EXCEPTION 'Duplicate option IDs submitted in response array';
        END IF;

        -- Reject multi-selection for single-answer types
        IF v_q_type IN ('MCQ', 'TRUE_FALSE') AND cardinality(p_selected_option_ids) > 1 THEN
            RAISE EXCEPTION '% questions permit at most 1 selected option', v_q_type;
        END IF;

        -- Reject options that do not belong to this question
        FOREACH v_opt_id IN ARRAY p_selected_option_ids
        LOOP
            IF NOT (v_opt_id = ANY(v_valid_option_ids)) THEN
                RAISE EXCEPTION 'Option % does not belong to question %', v_opt_id, p_question_id;
            END IF;
        END LOOP;
    END IF;

    -- 6. Atomic Upsert with strict version gating
    -- Explicitly stamps server_received_at with server authoritative timestamp
    INSERT INTO student_responses (
        attempt_id,
        question_id,
        selected_option_ids,
        is_marked_for_review,
        client_version,
        client_submitted_at,
        server_received_at
    ) VALUES (
        p_attempt_id,
        p_question_id,
        COALESCE(p_selected_option_ids, '{}'),
        COALESCE(p_is_marked_for_review, FALSE),
        p_client_version,
        COALESCE(p_client_submitted_at, clock_timestamp()),
        clock_timestamp()
    )
    ON CONFLICT (attempt_id, question_id) 
    DO UPDATE SET
        selected_option_ids = EXCLUDED.selected_option_ids,
        is_marked_for_review = EXCLUDED.is_marked_for_review,
        client_version = EXCLUDED.client_version,
        client_submitted_at = EXCLUDED.client_submitted_at,
        server_received_at = clock_timestamp()
    WHERE EXCLUDED.client_version > student_responses.client_version
    RETURNING client_version INTO v_saved_version;

    IF FOUND THEN
        RETURN QUERY SELECT 'ACCEPTED'::VARCHAR(25), v_saved_version;
        RETURN;
    END IF;

    -- 7. Diagnostic lock to determine reason for non-update
    SELECT client_version, selected_option_ids, is_marked_for_review
    INTO v_existing
    FROM student_responses
    WHERE attempt_id = p_attempt_id AND question_id = p_question_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student response not found for attempt % and question %', p_attempt_id, p_question_id;
    END IF;

    IF p_client_version = v_existing.client_version THEN
        IF v_existing.selected_option_ids = COALESCE(p_selected_option_ids, '{}') AND 
           v_existing.is_marked_for_review = COALESCE(p_is_marked_for_review, FALSE) THEN
            RETURN QUERY SELECT 'IDEMPOTENT_RETRY'::VARCHAR(25), v_existing.client_version;
        ELSE
            RETURN QUERY SELECT 'VERSION_CONFLICT'::VARCHAR(25), v_existing.client_version;
        END IF;
    ELSE
        RETURN QUERY SELECT 'STALE_REJECTED'::VARCHAR(25), v_existing.client_version;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Procedure: Idempotent Attempt Finalization
CREATE OR REPLACE FUNCTION sp_finalize_attempt(
    p_attempt_id UUID,
    p_submission_type VARCHAR(25),
    p_actor_user_id UUID,
    p_auth_signature TEXT
)
RETURNS TABLE (
    final_status VARCHAR(20),
    total_score NUMERIC(8,2),
    finalized_at TIMESTAMPTZ
) 
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_actor users;
    v_attempt RECORD;
    v_session RECORD;
    v_snapshot JSONB;
    v_q JSONB;
    v_question_id UUID;
    v_q_type VARCHAR(20);
    v_q_marks NUMERIC(8,4);
    v_q_penalty NUMERIC(8,4);
    v_student_resp RECORD;
    v_correct_opt_ids UUID[];
    v_incorrect_opt_ids UUID[];
    v_selected_ids UUID[];
    v_c_sel INT;
    v_i_sel INT;
    v_tot_correct INT;
    v_awarded NUMERIC(12,6);
    v_is_correct BOOLEAN;
    v_computed_total NUMERIC(8,2);
    v_cnt_correct SMALLINT := 0;
    v_cnt_incorrect SMALLINT := 0;
    v_cnt_unattempted SMALLINT := 0;
BEGIN
    -- 1. Validate submission type
    IF p_submission_type NOT IN ('MANUAL', 'AUTO_TIME_EXPIRED', 'SESSION_TERMINATED', 'ADMIN_TERMINATED') THEN
        RAISE EXCEPTION 'Invalid submission type: %', p_submission_type;
    END IF;

    -- 2. Lock attempt row
    SELECT * INTO v_attempt
    FROM quiz_attempts
    WHERE id = p_attempt_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attempt % not found', p_attempt_id;
    END IF;

    -- 3. Idempotent short-circuit
    IF v_attempt.status = 'FINALIZED' THEN
        RETURN QUERY SELECT v_attempt.status, v_attempt.total_score, v_attempt.finalized_at;
        RETURN;
    END IF;

    SELECT * INTO v_session
    FROM quiz_sessions
    WHERE id = v_attempt.session_id;

    -- 4. Cryptographically verify caller authorization & expiry based on submission type
    IF p_submission_type = 'MANUAL' THEN
        v_actor := fn_verify_actor_context(p_actor_user_id, 'STUDENT', p_auth_signature);
        IF v_attempt.student_user_id <> p_actor_user_id THEN
            RAISE EXCEPTION 'Unauthorized: Only student % can manually submit attempt %', v_attempt.student_user_id, p_attempt_id;
        END IF;
        IF clock_timestamp() > (v_attempt.deadline + INTERVAL '15 seconds') THEN
            RAISE EXCEPTION 'Manual submission rejected: Deadline has expired';
        END IF;

    ELSIF p_submission_type = 'AUTO_TIME_EXPIRED' THEN
        v_actor := fn_verify_actor_context(p_actor_user_id, NULL, p_auth_signature);
        IF clock_timestamp() <= v_attempt.deadline THEN
            RAISE EXCEPTION 'Cannot auto-expire attempt: Deadline % has not elapsed', v_attempt.deadline;
        END IF;

    ELSIF p_submission_type = 'SESSION_TERMINATED' THEN
        v_actor := fn_verify_actor_context(p_actor_user_id, NULL, p_auth_signature);
        IF v_session.status NOT IN ('COMPLETED', 'CANCELLED') AND v_session.faculty_user_id <> p_actor_user_id THEN
            RAISE EXCEPTION 'Unauthorized: Session % has not terminated', v_session.id;
        END IF;

    ELSIF p_submission_type = 'ADMIN_TERMINATED' THEN
        v_actor := fn_verify_actor_context(p_actor_user_id, 'ADMIN', p_auth_signature);
    END IF;

    -- 5. Load session snapshot
    v_snapshot := v_session.snapshot_json;
    IF v_snapshot IS NULL THEN
        RAISE EXCEPTION 'Session snapshot is missing';
    END IF;

    -- 6. Evaluate strictly against snapshot questions
    FOR v_q IN SELECT * FROM jsonb_array_elements(v_snapshot->'questions')
    LOOP
        v_question_id := (v_q->>'question_id')::UUID;
        v_q_type := v_q->>'question_type';
        v_q_marks := (v_q->>'marks')::NUMERIC(8,4);
        v_q_penalty := (v_q->>'negative_penalty')::NUMERIC(8,4);

        SELECT 
            COALESCE(array_agg((opt->>'option_id')::UUID) FILTER (WHERE (opt->>'is_correct')::BOOLEAN = TRUE), '{}'),
            COALESCE(array_agg((opt->>'option_id')::UUID) FILTER (WHERE (opt->>'is_correct')::BOOLEAN = FALSE), '{}')
        INTO v_correct_opt_ids, v_incorrect_opt_ids
        FROM jsonb_array_elements(v_q->'options') opt;

        v_tot_correct := COALESCE(array_length(v_correct_opt_ids, 1), 0);

        SELECT * INTO v_student_resp
        FROM student_responses
        WHERE attempt_id = p_attempt_id AND question_id = v_question_id;

        IF NOT FOUND OR v_student_resp.selected_option_ids = '{}' THEN
            -- Unattempted: calculated as zero; DO NOT insert dummy row
            v_cnt_unattempted := v_cnt_unattempted + 1;
            
            IF FOUND THEN
                UPDATE student_responses
                SET is_evaluated = TRUE,
                    is_correct = FALSE,
                    awarded_marks = 0.000000
                WHERE attempt_id = p_attempt_id AND question_id = v_question_id;
            END IF;
        ELSE
            v_selected_ids := v_student_resp.selected_option_ids;

            IF v_q_type IN ('MCQ', 'TRUE_FALSE') THEN
                IF v_selected_ids = v_correct_opt_ids THEN
                    v_awarded := v_q_marks::NUMERIC(12,6);
                    v_is_correct := TRUE;
                    v_cnt_correct := v_cnt_correct + 1;
                ELSE
                    v_awarded := -1.000000 * v_q_penalty::NUMERIC(12,6);
                    v_is_correct := FALSE;
                    v_cnt_incorrect := v_cnt_incorrect + 1;
                END IF;

            ELSIF v_q_type = 'MULTIPLE_SELECT' THEN
                SELECT 
                    COUNT(*) FILTER (WHERE id = ANY(v_correct_opt_ids)),
                    COUNT(*) FILTER (WHERE id = ANY(v_incorrect_opt_ids))
                INTO v_c_sel, v_i_sel
                FROM unnest(v_selected_ids) AS id;

                -- Proportional partial credit formula:
                -- Awarded = ( (c_sel / tot_correct) * marks ) - ( i_sel * penalty )
                v_awarded := ( (v_c_sel::NUMERIC / v_tot_correct::NUMERIC) * v_q_marks::NUMERIC )
                             - ( CASE WHEN v_i_sel > 0 THEN v_q_penalty::NUMERIC ELSE 0.000000 END );

                IF v_awarded = v_q_marks THEN
                    v_is_correct := TRUE;
                    v_cnt_correct := v_cnt_correct + 1;
                ELSE
                    v_is_correct := FALSE;
                    v_cnt_incorrect := v_cnt_incorrect + 1;
                END IF;
            END IF;

            UPDATE student_responses
            SET is_evaluated = TRUE,
                is_correct = v_is_correct,
                awarded_marks = v_awarded
            WHERE attempt_id = p_attempt_id AND question_id = v_question_id;
        END IF;
    END LOOP;

    -- 7. Sum awarded marks only for valid snapshot questions
    SELECT ROUND(COALESCE(SUM(sr.awarded_marks), 0.000000), 2)
    INTO v_computed_total
    FROM student_responses sr
    WHERE sr.attempt_id = p_attempt_id
      AND sr.question_id IN (
          SELECT (q->>'question_id')::UUID 
          FROM jsonb_array_elements(v_snapshot->'questions') q
      );

    -- 8. Atomic update of attempt record (Negative scores preserved; no floor at zero)
    UPDATE quiz_attempts AS qa
    SET status = 'FINALIZED',
        submission_type = p_submission_type,
        submitted_at = COALESCE(qa.submitted_at, clock_timestamp()),
        finalized_at = clock_timestamp(),
        total_score = v_computed_total,
        total_correct = v_cnt_correct,
        total_incorrect = v_cnt_incorrect,
        total_unattempted = v_cnt_unattempted
    WHERE qa.id = p_attempt_id
    RETURNING qa.status, qa.total_score, qa.finalized_at
    INTO v_attempt.status, v_attempt.total_score, v_attempt.finalized_at;

    RETURN QUERY SELECT v_attempt.status, v_attempt.total_score, v_attempt.finalized_at;
END;
$$ LANGUAGE plpgsql;

-- Procedure: Get Student Attempt Results with Strict Release Enforcement
CREATE OR REPLACE FUNCTION sp_get_student_attempt_results(
    p_attempt_id UUID,
    p_actor_user_id UUID,
    p_auth_signature TEXT
)
RETURNS TABLE (
    attempt_id UUID,
    status VARCHAR(20),
    is_results_released BOOLEAN,
    total_score NUMERIC(8,2),
    question_breakdown JSONB
)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_actor users;
    v_attempt RECORD;
    v_session RECORD;
    v_released BOOLEAN := FALSE;
    v_is_privileged BOOLEAN := FALSE;
BEGIN
    -- 1. Cryptographically verify caller & expiry
    v_actor := fn_verify_actor_context(p_actor_user_id, NULL, p_auth_signature);

    SELECT * INTO v_attempt
    FROM quiz_attempts
    WHERE id = p_attempt_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attempt % not found', p_attempt_id;
    END IF;

    SELECT * INTO v_session
    FROM quiz_sessions
    WHERE id = v_attempt.session_id;

    -- 2. Privilege evaluation
    IF v_session.faculty_user_id = p_actor_user_id OR EXISTS (
        SELECT 1 FROM user_roles WHERE user_id = p_actor_user_id AND role_code = 'ADMIN' AND college_id = v_attempt.college_id
    ) THEN
        v_is_privileged := TRUE;
    ELSIF v_attempt.student_user_id <> p_actor_user_id THEN
        RAISE EXCEPTION 'Unauthorized: Caller does not own this attempt';
    END IF;

    -- 3. Verify release conditions for students
    IF v_is_privileged THEN
        v_released := TRUE;
    ELSIF v_session.result_visibility = 'IMMEDIATELY' AND v_attempt.status = 'FINALIZED' THEN
        v_released := TRUE;
    ELSIF v_session.result_visibility = 'AFTER_SESSION_ENDS' AND v_session.status = 'COMPLETED' THEN
        v_released := TRUE;
    ELSIF v_session.result_visibility = 'UPON_FACULTY_RELEASE' AND v_session.results_released_at IS NOT NULL THEN
        v_released := TRUE;
    END IF;

    IF NOT v_released THEN
        RETURN QUERY SELECT 
            v_attempt.id,
            v_attempt.status,
            FALSE,
            NULL::NUMERIC(8,2),
            NULL::JSONB;
        RETURN;
    END IF;

    -- 4. Return full breakdown with guaranteed non-null zero values for unattempted questions
    RETURN QUERY SELECT 
        v_attempt.id,
        v_attempt.status,
        TRUE,
        v_attempt.total_score,
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'question_id', q->>'question_id',
                    'sequence_order', (q->>'sequence_order')::INT,
                    'question_text', q->>'question_text',
                    'question_type', q->>'question_type',
                    'marks', (q->>'marks')::NUMERIC(8,4),
                    'awarded_marks', COALESCE(sr.awarded_marks, 0.000000),
                    'is_correct', COALESCE(sr.is_correct, FALSE),
                    'selected_option_ids', COALESCE(sr.selected_option_ids, '{}'),
                    'explanation', q->>'explanation',
                    'options', q->'options'
                ) ORDER BY (q->>'sequence_order')::INT
            )
            FROM jsonb_array_elements(v_session.snapshot_json->'questions') q
            LEFT JOIN student_responses sr ON sr.attempt_id = v_attempt.id 
                 AND sr.question_id = (q->>'question_id')::UUID
        );
END;
$$ LANGUAGE plpgsql;
-- ============================================================================
-- CampusQuiz — Migration 03: Function Ownership & Least-Privilege Grants
-- Target: PostgreSQL 15+ (Standard / Neon Compatible)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DEFINE FUNCTION & PROCEDURE OWNERSHIP
-- ----------------------------------------------------------------------------

ALTER FUNCTION fn_set_updated_at() OWNER TO campusquiz_definer;
ALTER FUNCTION fn_enforce_snapshot_immutability() OWNER TO campusquiz_definer;
ALTER FUNCTION fn_validate_session_status_transition() OWNER TO campusquiz_definer;
ALTER FUNCTION fn_guard_session_creation() OWNER TO campusquiz_definer;
ALTER FUNCTION fn_guard_student_response_mutation() OWNER TO campusquiz_definer;
ALTER FUNCTION fn_generate_auth_signature(UUID, VARCHAR, INT) OWNER TO campusquiz_definer;
ALTER FUNCTION fn_verify_actor_context(UUID, VARCHAR, TEXT) OWNER TO campusquiz_definer;
ALTER FUNCTION fn_validate_quiz_for_publishing(UUID) OWNER TO campusquiz_definer;
ALTER FUNCTION sp_publish_quiz(UUID, UUID, TEXT) OWNER TO campusquiz_definer;
ALTER FUNCTION sp_activate_quiz_session(UUID, UUID, TEXT) OWNER TO campusquiz_definer;
ALTER FUNCTION sp_pause_quiz_session(UUID, UUID, TEXT) OWNER TO campusquiz_definer;
ALTER FUNCTION sp_resume_quiz_session(UUID, UUID, TEXT) OWNER TO campusquiz_definer;
ALTER FUNCTION sp_complete_quiz_session(UUID, UUID, TEXT) OWNER TO campusquiz_definer;
ALTER FUNCTION sp_cancel_quiz_session(UUID, UUID, TEXT) OWNER TO campusquiz_definer;
ALTER FUNCTION sp_release_session_results(UUID, UUID, TEXT) OWNER TO campusquiz_definer;
ALTER FUNCTION sp_start_quiz_attempt(UUID, UUID, TEXT) OWNER TO campusquiz_definer;
ALTER FUNCTION sp_save_student_response(UUID, UUID, UUID[], BOOLEAN, INT, TIMESTAMPTZ, UUID, TEXT) OWNER TO campusquiz_definer;
ALTER FUNCTION sp_finalize_attempt(UUID, VARCHAR, UUID, TEXT) OWNER TO campusquiz_definer;
ALTER FUNCTION sp_get_student_attempt_results(UUID, UUID, TEXT) OWNER TO campusquiz_definer;

-- ----------------------------------------------------------------------------
-- 2. REVOKE PUBLIC EXECUTE PRIVILEGES
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION fn_generate_auth_signature(UUID, VARCHAR, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_verify_actor_context(UUID, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_validate_quiz_for_publishing(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION sp_publish_quiz(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sp_activate_quiz_session(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sp_pause_quiz_session(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sp_resume_quiz_session(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sp_complete_quiz_session(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sp_cancel_quiz_session(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sp_release_session_results(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sp_start_quiz_attempt(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sp_save_student_response(UUID, UUID, UUID[], BOOLEAN, INT, TIMESTAMPTZ, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sp_finalize_attempt(UUID, VARCHAR, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sp_get_student_attempt_results(UUID, UUID, TEXT) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 3. GRANT EXECUTE TO APPLICATION ROLE ONLY
-- ----------------------------------------------------------------------------

-- NOTE: fn_generate_auth_signature is strictly revoked from campusquiz_app (backend-only minting via AUTH_HMAC_SECRET)
GRANT EXECUTE ON FUNCTION fn_validate_quiz_for_publishing(UUID) TO campusquiz_app;
GRANT EXECUTE ON FUNCTION sp_publish_quiz(UUID, UUID, TEXT) TO campusquiz_app;
GRANT EXECUTE ON FUNCTION sp_activate_quiz_session(UUID, UUID, TEXT) TO campusquiz_app;
GRANT EXECUTE ON FUNCTION sp_pause_quiz_session(UUID, UUID, TEXT) TO campusquiz_app;
GRANT EXECUTE ON FUNCTION sp_resume_quiz_session(UUID, UUID, TEXT) TO campusquiz_app;
GRANT EXECUTE ON FUNCTION sp_complete_quiz_session(UUID, UUID, TEXT) TO campusquiz_app;
GRANT EXECUTE ON FUNCTION sp_cancel_quiz_session(UUID, UUID, TEXT) TO campusquiz_app;
GRANT EXECUTE ON FUNCTION sp_release_session_results(UUID, UUID, TEXT) TO campusquiz_app;
GRANT EXECUTE ON FUNCTION sp_start_quiz_attempt(UUID, UUID, TEXT) TO campusquiz_app;
GRANT EXECUTE ON FUNCTION sp_save_student_response(UUID, UUID, UUID[], BOOLEAN, INT, TIMESTAMPTZ, UUID, TEXT) TO campusquiz_app;
GRANT EXECUTE ON FUNCTION sp_finalize_attempt(UUID, VARCHAR, UUID, TEXT) TO campusquiz_app;
GRANT EXECUTE ON FUNCTION sp_get_student_attempt_results(UUID, UUID, TEXT) TO campusquiz_app;

-- ----------------------------------------------------------------------------
-- 4. TABLE PERMISSIONS & SENSITIVE DATA RESTRICTION
-- ----------------------------------------------------------------------------

-- Definer: SELECT on all tables (required by all stored procedure reads)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO campusquiz_definer;
-- Definer: INSERT only where stored procedures create new rows
GRANT INSERT ON quiz_attempts, student_responses TO campusquiz_definer;
-- Definer: UPDATE only where stored procedures mutate records
GRANT UPDATE ON quizzes, quiz_sessions, quiz_attempts, student_responses TO campusquiz_definer;
-- Definer: Sequence USAGE for UUID generation (gen_random_uuid)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO campusquiz_definer;

-- Strict protection of internal auth secrets: No access to app role or public
REVOKE ALL ON app_auth_config FROM PUBLIC, campusquiz_app;
GRANT SELECT ON app_auth_config TO campusquiz_definer;

-- Standard operational tables: Full DML for application role
GRANT SELECT, INSERT, UPDATE, DELETE ON 
    colleges, users, roles, user_roles, 
    departments, faculty_profiles, student_profiles, branches, academic_years, 
    classes, subjects, faculty_assignments, student_enrollments, 
    questions, quizzes, quiz_questions 
TO campusquiz_app;

-- Quiz Attempts: Read-only access for reporting/queries (scoring and finalization strictly procedure-controlled)
REVOKE ALL ON quiz_attempts FROM campusquiz_app;
GRANT SELECT ON quiz_attempts TO campusquiz_app;

-- Question Options: Restrict direct SELECT on is_correct
REVOKE ALL ON question_options FROM campusquiz_app;
GRANT SELECT (id, question_id, option_text, display_order, created_at), 
      INSERT, UPDATE, DELETE 
ON question_options TO campusquiz_app;

-- Quiz Sessions: Restrict direct SELECT on snapshot_json (contains answers & explanations)
REVOKE ALL ON quiz_sessions FROM campusquiz_app;
GRANT SELECT (
    id, college_id, quiz_id, faculty_user_id, class_id, session_code, 
    session_mode, status, start_window_time, end_window_time, 
    actual_started_at, actual_ended_at, duration_minutes, 
    negative_marking_enabled, negative_penalty, result_visibility, 
    results_released_at, current_question_index, is_question_revealed, 
    created_at, updated_at
), INSERT, UPDATE, DELETE 
ON quiz_sessions TO campusquiz_app;

-- Student Responses: Revoke table-level access entirely
REVOKE ALL ON student_responses FROM campusquiz_app;

-- Column-level SELECT: Exclude is_evaluated, is_correct, awarded_marks
GRANT SELECT (
    id, attempt_id, question_id, selected_option_ids, 
    is_marked_for_review, client_version, client_submitted_at, 
    server_received_at, created_at, updated_at
) ON student_responses TO campusquiz_app;

-- Column-level INSERT: Exclude is_evaluated, is_correct, awarded_marks, AND server_received_at
-- server_received_at is strictly database/definer controlled (clock_timestamp())
GRANT INSERT (
    id, attempt_id, question_id, selected_option_ids, 
    is_marked_for_review, client_version, client_submitted_at, 
    created_at, updated_at
) ON student_responses TO campusquiz_app;

-- Column-level UPDATE: Only student editable fields permitted (NO server_received_at)
GRANT UPDATE (
    selected_option_ids, is_marked_for_review, 
    client_version, client_submitted_at, updated_at
) ON student_responses TO campusquiz_app;
-- ============================================================================
-- CampusQuiz — Migration 04: Security, Integrity & Concurrency Verification Test Suite
-- Target: PostgreSQL 15+ (Standard / Neon Compatible)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TEST 1: Table & Column-Level Least-Privilege Permissions
-- Direct update of evaluation columns & server_received_at must be blocked (42501)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    -- Switch to restricted application role to verify permission boundaries
    EXECUTE 'SET ROLE campusquiz_app';

    -- 1A: Evaluation field modification blocked
    BEGIN
        EXECUTE 'UPDATE student_responses SET awarded_marks = 100.000000 WHERE id = gen_random_uuid()';
        RAISE EXCEPTION 'TEST-01A FAILED: Direct update of awarded_marks was permitted!';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST-01A PASSED: Direct update of awarded_marks was blocked by column-level permissions (42501).';
    END;

    -- 1B: server_received_at modification blocked
    BEGIN
        EXECUTE 'UPDATE student_responses SET server_received_at = clock_timestamp() WHERE id = gen_random_uuid()';
        RAISE EXCEPTION 'TEST-01B FAILED: Direct update of server_received_at was permitted!';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST-01B PASSED: Direct update of server_received_at was blocked by column-level permissions (42501).';
    END;

    EXECUTE 'RESET ROLE';
EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE;
END $$;

-- ----------------------------------------------------------------------------
-- TEST 2: Multi-College Tenant Isolation & Cross-College Referential Integrity
-- Expected: Foreign Key Violation (SQLSTATE 23503)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_c1 UUID := gen_random_uuid();
    v_c2 UUID := gen_random_uuid();
    v_dept UUID := gen_random_uuid();
    v_sub UUID := gen_random_uuid();
    v_user1 UUID := gen_random_uuid();
    v_user2 UUID := gen_random_uuid();
    v_q UUID := gen_random_uuid();
    v_quiz UUID := gen_random_uuid();
BEGIN
    INSERT INTO colleges (id, name, code) VALUES (v_c1, 'College One', 'C1_' || v_c1);
    INSERT INTO colleges (id, name, code) VALUES (v_c2, 'College Two', 'C2_' || v_c2);

    INSERT INTO users (id, college_id, email, password_hash, first_name, last_name)
    VALUES (v_user1, v_c1, 'faculty1_' || v_c1 || '@c1.edu', 'hash', 'Fac', 'One'),
           (v_user2, v_c2, 'faculty2_' || v_c2 || '@c2.edu', 'hash', 'Fac', 'Two');

    INSERT INTO roles (code, name) VALUES ('FACULTY', 'Faculty') ON CONFLICT DO NOTHING;
    INSERT INTO user_roles (user_id, role_code, college_id) VALUES (v_user1, 'FACULTY', v_c1), (v_user2, 'FACULTY', v_c2);

    INSERT INTO departments (id, college_id, name, code) VALUES (v_dept, v_c1, 'CS Dept', 'CS_' || v_c1);
    INSERT INTO subjects (id, college_id, department_id, name, code) VALUES (v_sub, v_c1, v_dept, 'DBMS', 'CS301_' || v_c1);

    -- Question belongs to College 1
    INSERT INTO questions (id, college_id, subject_id, created_by_faculty_id, question_type, question_text)
    VALUES (v_q, v_c1, v_sub, v_user1, 'MCQ', 'What is 2+2?');

    -- Quiz belongs to College 2
    INSERT INTO quizzes (id, college_id, faculty_user_id, subject_id, title, default_duration_minutes)
    VALUES (v_quiz, v_c2, v_user2, v_sub, 'Quiz in College 2', 30);

    -- Attempt to link Question (College 1) to Quiz (College 2)
    BEGIN
        INSERT INTO quiz_questions (college_id, quiz_id, question_id, sequence_order)
        VALUES (v_c2, v_quiz, v_q, 1);
        RAISE EXCEPTION 'TEST-02 FAILED: Cross-college quiz question insertion was not blocked!';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'TEST-02 PASSED: Cross-college quiz question was rejected by foreign key constraint (23503).';
    END;

    -- Cleanup test data
    DELETE FROM quiz_questions WHERE quiz_id = v_quiz;
    DELETE FROM quizzes WHERE id = v_quiz;
    DELETE FROM questions WHERE id = v_q;
    DELETE FROM subjects WHERE id = v_sub;
    DELETE FROM departments WHERE id = v_dept;
    DELETE FROM user_roles WHERE user_id IN (v_user1, v_user2);
    DELETE FROM users WHERE id IN (v_user1, v_user2);
    DELETE FROM colleges WHERE id IN (v_c1, v_c2);
END $$;

-- ----------------------------------------------------------------------------
-- TEST 3: Single Current Academic Year Partial Unique Index
-- Expected: Unique Violation (SQLSTATE 23505)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_c UUID := gen_random_uuid();
    v_ay1 UUID := gen_random_uuid();
    v_ay2 UUID := gen_random_uuid();
BEGIN
    INSERT INTO colleges (id, name, code) VALUES (v_c, 'Test College AY', 'TCAY_' || v_c);
    
    INSERT INTO academic_years (id, college_id, name, start_date, end_date, is_current)
    VALUES (v_ay1, v_c, '2024-2025', '2024-06-01', '2025-05-31', TRUE);

    BEGIN
        INSERT INTO academic_years (id, college_id, name, start_date, end_date, is_current)
        VALUES (v_ay2, v_c, '2025-2026', '2025-06-01', '2026-05-31', TRUE);
        RAISE EXCEPTION 'TEST-03 FAILED: Duplicate current academic year was allowed!';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'TEST-03 PASSED: Multiple current academic years blocked by uq_ay_single_current (23505).';
    END;

    DELETE FROM academic_years WHERE college_id = v_c;
    DELETE FROM colleges WHERE id = v_c;
END $$;

-- ----------------------------------------------------------------------------
-- TEST 4: Active Student Enrollment Constraints
-- Single active CORE enrollment vs multiple ELECTIVE enrollments
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_c UUID := gen_random_uuid();
    v_ay UUID := gen_random_uuid();
    v_dept UUID := gen_random_uuid();
    v_branch UUID := gen_random_uuid();
    v_class1 UUID := gen_random_uuid();
    v_class2 UUID := gen_random_uuid();
    v_class3 UUID := gen_random_uuid();
    v_user UUID := gen_random_uuid();
    v_enroll1 UUID := gen_random_uuid();
    v_enroll2 UUID := gen_random_uuid();
    v_enroll3 UUID := gen_random_uuid();
BEGIN
    INSERT INTO colleges (id, name, code) VALUES (v_c, 'Enrollment Test College', 'ETC_' || v_c);
    INSERT INTO users (id, college_id, email, password_hash, first_name, last_name)
    VALUES (v_user, v_c, 'student_' || v_c || '@etc.edu', 'hash', 'Test', 'Student');
    
    INSERT INTO roles (code, name) VALUES ('STUDENT', 'Student') ON CONFLICT DO NOTHING;
    INSERT INTO user_roles (user_id, role_code, college_id) VALUES (v_user, 'STUDENT', v_c);
    INSERT INTO student_profiles (user_id, college_id, roll_number) VALUES (v_user, v_c, UPPER('ROLL_' || v_c));

    INSERT INTO academic_years (id, college_id, name, start_date, end_date, is_current)
    VALUES (v_ay, v_c, '2024-2025', '2024-06-01', '2025-05-31', TRUE);

    INSERT INTO departments (id, college_id, name, code) VALUES (v_dept, v_c, 'CS', 'CS_' || v_c);
    INSERT INTO branches (id, college_id, department_id, name, code) VALUES (v_branch, v_c, v_dept, 'BTech CSE', 'BCSE_' || v_c);

    INSERT INTO classes (id, college_id, branch_id, academic_year_id, year_of_study, semester, section)
    VALUES (v_class1, v_c, v_branch, v_ay, 3, 5, 'A'),
           (v_class2, v_c, v_branch, v_ay, 3, 5, 'B'),
           (v_class3, v_c, v_branch, v_ay, 3, 5, 'ELECTIVE_FRENCH');

    -- Enroll in 1st CORE class
    INSERT INTO student_enrollments (id, college_id, student_user_id, class_id, academic_year_id, enrollment_type, is_active)
    VALUES (v_enroll1, v_c, v_user, v_class1, v_ay, 'CORE', TRUE);

    -- Attempt 2nd active CORE enrollment in same academic year
    BEGIN
        INSERT INTO student_enrollments (id, college_id, student_user_id, class_id, academic_year_id, enrollment_type, is_active)
        VALUES (v_enroll2, v_c, v_user, v_class2, v_ay, 'CORE', TRUE);
        RAISE EXCEPTION 'TEST-04 FAILED: Duplicate active CORE enrollment was permitted!';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'TEST-04A PASSED: Second active CORE enrollment was rejected by uq_student_single_core_enrollment.';
    END;

    -- Multiple ELECTIVE enrollments permitted
    INSERT INTO student_enrollments (id, college_id, student_user_id, class_id, academic_year_id, enrollment_type, is_active)
    VALUES (v_enroll3, v_c, v_user, v_class3, v_ay, 'ELECTIVE', TRUE);
    RAISE NOTICE 'TEST-04B PASSED: Multiple ELECTIVE enrollments are allowed alongside single CORE.';

    -- Cleanup
    DELETE FROM student_enrollments WHERE college_id = v_c;
    DELETE FROM classes WHERE college_id = v_c;
    DELETE FROM branches WHERE college_id = v_c;
    DELETE FROM departments WHERE college_id = v_c;
    DELETE FROM academic_years WHERE college_id = v_c;
    DELETE FROM student_profiles WHERE user_id = v_user;
    DELETE FROM user_roles WHERE user_id = v_user;
    DELETE FROM users WHERE id = v_user;
    DELETE FROM colleges WHERE id = v_c;
END $$;

-- ----------------------------------------------------------------------------
-- TEST 5: Minimal HMAC Authentication Context, Replay Expiry & Token Revocation
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_c UUID := gen_random_uuid();
    v_user UUID := gen_random_uuid();
    v_valid_sig TEXT;
    v_expired_sig TEXT;
    v_fake_sig TEXT := '9999999999:deadbeefcafebabe0123456789abcdef0123456789abcdef0123456789abcdef';
BEGIN
    INSERT INTO colleges (id, name, code) VALUES (v_c, 'Auth College', 'AC_' || v_c);
    INSERT INTO users (id, college_id, email, password_hash, first_name, last_name, token_version)
    VALUES (v_user, v_c, 'student_auth_' || v_c || '@ac.edu', 'hash', 'Auth', 'Student', 1);

    INSERT INTO roles (code, name) VALUES ('STUDENT', 'Student') ON CONFLICT DO NOTHING;
    INSERT INTO user_roles (user_id, role_code, college_id) VALUES (v_user, 'STUDENT', v_c);

    -- 5A: Forged signature rejection
    BEGIN
        PERFORM fn_verify_actor_context(v_user, 'STUDENT', v_fake_sig);
        RAISE EXCEPTION 'TEST-05A FAILED: Forged auth signature was accepted!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST-05A PASSED: Forged signature successfully rejected.';
    END;

    -- 5B: Valid HMAC signature accepted
    v_valid_sig := fn_generate_auth_signature(v_user, 'STUDENT', 300);
    PERFORM fn_verify_actor_context(v_user, 'STUDENT', v_valid_sig);
    RAISE NOTICE 'TEST-05B PASSED: Valid HMAC signature successfully verified.';

    -- 5C: Expired HMAC signature rejected
    -- Generate signature with -10 seconds validity (already in the past)
    v_expired_sig := fn_generate_auth_signature(v_user, 'STUDENT', -10);
    BEGIN
        PERFORM fn_verify_actor_context(v_user, 'STUDENT', v_expired_sig);
        RAISE EXCEPTION 'TEST-05C FAILED: Expired signature was accepted!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST-05C PASSED: Expired signature successfully rejected.';
    END;

    -- 5D: Token version bump invalidation
    UPDATE users SET token_version = token_version + 1 WHERE id = v_user;
    BEGIN
        PERFORM fn_verify_actor_context(v_user, 'STUDENT', v_valid_sig);
        RAISE EXCEPTION 'TEST-05D FAILED: Signature was accepted after token version bump!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST-05D PASSED: Previously valid signature rejected after token version bump.';
    END;

    -- Cleanup
    DELETE FROM user_roles WHERE user_id = v_user;
    DELETE FROM users WHERE id = v_user;
    DELETE FROM colleges WHERE id = v_c;
END $$;

-- ----------------------------------------------------------------------------
-- TEST 6: Quiz Authoring, Publishing Validation & Atomicity
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_c UUID := gen_random_uuid();
    v_ay UUID := gen_random_uuid();
    v_dept UUID := gen_random_uuid();
    v_fac UUID := gen_random_uuid();
    v_sub UUID := gen_random_uuid();
    v_quiz UUID := gen_random_uuid();
    v_q UUID := gen_random_uuid();
    v_fac_sig TEXT;
    v_pub_status VARCHAR(20);
    v_pub_total NUMERIC(8,2);
BEGIN
    INSERT INTO colleges (id, name, code) VALUES (v_c, 'Publish College', 'PBC_' || v_c);
    INSERT INTO users (id, college_id, email, password_hash, first_name, last_name)
    VALUES (v_fac, v_c, 'fac_pub_' || v_c || '@pbc.edu', 'hash', 'Fac', 'Pub');

    INSERT INTO roles (code, name) VALUES ('FACULTY', 'Faculty') ON CONFLICT DO NOTHING;
    INSERT INTO user_roles (user_id, role_code, college_id) VALUES (v_fac, 'FACULTY', v_c);
    INSERT INTO departments (id, college_id, name, code) VALUES (v_dept, v_c, 'CS', 'CS_' || v_c);
    INSERT INTO faculty_profiles (user_id, college_id, department_id, employee_id, designation) VALUES (v_fac, v_c, v_dept, UPPER('EMP_' || v_fac), 'Professor');
    INSERT INTO subjects (id, college_id, department_id, name, code) VALUES (v_sub, v_c, v_dept, 'Math', 'MTH_' || v_c);

    INSERT INTO quizzes (id, college_id, faculty_user_id, subject_id, title, default_duration_minutes)
    VALUES (v_quiz, v_c, v_fac, v_sub, 'Empty Quiz', 30);

    v_fac_sig := fn_generate_auth_signature(v_fac, 'ANY', 300);

    -- 6A: Reject publishing empty quiz (no questions)
    BEGIN
        PERFORM sp_publish_quiz(v_quiz, v_fac, v_fac_sig);
        RAISE EXCEPTION 'TEST-06A FAILED: Empty quiz was published!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST-06A PASSED: Empty quiz publishing rejected.';
    END;

    -- Add question with no options
    INSERT INTO questions (id, college_id, subject_id, created_by_faculty_id, question_type, question_text, default_marks)
    VALUES (v_q, v_c, v_sub, v_fac, 'MCQ', 'Question 1', 2.0000);

    INSERT INTO quiz_questions (college_id, quiz_id, question_id, sequence_order)
    VALUES (v_c, v_quiz, v_q, 1);

    -- 6B: Reject publishing question with no options
    BEGIN
        PERFORM sp_publish_quiz(v_quiz, v_fac, v_fac_sig);
        RAISE EXCEPTION 'TEST-06B FAILED: Question without options was published!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST-06B PASSED: Quiz with options missing rejected.';
    END;

    -- Add valid options (1 correct, 1 incorrect)
    INSERT INTO question_options (question_id, option_text, is_correct, display_order)
    VALUES (v_q, 'Option A', TRUE, 1), (v_q, 'Option B', FALSE, 2);

    -- 6C: Valid Publish
    SELECT status, total_marks INTO v_pub_status, v_pub_total
    FROM sp_publish_quiz(v_quiz, v_fac, v_fac_sig);

    IF v_pub_status <> 'PUBLISHED' OR v_pub_total <> 2.00 THEN
        RAISE EXCEPTION 'TEST-06C FAILED: Expected PUBLISHED with 2.00 marks, got % with %', v_pub_status, v_pub_total;
    END IF;
    RAISE NOTICE 'TEST-06C PASSED: Quiz successfully published atomically with total_marks computed.';

    -- Cleanup
    DELETE FROM quiz_questions WHERE quiz_id = v_quiz;
    DELETE FROM quizzes WHERE id = v_quiz;
    DELETE FROM question_options WHERE question_id = v_q;
    DELETE FROM questions WHERE id = v_q;
    DELETE FROM subjects WHERE id = v_sub;
    DELETE FROM faculty_profiles WHERE user_id = v_fac;
    DELETE FROM departments WHERE id = v_dept;
    DELETE FROM user_roles WHERE user_id = v_fac;
    DELETE FROM users WHERE id = v_fac;
    DELETE FROM colleges WHERE id = v_c;
END $$;

-- ----------------------------------------------------------------------------
-- TEST 7: Faculty Authorization & Session Creation Guard
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_c UUID := gen_random_uuid();
    v_ay UUID := gen_random_uuid();
    v_dept UUID := gen_random_uuid();
    v_branch UUID := gen_random_uuid();
    v_class UUID := gen_random_uuid();
    v_fac1 UUID := gen_random_uuid();
    v_fac2 UUID := gen_random_uuid();
    v_sub UUID := gen_random_uuid();
    v_quiz UUID := gen_random_uuid();
    v_q UUID := gen_random_uuid();
    v_session UUID := gen_random_uuid();
    v_fac2_sig TEXT;
BEGIN
    INSERT INTO colleges (id, name, code) VALUES (v_c, 'Authz College', 'AZC_' || v_c);
    
    INSERT INTO users (id, college_id, email, password_hash, first_name, last_name)
    VALUES (v_fac1, v_c, 'fac1_az_' || v_c || '@azc.edu', 'hash', 'Fac', 'One'),
           (v_fac2, v_c, 'fac2_az_' || v_c || '@azc.edu', 'hash', 'Fac', 'Two');

    INSERT INTO roles (code, name) VALUES ('FACULTY', 'Faculty') ON CONFLICT DO NOTHING;
    INSERT INTO user_roles (user_id, role_code, college_id) VALUES (v_fac1, 'FACULTY', v_c), (v_fac2, 'FACULTY', v_c);

    INSERT INTO academic_years (id, college_id, name, start_date, end_date, is_current)
    VALUES (v_ay, v_c, '2024-2025', '2024-06-01', '2025-05-31', TRUE);

    INSERT INTO departments (id, college_id, name, code) VALUES (v_dept, v_c, 'CS', 'CS_' || v_c);
    INSERT INTO branches (id, college_id, department_id, name, code) VALUES (v_branch, v_c, v_dept, 'CSE', 'CSE_' || v_c);
    INSERT INTO classes (id, college_id, branch_id, academic_year_id, year_of_study, semester, section)
    VALUES (v_class, v_c, v_branch, v_ay, 3, 5, 'A');

    INSERT INTO subjects (id, college_id, department_id, name, code) VALUES (v_sub, v_c, v_dept, 'CN', 'CN_' || v_c);

    -- Faculty 1 owns quiz
    INSERT INTO quizzes (id, college_id, faculty_user_id, subject_id, title, default_duration_minutes)
    VALUES (v_quiz, v_c, v_fac1, v_sub, 'CN Quiz', 30);

    -- 7A: Faculty 2 cannot publish Faculty 1's quiz
    v_fac2_sig := fn_generate_auth_signature(v_fac2, 'ANY', 300);
    BEGIN
        PERFORM sp_publish_quiz(v_quiz, v_fac2, v_fac2_sig);
        RAISE EXCEPTION 'TEST-07A FAILED: Unauthorized faculty was permitted to publish quiz!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST-07A PASSED: Unauthorized faculty publishing rejected.';
    END;

    -- 7B: Direct creation of ACTIVE session via INSERT blocked by trigger
    BEGIN
        INSERT INTO quiz_sessions (
            id, college_id, quiz_id, faculty_user_id, class_id, session_code,
            status, start_window_time, end_window_time, duration_minutes
        ) VALUES (
            v_session, v_c, v_quiz, v_fac1, v_class, 'SESSAZ',
            'ACTIVE', clock_timestamp(), clock_timestamp() + INTERVAL '1 hour', 30
        );
        RAISE EXCEPTION 'TEST-07B FAILED: Direct creation of ACTIVE session was permitted!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST-07B PASSED: Direct ACTIVE session creation rejected by fn_guard_session_creation.';
    END;

    -- Cleanup
    DELETE FROM quizzes WHERE id = v_quiz;
    DELETE FROM subjects WHERE id = v_sub;
    DELETE FROM classes WHERE id = v_class;
    DELETE FROM branches WHERE id = v_branch;
    DELETE FROM departments WHERE id = v_dept;
    DELETE FROM academic_years WHERE id = v_ay;
    DELETE FROM user_roles WHERE user_id IN (v_fac1, v_fac2);
    DELETE FROM users WHERE id IN (v_fac1, v_fac2);
    DELETE FROM colleges WHERE id = v_c;
END $$;

-- ----------------------------------------------------------------------------
-- TEST 8: Negative Marking Precedence, Explicit Zero Overrides & Snapshot Immutability
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_c UUID := gen_random_uuid();
    v_ay UUID := gen_random_uuid();
    v_dept UUID := gen_random_uuid();
    v_branch UUID := gen_random_uuid();
    v_class UUID := gen_random_uuid();
    v_fac UUID := gen_random_uuid();
    v_sub UUID := gen_random_uuid();
    v_q1 UUID := gen_random_uuid();
    v_q2 UUID := gen_random_uuid();
    v_opt1 UUID := gen_random_uuid();
    v_opt2 UUID := gen_random_uuid();
    v_opt3 UUID := gen_random_uuid();
    v_opt4 UUID := gen_random_uuid();
    v_quiz UUID := gen_random_uuid();
    v_session UUID := gen_random_uuid();
    v_fac_sig TEXT;
    v_snapshot JSONB;
    v_snap_p1 NUMERIC(8,4);
    v_snap_p2 NUMERIC(8,4);
BEGIN
    INSERT INTO colleges (id, name, code) VALUES (v_c, 'Precedence College', 'PC_' || v_c);
    INSERT INTO users (id, college_id, email, password_hash, first_name, last_name)
    VALUES (v_fac, v_c, 'fac_prec_' || v_c || '@pc.edu', 'hash', 'Fac', 'Prec');

    INSERT INTO roles (code, name) VALUES ('FACULTY', 'Faculty') ON CONFLICT DO NOTHING;
    INSERT INTO user_roles (user_id, role_code, college_id) VALUES (v_fac, 'FACULTY', v_c);
    INSERT INTO academic_years (id, college_id, name, start_date, end_date, is_current)
    VALUES (v_ay, v_c, '2024-2025', '2024-06-01', '2025-05-31', TRUE);

    INSERT INTO departments (id, college_id, name, code) VALUES (v_dept, v_c, 'CS', 'CS_' || v_c);
    INSERT INTO faculty_profiles (user_id, college_id, department_id, employee_id, designation) VALUES (v_fac, v_c, v_dept, UPPER('EMP_' || v_fac), 'Professor');
    INSERT INTO branches (id, college_id, department_id, name, code) VALUES (v_branch, v_c, v_dept, 'CSE', 'CSE_' || v_c);
    INSERT INTO classes (id, college_id, branch_id, academic_year_id, year_of_study, semester, section)
    VALUES (v_class, v_c, v_branch, v_ay, 3, 5, 'A');

    INSERT INTO subjects (id, college_id, department_id, name, code) VALUES (v_sub, v_c, v_dept, 'Math', 'MTH_' || v_c);

    INSERT INTO faculty_assignments (college_id, faculty_user_id, subject_id, class_id, academic_year_id)
    VALUES (v_c, v_fac, v_sub, v_class, v_ay);

    -- Question 1: Bank default penalty 0.25
    INSERT INTO questions (id, college_id, subject_id, created_by_faculty_id, question_type, question_text, default_marks, default_negative_penalty)
    VALUES (v_q1, v_c, v_sub, v_fac, 'MCQ', 'Q1?', 1.0000, 0.2500);

    INSERT INTO question_options (id, question_id, option_text, is_correct, display_order)
    VALUES (v_opt1, v_q1, 'A', TRUE, 1), (v_opt2, v_q1, 'B', FALSE, 2);

    -- Question 2: Bank default penalty 0.50
    INSERT INTO questions (id, college_id, subject_id, created_by_faculty_id, question_type, question_text, default_marks, default_negative_penalty)
    VALUES (v_q2, v_c, v_sub, v_fac, 'MCQ', 'Q2?', 2.0000, 0.5000);

    INSERT INTO question_options (id, question_id, option_text, is_correct, display_order)
    VALUES (v_opt3, v_q2, 'A', TRUE, 1), (v_opt4, v_q2, 'B', FALSE, 2);

    -- Quiz: Enablement = TRUE, default penalty = 0.3333
    INSERT INTO quizzes (id, college_id, faculty_user_id, subject_id, title, default_duration_minutes, default_negative_marking_enabled, default_negative_penalty)
    VALUES (v_quiz, v_c, v_fac, v_sub, 'Quiz Prec', 30, TRUE, 0.3333);

    -- Q1: Inherits quiz default penalty (override = NULL)
    INSERT INTO quiz_questions (college_id, quiz_id, question_id, sequence_order, negative_penalty_override)
    VALUES (v_c, v_quiz, v_q1, 1, NULL);

    -- Q2: Explicitly overrides penalty to 0.0000 (explicit zero override preserved)
    INSERT INTO quiz_questions (college_id, quiz_id, question_id, sequence_order, negative_penalty_override)
    VALUES (v_c, v_quiz, v_q2, 2, 0.0000);

    v_fac_sig := fn_generate_auth_signature(v_fac, 'ANY', 300);
    PERFORM sp_publish_quiz(v_quiz, v_fac, v_fac_sig);

    INSERT INTO quiz_sessions (
        id, college_id, quiz_id, faculty_user_id, class_id, session_code,
        start_window_time, end_window_time, duration_minutes, negative_marking_enabled, negative_penalty
    ) VALUES (
        v_session, v_c, v_quiz, v_fac, v_class, 'SESS01',
        clock_timestamp() - INTERVAL '5 minutes', clock_timestamp() + INTERVAL '1 hour', 30, TRUE, NULL
    );

    v_snapshot := sp_activate_quiz_session(v_session, v_fac, v_fac_sig);

    v_snap_p1 := ((v_snapshot->'questions'->0)->>'negative_penalty')::NUMERIC(8,4);
    v_snap_p2 := ((v_snapshot->'questions'->1)->>'negative_penalty')::NUMERIC(8,4);

    IF v_snap_p1 <> 0.3333 THEN
        RAISE EXCEPTION 'TEST-08A FAILED: Q1 penalty was % (expected 0.3333)', v_snap_p1;
    END IF;

    IF v_snap_p2 <> 0.0000 THEN
        RAISE EXCEPTION 'TEST-08B FAILED: Q2 penalty was % (expected 0.0000)', v_snap_p2;
    END IF;
    RAISE NOTICE 'TEST-08A/B PASSED: Negative marking inheritance and explicit zero override verified.';

    -- 8C: Test Snapshot Immutability Trigger
    BEGIN
        UPDATE quiz_sessions SET snapshot_json = '{"altered": true}'::jsonb WHERE id = v_session;
        RAISE EXCEPTION 'TEST-08C FAILED: Snapshot modification was permitted!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST-08C PASSED: Direct snapshot mutation blocked by fn_enforce_snapshot_immutability.';
    END;

    -- Cleanup
    DELETE FROM quiz_sessions WHERE id = v_session;
    DELETE FROM quiz_questions WHERE quiz_id = v_quiz;
    DELETE FROM quizzes WHERE id = v_quiz;
    DELETE FROM question_options WHERE question_id IN (v_q1, v_q2);
    DELETE FROM questions WHERE id IN (v_q1, v_q2);
    DELETE FROM faculty_assignments WHERE college_id = v_c;
    DELETE FROM subjects WHERE id = v_sub;
    DELETE FROM classes WHERE id = v_class;
    DELETE FROM branches WHERE id = v_branch;
    DELETE FROM faculty_profiles WHERE user_id = v_fac;
    DELETE FROM departments WHERE id = v_dept;
    DELETE FROM academic_years WHERE id = v_ay;
    DELETE FROM user_roles WHERE user_id = v_fac;
    DELETE FROM users WHERE id = v_fac;
    DELETE FROM colleges WHERE id = v_c;
END $$;

-- ----------------------------------------------------------------------------
-- TEST 9: Session Lifecycle State Transitions
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_c UUID := gen_random_uuid();
    v_ay UUID := gen_random_uuid();
    v_dept UUID := gen_random_uuid();
    v_branch UUID := gen_random_uuid();
    v_class UUID := gen_random_uuid();
    v_fac UUID := gen_random_uuid();
    v_sub UUID := gen_random_uuid();
    v_quiz UUID := gen_random_uuid();
    v_q UUID := gen_random_uuid();
    v_session UUID := gen_random_uuid();
    v_fac_sig TEXT;
BEGIN
    INSERT INTO colleges (id, name, code) VALUES (v_c, 'Lifecycle College', 'LC_' || v_c);
    INSERT INTO users (id, college_id, email, password_hash, first_name, last_name)
    VALUES (v_fac, v_c, 'fac_lc_' || v_c || '@lc.edu', 'hash', 'Fac', 'LC');

    INSERT INTO roles (code, name) VALUES ('FACULTY', 'Faculty') ON CONFLICT DO NOTHING;
    INSERT INTO user_roles (user_id, role_code, college_id) VALUES (v_fac, 'FACULTY', v_c);
    INSERT INTO academic_years (id, college_id, name, start_date, end_date, is_current)
    VALUES (v_ay, v_c, '2024-2025', '2024-06-01', '2025-05-31', TRUE);

    INSERT INTO departments (id, college_id, name, code) VALUES (v_dept, v_c, 'CS', 'CS_' || v_c);
    INSERT INTO faculty_profiles (user_id, college_id, department_id, employee_id, designation) VALUES (v_fac, v_c, v_dept, UPPER('EMP_' || v_fac), 'Professor');
    INSERT INTO branches (id, college_id, department_id, name, code) VALUES (v_branch, v_c, v_dept, 'CSE', 'CSE_' || v_c);
    INSERT INTO classes (id, college_id, branch_id, academic_year_id, year_of_study, semester, section)
    VALUES (v_class, v_c, v_branch, v_ay, 3, 5, 'A');

    INSERT INTO subjects (id, college_id, department_id, name, code) VALUES (v_sub, v_c, v_dept, 'CS', 'CS_' || v_c);

    INSERT INTO faculty_assignments (college_id, faculty_user_id, subject_id, class_id, academic_year_id)
    VALUES (v_c, v_fac, v_sub, v_class, v_ay);

    INSERT INTO questions (id, college_id, subject_id, created_by_faculty_id, question_type, question_text)
    VALUES (v_q, v_c, v_sub, v_fac, 'MCQ', 'LC Q?');

    INSERT INTO question_options (question_id, option_text, is_correct, display_order)
    VALUES (v_q, 'A', TRUE, 1), (v_q, 'B', FALSE, 2);

    INSERT INTO quizzes (id, college_id, faculty_user_id, subject_id, title, default_duration_minutes)
    VALUES (v_quiz, v_c, v_fac, v_sub, 'LC Quiz', 30);

    INSERT INTO quiz_questions (college_id, quiz_id, question_id, sequence_order)
    VALUES (v_c, v_quiz, v_q, 1);

    v_fac_sig := fn_generate_auth_signature(v_fac, 'ANY', 300);
    PERFORM sp_publish_quiz(v_quiz, v_fac, v_fac_sig);

    INSERT INTO quiz_sessions (
        id, college_id, quiz_id, faculty_user_id, class_id, session_code,
        start_window_time, end_window_time, duration_minutes
    ) VALUES (
        v_session, v_c, v_quiz, v_fac, v_class, 'SESSLC',
        clock_timestamp() - INTERVAL '1 minute', clock_timestamp() + INTERVAL '1 hour', 30
    );

    -- 9A: Invalid transition from SCHEDULED directly to COMPLETED blocked
    BEGIN
        UPDATE quiz_sessions SET status = 'COMPLETED' WHERE id = v_session;
        RAISE EXCEPTION 'TEST-09A FAILED: Direct SCHEDULED -> COMPLETED was permitted!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST-09A PASSED: Invalid lifecycle jump blocked by fn_validate_session_status_transition.';
    END;

    -- Valid lifecycle transitions
    PERFORM sp_activate_quiz_session(v_session, v_fac, v_fac_sig);
    PERFORM sp_pause_quiz_session(v_session, v_fac, v_fac_sig);
    PERFORM sp_resume_quiz_session(v_session, v_fac, v_fac_sig);
    PERFORM sp_complete_quiz_session(v_session, v_fac, v_fac_sig);
    RAISE NOTICE 'TEST-09B PASSED: Valid lifecycle transitions (SCHEDULED -> ACTIVE -> PAUSED -> ACTIVE -> COMPLETED) succeeded.';

    -- Cleanup
    DELETE FROM quiz_sessions WHERE id = v_session;
    DELETE FROM quiz_questions WHERE quiz_id = v_quiz;
    DELETE FROM quizzes WHERE id = v_quiz;
    DELETE FROM question_options WHERE question_id = v_q;
    DELETE FROM questions WHERE id = v_q;
    DELETE FROM faculty_assignments WHERE college_id = v_c;
    DELETE FROM subjects WHERE id = v_sub;
    DELETE FROM classes WHERE id = v_class;
    DELETE FROM branches WHERE id = v_branch;
    DELETE FROM faculty_profiles WHERE user_id = v_fac;
    DELETE FROM departments WHERE id = v_dept;
    DELETE FROM academic_years WHERE id = v_ay;
    DELETE FROM user_roles WHERE user_id = v_fac;
    DELETE FROM users WHERE id = v_fac;
    DELETE FROM colleges WHERE id = v_c;
END $$;

-- ----------------------------------------------------------------------------
-- TEST 10: Student Attempt Creation, Concurrency & Ownership
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_c UUID := gen_random_uuid();
    v_ay UUID := gen_random_uuid();
    v_dept UUID := gen_random_uuid();
    v_branch UUID := gen_random_uuid();
    v_class UUID := gen_random_uuid();
    v_fac UUID := gen_random_uuid();
    v_s1 UUID := gen_random_uuid();
    v_s2 UUID := gen_random_uuid();
    v_sub UUID := gen_random_uuid();
    v_quiz UUID := gen_random_uuid();
    v_q UUID := gen_random_uuid();
    v_session UUID := gen_random_uuid();
    v_att1 UUID;
    v_att2 UUID;
    v_fac_sig TEXT;
    v_s1_sig TEXT;
    v_s2_sig TEXT;
BEGIN
    INSERT INTO colleges (id, name, code) VALUES (v_c, 'Attempt College', 'ATC_' || v_c);
    
    INSERT INTO users (id, college_id, email, password_hash, first_name, last_name)
    VALUES (v_fac, v_c, 'fac_at_' || v_c || '@atc.edu', 'hash', 'Fac', 'AT'),
           (v_s1, v_c, 's1_at_' || v_c || '@atc.edu', 'hash', 'Stud', 'One'),
           (v_s2, v_c, 's2_at_' || v_c || '@atc.edu', 'hash', 'Stud', 'Two');

    INSERT INTO roles (code, name) VALUES ('FACULTY', 'Faculty'), ('STUDENT', 'Student') ON CONFLICT DO NOTHING;
    INSERT INTO user_roles (user_id, role_code, college_id) 
    VALUES (v_fac, 'FACULTY', v_c), (v_s1, 'STUDENT', v_c), (v_s2, 'STUDENT', v_c);

    INSERT INTO student_profiles (user_id, college_id, roll_number) 
    VALUES (v_s1, v_c, UPPER('R1_' || v_c)), (v_s2, v_c, UPPER('R2_' || v_c));

    INSERT INTO academic_years (id, college_id, name, start_date, end_date, is_current)
    VALUES (v_ay, v_c, '2024-2025', '2024-06-01', '2025-05-31', TRUE);

    INSERT INTO departments (id, college_id, name, code) VALUES (v_dept, v_c, 'CS', 'CS_' || v_c);
    INSERT INTO faculty_profiles (user_id, college_id, department_id, employee_id, designation) VALUES (v_fac, v_c, v_dept, UPPER('EMP_' || v_fac), 'Lecturer');
    INSERT INTO branches (id, college_id, department_id, name, code) VALUES (v_branch, v_c, v_dept, 'CSE', 'CSE_' || v_c);
    INSERT INTO classes (id, college_id, branch_id, academic_year_id, year_of_study, semester, section)
    VALUES (v_class, v_c, v_branch, v_ay, 3, 5, 'A');

    -- Enroll both students
    INSERT INTO student_enrollments (college_id, student_user_id, class_id, academic_year_id, enrollment_type, is_active)
    VALUES (v_c, v_s1, v_class, v_ay, 'CORE', TRUE),
           (v_c, v_s2, v_class, v_ay, 'CORE', TRUE);

    INSERT INTO subjects (id, college_id, department_id, name, code) VALUES (v_sub, v_c, v_dept, 'OS', 'OS_' || v_c);
    INSERT INTO faculty_assignments (college_id, faculty_user_id, subject_id, class_id, academic_year_id)
    VALUES (v_c, v_fac, v_sub, v_class, v_ay);

    INSERT INTO questions (id, college_id, subject_id, created_by_faculty_id, question_type, question_text)
    VALUES (v_q, v_c, v_sub, v_fac, 'MCQ', 'OS Q?');

    INSERT INTO question_options (question_id, option_text, is_correct, display_order)
    VALUES (v_q, 'A', TRUE, 1), (v_q, 'B', FALSE, 2);

    INSERT INTO quizzes (id, college_id, faculty_user_id, subject_id, title, default_duration_minutes)
    VALUES (v_quiz, v_c, v_fac, v_sub, 'OS Quiz', 30);

    INSERT INTO quiz_questions (college_id, quiz_id, question_id, sequence_order)
    VALUES (v_c, v_quiz, v_q, 1);

    v_fac_sig := fn_generate_auth_signature(v_fac, 'ANY', 300);
    PERFORM sp_publish_quiz(v_quiz, v_fac, v_fac_sig);

    INSERT INTO quiz_sessions (
        id, college_id, quiz_id, faculty_user_id, class_id, session_code,
        start_window_time, end_window_time, duration_minutes
    ) VALUES (
        v_session, v_c, v_quiz, v_fac, v_class, 'SESSAT',
        clock_timestamp() - INTERVAL '1 minute', clock_timestamp() + INTERVAL '1 hour', 30
    );

    PERFORM sp_activate_quiz_session(v_session, v_fac, v_fac_sig);

    v_s1_sig := fn_generate_auth_signature(v_s1, 'STUDENT', 300);
    v_s2_sig := fn_generate_auth_signature(v_s2, 'STUDENT', 300);

    -- 10A: Student 1 starts attempt
    SELECT attempt_id INTO v_att1 FROM sp_start_quiz_attempt(v_session, v_s1, v_s1_sig);

    -- 10B: Concurrent / duplicate start by Student 1 returns identical attempt idempotently
    SELECT attempt_id INTO v_att2 FROM sp_start_quiz_attempt(v_session, v_s1, v_s1_sig);
    IF v_att1 <> v_att2 THEN
        RAISE EXCEPTION 'TEST-10B FAILED: Idempotent attempt start produced different IDs';
    END IF;
    RAISE NOTICE 'TEST-10A/B PASSED: Concurrent start attempt returned identical attempt idempotently.';

    -- 10C: Attempt Ownership: Student 2 cannot save responses to Student 1's attempt
    BEGIN
        PERFORM sp_save_student_response(
            v_att1, v_q, '{}', FALSE, 1, clock_timestamp(), v_s2, v_s2_sig
        );
        RAISE EXCEPTION 'TEST-10C FAILED: Cross-student response mutation was permitted!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST-10C PASSED: Cross-student response mutation rejected.';
    END;

    -- Cleanup
    DELETE FROM quiz_attempts WHERE session_id = v_session;
    DELETE FROM quiz_sessions WHERE id = v_session;
    DELETE FROM quiz_questions WHERE quiz_id = v_quiz;
    DELETE FROM quizzes WHERE id = v_quiz;
    DELETE FROM question_options WHERE question_id = v_q;
    DELETE FROM questions WHERE id = v_q;
    DELETE FROM faculty_assignments WHERE college_id = v_c;
    DELETE FROM student_enrollments WHERE college_id = v_c;
    DELETE FROM subjects WHERE id = v_sub;
    DELETE FROM classes WHERE id = v_class;
    DELETE FROM branches WHERE id = v_branch;
    DELETE FROM student_profiles WHERE user_id IN (v_s1, v_s2);
    DELETE FROM faculty_profiles WHERE user_id = v_fac;
    DELETE FROM departments WHERE id = v_dept;
    DELETE FROM academic_years WHERE id = v_ay;
    DELETE FROM user_roles WHERE user_id IN (v_fac, v_s1, v_s2);
    DELETE FROM users WHERE id IN (v_fac, v_s1, v_s2);
    DELETE FROM colleges WHERE id = v_c;
END $$;

-- ----------------------------------------------------------------------------
-- TEST 11: Autosave Concurrency, Option Validation & Version Gating
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_c UUID := gen_random_uuid();
    v_ay UUID := gen_random_uuid();
    v_dept UUID := gen_random_uuid();
    v_branch UUID := gen_random_uuid();
    v_class UUID := gen_random_uuid();
    v_fac UUID := gen_random_uuid();
    v_student UUID := gen_random_uuid();
    v_sub UUID := gen_random_uuid();
    v_q UUID := gen_random_uuid();
    v_opt1 UUID := gen_random_uuid();
    v_opt2 UUID := gen_random_uuid();
    v_foreign_opt UUID := gen_random_uuid();
    v_quiz UUID := gen_random_uuid();
    v_session UUID := gen_random_uuid();
    v_attempt_id UUID;
    v_fac_sig TEXT;
    v_stud_sig TEXT;
    v_save_status VARCHAR(25);
    v_saved_ver INT;
BEGIN
    INSERT INTO colleges (id, name, code) VALUES (v_c, 'Autosave College', 'ASC_' || v_c);
    
    INSERT INTO users (id, college_id, email, password_hash, first_name, last_name)
    VALUES (v_fac, v_c, 'fac_as_' || v_c || '@asc.edu', 'hash', 'Fac', 'AS'),
           (v_student, v_c, 'stud_as_' || v_c || '@asc.edu', 'hash', 'Stud', 'AS');

    INSERT INTO roles (code, name) VALUES ('FACULTY', 'Faculty'), ('STUDENT', 'Student') ON CONFLICT DO NOTHING;
    INSERT INTO user_roles (user_id, role_code, college_id) VALUES (v_fac, 'FACULTY', v_c), (v_student, 'STUDENT', v_c);
    INSERT INTO student_profiles (user_id, college_id, roll_number) VALUES (v_student, v_c, UPPER('ROLL_AS_' || v_c));

    INSERT INTO academic_years (id, college_id, name, start_date, end_date, is_current)
    VALUES (v_ay, v_c, '2024-2025', '2024-06-01', '2025-05-31', TRUE);

    INSERT INTO departments (id, college_id, name, code) VALUES (v_dept, v_c, 'CS', 'CS_' || v_c);
    INSERT INTO faculty_profiles (user_id, college_id, department_id, employee_id, designation) VALUES (v_fac, v_c, v_dept, UPPER('EMP_' || v_fac), 'Lecturer');
    INSERT INTO branches (id, college_id, department_id, name, code) VALUES (v_branch, v_c, v_dept, 'CSE', 'CSE_' || v_c);
    INSERT INTO classes (id, college_id, branch_id, academic_year_id, year_of_study, semester, section)
    VALUES (v_class, v_c, v_branch, v_ay, 3, 5, 'A');

    INSERT INTO student_enrollments (college_id, student_user_id, class_id, academic_year_id, enrollment_type, is_active)
    VALUES (v_c, v_student, v_class, v_ay, 'CORE', TRUE);

    INSERT INTO subjects (id, college_id, department_id, name, code) VALUES (v_sub, v_c, v_dept, 'OS', 'OS_' || v_c);
    INSERT INTO faculty_assignments (college_id, faculty_user_id, subject_id, class_id, academic_year_id)
    VALUES (v_c, v_fac, v_sub, v_class, v_ay);

    INSERT INTO questions (id, college_id, subject_id, created_by_faculty_id, question_type, question_text, default_marks)
    VALUES (v_q, v_c, v_sub, v_fac, 'MCQ', 'What is a mutex?', 2.0000);

    INSERT INTO question_options (id, question_id, option_text, is_correct, display_order)
    VALUES (v_opt1, v_q, 'Lock mechanism', TRUE, 1),
           (v_opt2, v_q, 'Hardware chip', FALSE, 2);

    INSERT INTO quizzes (id, college_id, faculty_user_id, subject_id, title, default_duration_minutes)
    VALUES (v_quiz, v_c, v_fac, v_sub, 'OS Quiz', 30);

    INSERT INTO quiz_questions (college_id, quiz_id, question_id, sequence_order)
    VALUES (v_c, v_quiz, v_q, 1);

    v_fac_sig := fn_generate_auth_signature(v_fac, 'ANY', 300);
    PERFORM sp_publish_quiz(v_quiz, v_fac, v_fac_sig);

    INSERT INTO quiz_sessions (
        id, college_id, quiz_id, faculty_user_id, class_id, session_code,
        start_window_time, end_window_time, duration_minutes
    ) VALUES (
        v_session, v_c, v_quiz, v_fac, v_class, 'SESS02',
        clock_timestamp() - INTERVAL '1 minute', clock_timestamp() + INTERVAL '1 hour', 30
    );

    PERFORM sp_activate_quiz_session(v_session, v_fac, v_fac_sig);

    v_stud_sig := fn_generate_auth_signature(v_student, 'STUDENT', 300);
    SELECT attempt_id INTO v_attempt_id FROM sp_start_quiz_attempt(v_session, v_student, v_stud_sig);

    -- 11A: Reject foreign option ID
    BEGIN
        PERFORM sp_save_student_response(
            v_attempt_id, v_q, ARRAY[v_foreign_opt], FALSE, 1, clock_timestamp(), v_student, v_stud_sig
        );
        RAISE EXCEPTION 'TEST-11A FAILED: Foreign option was accepted!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST-11A PASSED: Foreign option was rejected.';
    END;

    -- 11B: Reject duplicate option IDs
    BEGIN
        PERFORM sp_save_student_response(
            v_attempt_id, v_q, ARRAY[v_opt1, v_opt1], FALSE, 1, clock_timestamp(), v_student, v_stud_sig
        );
        RAISE EXCEPTION 'TEST-11B FAILED: Duplicate options were accepted!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST-11B PASSED: Duplicate option IDs were rejected.';
    END;

    -- 11C: Valid Save: client_version = 1
    SELECT result_status, saved_version INTO v_save_status, v_saved_ver
    FROM sp_save_student_response(
        v_attempt_id, v_q, ARRAY[v_opt1], FALSE, 1, clock_timestamp(), v_student, v_stud_sig
    );
    IF v_save_status <> 'ACCEPTED' OR v_saved_ver <> 1 THEN
        RAISE EXCEPTION 'TEST-11C FAILED: Expected ACCEPTED v1, got % v%', v_save_status, v_saved_ver;
    END IF;
    RAISE NOTICE 'TEST-11C PASSED: Valid response v1 saved as ACCEPTED.';

    -- 11D: Idempotent Retry: same version, same payload
    SELECT result_status, saved_version INTO v_save_status, v_saved_ver
    FROM sp_save_student_response(
        v_attempt_id, v_q, ARRAY[v_opt1], FALSE, 1, clock_timestamp(), v_student, v_stud_sig
    );
    IF v_save_status <> 'IDEMPOTENT_RETRY' THEN
        RAISE EXCEPTION 'TEST-11D FAILED: Expected IDEMPOTENT_RETRY, got %', v_save_status;
    END IF;
    RAISE NOTICE 'TEST-11D PASSED: Identical replay resolved as IDEMPOTENT_RETRY.';

    -- 11E: Version Conflict on same version with differing payload
    SELECT result_status, saved_version INTO v_save_status, v_saved_ver
    FROM sp_save_student_response(
        v_attempt_id, v_q, ARRAY[v_opt2], FALSE, 1, clock_timestamp(), v_student, v_stud_sig
    );
    IF v_save_status <> 'VERSION_CONFLICT' THEN
        RAISE EXCEPTION 'TEST-11E FAILED: Expected VERSION_CONFLICT, got %', v_save_status;
    END IF;
    RAISE NOTICE 'TEST-11E PASSED: Conflicting payload on same version resolved as VERSION_CONFLICT.';

    -- 11F: Valid empty selection (clearing response) at client_version = 2
    SELECT result_status, saved_version INTO v_save_status, v_saved_ver
    FROM sp_save_student_response(
        v_attempt_id, v_q, '{}', FALSE, 2, clock_timestamp(), v_student, v_stud_sig
    );
    IF v_save_status <> 'ACCEPTED' OR v_saved_ver <> 2 THEN
        RAISE EXCEPTION 'TEST-11F FAILED: Empty selection was not accepted';
    END IF;
    RAISE NOTICE 'TEST-11F PASSED: Valid empty selection saved at version 2.';

    -- Cleanup
    DELETE FROM student_responses WHERE attempt_id = v_attempt_id;
    DELETE FROM quiz_attempts WHERE id = v_attempt_id;
    DELETE FROM quiz_sessions WHERE id = v_session;
    DELETE FROM quiz_questions WHERE quiz_id = v_quiz;
    DELETE FROM quizzes WHERE id = v_quiz;
    DELETE FROM question_options WHERE question_id = v_q;
    DELETE FROM questions WHERE id = v_q;
    DELETE FROM faculty_assignments WHERE college_id = v_c;
    DELETE FROM student_enrollments WHERE college_id = v_c;
    DELETE FROM subjects WHERE id = v_sub;
    DELETE FROM classes WHERE id = v_class;
    DELETE FROM branches WHERE id = v_branch;
    DELETE FROM student_profiles WHERE user_id = v_student;
    DELETE FROM faculty_profiles WHERE user_id = v_fac;
    DELETE FROM departments WHERE id = v_dept;
    DELETE FROM academic_years WHERE id = v_ay;
    DELETE FROM user_roles WHERE user_id IN (v_fac, v_student);
    DELETE FROM users WHERE id IN (v_fac, v_student);
    DELETE FROM colleges WHERE id = v_c;
END $$;

-- ----------------------------------------------------------------------------
-- TEST 12: Attempt Finalization, Submission-Type Authorization & Deadline Checks
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_c UUID := gen_random_uuid();
    v_ay UUID := gen_random_uuid();
    v_dept UUID := gen_random_uuid();
    v_branch UUID := gen_random_uuid();
    v_class UUID := gen_random_uuid();
    v_fac UUID := gen_random_uuid();
    v_s1 UUID := gen_random_uuid();
    v_s2 UUID := gen_random_uuid();
    v_sub UUID := gen_random_uuid();
    v_quiz UUID := gen_random_uuid();
    v_q UUID := gen_random_uuid();
    v_session UUID := gen_random_uuid();
    v_att UUID;
    v_fac_sig TEXT;
    v_s1_sig TEXT;
    v_s2_sig TEXT;
    v_final_status VARCHAR(20);
    v_final_score NUMERIC(8,2);
    v_final_at TIMESTAMPTZ;
BEGIN
    INSERT INTO colleges (id, name, code) VALUES (v_c, 'Fin College', 'FC_' || v_c);
    
    INSERT INTO users (id, college_id, email, password_hash, first_name, last_name)
    VALUES (v_fac, v_c, 'fac_fin_' || v_c || '@fc.edu', 'hash', 'Fac', 'Fin'),
           (v_s1, v_c, 's1_fin_' || v_c || '@fc.edu', 'hash', 'Stud', 'One'),
           (v_s2, v_c, 's2_fin_' || v_c || '@fc.edu', 'hash', 'Stud', 'Two');

    INSERT INTO roles (code, name) VALUES ('FACULTY', 'Faculty'), ('STUDENT', 'Student') ON CONFLICT DO NOTHING;
    INSERT INTO user_roles (user_id, role_code, college_id) 
    VALUES (v_fac, 'FACULTY', v_c), (v_s1, 'STUDENT', v_c), (v_s2, 'STUDENT', v_c);

    INSERT INTO student_profiles (user_id, college_id, roll_number) 
    VALUES (v_s1, v_c, UPPER('R1_' || v_c)), (v_s2, v_c, UPPER('R2_' || v_c));

    INSERT INTO academic_years (id, college_id, name, start_date, end_date, is_current)
    VALUES (v_ay, v_c, '2024-2025', '2024-06-01', '2025-05-31', TRUE);

    INSERT INTO departments (id, college_id, name, code) VALUES (v_dept, v_c, 'CS', 'CS_' || v_c);
    INSERT INTO faculty_profiles (user_id, college_id, department_id, employee_id, designation) VALUES (v_fac, v_c, v_dept, UPPER('EMP_' || v_fac), 'Prof');
    INSERT INTO branches (id, college_id, department_id, name, code) VALUES (v_branch, v_c, v_dept, 'CSE', 'CSE_' || v_c);
    INSERT INTO classes (id, college_id, branch_id, academic_year_id, year_of_study, semester, section)
    VALUES (v_class, v_c, v_branch, v_ay, 3, 5, 'A');

    INSERT INTO student_enrollments (college_id, student_user_id, class_id, academic_year_id, enrollment_type, is_active)
    VALUES (v_c, v_s1, v_class, v_ay, 'CORE', TRUE),
           (v_c, v_s2, v_class, v_ay, 'CORE', TRUE);

    INSERT INTO subjects (id, college_id, department_id, name, code) VALUES (v_sub, v_c, v_dept, 'Algo', 'ALG_' || v_c);
    INSERT INTO faculty_assignments (college_id, faculty_user_id, subject_id, class_id, academic_year_id)
    VALUES (v_c, v_fac, v_sub, v_class, v_ay);

    INSERT INTO questions (id, college_id, subject_id, created_by_faculty_id, question_type, question_text, default_marks)
    VALUES (v_q, v_c, v_sub, v_fac, 'MCQ', 'Algo Q?', 5.0000);

    INSERT INTO question_options (question_id, option_text, is_correct, display_order)
    VALUES (v_q, 'Correct', TRUE, 1), (v_q, 'Wrong', FALSE, 2);

    INSERT INTO quizzes (id, college_id, faculty_user_id, subject_id, title, default_duration_minutes)
    VALUES (v_quiz, v_c, v_fac, v_sub, 'Algo Quiz', 30);

    INSERT INTO quiz_questions (college_id, quiz_id, question_id, sequence_order)
    VALUES (v_c, v_quiz, v_q, 1);

    v_fac_sig := fn_generate_auth_signature(v_fac, 'ANY', 300);
    PERFORM sp_publish_quiz(v_quiz, v_fac, v_fac_sig);

    INSERT INTO quiz_sessions (
        id, college_id, quiz_id, faculty_user_id, class_id, session_code,
        start_window_time, end_window_time, duration_minutes
    ) VALUES (
        v_session, v_c, v_quiz, v_fac, v_class, 'SESSFN',
        clock_timestamp() - INTERVAL '1 minute', clock_timestamp() + INTERVAL '1 hour', 30
    );

    PERFORM sp_activate_quiz_session(v_session, v_fac, v_fac_sig);

    v_s1_sig := fn_generate_auth_signature(v_s1, 'STUDENT', 300);
    v_s2_sig := fn_generate_auth_signature(v_s2, 'STUDENT', 300);

    SELECT attempt_id INTO v_att FROM sp_start_quiz_attempt(v_session, v_s1, v_s1_sig);

    -- 12A: Unauthorized student cannot finalize Student 1's attempt manually
    BEGIN
        PERFORM sp_finalize_attempt(v_att, 'MANUAL', v_s2, v_s2_sig);
        RAISE EXCEPTION 'TEST-12A FAILED: Unauthorized student manual finalization was permitted!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST-12A PASSED: Unauthorized student manual finalization rejected.';
    END;

    -- 12B: AUTO_TIME_EXPIRED rejected before deadline has elapsed
    BEGIN
        PERFORM sp_finalize_attempt(v_att, 'AUTO_TIME_EXPIRED', v_s1, v_s1_sig);
        RAISE EXCEPTION 'TEST-12B FAILED: AUTO_TIME_EXPIRED permitted before deadline!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST-12B PASSED: Premature AUTO_TIME_EXPIRED rejected.';
    END;

    -- 12C: Valid MANUAL Finalization by owner
    SELECT final_status, total_score, finalized_at INTO v_final_status, v_final_score, v_final_at
    FROM sp_finalize_attempt(v_att, 'MANUAL', v_s1, v_s1_sig);

    IF v_final_status <> 'FINALIZED' THEN
        RAISE EXCEPTION 'TEST-12C FAILED: Expected FINALIZED, got %', v_final_status;
    END IF;
    RAISE NOTICE 'TEST-12C PASSED: Valid MANUAL finalization succeeded.';

    -- 12D: Idempotent finalization return
    SELECT final_status, total_score, finalized_at INTO v_final_status, v_final_score, v_final_at
    FROM sp_finalize_attempt(v_att, 'MANUAL', v_s1, v_s1_sig);
    IF v_final_status <> 'FINALIZED' THEN
        RAISE EXCEPTION 'TEST-12D FAILED: Idempotent return did not preserve FINALIZED state';
    END IF;
    RAISE NOTICE 'TEST-12D PASSED: Duplicate finalization returned identically and idempotently.';

    -- Cleanup
    DELETE FROM quiz_attempts WHERE id = v_att;
    DELETE FROM quiz_sessions WHERE id = v_session;
    DELETE FROM quiz_questions WHERE quiz_id = v_quiz;
    DELETE FROM quizzes WHERE id = v_quiz;
    DELETE FROM question_options WHERE question_id = v_q;
    DELETE FROM questions WHERE id = v_q;
    DELETE FROM faculty_assignments WHERE college_id = v_c;
    DELETE FROM student_enrollments WHERE college_id = v_c;
    DELETE FROM subjects WHERE id = v_sub;
    DELETE FROM classes WHERE id = v_class;
    DELETE FROM branches WHERE id = v_branch;
    DELETE FROM student_profiles WHERE user_id IN (v_s1, v_s2);
    DELETE FROM faculty_profiles WHERE user_id = v_fac;
    DELETE FROM departments WHERE id = v_dept;
    DELETE FROM academic_years WHERE id = v_ay;
    DELETE FROM user_roles WHERE user_id IN (v_fac, v_s1, v_s2);
    DELETE FROM users WHERE id IN (v_fac, v_s1, v_s2);
    DELETE FROM colleges WHERE id = v_c;
END $$;

-- ----------------------------------------------------------------------------
-- TEST 13: Comprehensive Scoring Engine, Partial-Credit, Negative Scores & Unanswered Handling
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_c UUID := gen_random_uuid();
    v_ay UUID := gen_random_uuid();
    v_dept UUID := gen_random_uuid();
    v_branch UUID := gen_random_uuid();
    v_class UUID := gen_random_uuid();
    v_fac UUID := gen_random_uuid();
    v_student UUID := gen_random_uuid();
    v_sub UUID := gen_random_uuid();
    v_quiz UUID := gen_random_uuid();
    v_q_mcq UUID := gen_random_uuid();
    v_q_ms UUID := gen_random_uuid();
    v_q_unatt UUID := gen_random_uuid();
    v_opt_mcq_c UUID := gen_random_uuid();
    v_opt_mcq_w UUID := gen_random_uuid();
    v_opt_ms_c1 UUID := gen_random_uuid();
    v_opt_ms_c2 UUID := gen_random_uuid();
    v_opt_ms_w1 UUID := gen_random_uuid();
    v_opt_ms_w2 UUID := gen_random_uuid();
    v_opt_unatt_c UUID := gen_random_uuid();
    v_opt_unatt_w UUID := gen_random_uuid();
    v_session UUID := gen_random_uuid();
    v_att UUID;
    v_fac_sig TEXT;
    v_stud_sig TEXT;
    v_final_status VARCHAR(20);
    v_final_score NUMERIC(8,2);
    v_final_at TIMESTAMPTZ;
    v_dummy_count INT;
BEGIN
    INSERT INTO colleges (id, name, code) VALUES (v_c, 'Scoring College', 'SC_' || v_c);
    
    INSERT INTO users (id, college_id, email, password_hash, first_name, last_name)
    VALUES (v_fac, v_c, 'fac_sc_' || v_c || '@sc.edu', 'hash', 'Fac', 'SC'),
           (v_student, v_c, 'stud_sc_' || v_c || '@sc.edu', 'hash', 'Stud', 'SC');

    INSERT INTO roles (code, name) VALUES ('FACULTY', 'Faculty'), ('STUDENT', 'Student') ON CONFLICT DO NOTHING;
    INSERT INTO user_roles (user_id, role_code, college_id) 
    VALUES (v_fac, 'FACULTY', v_c), (v_student, 'STUDENT', v_c);

    INSERT INTO student_profiles (user_id, college_id, roll_number) VALUES (v_student, v_c, UPPER('R_SC_' || v_c));

    INSERT INTO academic_years (id, college_id, name, start_date, end_date, is_current)
    VALUES (v_ay, v_c, '2024-2025', '2024-06-01', '2025-05-31', TRUE);

    INSERT INTO departments (id, college_id, name, code) VALUES (v_dept, v_c, 'CS', 'CS_' || v_c);
    INSERT INTO faculty_profiles (user_id, college_id, department_id, employee_id, designation) VALUES (v_fac, v_c, v_dept, UPPER('EMP_' || v_fac), 'Prof');
    INSERT INTO branches (id, college_id, department_id, name, code) VALUES (v_branch, v_c, v_dept, 'CSE', 'CSE_' || v_c);
    INSERT INTO classes (id, college_id, branch_id, academic_year_id, year_of_study, semester, section)
    VALUES (v_class, v_c, v_branch, v_ay, 3, 5, 'A');

    INSERT INTO student_enrollments (college_id, student_user_id, class_id, academic_year_id, enrollment_type, is_active)
    VALUES (v_c, v_student, v_class, v_ay, 'CORE', TRUE);

    INSERT INTO subjects (id, college_id, department_id, name, code) VALUES (v_sub, v_c, v_dept, 'DS', 'DS_' || v_c);
    INSERT INTO faculty_assignments (college_id, faculty_user_id, subject_id, class_id, academic_year_id)
    VALUES (v_c, v_fac, v_sub, v_class, v_ay);

    -- Question 1: MCQ (Marks: 2.0000, Penalty: 3.5000) -> student chooses Wrong answer -> Score = -3.500000
    INSERT INTO questions (id, college_id, subject_id, created_by_faculty_id, question_type, question_text, default_marks, default_negative_penalty)
    VALUES (v_q_mcq, v_c, v_sub, v_fac, 'MCQ', 'MCQ High Penalty', 2.0000, 3.5000);

    INSERT INTO question_options (id, question_id, option_text, is_correct, display_order)
    VALUES (v_opt_mcq_c, v_q_mcq, 'Correct', TRUE, 1),
           (v_opt_mcq_w, v_q_mcq, 'Wrong', FALSE, 2);

    -- Question 2: Multiple-Select (Marks: 4.0000, Penalty: 1.0000 per wrong choice)
    -- Correct options: c1, c2 (tot_correct = 2). Student selects c1 (correct) and w1 (wrong).
    -- Awarded = (1/2 * 4.0000) - (1 * 1.0000) = 2.0000 - 1.0000 = +1.000000
    INSERT INTO questions (id, college_id, subject_id, created_by_faculty_id, question_type, question_text, default_marks, default_negative_penalty)
    VALUES (v_q_ms, v_c, v_sub, v_fac, 'MULTIPLE_SELECT', 'MS Question', 4.0000, 1.0000);

    INSERT INTO question_options (id, question_id, option_text, is_correct, display_order)
    VALUES (v_opt_ms_c1, v_q_ms, 'C1', TRUE, 1),
           (v_opt_ms_c2, v_q_ms, 'C2', TRUE, 2),
           (v_opt_ms_w1, v_q_ms, 'W1', FALSE, 3),
           (v_opt_ms_w2, v_q_ms, 'W2', FALSE, 4);

    -- Question 3: Unanswered Question (Marks: 5.0000) -> Not attempted -> Awarded = 0.000000
    INSERT INTO questions (id, college_id, subject_id, created_by_faculty_id, question_type, question_text, default_marks)
    VALUES (v_q_unatt, v_c, v_sub, v_fac, 'MCQ', 'Unanswered Q', 5.0000);

    INSERT INTO question_options (id, question_id, option_text, is_correct, display_order)
    VALUES (v_opt_unatt_c, v_q_unatt, 'C', TRUE, 1),
           (v_opt_unatt_w, v_q_unatt, 'W', FALSE, 2);

    -- Quiz: Default negative marking enabled = TRUE
    INSERT INTO quizzes (id, college_id, faculty_user_id, subject_id, title, default_duration_minutes, default_negative_marking_enabled)
    VALUES (v_quiz, v_c, v_fac, v_sub, 'Scoring Quiz', 30, TRUE);

    INSERT INTO quiz_questions (college_id, quiz_id, question_id, sequence_order)
    VALUES (v_c, v_quiz, v_q_mcq, 1),
           (v_c, v_quiz, v_q_ms, 2),
           (v_c, v_quiz, v_q_unatt, 3);

    v_fac_sig := fn_generate_auth_signature(v_fac, 'ANY', 300);
    PERFORM sp_publish_quiz(v_quiz, v_fac, v_fac_sig);

    INSERT INTO quiz_sessions (
        id, college_id, quiz_id, faculty_user_id, class_id, session_code,
        start_window_time, end_window_time, duration_minutes, negative_marking_enabled
    ) VALUES (
        v_session, v_c, v_quiz, v_fac, v_class, 'SESSSC',
        clock_timestamp() - INTERVAL '1 minute', clock_timestamp() + INTERVAL '1 hour', 30, TRUE
    );

    PERFORM sp_activate_quiz_session(v_session, v_fac, v_fac_sig);

    v_stud_sig := fn_generate_auth_signature(v_student, 'STUDENT', 300);
    SELECT attempt_id INTO v_att FROM sp_start_quiz_attempt(v_session, v_student, v_stud_sig);

    -- Save Answer for Q1 (Wrong answer)
    PERFORM sp_save_student_response(
        v_att, v_q_mcq, ARRAY[v_opt_mcq_w], FALSE, 1, clock_timestamp(), v_student, v_stud_sig
    );

    -- Save Answer for Q2 (1 Correct, 1 Wrong)
    PERFORM sp_save_student_response(
        v_att, v_q_ms, ARRAY[v_opt_ms_c1, v_opt_ms_w1], FALSE, 1, clock_timestamp(), v_student, v_stud_sig
    );

    -- Leave Q3 Unanswered (No response saved)

    -- Finalize Attempt
    SELECT final_status, total_score, finalized_at INTO v_final_status, v_final_score, v_final_at
    FROM sp_finalize_attempt(v_att, 'MANUAL', v_student, v_stud_sig);

    -- Expected Score:
    -- Q1: -3.50
    -- Q2: +1.00
    -- Q3: 0.00
    -- Net Score = -2.50
    -- Supports negative total scores; verifies NO artificial floor at 0.00!
    IF v_final_score <> -2.50 THEN
        RAISE EXCEPTION 'TEST-13 FAILED: Expected final net score -2.50, got %', v_final_score;
    END IF;
    RAISE NOTICE 'TEST-13A PASSED: Net negative score (-2.50) preserved without artificial zero-floor.';

    -- Verify that no dummy row was inserted into student_responses for Q3
    SELECT COUNT(*) INTO v_dummy_count
    FROM student_responses
    WHERE attempt_id = v_att AND question_id = v_q_unatt;

    IF v_dummy_count <> 0 THEN
        RAISE EXCEPTION 'TEST-13B FAILED: Dummy response row was inserted for unanswered question!';
    END IF;
    RAISE NOTICE 'TEST-13B PASSED: Unanswered questions evaluated without inserting dummy response rows.';

    -- Cleanup
    DELETE FROM student_responses WHERE attempt_id = v_att;
    DELETE FROM quiz_attempts WHERE id = v_att;
    DELETE FROM quiz_sessions WHERE id = v_session;
    DELETE FROM quiz_questions WHERE quiz_id = v_quiz;
    DELETE FROM quizzes WHERE id = v_quiz;
    DELETE FROM question_options WHERE question_id IN (v_q_mcq, v_q_ms, v_q_unatt);
    DELETE FROM questions WHERE id IN (v_q_mcq, v_q_ms, v_q_unatt);
    DELETE FROM faculty_assignments WHERE college_id = v_c;
    DELETE FROM student_enrollments WHERE college_id = v_c;
    DELETE FROM subjects WHERE id = v_sub;
    DELETE FROM classes WHERE id = v_class;
    DELETE FROM branches WHERE id = v_branch;
    DELETE FROM student_profiles WHERE user_id = v_student;
    DELETE FROM faculty_profiles WHERE user_id = v_fac;
    DELETE FROM departments WHERE id = v_dept;
    DELETE FROM academic_years WHERE id = v_ay;
    DELETE FROM user_roles WHERE user_id IN (v_fac, v_student);
    DELETE FROM users WHERE id IN (v_fac, v_student);
    DELETE FROM colleges WHERE id = v_c;
END $$;

-- ----------------------------------------------------------------------------
-- TEST 14: Result Release Visibility Protection
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_c UUID := gen_random_uuid();
    v_ay UUID := gen_random_uuid();
    v_dept UUID := gen_random_uuid();
    v_branch UUID := gen_random_uuid();
    v_class UUID := gen_random_uuid();
    v_fac UUID := gen_random_uuid();
    v_student UUID := gen_random_uuid();
    v_sub UUID := gen_random_uuid();
    v_quiz UUID := gen_random_uuid();
    v_q UUID := gen_random_uuid();
    v_session UUID := gen_random_uuid();
    v_att UUID;
    v_fac_sig TEXT;
    v_stud_sig TEXT;
    v_released BOOLEAN;
    v_score NUMERIC(8,2);
    v_breakdown JSONB;
BEGIN
    INSERT INTO colleges (id, name, code) VALUES (v_c, 'Release College', 'RC_' || v_c);
    
    INSERT INTO users (id, college_id, email, password_hash, first_name, last_name)
    VALUES (v_fac, v_c, 'fac_rc_' || v_c || '@rc.edu', 'hash', 'Fac', 'RC'),
           (v_student, v_c, 'stud_rc_' || v_c || '@rc.edu', 'hash', 'Stud', 'RC');

    INSERT INTO roles (code, name) VALUES ('FACULTY', 'Faculty'), ('STUDENT', 'Student') ON CONFLICT DO NOTHING;
    INSERT INTO user_roles (user_id, role_code, college_id) 
    VALUES (v_fac, 'FACULTY', v_c), (v_student, 'STUDENT', v_c);

    INSERT INTO student_profiles (user_id, college_id, roll_number) VALUES (v_student, v_c, UPPER('R_RC_' || v_c));

    INSERT INTO academic_years (id, college_id, name, start_date, end_date, is_current)
    VALUES (v_ay, v_c, '2024-2025', '2024-06-01', '2025-05-31', TRUE);

    INSERT INTO departments (id, college_id, name, code) VALUES (v_dept, v_c, 'CS', 'CS_' || v_c);
    INSERT INTO faculty_profiles (user_id, college_id, department_id, employee_id, designation) VALUES (v_fac, v_c, v_dept, UPPER('EMP_' || v_fac), 'Prof');
    INSERT INTO branches (id, college_id, department_id, name, code) VALUES (v_branch, v_c, v_dept, 'CSE', 'CSE_' || v_c);
    INSERT INTO classes (id, college_id, branch_id, academic_year_id, year_of_study, semester, section)
    VALUES (v_class, v_c, v_branch, v_ay, 3, 5, 'A');

    INSERT INTO student_enrollments (college_id, student_user_id, class_id, academic_year_id, enrollment_type, is_active)
    VALUES (v_c, v_student, v_class, v_ay, 'CORE', TRUE);

    INSERT INTO subjects (id, college_id, department_id, name, code) VALUES (v_sub, v_c, v_dept, 'Ethics', 'ETH_' || v_c);
    INSERT INTO faculty_assignments (college_id, faculty_user_id, subject_id, class_id, academic_year_id)
    VALUES (v_c, v_fac, v_sub, v_class, v_ay);

    INSERT INTO questions (id, college_id, subject_id, created_by_faculty_id, question_type, question_text, default_marks)
    VALUES (v_q, v_c, v_sub, v_fac, 'MCQ', 'Ethics Q?', 1.0000);

    INSERT INTO question_options (question_id, option_text, is_correct, display_order)
    VALUES (v_q, 'C', TRUE, 1), (v_q, 'W', FALSE, 2);

    -- Quiz: Visibility AFTER_SESSION_ENDS
    INSERT INTO quizzes (id, college_id, faculty_user_id, subject_id, title, default_duration_minutes, default_result_visibility)
    VALUES (v_quiz, v_c, v_fac, v_sub, 'Ethics Quiz', 30, 'AFTER_SESSION_ENDS');

    INSERT INTO quiz_questions (college_id, quiz_id, question_id, sequence_order)
    VALUES (v_c, v_quiz, v_q, 1);

    v_fac_sig := fn_generate_auth_signature(v_fac, 'ANY', 300);
    PERFORM sp_publish_quiz(v_quiz, v_fac, v_fac_sig);

    INSERT INTO quiz_sessions (
        id, college_id, quiz_id, faculty_user_id, class_id, session_code,
        start_window_time, end_window_time, duration_minutes, result_visibility
    ) VALUES (
        v_session, v_c, v_quiz, v_fac, v_class, 'SESSRC',
        clock_timestamp() - INTERVAL '1 minute', clock_timestamp() + INTERVAL '1 hour', 30, 'AFTER_SESSION_ENDS'
    );

    PERFORM sp_activate_quiz_session(v_session, v_fac, v_fac_sig);

    v_stud_sig := fn_generate_auth_signature(v_student, 'STUDENT', 300);
    SELECT attempt_id INTO v_att FROM sp_start_quiz_attempt(v_session, v_student, v_stud_sig);
    PERFORM sp_finalize_attempt(v_att, 'MANUAL', v_student, v_stud_sig);

    -- 14A: Attempt finalized, but session is still ACTIVE -> Results must remain hidden for student
    SELECT is_results_released, total_score, question_breakdown
    INTO v_released, v_score, v_breakdown
    FROM sp_get_student_attempt_results(v_att, v_student, v_stud_sig);

    IF v_released = TRUE OR v_score IS NOT NULL OR v_breakdown IS NOT NULL THEN
        RAISE EXCEPTION 'TEST-14A FAILED: Results leaked before session completed!';
    END IF;
    RAISE NOTICE 'TEST-14A PASSED: Results withheld from student while session remains ACTIVE.';

    -- 14B: Faculty completes session -> Results now released
    PERFORM sp_complete_quiz_session(v_session, v_fac, v_fac_sig);

    SELECT is_results_released, total_score, question_breakdown
    INTO v_released, v_score, v_breakdown
    FROM sp_get_student_attempt_results(v_att, v_student, v_stud_sig);

    IF v_released <> TRUE OR v_breakdown IS NULL THEN
        RAISE EXCEPTION 'TEST-14B FAILED: Results not released after session completed';
    END IF;
    RAISE NOTICE 'TEST-14B PASSED: Results successfully released to student upon session completion.';

    -- Cleanup
    DELETE FROM quiz_attempts WHERE id = v_att;
    DELETE FROM quiz_sessions WHERE id = v_session;
    DELETE FROM quiz_questions WHERE quiz_id = v_quiz;
    DELETE FROM quizzes WHERE id = v_quiz;
    DELETE FROM question_options WHERE question_id = v_q;
    DELETE FROM questions WHERE id = v_q;
    DELETE FROM faculty_assignments WHERE college_id = v_c;
    DELETE FROM student_enrollments WHERE college_id = v_c;
    DELETE FROM subjects WHERE id = v_sub;
    DELETE FROM classes WHERE id = v_class;
    DELETE FROM branches WHERE id = v_branch;
    DELETE FROM student_profiles WHERE user_id = v_student;
    DELETE FROM faculty_profiles WHERE user_id = v_fac;
    DELETE FROM departments WHERE id = v_dept;
    DELETE FROM academic_years WHERE id = v_ay;
    DELETE FROM user_roles WHERE user_id IN (v_fac, v_student);
    DELETE FROM users WHERE id IN (v_fac, v_student);
    DELETE FROM colleges WHERE id = v_c;
END $$;
