-- ============================================================================
-- CampusQuiz — Integration & Security Verification Test Suite
-- Target: PostgreSQL 15+ / Neon 18.6 Compatible
-- NOTE: Executed transactionally (with unconditional ROLLBACK) via --tests-only.
--       NEVER tracked in schema_migrations or executed by --migrate.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TEST 1: Table & Column-Level Least-Privilege Permissions
-- Direct update of evaluation columns & server_received_at must be blocked (42501)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_col TEXT;
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

    -- 1C: Direct INSERT on student_responses blocked (Migration 07 least-privilege enforcement)
    BEGIN
        EXECUTE 'INSERT INTO student_responses (id, attempt_id, question_id, client_version) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1)';
        RAISE EXCEPTION 'TEST-01C FAILED: Direct insert into student_responses was permitted for campusquiz_app!';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST-01C PASSED: Direct insert into student_responses was blocked by permissions (42501).';
    END;

    -- 1D: Direct UPDATE on selected_option_ids blocked
    BEGIN
        EXECUTE 'UPDATE student_responses SET selected_option_ids = ARRAY[gen_random_uuid()] WHERE id = gen_random_uuid()';
        RAISE EXCEPTION 'TEST-01D FAILED: Direct update of selected_option_ids was permitted for campusquiz_app!';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST-01D PASSED: Direct update of selected_option_ids was blocked by permissions (42501).';
    END;

    -- 1E: Direct UPDATE on client_version blocked
    BEGIN
        EXECUTE 'UPDATE student_responses SET client_version = 2 WHERE id = gen_random_uuid()';
        RAISE EXCEPTION 'TEST-01E FAILED: Direct update of client_version was permitted for campusquiz_app!';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST-01E PASSED: Direct update of client_version was blocked by permissions (42501).';
    END;

    -- 1F: Comprehensive catalog-based privilege verification across all 13 columns
    IF has_table_privilege('campusquiz_app', 'student_responses', 'INSERT') THEN
        RAISE EXCEPTION 'TEST-01F FAILED: campusquiz_app unexpectedly holds table-level INSERT on student_responses';
    END IF;
    IF has_table_privilege('campusquiz_app', 'student_responses', 'UPDATE') THEN
        RAISE EXCEPTION 'TEST-01F FAILED: campusquiz_app unexpectedly holds table-level UPDATE on student_responses';
    END IF;

    -- Verify all 13 columns directly from PostgreSQL system catalog pg_attribute
    FOR v_col IN
        SELECT a.attname
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'student_responses'
          AND a.attnum > 0
          AND NOT a.attisdropped
    LOOP
        -- INSERT must be FALSE for every column
        IF has_column_privilege('campusquiz_app', 'student_responses', v_col, 'INSERT') THEN
            RAISE EXCEPTION 'TEST-01F FAILED: campusquiz_app unexpectedly holds column-level INSERT on %', v_col;
        END IF;

        -- UPDATE must be FALSE for every column
        IF has_column_privilege('campusquiz_app', 'student_responses', v_col, 'UPDATE') THEN
            RAISE EXCEPTION 'TEST-01F FAILED: campusquiz_app unexpectedly holds column-level UPDATE on %', v_col;
        END IF;

        -- Evaluative columns must NOT have SELECT
        IF v_col IN ('is_evaluated', 'is_correct', 'awarded_marks') THEN
            IF has_column_privilege('campusquiz_app', 'student_responses', v_col, 'SELECT') THEN
                RAISE EXCEPTION 'TEST-01F FAILED: campusquiz_app unexpectedly holds SELECT on evaluative column %', v_col;
            END IF;
        ELSE
            -- The 10 approved columns MUST have SELECT
            IF NOT has_column_privilege('campusquiz_app', 'student_responses', v_col, 'SELECT') THEN
                RAISE EXCEPTION 'TEST-01F FAILED: campusquiz_app missing required SELECT on approved column %', v_col;
            END IF;
        END IF;
    END LOOP;

    -- Definer must retain required privileges for SECURITY DEFINER routines
    IF NOT has_table_privilege('campusquiz_definer', 'student_responses', 'INSERT') OR
       NOT has_table_privilege('campusquiz_definer', 'student_responses', 'UPDATE') OR
       NOT has_table_privilege('campusquiz_definer', 'student_responses', 'SELECT') THEN
        RAISE EXCEPTION 'TEST-01F FAILED: campusquiz_definer missing required table-level privileges on student_responses';
    END IF;
    RAISE NOTICE 'TEST-01F PASSED: Complete 13-column catalog-based privilege assertions verified for app and definer roles.';

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
    v_c1   UUID := gen_random_uuid();
    v_c2   UUID := gen_random_uuid();
    v_dept  UUID := gen_random_uuid();
    v_dept2 UUID := gen_random_uuid();
    v_sub   UUID := gen_random_uuid();
    v_sub2  UUID := gen_random_uuid();
    v_user1 UUID := gen_random_uuid();
    v_user2 UUID := gen_random_uuid();
    v_q    UUID := gen_random_uuid();
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

    -- Department and subject for College 2 (required by fk_quizzes_subject)
    INSERT INTO departments (id, college_id, name, code) VALUES (v_dept2, v_c2, 'CS Dept 2', 'CS2_' || v_c2);
    INSERT INTO subjects (id, college_id, department_id, name, code) VALUES (v_sub2, v_c2, v_dept2, 'DBMS2', 'CS301_' || v_c2);

    -- Question belongs to College 1
    INSERT INTO questions (id, college_id, subject_id, created_by_faculty_id, question_type, question_text)
    VALUES (v_q, v_c1, v_sub, v_user1, 'MCQ', 'What is 2+2?');

    -- Quiz belongs to College 2, correctly using College 2's subject (v_sub2)
    INSERT INTO quizzes (id, college_id, faculty_user_id, subject_id, title, default_duration_minutes)
    VALUES (v_quiz, v_c2, v_user2, v_sub2, 'Quiz in College 2', 30);

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
    DELETE FROM subjects WHERE id IN (v_sub, v_sub2);
    DELETE FROM departments WHERE id IN (v_dept, v_dept2);
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
    DECLARE _blocked BOOLEAN := FALSE;
    BEGIN
        BEGIN
            PERFORM fn_verify_actor_context(v_user, 'STUDENT', v_fake_sig);
        EXCEPTION WHEN OTHERS THEN
            _blocked := TRUE;
        END;
        IF _blocked THEN
            RAISE NOTICE 'TEST-05A PASSED: Forged signature successfully rejected.';
        ELSE
            RAISE EXCEPTION 'TEST-05A FAILED: Forged auth signature was accepted!';
        END IF;
    END;

    -- 5B: Valid HMAC signature accepted
    v_valid_sig := fn_generate_auth_signature(v_user, 'STUDENT', 300);
    PERFORM fn_verify_actor_context(v_user, 'STUDENT', v_valid_sig);
    RAISE NOTICE 'TEST-05B PASSED: Valid HMAC signature successfully verified.';

    -- 5C: Expired HMAC signature rejected
    -- Generate signature with -10 seconds validity (already in the past)
    v_expired_sig := fn_generate_auth_signature(v_user, 'STUDENT', -10);
    DECLARE _blocked BOOLEAN := FALSE;
    BEGIN
        BEGIN
            PERFORM fn_verify_actor_context(v_user, 'STUDENT', v_expired_sig);
        EXCEPTION WHEN OTHERS THEN
            _blocked := TRUE;
        END;
        IF _blocked THEN
            RAISE NOTICE 'TEST-05C PASSED: Expired signature successfully rejected.';
        ELSE
            RAISE EXCEPTION 'TEST-05C FAILED: Expired signature was accepted!';
        END IF;
    END;

    -- 5D: Token version bump invalidation
    UPDATE users SET token_version = token_version + 1 WHERE id = v_user;
    DECLARE _blocked BOOLEAN := FALSE;
    BEGIN
        BEGIN
            PERFORM fn_verify_actor_context(v_user, 'STUDENT', v_valid_sig);
        EXCEPTION WHEN OTHERS THEN
            _blocked := TRUE;
        END;
        IF _blocked THEN
            RAISE NOTICE 'TEST-05D PASSED: Previously valid signature rejected after token version bump.';
        ELSE
            RAISE EXCEPTION 'TEST-05D FAILED: Signature was accepted after token version bump!';
        END IF;
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
    DECLARE _blocked BOOLEAN := FALSE;
    BEGIN
        BEGIN
            PERFORM sp_publish_quiz(v_quiz, v_fac, v_fac_sig);
        EXCEPTION WHEN OTHERS THEN
            _blocked := TRUE;
        END;
        IF _blocked THEN
            RAISE NOTICE 'TEST-06A PASSED: Empty quiz publishing rejected.';
        ELSE
            RAISE EXCEPTION 'TEST-06A FAILED: Empty quiz was published!';
        END IF;
    END;

    -- Add question with no options
    INSERT INTO questions (id, college_id, subject_id, created_by_faculty_id, question_type, question_text, default_marks)
    VALUES (v_q, v_c, v_sub, v_fac, 'MCQ', 'Question 1', 2.0000);

    INSERT INTO quiz_questions (college_id, quiz_id, question_id, sequence_order)
    VALUES (v_c, v_quiz, v_q, 1);

    -- 6B: Reject publishing question with no options
    DECLARE _blocked BOOLEAN := FALSE;
    BEGIN
        BEGIN
            PERFORM sp_publish_quiz(v_quiz, v_fac, v_fac_sig);
        EXCEPTION WHEN OTHERS THEN
            _blocked := TRUE;
        END;
        IF _blocked THEN
            RAISE NOTICE 'TEST-06B PASSED: Quiz with options missing rejected.';
        ELSE
            RAISE EXCEPTION 'TEST-06B FAILED: Question without options was published!';
        END IF;
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
    DECLARE _blocked BOOLEAN := FALSE;
    BEGIN
        BEGIN
            PERFORM sp_publish_quiz(v_quiz, v_fac2, v_fac2_sig);
        EXCEPTION WHEN OTHERS THEN
            _blocked := TRUE;
        END;
        IF _blocked THEN
            RAISE NOTICE 'TEST-07A PASSED: Unauthorized faculty publishing rejected.';
        ELSE
            RAISE EXCEPTION 'TEST-07A FAILED: Unauthorized faculty was permitted to publish quiz!';
        END IF;
    END;

    -- 7B: Direct creation of ACTIVE session via INSERT blocked by trigger
    DECLARE _blocked BOOLEAN := FALSE;
    BEGIN
        BEGIN
            INSERT INTO quiz_sessions (
                id, college_id, quiz_id, faculty_user_id, class_id, session_code,
                status, start_window_time, end_window_time, duration_minutes
            ) VALUES (
                v_session, v_c, v_quiz, v_fac1, v_class, 'SESSAZ',
                'ACTIVE', clock_timestamp(), clock_timestamp() + INTERVAL '1 hour', 30
            );
        EXCEPTION WHEN OTHERS THEN
            _blocked := TRUE;
        END;
        IF _blocked THEN
            RAISE NOTICE 'TEST-07B PASSED: Direct ACTIVE session creation rejected by fn_guard_session_creation.';
        ELSE
            RAISE EXCEPTION 'TEST-07B FAILED: Direct creation of ACTIVE session was permitted!';
        END IF;
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
    DECLARE _blocked BOOLEAN := FALSE;
    BEGIN
        BEGIN
            UPDATE quiz_sessions SET snapshot_json = '{"altered": true}'::jsonb WHERE id = v_session;
        EXCEPTION WHEN OTHERS THEN
            _blocked := TRUE;
        END;
        IF _blocked THEN
            RAISE NOTICE 'TEST-08C PASSED: Direct snapshot mutation blocked by fn_enforce_snapshot_immutability.';
        ELSE
            RAISE EXCEPTION 'TEST-08C FAILED: Snapshot modification was permitted!';
        END IF;
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
    DECLARE _blocked BOOLEAN := FALSE;
    BEGIN
        BEGIN
            UPDATE quiz_sessions SET status = 'COMPLETED' WHERE id = v_session;
        EXCEPTION WHEN OTHERS THEN
            _blocked := TRUE;
        END;
        IF _blocked THEN
            RAISE NOTICE 'TEST-09A PASSED: Invalid lifecycle jump blocked by fn_validate_session_status_transition.';
        ELSE
            RAISE EXCEPTION 'TEST-09A FAILED: Direct SCHEDULED -> COMPLETED was permitted!';
        END IF;
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
    DECLARE _blocked BOOLEAN := FALSE;
    BEGIN
        BEGIN
            PERFORM sp_save_student_response(
                v_att1, v_q, '{}', FALSE, 1, clock_timestamp(), v_s2, v_s2_sig
            );
        EXCEPTION WHEN OTHERS THEN
            _blocked := TRUE;
        END;
        IF _blocked THEN
            RAISE NOTICE 'TEST-10C PASSED: Cross-student response mutation rejected.';
        ELSE
            RAISE EXCEPTION 'TEST-10C FAILED: Cross-student response mutation was permitted!';
        END IF;
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
    DECLARE _blocked BOOLEAN := FALSE;
    BEGIN
        BEGIN
            PERFORM sp_save_student_response(
                v_attempt_id, v_q, ARRAY[v_foreign_opt], FALSE, 1, clock_timestamp(), v_student, v_stud_sig
            );
        EXCEPTION WHEN OTHERS THEN
            _blocked := TRUE;
        END;
        IF _blocked THEN
            RAISE NOTICE 'TEST-11A PASSED: Foreign option was rejected.';
        ELSE
            RAISE EXCEPTION 'TEST-11A FAILED: Foreign option was accepted!';
        END IF;
    END;

    -- 11B: Reject duplicate option IDs
    DECLARE _blocked BOOLEAN := FALSE;
    BEGIN
        BEGIN
            PERFORM sp_save_student_response(
                v_attempt_id, v_q, ARRAY[v_opt1, v_opt1], FALSE, 1, clock_timestamp(), v_student, v_stud_sig
            );
        EXCEPTION WHEN OTHERS THEN
            _blocked := TRUE;
        END;
        IF _blocked THEN
            RAISE NOTICE 'TEST-11B PASSED: Duplicate option IDs were rejected.';
        ELSE
            RAISE EXCEPTION 'TEST-11B FAILED: Duplicate options were accepted!';
        END IF;
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
    DECLARE _blocked BOOLEAN := FALSE;
    BEGIN
        BEGIN
            PERFORM sp_finalize_attempt(v_att, 'MANUAL', v_s2, v_s2_sig);
        EXCEPTION WHEN OTHERS THEN
            _blocked := TRUE;
        END;
        IF _blocked THEN
            RAISE NOTICE 'TEST-12A PASSED: Unauthorized student manual finalization rejected.';
        ELSE
            RAISE EXCEPTION 'TEST-12A FAILED: Unauthorized student manual finalization was permitted!';
        END IF;
    END;

    -- 12B: AUTO_TIME_EXPIRED rejected before deadline has elapsed
    DECLARE _blocked BOOLEAN := FALSE;
    BEGIN
        BEGIN
            PERFORM sp_finalize_attempt(v_att, 'AUTO_TIME_EXPIRED', v_s1, v_s1_sig);
        EXCEPTION WHEN OTHERS THEN
            _blocked := TRUE;
        END;
        IF _blocked THEN
            RAISE NOTICE 'TEST-12B PASSED: Premature AUTO_TIME_EXPIRED rejected.';
        ELSE
            RAISE EXCEPTION 'TEST-12B FAILED: AUTO_TIME_EXPIRED permitted before deadline!';
        END IF;
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

    -- Note: Finalized attempts and their responses are immutably protected by
    -- fn_guard_student_response_mutation() and cannot be deleted. Cleanup is
    -- safely and automatically handled by the outer test transaction rollback.
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
    v_stud_any_sig TEXT;
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
    v_stud_any_sig := fn_generate_auth_signature(v_student, 'ANY', 300);
    SELECT attempt_id INTO v_att FROM sp_start_quiz_attempt(v_session, v_student, v_stud_sig);
    PERFORM sp_finalize_attempt(v_att, 'MANUAL', v_student, v_stud_sig);

    -- 14A: Attempt finalized, but session is still ACTIVE -> Results must remain hidden for student
    SELECT is_results_released, total_score, question_breakdown
    INTO v_released, v_score, v_breakdown
    FROM sp_get_student_attempt_results(v_att, v_student, v_stud_any_sig);

    IF v_released = TRUE OR v_score IS NOT NULL OR v_breakdown IS NOT NULL THEN
        RAISE EXCEPTION 'TEST-14A FAILED: Results leaked before session completed!';
    END IF;
    RAISE NOTICE 'TEST-14A PASSED: Results withheld from student while session remains ACTIVE.';

    -- 14B: Faculty completes session -> Results now released
    PERFORM sp_complete_quiz_session(v_session, v_fac, v_fac_sig);

    SELECT is_results_released, total_score, question_breakdown
    INTO v_released, v_score, v_breakdown
    FROM sp_get_student_attempt_results(v_att, v_student, v_stud_any_sig);

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
