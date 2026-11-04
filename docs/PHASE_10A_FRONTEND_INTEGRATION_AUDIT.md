# CampusQuiz — Phase 10A: Frontend Foundation & Backend Integration Audit (Revised)

**Audit Version:** 2.0 (Post-Verification & Exact Route Reconciliation)
**Date:** November 2026
**Audited Git Commit:** `6abf81b` (`feat(backend): implement Phases 5-9B.2 lifecycle, attempts, scoring and websockets`)
**Workspace:** `D:\Quiz-fixed`
**Target Stack:** React 19 / TypeScript 5 / Tailwind CSS / React Router v7 (or v6) / Recharts / Vite

---

## 1. Route Reconciliation & Verification Findings

### 1.1 Resolution of Previous Route Count Discrepancy
In the initial draft of Phase 10A, a summary statement loosely cited "32 routes" while its internal tables itemized dozens of endpoints.

To resolve this discrepancy conclusively, `create_app().routes` was programmatically inspected directly from the application instance.

**Actual Route Totals:**
- **Total Registered Endpoints:** **61** (59 HTTP endpoints + 2 WebSocket endpoints).
- **Zero Incomplete or Dummy Routes:** Every single route maps to an active asynchronous handler in `app/api/v1/endpoints/` or `app/api/health.py`.

### 1.2 Route Count Breakdown by Subsystem
| Category / Subsystem | Router Prefix / Tag | REST | WS | Subtotal |
|---|---|---|---|---|
| **Health & Readiness** | `/health`, `/api/v1/health` | 4 | 0 | 4 |
| **Authentication & Identity** | `/api/v1/auth` | 5 | 0 | 5 |
| **Institutional Administration** | `/api/v1/admin` | 17 | 0 | 17 |
| **Question Bank & Quiz Authoring** | `/api/v1/questions`, `/api/v1/quizzes` | 12 | 0 | 12 |
| **Publishing, Sessions & Results** | `/api/v1/quizzes/{id}/*`, `/api/v1/sessions/*` | 9 | 0 | 9 |
| **Student Discovery, Lobby, Attempt & Results** | `/api/v1/student` | 12 | 0 | 12 |
| **Live WebSocket Channels** | `/api/v1/ws/sessions/{id}/*` | 0 | 2 | 2 |
| **Total Registered Routes** | | **59** | **2** | **61** |

*(Note on Health Routes: `health_router` is included twice — once at the FastAPI root level providing `/health/live` and `/health/ready`, and once inside `api_router` mounted under `/api/v1/health/live` and `/api/v1/health/ready`)*.

---

## 2. Complete, Code-Verified Endpoint Inventory (61 Routes)

Every route below was verified directly against the running FastAPI route table, handler signatures, Pydantic schemas, and role dependency guards.

### 2.1 Health & Diagnostics (4 routes)
| # | Method | Path | Required Role | Request Body | Response Model / Shape | Status |
|---|---|---|---|---|---|---|
| 1 | `GET` | `/health/live` | Public | None | `{"status": "alive"}` | Implemented |
| 2 | `GET` | `/health/ready` | Public | None | `{"status": "ready"}` (503 if DB down) | Implemented |
| 3 | `GET` | `/api/v1/health/live` | Public | None | `{"status": "alive"}` | Implemented |
| 4 | `GET` | `/api/v1/health/ready` | Public | None | `{"status": "ready"}` (503 if DB down) | Implemented |

### 2.2 Authentication & Identity (`/api/v1/auth`, 5 routes)
| # | Method | Path | Required Role | Request Body | Response Model | Status | Notes |
|---|---|---|---|---|---|---|---|
| 5 | `POST` | `/api/v1/auth/login` | Public | `LoginRequest` (`college_id`, `email`, `password`) | `TokenResponse` | Implemented | Email normalized; Argon2id verified; returns access+refresh JWTs |
| 6 | `POST` | `/api/v1/auth/refresh` | Public | `RefreshRequest` (`refresh_token`) | `TokenResponse` | Implemented | Validates refresh JWT & checks DB `token_version` |
| 7 | `POST` | `/api/v1/auth/logout` | Public | `RefreshRequest` (`refresh_token`) | `204 No Content` | Implemented | Increments DB `token_version`, invalidating active tokens |
| 8 | `GET` | `/api/v1/auth/me` | Bearer (Any) | None | `UserProfile` | Implemented | Returns tenant ID, name, email, roles array, password status |
| 9 | `POST` | `/api/v1/auth/ws-ticket` | Bearer (Any) | `WebSocketTicketRequest` (`session_id?`) | `WebSocketTicketResponse` | Implemented | Mints single-use 60s signed ticket with unique JTI |

