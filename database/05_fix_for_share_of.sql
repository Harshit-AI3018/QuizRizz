-- ============================================================================
-- CampusQuiz — Migration 05: Fix FOR SHARE Table Locking in sp_start_quiz_attempt
-- Target: PostgreSQL 15+ / Neon 18.6 Compatible
-- ============================================================================
--
-- ROOT CAUSE
-- ---------------------------------------------------------------------------
-- PostgreSQL requires UPDATE privilege on *every table targeted by a row-locking
-- clause* (FOR UPDATE, FOR SHARE, FOR NO KEY UPDATE, FOR KEY SHARE), not just
-- SELECT. The PostgreSQL documentation states:
--
--   "The use of FOR NO KEY UPDATE, FOR UPDATE, FOR SHARE or FOR KEY SHARE
--    requires UPDATE privilege as well (for at least one column of each table
--    so selected)."
--
-- sp_start_quiz_attempt executes:
--
--   SELECT qs.*, c.academic_year_id INTO v_session
--   FROM quiz_sessions qs
--   JOIN classes c ON c.id = qs.class_id
--   WHERE qs.id = p_session_id AND qs.college_id = v_actor.college_id
--   FOR SHARE;
--
-- The unqualified FOR SHARE targets BOTH quiz_sessions AND classes.
-- campusquiz_definer holds UPDATE on quiz_sessions (granted in migration 04)
-- but does NOT hold UPDATE on classes — only SELECT.
-- PostgreSQL therefore raises: "permission denied for table classes".
--
-- FIX (Least Privilege)
-- ---------------------------------------------------------------------------
-- Replace "FOR SHARE" with "FOR SHARE OF qs".
--
-- "FOR SHARE OF qs" acquires a row-level share lock only on the quiz_sessions
-- row (alias qs). The classes join becomes a plain read with no locking
-- semantics, so only SELECT on classes is required — which campusquiz_definer
-- already holds via the broad GRANT SELECT on ALL TABLES in migration 04.
--
-- This is semantically correct: the intent of the lock is to prevent concurrent
-- status transitions on the quiz session (e.g., another student starting at the
-- same instant, or faculty cancelling the session mid-enrol). The classes row
-- is read purely to obtain academic_year_id for enrolment verification and
-- does not participate in any concurrent mutation path.
--
-- No new privileges are granted. No existing privileges are revoked.
-- ----------------------------------------------------------------------------

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

    -- 2. Lock quiz session in SHARE mode (OF qs only — classes is a read-only join)
    --    FOR SHARE OF qs acquires a row-level share lock on the quiz_sessions row only.
    --    This requires UPDATE on quiz_sessions (already granted) but NOT on classes.
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
