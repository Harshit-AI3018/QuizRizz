-- ============================================================================
-- CampusQuiz — Migration 06: Fix Record Variable Assignment in sp_save_student_response
-- Target: PostgreSQL 15+ / Neon 18.6 Compatible
-- ============================================================================
--
-- ROOT CAUSE
-- ---------------------------------------------------------------------------
-- In PL/pgSQL, an unassigned generic RECORD variable has an indeterminate
-- tuple structure (no known fields). Attempting to assign into a subfield of an
-- unassigned record:
--
--   RETURNING client_version INTO v_existing.client_version;
--
-- fails at runtime with:
--   ERROR: record "v_existing" is not assigned yet
--   DETAIL: The tuple structure of a not-yet-assigned record is indeterminate.
--
-- FIX
-- ---------------------------------------------------------------------------
-- 1. Declare a typed scalar variable `v_saved_version INT;` to receive the
--    returned client_version from the upsert RETURNING clause.
-- 2. Verify FOUND immediately after the upsert. If TRUE, return ('ACCEPTED', v_saved_version).
-- 3. If NOT FOUND (conflict where incoming version <= existing), Step 7 assigns
--    to `v_existing` as a WHOLE (SELECT ... INTO v_existing), which assigns
--    the composite row structure before inspecting its fields.
-- 4. Check IF NOT FOUND immediately after Step 7's SELECT INTO as a defensive
--    guard against reading unassigned fields.
-- 5. No permissions or ownership changes are made.
-- ----------------------------------------------------------------------------

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