### 2.3 Institutional Administration (`/api/v1/admin`, 17 routes)
*All require `ADMIN` role and enforce tenant (`college_id`) isolation.*

| # | Method | Path | Required Role | Request Body | Response Model | Status |
|---|---|---|---|---|---|---|
| 10 | `GET` | `/api/v1/admin/college` | `ADMIN` | None | `dict[str, Any]` (College) | Implemented |
| 11 | `PATCH` | `/api/v1/admin/college` | `ADMIN` | `CollegeUpdate` | `dict[str, Any]` (College) | Implemented |
| 12 | `GET` | `/api/v1/admin/academic/{resource_name}` | `ADMIN` | Query: `limit`, `offset` | `list[dict[str, Any]]` | Implemented |
| 13 | `POST` | `/api/v1/admin/academic/{resource_name}` | `ADMIN` | `CreateResourceRequest` | `dict[str, Any]` (201) | Implemented |
| 14 | `GET` | `/api/v1/admin/academic/{resource_name}/{record_id}` | `ADMIN` | None | `dict[str, Any]` | Implemented |
| 15 | `PATCH` | `/api/v1/admin/academic/{resource_name}/{record_id}` | `ADMIN` | `UpdateResourceRequest` | `dict[str, Any]` | Implemented |
| 16 | `DELETE` | `/api/v1/admin/academic/{resource_name}/{record_id}` | `ADMIN` | None | `204 No Content` | Implemented |
| 17 | `GET` | `/api/v1/admin/faculty` | `ADMIN` | Query: `limit`, `offset` | `list[dict[str, Any]]` | Implemented |
| 18 | `POST` | `/api/v1/admin/faculty` | `ADMIN` | `FacultyCreate` | `dict[str, Any]` (201) | Implemented |
| 19 | `GET` | `/api/v1/admin/faculty/{user_id}` | `ADMIN` | None | `dict[str, Any]` | Implemented |
| 20 | `PATCH` | `/api/v1/admin/faculty/{user_id}` | `ADMIN` | `FacultyUpdate` | `dict[str, Any]` | Implemented |
| 21 | `DELETE` | `/api/v1/admin/faculty/{user_id}` | `ADMIN` | None | `204 No Content` | Implemented |
| 22 | `GET` | `/api/v1/admin/students` | `ADMIN` | Query: `limit`, `offset` | `list[dict[str, Any]]` | Implemented |
| 23 | `POST` | `/api/v1/admin/students` | `ADMIN` | `StudentCreate` | `dict[str, Any]` (201) | Implemented |
| 24 | `GET` | `/api/v1/admin/students/{user_id}` | `ADMIN` | None | `dict[str, Any]` | Implemented |
| 25 | `PATCH` | `/api/v1/admin/students/{user_id}` | `ADMIN` | `StudentUpdate` | `dict[str, Any]` | Implemented |
| 26 | `DELETE` | `/api/v1/admin/students/{user_id}` | `ADMIN` | None | `204 No Content` | Implemented |

*(Academic resources supported: `academic-years`, `departments`, `branches`, `classes`, `subjects`, `faculty-assignments`, `enrollments`)*.

### 2.4 Question Bank & Quiz Authoring (12 routes)
*All require `FACULTY` or `ADMIN` role. Faculty must be assigned to the referenced subject.*

