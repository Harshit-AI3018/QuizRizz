-- ============================================================================
-- CampusQuiz — Migration 08: Fix Multiple-Select Negative Marking Scoring Penalty
-- Target: PostgreSQL 15+ / Neon 18.6 Compatible
-- ============================================================================
--
-- ROOT CAUSE
-- ----------------------------------------------------------------------------
-- The earlier sp_finalize_attempt implementation in migrations 02 and 04 computed
-- multiple-select penalty deduction by multiplying the configured question penalty
-- by the number of incorrect options selected:
--     v_awarded := ((v_c_sel / tot_correct) * marks) - (v_i_sel * v_q_penalty);
--
-- Under the agreed CampusQuiz assessment rules:
--   - Single-select and True/False: full marks for a correct answer; zero for an
--     incorrect answer before any configured penalty.
--   - Multiple-select: proportional partial credit based on correctly selected
--     options divided by the total correct options: (c_sel / tot_correct) * marks.
--   - If negative marking is enabled and at least one incorrect option is selected,
--     apply the configured penalty ONCE for that question.
--   - Do NOT multiply the penalty by the number of incorrect options.
--   - If negative marking is disabled, do not deduct a penalty (penalty is 0.000000).
--   - Do not impose a zero floor on question marks or total attempt score.
--   - Unanswered questions receive zero.
--
-- FIX
-- ----------------------------------------------------------------------------
-- Replace `(v_i_sel::NUMERIC * v_q_penalty::NUMERIC)` with:
--     (CASE WHEN v_i_sel > 0 THEN v_q_penalty::NUMERIC ELSE 0.000000 END)
--
-- Retains least-privilege grants and SECURITY DEFINER context.
-- ----------------------------------------------------------------------------

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

                -- Proportional partial credit formula with single-penalty deduction:
                -- Awarded = ( (c_sel / tot_correct) * marks ) - (CASE WHEN i_sel > 0 THEN penalty ELSE 0 END)
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

ALTER FUNCTION sp_finalize_attempt(UUID, VARCHAR, UUID, TEXT) OWNER TO campusquiz_definer;
REVOKE ALL ON FUNCTION sp_finalize_attempt(UUID, VARCHAR, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sp_finalize_attempt(UUID, VARCHAR, UUID, TEXT) TO campusquiz_app;
