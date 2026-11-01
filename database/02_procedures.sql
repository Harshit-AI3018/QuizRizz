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
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
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

    -- 2. Lock quiz session in SHARE mode (OF qs only — classes is a read-only join)
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
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
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
                             - ( v_i_sel::NUMERIC * v_q_penalty::NUMERIC );

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
SET search_path = public, pg_temp
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
