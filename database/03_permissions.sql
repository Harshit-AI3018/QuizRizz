-- ============================================================================
-- CampusQuiz — Migration 03: Function Ownership & Least-Privilege Grants
-- Target: PostgreSQL 15+ (Standard / Neon Compatible)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. SCHEMA PRIVILEGES (PostgreSQL 15+ / Neon Ownership Prerequisite)
-- ----------------------------------------------------------------------------

-- Grant schema usage to the application connection role
GRANT USAGE ON SCHEMA public TO campusquiz_app;

-- Grant usage and create to definer role so it can receive object ownership
GRANT USAGE, CREATE ON SCHEMA public TO campusquiz_definer;

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
-- NOTE: fn_generate_auth_signature is strictly revoked from campusquiz_app
-- (signatures must only be minted by backend services via AUTH_HMAC_SECRET).
-- ----------------------------------------------------------------------------

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

-- Standard operational tables: Full DML for application role (excluding quiz_attempts)
GRANT SELECT, INSERT, UPDATE, DELETE ON 
    colleges, users, roles, user_roles, 
    departments, faculty_profiles, student_profiles, branches, academic_years, 
    classes, subjects, faculty_assignments, student_enrollments, 
    questions, quizzes, quiz_questions 
TO campusquiz_app;

-- Quiz Attempts: Read-only access for queries & reporting (scoring & lifecycle strictly procedure-controlled)
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

-- ----------------------------------------------------------------------------
-- 5. POST-MIGRATION HARDENING (Revoke temporary schema creation rights)
-- ----------------------------------------------------------------------------

-- Definer role only required CREATE during ownership transfers; revoke for least privilege
REVOKE CREATE ON SCHEMA public FROM campusquiz_definer;