| # | Method | Path | Required Role | Request Body | Response Model | Status |
|---|---|---|---|---|---|---|
| 27 | `GET` | `/api/v1/questions` | `FACULTY`, `ADMIN` | Query: `subject_id?`, `limit`, `offset` | `list[QuestionRead]` | Implemented |
| 28 | `POST` | `/api/v1/questions` | `FACULTY`, `ADMIN` | `QuestionCreate` | `QuestionRead` (201) | Implemented |
| 29 | `GET` | `/api/v1/questions/{question_id}` | `FACULTY`, `ADMIN` | None | `QuestionRead` | Implemented |
| 30 | `PATCH` | `/api/v1/questions/{question_id}` | `FACULTY`, `ADMIN` | `QuestionUpdate` | `QuestionRead` | Implemented |
| 31 | `PUT` | `/api/v1/questions/{question_id}/options` | `FACULTY`, `ADMIN` | `QuestionOptionsReplace` | `QuestionRead` | Implemented |
| 32 | `DELETE` | `/api/v1/questions/{question_id}` | `FACULTY`, `ADMIN` | None | `204 No Content` | Implemented |
| 33 | `GET` | `/api/v1/quizzes` | `FACULTY`, `ADMIN` | Query: `limit`, `offset` | `list[QuizRead]` | Implemented |
| 34 | `POST` | `/api/v1/quizzes` | `FACULTY`, `ADMIN` | `QuizCreate` | `QuizRead` (201) | Implemented |
| 35 | `GET` | `/api/v1/quizzes/{quiz_id}` | `FACULTY`, `ADMIN` | None | `QuizRead` | Implemented |
| 36 | `PATCH` | `/api/v1/quizzes/{quiz_id}` | `FACULTY`, `ADMIN` | `QuizUpdate` | `QuizRead` | Implemented |
| 37 | `PUT` | `/api/v1/quizzes/{quiz_id}/questions` | `FACULTY`, `ADMIN` | `QuizQuestionsReplace` | `QuizRead` | Implemented |
| 38 | `DELETE` | `/api/v1/quizzes/{quiz_id}` | `FACULTY`, `ADMIN` | None | `204 No Content` | Implemented |

### 2.5 Publishing, Session Lifecycle & Faculty Results (9 routes)
*All require `FACULTY` or `ADMIN` role.*

| # | Method | Path | Required Role | Request Body | Response Model | Status | Notes |
|---|---|---|---|---|---|---|---|
| 39 | `POST` | `/api/v1/quizzes/{quiz_id}/publish` | `FACULTY`, `ADMIN` | None | `QuizPublished` | Implemented | Locks quiz from draft edits; computes `total_marks` |
| 40 | `POST` | `/api/v1/quizzes/{quiz_id}/sessions` | `FACULTY`, `ADMIN` | `QuizSessionCreate` | `QuizSessionRead` (201) | Implemented | Convenience alias for scheduling directly from quiz context |
| 41 | `GET` | `/api/v1/sessions` | `FACULTY`, `ADMIN` | Query: `quiz_id?`, `class_id?`, `status?`, `limit`, `offset` | `list[QuizSessionRead]` | Implemented | Filterable list of sessions |
| 42 | `POST` | `/api/v1/sessions` | `FACULTY`, `ADMIN` | `QuizSessionCreate` | `QuizSessionRead` (201) | Implemented | Creates and schedules a session with a generated code |
| 43 | `GET` | `/api/v1/sessions/{session_id}` | `FACULTY`, `ADMIN` | None | `QuizSessionRead` | Implemented | Reads session details and current state |
| 44 | `POST` | `/api/v1/sessions/{session_id}/{action}` | `FACULTY`, `ADMIN` | Path `action`: `start`, `activate`, `pause`, `resume`, `complete`, `end`, `cancel`, `release` | `QuizSessionRead` | Implemented | Invokes stored procedure transition and emits post-commit WS broadcast |
| 45 | `GET` | `/api/v1/sessions/{session_id}/results` | `FACULTY`, `ADMIN` | None | `SessionResultsSummary` | Implemented | Comprehensive faculty report: average, high/low, all student scores |
| 46 | `GET` | `/api/v1/sessions/{session_id}/attempts/{attempt_id}/result` | `FACULTY`, `ADMIN` | None | `StudentAttemptResult` | Implemented | Faculty inspection of an individual student's full attempt breakdown |
| 47 | `POST` | `/api/v1/sessions/{session_id}/results/release` | `FACULTY`, `ADMIN` | None | `QuizSessionRead` | Implemented | Sets `results_released_at = NOW()` via `sp_release_session_results` |

### 2.6 Student Discovery, Lobby, Attempt Engine & Results (`/api/v1/student`, 12 routes)
*All require `STUDENT` role and enforce class enrollment and tenant isolation.*

