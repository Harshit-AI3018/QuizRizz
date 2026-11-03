-- ============================================================================
-- CampusQuiz — Migration 07: Revoke Direct Mutation Rights on student_responses
-- Target: PostgreSQL 15+ / Neon 18.6 Compatible
-- ============================================================================
--
-- CONTEXT & RATIONALE
-- ---------------------------------------------------------------------------
-- Migration 03 granted column-level INSERT and UPDATE privileges on
-- student_responses to campusquiz_app for student-editable columns.
-- This violated the core architectural invariant:
--
--   "All mutations on student responses must strictly flow through the
--    SECURITY DEFINER stored routine sp_save_student_response."
--
-- Having direct column-level INSERT and UPDATE permitted potential bypass
-- of cryptographic HMAC actor authentication, attempt ownership checks,
-- frozen snapshot question/option validation, cardinality checks, and
-- monotonic version-gating.
--
-- FIX
-- ---------------------------------------------------------------------------
-- 1. Explicitly REVOKE column-level INSERT privileges on student_responses
--    from campusquiz_app.
-- 2. Explicitly REVOKE column-level UPDATE privileges on student_responses
--    from campusquiz_app.
-- 3. Revoke all table-level privileges on student_responses from PUBLIC
--    and campusquiz_app.
-- 4. Restore ONLY column-level SELECT on approved non-evaluative columns for
--    campusquiz_app.
-- 5. campusquiz_definer retains SELECT, INSERT, and UPDATE on student_responses
--    (granted in Migration 03/04), ensuring sp_save_student_response and
--    sp_finalize_attempt continue to execute with full SECURITY DEFINER authority.
-- ============================================================================

-- 1. Explicitly revoke all column-level INSERT grants from campusquiz_app
REVOKE INSERT (
    id,
    attempt_id,
    question_id,
    selected_option_ids,
    is_marked_for_review,
    client_version,
    client_submitted_at,
    created_at,
    updated_at
) ON TABLE public.student_responses FROM campusquiz_app;

-- 2. Explicitly revoke all column-level UPDATE grants from campusquiz_app
REVOKE UPDATE (
    selected_option_ids,
    is_marked_for_review,
    client_version,
    client_submitted_at,
    updated_at
) ON TABLE public.student_responses FROM campusquiz_app;

-- 3. Clear table-level privileges for PUBLIC and application role
REVOKE ALL ON student_responses FROM PUBLIC, campusquiz_app;

-- 4. Restore column-level SELECT on approved non-evaluative columns only to campusquiz_app
-- Excludes evaluative columns: is_evaluated, is_correct, awarded_marks
GRANT SELECT (
    id,
    attempt_id,
    question_id,
    selected_option_ids,
    is_marked_for_review,
    client_version,
    client_submitted_at,
    server_received_at,
    created_at,
    updated_at
) ON student_responses TO campusquiz_app;
