-- ============================================================================
-- CampusQuiz — Migration 01: Complete Schema, Constraints & Triggers
-- Target: PostgreSQL 15+ (Standard / Neon Compatible)
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