| # | Method | Path | Required Role | Request Body | Response Model | Status | Notes |
|---|---|---|---|---|---|---|---|
| 48 | `GET` | `/api/v1/student/sessions` | `STUDENT` | Query: `limit`, `offset` | `list[StudentSessionDiscovery]` | Implemented | Lists active/scheduled sessions for student's enrolled classes |
| 49 | `GET` | `/api/v1/student/sessions/joined` | `STUDENT` | Query: `limit`, `offset` | `list[StudentSessionDiscovery]` | Implemented | Lists sessions student has previously joined or attempted |
| 50 | `POST` | `/api/v1/student/sessions/join` | `STUDENT` | `SessionJoinRequest` (`session_code`) | `StudentLobbyStatus` | Implemented | Joins session by code; returns current lobby state |
| 51 | `POST` | `/api/v1/student/join` | `STUDENT` | `SessionJoinRequest` (`session_code`) | `StudentLobbyStatus` | Implemented | Root alias for join (identical handler, hidden from OpenAPI) |
| 52 | `GET` | `/api/v1/student/sessions/{session_id}/lobby` | `STUDENT` | None | `StudentLobbyStatus` | Implemented | Polling endpoint for waiting room state |
| 53 | `POST` | `/api/v1/student/sessions/{session_id}/start` | `STUDENT` | None | `StudentAttemptStart` | Implemented | Calls `sp_start_quiz_attempt`; returns deadline, questions, and prior responses |
| 54 | `GET` | `/api/v1/student/attempts/{attempt_id}` | `STUDENT` | None | `StudentAttemptRead` | Implemented | Reads deadline, elapsed status, and `time_remaining_seconds` |
| 55 | `GET` | `/api/v1/student/attempts/{attempt_id}/questions` | `STUDENT` | None | `list[StudentQuestion]` | Implemented | Full sequence, question text, options (correct answers omitted) |
| 56 | `GET` | `/api/v1/student/attempts/{attempt_id}/responses` | `STUDENT` | None | `list[StudentSavedResponse]` | Implemented | Retrieves all responses saved to date (for reconnect recovery) |
| 57 | `POST` | `/api/v1/student/attempts/{attempt_id}/responses` | `STUDENT` | `StudentResponseSaveRequest` | `StudentResponseSaveResult` | Implemented | Monotonic autosave (`ACCEPTED`, `IDEMPOTENT_RETRY`, `VERSION_CONFLICT`) |
| 58 | `POST` | `/api/v1/student/attempts/{attempt_id}/submit` | `STUDENT` | None | `StudentAttemptFinalized` | Implemented | Finalizes attempt via `sp_finalize_attempt`; returns score if released |
| 59 | `GET` | `/api/v1/student/attempts/{attempt_id}/result` | `STUDENT` | None | `StudentAttemptResult` | Implemented | Returns score and breakdown IF released; returns withheld notice otherwise |

### 2.7 Live WebSocket Channels (`/api/v1/ws/sessions`, 2 routes)
| # | Protocol | Path | Required Role | Handshake Authentication | Transmitted Events | Status |
|---|---|---|---|---|---|---|
| 60 | `WS` | `/api/v1/ws/sessions/{session_id}/monitor` | `FACULTY`, `ADMIN` | First JSON frame: `{"action": "AUTH", "ticket": "..."}` within 5.0 s (or query `ticket`) | **S→C:** `MONITOR_SYNC_STATE`, `STUDENT_PRESENCE_UPDATED`, `ATTEMPT_STATUS_CHANGED`, `STUDENT_PROGRESS_UPDATED`, `SESSION_STATUS_CHANGED`, `PONG`<br>**C→S:** `AUTH`, `PING`, `REQUEST_SYNC` | Implemented |
| 61 | `WS` | `/api/v1/ws/sessions/{session_id}/student` | `STUDENT` | First JSON frame: `{"action": "AUTH", "ticket": "..."}` within 5.0 s (or query `ticket`) | **S→C:** `SESSION_STATUS_CHANGED`, `PONG`<br>**C→S:** `AUTH`, `PING` | Implemented |

---

## 3. Verified Backend Authentication & Transport Mechanics

Direct verification of `app/core/security.py`, `app/api/deps.py`, `app/services/auth_service.py`, and `app/main.py` establishes the following code-level facts:

### 3.1 Token Issuance & Format
- **Signing Algorithm:** HMAC-SHA256 (`HS256`) via `jwt.encode()` using `settings.jwt_secret_key`.
- **Access Token:**
  - Standard lifetime: **15 minutes** (`expires_in: 900`).
  - Claims: `sub` (User UUID), `college_id` (College UUID), `roles` (list of strings), `token_version` (integer), `token_type: "access"`, `iss: "campusquiz"`, `aud: "campusquiz_api"`, `iat`, `exp`.
- **Refresh Token:**
  - Standard lifetime: **7 days** (`timedelta(days=7)`).
  - Claims: `sub`, `college_id`, `token_version`, `token_type: "refresh"`, `iss`, `aud`, `iat`, `exp`.
  - *Note:* The refresh token intentionally does **not** carry `roles`.
- **WebSocket Ticket:**
  - Strict maximum lifetime: **60 seconds** (`expires_in: 60`).
  - Claims: `sub`, `college_id`, `roles`, `token_version`, `token_type: "ws_ticket"`, `session_id` (optional), `jti` (unique UUID), `iss`, `aud`, `iat`, `exp`.

### 3.2 Token Transport & Validation
- **Protected REST Requests:** The client must supply the access token in the standard HTTP header:
  ```http
  Authorization: Bearer <access_token>
  ```
- **Validation Pipeline:**
  1. `bearer_scheme = HTTPBearer(auto_error=False)` in `app/api/deps.py` extracts credentials.
  2. `get_access_token_payload()` verifies scheme is `"bearer"` and decodes the JWT using `decode_token(..., expected_type="access")`.
  3. `get_current_actor()` queries the database:
     ```sql
     SELECT id, college_id, email, first_name, last_name, is_active, must_change_password, token_version
     FROM users WHERE id = :user_id
     ```
  4. If `token_version` does not match the database value, or `is_active` is `FALSE`, or `college_id` does not match, a 401 Unauthorized is raised immediately.
- **Refresh Flow:**
  - Client sends `POST /api/v1/auth/refresh` with JSON body: `{"refresh_token": "<token>"}`.
  - Server decodes token, confirms `token_type="refresh"`, verifies current DB `token_version`, queries user roles from `user_roles`, and returns a new `TokenResponse`.
- **Logout Flow:**
  - Client sends `POST /api/v1/auth/logout` with JSON body: `{"refresh_token": "<token>"}`.
  - Server runs an atomic database update:
    ```sql
    UPDATE users SET token_version = token_version + 1
    WHERE id = :user_id AND college_id = :college_id AND token_version = :token_version AND is_active = TRUE
    ```
  - This immediately revokes all issued access, refresh, and ticket tokens associated with that user version.

### 3.3 Cookie Behavior
> [!IMPORTANT]
> **Zero cookie support exists in the current backend.**
> - `Set-Cookie` is never emitted by any endpoint.
> - `Request.cookies` is never read by `deps.py` or `auth_service.py`.
> - No session cookies, CSRF cookies, or cookie attributes (`HttpOnly`, `SameSite`, `Secure`) exist in the application code.

### 3.4 CORS Behavior
> [!WARNING]
> **Zero CORS middleware is mounted in `app/main.py`.**
> - `create_app()` instantiates FastAPI without `CORSMiddleware`.
> - Direct cross-origin browser requests (e.g. from Vite on `http://localhost:5173` to FastAPI on `http://localhost:8000`) will fail browser preflight checks (OPTIONS requests will return 405 Method Not Allowed).

---

## 4. Architecture Evaluation: Integrating Frontend with Bearer Auth

We evaluate the two viable architectural approaches for bridging the current backend with a modern browser frontend.

### 4.1 Comparative Evaluation

| Evaluation Criteria | Approach 1: In-Memory Access Token + Dev Proxy (Recommended) | Approach 2: Backend HttpOnly Cookie Refactor |
|---|---|---|
| **Backend Code Changes** | **Zero changes.** Backend remains untouched; historical tests and migrations 100% preserved. | **Requires modifying backend.** Must rewrite `auth.py`, `deps.py`, `main.py`, and update 20+ auth unit tests. |
| **XSS Protection** | **High.** Access token is kept in memory (React closure/state). Never written to `localStorage` or `sessionStorage`. Cannot be exfiltrated via passive storage scrapers. | **Maximum.** JavaScript cannot read `HttpOnly` cookies even if an XSS script executes. |
| **CSRF Vulnerability** | **Immune.** Browsers do not automatically attach `Authorization: Bearer` headers to cross-site requests. | **Vulnerable by default.** Browsers automatically send cookies on cross-site requests. Requires CSRF tokens (SameSite + Double-Submit cookie pattern). |
| **CORS Overhead** | **None in development.** Vite dev proxy makes API requests appear same-origin (`/api` -> `http://127.0.0.1:8000`). In production, served behind Nginx/Cloudflare on the same domain. | **Requires complex CORS setup.** Cross-origin cookies require explicit origin whitelisting, `Access-Control-Allow-Credentials: true`, and FastAPI `CORSMiddleware`. |
| **Page Reload (F5) Behavior** | In a pure in-memory setup, a hard page reload clears memory, requiring either a re-login or an in-memory session restoration step via proxy. | Page reload automatically sends the `HttpOnly` cookie; session survives transparently. |
| **Conformance with Project Rules** | **100% compliant.** Fully honors the strict constraint: *"Do not rewrite or refactor the existing backend"* and *"Do not introduce localStorage-based JWT storage"*. | **Violates Phase 10 constraints.** Modifying production auth code violates the scope of Phase 10. |

### 4.2 Recommended Architecture
**Approach 1 is strongly recommended for Phase 10:**
1. **Frontend Access Token:** Stored strictly in memory within an `AuthContext` React provider.
2. **Local Development Proxy:** Configure `vite.config.ts` to proxy `/api` and `/ws` to `http://127.0.0.1:8000`. This provides seamless same-origin behavior, eliminating CORS preflight errors without altering backend code.
3. **Session Restoration:** For Phase 10 development, the user authenticates via `/login`. The session remains active throughout SPA navigation.
4. **Production Path (Future Milestone):** If persistent sessions across browser restarts/reloads are required in production, document a focused enhancement to have `/auth/login` issue an `HttpOnly` cookie *strictly for the refresh token*, while keeping the access token in memory.

---

## 5. Verified Data Flows & Exact Contracts

### 5.1 Quiz Preview Data Flow
A critical finding from inspecting `app/schemas/authoring.py`:
- `GET /api/v1/quizzes/{quiz_id}` returns `QuizRead`:
  ```json
  {
    "id": "uuid",
    "title": "Data Structures Midterm",
    "total_marks": "50.0000",
    "questions": [
      {
        "question_id": "uuid-1",
        "sequence_order": 1,
        "marks_override": null,
        "negative_marking_enabled_override": null,
        "negative_penalty_override": null
      }
    ]
  }
  ```
  `QuizQuestionRead` contains **only question IDs, sequence orders, and mark overrides**. It does **not** contain the question text, difficulty, question type, or option choices.

**Exact Requests Required for a Complete Quiz Preview:**
1. **Request 1:** `GET /api/v1/quizzes/{quiz_id}` — Retrieves quiz metadata and ordered list of question IDs.
2. **Request 2:** `GET /api/v1/questions?subject_id={subject_id}` — Retrieves the full question bank records for that subject (up to `limit=500`). The frontend matches `question_id` to render the question text, type, and option choices.
3. **Alternative Request (if question not in current subject list):** `GET /api/v1/questions/{question_id}` — Fetches individual question records in parallel.

*Least-Privilege Note:* In `QuestionRead`, `options` contains `id`, `option_text`, and `display_order`. It **never** reveals `is_correct` flags to client endpoints, preserving academic integrity.

### 5.2 Result Endpoints & Withheld Response Shapes
Both student and faculty result endpoints were verified:

#### A. Student Result Endpoint (`GET /api/v1/student/attempts/{attempt_id}/result`)
- **When Results Are Withheld** (e.g. session active, or visibility configured as `AFTER_SESSION_ENDS` or `UPON_FACULTY_RELEASE` before faculty release):
  ```json
  {
    "attempt_id": "8481358c-6e6b-4e69-8db3-8f0a5be7c001",
    "status": "SUBMITTED",
    "is_results_released": false,
    "total_score": null,
    "question_breakdown": null,
    "message": "Results are not yet released for this session."
  }
  ```
  *Crucial Frontend Requirement:* The student results page must handle `question_breakdown === null` cleanly, displaying a "Submission Confirmed — Results Pending Release" status card.
- **When Results Are Released:**
  ```json
  {
    "attempt_id": "8481358c-6e6b-4e69-8db3-8f0a5be7c001",
    "status": "SUBMITTED",
    "is_results_released": true,
    "total_score": "42.5000",
    "question_breakdown": [
      {
        "question_id": "uuid",
        "sequence_order": 1,
        "question_text": "What is the time complexity of binary search?",
        "question_type": "MCQ",
        "marks": "2.0000",
        "awarded_marks": "2.0000",
        "is_correct": true,
        "selected_option_ids": ["uuid-opt-2"],
        "explanation": "Binary search divides the array in half at each step.",
        "options": [
          {"option_id": "uuid-opt-1", "option_text": "O(n)", "display_order": 1, "is_correct": false},
          {"option_id": "uuid-opt-2", "option_text": "O(log n)", "display_order": 2, "is_correct": true}
        ]
      }
    ],
    "message": "Results retrieved successfully"
  }
  ```

#### B. Faculty Results Endpoints
- `GET /api/v1/sessions/{session_id}/results`: Returns `SessionResultsSummary` with aggregate statistics (`total_attempts`, `finalized_attempts`, `average_score`, `highest_score`, `lowest_score`) and a list of all student attempts. **Faculty can always view scores regardless of student release status.**
- `GET /api/v1/sessions/{session_id}/attempts/{attempt_id}/result`: Faculty inspection endpoint that returns the complete student breakdown.
- `POST /api/v1/sessions/{session_id}/results/release`: Explicitly sets `results_released_at = NOW()` and unwithholds scores for all students in the session.

---

## 6. Verified Real-Time WebSocket Protocols

### 6.1 Teacher Live Monitoring (`/api/v1/ws/sessions/{id}/monitor`)
1. **Ticket Request:** Frontend calls `POST /api/v1/auth/ws-ticket` with `{ "session_id": "<id>" }` using Bearer auth; receives single-use 60s ticket.
2. **Clean URL Connection:** Connects to `ws://localhost:8000/api/v1/ws/sessions/{id}/monitor` (no query string ticket).
3. **First-Frame Authentication:** Within 5.0 seconds of socket connection, sends:
   ```json
   {"action": "AUTH", "ticket": "<ticket_jwt>"}
   ```
4. **Authoritative Initial Sync:** Server responds with `MONITOR_SYNC_STATE`:
   ```json
   {
     "event": "MONITOR_SYNC_STATE",
     "session_id": "uuid",
     "timestamp": "2026-11-04T18:00:00Z",
     "data": {
       "session_id": "uuid",
       "session_status": "ACTIVE",
       "total_enrolled": 45,
       "connected_students_count": 42,
       "summary": {"not_started": 3, "in_progress": 38, "submitted": 4, "timed_out": 0},
       "participants": [
         {
           "student_user_id": "uuid",
           "student_name": "Jane Doe",
           "roll_number": "CS-101",
           "attempt_status": "IN_PROGRESS",
           "is_connected": true,
           "answered_count": 14,
           "total_questions": 20,
           "time_remaining_seconds": 1240
         }
       ]
     }
   }
   ```
5. **Real-Time Stream:** Receives `STUDENT_PRESENCE_UPDATED`, `ATTEMPT_STATUS_CHANGED`, and `STUDENT_PROGRESS_UPDATED` as students save answers or disconnect.
6. **Reconnection & Sync Fallback:** Client can trigger an on-demand full sync at any time by sending `{"event": "REQUEST_SYNC"}`. Server also emits periodic sync every 30 seconds.

### 6.2 Student Signal Channel (`/api/v1/ws/sessions/{id}/student`)
1. Connects with first-frame `AUTH` ticket.
2. Tracks student online presence (supports multiple browser tabs per student; only marks disconnected when the last socket closes).
3. Receives `SESSION_STATUS_CHANGED` events (`ACTIVE`, `PAUSED`, `COMPLETED`, `CANCELLED`) to dynamically lock/unlock the quiz attempt interface.

---

## 7. Proposed Frontend Architecture (Phase 10B Implementation Plan)

### 7.1 Directory Layout
```
frontend/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts                   # Proxies /api and /ws to backend
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── main.tsx
    ├── App.tsx                      # Root layout, AuthProvider, Router
    ├── api/
    │   ├── client.ts                # Axios/Fetch client injecting Authorization header
    │   ├── authApi.ts               # Login, refresh, logout, me, ws-ticket
    │   ├── adminApi.ts              # College, academic structures, faculty/student CRUD
    │   ├── authoringApi.ts          # Questions, quizzes, assembly
    │   ├── lifecycleApi.ts          # Sessions, lifecycle actions, results release
    │   └── studentApi.ts            # Discovery, lobby, attempt engine, autosave
    ├── context/
    │   ├── AuthContext.tsx          # Current user, active role, in-memory tokens
    │   └── WebSocketContext.tsx     # Reconnection management and ticket provisioning
    ├── hooks/
    │   ├── useAuth.ts
    │   ├── useSessionMonitorWS.ts   # Live teacher monitoring hook
    │   ├── useStudentSessionWS.ts   # Student lifecycle signal hook
    │   ├── useAutosave.ts           # Debounced monotonic response autosave
    │   └── useServerTimer.ts        # Drift-compensated authoritative quiz countdown
    ├── components/
    │   ├── common/                  # Buttons, Modals, Inputs, Cards, Spinners, Badges
    │   ├── layout/                  # AdminLayout, FacultyLayout, StudentLayout
    │   ├── auth/                    # ProtectedRoute, RoleSwitcher
    │   ├── quiz/                    # QuestionCard, QuestionPalette, TimerDisplay
    │   └── monitor/                 # LiveParticipantTable, MetricCardGroup, LiveControls
    ├── pages/
    │   ├── auth/                    # LoginPage, ForbiddenPage
    │   ├── admin/                   # Dashboard, AcademicStructures, Faculty, Students
    │   ├── faculty/                 # Dashboard, QuestionBank, QuizAuthoring, LiveMonitor, Results
    │   └── student/                 # Discovery, Lobby, Attempt, Result
    ├── types/                       # Exact TypeScript types mirrored from backend schemas
    └── utils/                       # Date/duration formatters, score calculations
```

### 7.2 Core UI Flow & Role Matrix
- **Login (`/login`):** Validates credentials against `POST /api/v1/auth/login`. If the returned user has multiple roles (e.g. `["FACULTY", "ADMIN"]`), presents a role selection prompt ("Admin Portal" vs "Faculty Studio").
- **Admin Portal (`/admin/*`):** Full CRUD for academic years, departments, classes, subjects, faculty profiles, and student profiles.
- **Faculty Studio (`/faculty/*`):** Question authoring, quiz assembly, session scheduling, real-time WebSocket live monitoring, and results release.
- **Student Portal (`/student/*`):** Session discovery, short-code lobby join, live waiting room, real-time attempt engine with autosave, and score/explanation view.

---

## 8. Unresolved Risks & Action Items

| Item | Nature | Current State | Required Action / Mitigation |
|---|---|---|---|
| **CORS** | Infrastructure | Not configured in `app/main.py`. | Use Vite development server reverse proxy (`vite.config.ts`) for dev. Add FastAPI `CORSMiddleware` in production deployment settings. |
| **HttpOnly Cookies** | Security / Transport | Backend currently uses header Bearer tokens only. | Keep access tokens strictly in React memory (no localStorage). Document future backend refresh-cookie enhancement for production. |
| **WebSocket Reconnection Tickets** | Reliability | Tickets are single-use and expire in 60s. | Frontend reconnect logic must request a fresh ticket via `POST /api/v1/auth/ws-ticket` prior to every reconnect attempt. |
| **Quiz Preview Question Hydration** | API Contract | `QuizRead` returns question IDs only. | Frontend quiz authoring module must batch-fetch questions from `/api/v1/questions` to render full question text and choices. |
| **Client Timer Drift** | Integrity | Student local machine clocks may drift. | Frontend countdown timer must synchronize against the server `deadline` and `server_received_at` timestamp. |

---

## 9. Implementation Roadmap for Phases 10B–10G

1. **Phase 10B:** Frontend Tooling, Vite Setup, Tailwind CSS, Typed API Client, and Auth Context.
2. **Phase 10C:** Institutional Administration Portal (Academic structures & profile CRUD).
3. **Phase 10D:** Faculty Question Bank, Option Replacement & Quiz Authoring.
4. **Phase 10E:** Session Scheduling, Lifecycle Controls & Teacher Live WebSocket Monitor.
5. **Phase 10F:** Student Experience (Discovery, Waiting Lobby, Live Quiz Attempt & Monotonic Autosave).
6. **Phase 10G:** Results, Analytical Charts (Recharts), and End-to-End Integration Verification.
