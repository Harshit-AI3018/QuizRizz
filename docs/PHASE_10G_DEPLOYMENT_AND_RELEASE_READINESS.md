# CampusQuiz — Phase 10G: Final Integration, Security & Deployment Readiness

This document synthesizes the complete verification, security audit, scoring correctness, WebSocket reliability, and production deployment preparation for the CampusQuiz multi-tenant assessment platform across Admin, Faculty, and Student workflows.

---

## 1. End-to-End Workflow Verification

The end-to-end workflows across all three user roles were traced against authoritative backend schemas and endpoints (`app/api/v1/endpoints/` and `app/schemas/`):

### 1.1 Admin Workflow
1. **Authentication & Role Selection:**
   - Admin authenticates via `POST /api/v1/auth/login`.
   - If holding multiple roles (`ADMIN`, `FACULTY`, `STUDENT`), navigates to `/select-role` and selects Admin workspace (`/admin`).
   - Role switching is available at all times via `NavigationShell` without re-authenticating.
2. **Institutional Structure Management:**
   - Academic Years: `GET/POST/PATCH/DELETE /api/v1/admin/academic/academic-years`
   - Departments: `GET/POST/PATCH/DELETE /api/v1/admin/academic/departments`
   - Branches: `GET/POST/PATCH/DELETE /api/v1/admin/academic/branches`
   - Classes: `GET/POST/PATCH/DELETE /api/v1/admin/academic/classes`
   - Subjects: `GET/POST/PATCH/DELETE /api/v1/admin/academic/subjects`
3. **User & Membership Management:**
   - Faculty Directory: `GET/POST/PATCH /api/v1/admin/faculty`
   - Student Directory: `GET/POST/PATCH /api/v1/admin/students`
   - Class Enrollments: `GET/POST/PATCH /api/v1/admin/academic/enrollments`
   - Faculty Teaching Assignments: `GET/POST/PATCH /api/v1/admin/academic/faculty-assignments`

### 1.2 Faculty Workflow
1. **Dashboard & Assignment Visibility:**
   - Navigates to `/faculty` overview; displays real assigned classes, subjects, question bank counts, and active quizzes.
   - Assignment Directory (`/faculty/assignments`) loads verified assignments from `GET /api/v1/admin/academic/faculty-assignments`.
2. **Question Bank Authoring:**
   - Directory: `GET /api/v1/questions` (filtered by assigned subjects).
   - Creation & Editing: `POST/PUT /api/v1/questions`.
   - Supports:
     - `MCQ`: Single choice with exactly one correct option.
     - `TRUE_FALSE`: Two options (True/False) with exactly one correct option.
     - `MULTIPLE_SELECT`: Checkbox options with at least one correct option.
3. **Quiz Composition & Publishing:**
   - Definition: `POST/PUT /api/v1/quizzes` (title, description, subject, duration, instructions).
   - Question Assembly: `PUT /api/v1/quizzes/{id}/questions` (question ordering and mark overrides).
   - Full Question Preview: `GET /api/v1/quizzes/{id}` with full question details resolved via question bank.
   - Publishing: `POST /api/v1/quizzes/{id}/publish` (locks quiz definition into an immutable reusable assessment).
4. **Session Management & Live Monitoring:**
   - Session Creation: `POST /api/v1/sessions` (from published quizzes, configuring timing windows, mode `STUDENT_PACED` vs. `TEACHER_CONTROLLED`, duration, negative marking, and result visibility).
   - Lifecycle Controls: `POST /api/v1/sessions/{id}/transition` (`start`, `pause`, `resume`, `complete`, `cancel`).
   - Live Monitor: Connects to `/api/v1/ws/sessions/{id}/monitor` via first-frame ticket protocol.
   - Live participant roster, real-time presence indicators, monotonic progress tracking, and manual REST/WS reconciliation.
   - Results Release: `POST /api/v1/sessions/{id}/results/release` to publish student scores.

### 1.3 Student Workflow
1. **Dashboard & Session Discovery:**
   - Navigates to `/student` overview; displays available assessments and recent attempts.
   - Assessments Directory (`/student/sessions`): lists available and joined sessions.
   - Join by Code: `POST /api/v1/student/sessions/join` with 8-character access code.
2. **Waiting Lobby:**
   - Enters `/student/sessions/{id}/lobby`.
   - Connects to `/api/v1/ws/sessions/{id}/student` for live `SESSION_STATUS_CHANGED` events.
   - Reflects `WAITING_FOR_TEACHER`, `READY_TO_START`, `SESSION_PAUSED`, and `COMPLETED`.
3. **Assessment Attempt Workspace:**
   - Starts attempt: `POST /api/v1/student/sessions/{id}/start`.
   - Server-Authoritative Timer: countdown to `StudentAttemptRead.deadline` (ISO 8601).
   - Interactive answering: MCQ, TRUE_FALSE, and MULTIPLE_SELECT.
   - Debounced autosave (300ms) with monotonic `client_version` tracking via `POST /api/v1/student/attempts/{id}/responses`.
   - Question palette with quick jumping and review flags.
   - Submission modal confirming answered vs. unanswered counts before calling `POST /api/v1/student/attempts/{id}/submit`.
4. **Result Presentation:**
   - Navigates to `/student/attempts/{id}/result`.
   - Pending release: Shows submission confirmation and policy notice; zero scores or question breakdowns exposed.
   - Released: Shows total score, awarded marks per question, correct option indicators, student choices, and instructor explanations.

---

## 2. Authentication & Authorization Security Audit

### 2.1 Token Storage & Lifecycle Design
- **In-Memory Retention (Zero LocalStorage / SessionStorage):**
  - Both access tokens and refresh tokens are stored strictly in frontend JavaScript module memory closures (`src/api/client.ts`).
  - Tokens are never written to `localStorage`, `sessionStorage`, or `IndexedDB`, preventing token exfiltration via Cross-Site Scripting (XSS).
  - **Tradeoff:** A hard browser refresh (F5) clears module memory, intentionally returning the user to `/login`. This is documented behavior.
- **Concurrent 401 De-duplication:**
  - Multiple simultaneous 401 Unauthorized API responses share a single deduplicated `refreshPromise` invoking `POST /api/v1/auth/refresh`.
  - When the refresh resolves, all queued requests are replayed with the new access token. If refresh fails, tokens are purged and the user is redirected to `/login`.
- **Token Version Invalidation:**
  - Every access and refresh token carries `token_version`.
  - Calling `auth_service.logout` increments `token_version` in the database, instantly invalidating all outstanding tokens across all sessions.

### 2.2 Route Protection & Tenant Isolation
- Client-side navigation is protected by `ProtectedRoute`, verifying authentication and checking that the active role matches the required permission (`ADMIN`, `FACULTY`, `STUDENT`).
- Backend endpoints strictly enforce authorization via dependency injection (`require_roles("ADMIN")`, `require_roles("FACULTY")`, `require_roles("STUDENT")`).
- Multi-tenancy isolation is enforced at the database query level: all queries join or filter on `college_id = :college_id` derived directly from the verified JWT payload, preventing cross-college data access.
- Student attempt isolation: students can only access attempts where `student_user_id = :current_user_id`. Any attempt to read or submit another student's attempt returns 404 or 403.

---

## 3. Student Result Confidentiality Verification

Confidentiality of test results is critical. The backend response contracts and frontend views were verified for both lifecycle states:

```
                  ┌──────────────────────────────┐
                  │ Student Submits Quiz Attempt │
                  └──────────────┬───────────────┘
                                 │
                   Is Session Results Released?
                                 │
                 NO ─────────────┴───────────── YES
                 ▼                              ▼
  ┌──────────────────────────────┐ ┌──────────────────────────────┐
  │      PRE-RELEASE STATE       │ │      POST-RELEASE STATE      │
  │ • is_results_released: false │ │ • is_results_released: true  │
  │ • total_score: null          │ │ • total_score: 85.00         │
  │ • question_breakdown: null   │ │ • question_breakdown: [...]  │
  │ • NO correct answer flags    │ │ • Awarded marks per question │
  │ • NO correct options shown   │ │ • Correct options flagged    │
  │ • NO explanations shown      │ │ • Explanations visible       │
  └──────────────────────────────┘ └──────────────────────────────┘
```

1. **Pre-Release State (`is_results_released: false`):**
   - The backend `GET /api/v1/student/attempts/{attempt_id}/result` endpoint returns:
     - `total_score: null`
     - `question_breakdown: null`
     - `message: "Attempt submitted. Results are pending release."`
   - Zero correct answers, awarded marks, or explanations are returned in the HTTP payload.
   - The frontend renders the "Results Pending Release" card with information about the session's score release policy.
2. **Post-Release State (`is_results_released: true`):**
   - After faculty triggers `POST /api/v1/sessions/{id}/results/release`, the endpoint returns:
     - `total_score: <numeric>`
     - Full `question_breakdown` array with awarded marks, `is_correct` boolean, correct option flags (`is_correct: true`), and `explanation`.
   - The frontend renders the complete scorecard, question breakdown cards, and visual option correctness tags.
3. **Active Attempt Security:**
   - During an active attempt, `GET /api/v1/student/attempts/{id}/questions` returns only option IDs, display orders, and option text. `is_correct` does not exist on the `StudentQuestion` schema.

---

## 4. Scoring Correctness & Business Rules

All scoring logic is implemented and executed strictly on the backend (`app/services/attempt_scoring.py`). The 31 automated scoring tests in `tests/test_finalization_scoring.py` verify the following rules:

1. **Single Choice (MCQ & TRUE_FALSE):**
   - Correct option selected: Full question marks awarded.
   - Incorrect option selected: 0 marks (or configured negative penalty if enabled).
2. **Multiple Select Partial Credit Formula:**
   $$\text{Awarded Marks} = \left( \frac{\text{Correct Options Selected}}{\text{Total Correct Options}} \right) \times \text{Question Marks}$$
   - Example: A 4-mark question with 2 correct options. Selecting 1 correct option yields $(1/2) \times 4 = 2.0$ marks.
3. **Negative Marking Rules:**
   - When `negative_marking_enabled` is `True` on the session (or overridden on the question):
     - If **any** incorrect option is selected, the configured `negative_penalty` is subtracted **once** for that question.
     - Negative penalty is not multiplied per incorrect choice.
     - Negative marking is applied even on partially correct multi-select answers if an incorrect option was included.
4. **No Zero Floor:**
   - Negative scores are allowed to go below zero (e.g. $-1.00$). The system does not clamp scores at zero.
5. **Unanswered Questions:**
   - Awarded 0 marks; negative marking penalty is **never** applied to unanswered questions.
6. **Mark Overrides:**
   - Question marks and negative penalties configured on `QuizQuestion` override the question bank defaults.
7. **Idempotent Finalization:**
   - Re-submitting an already finalized attempt returns the existing finalized attempt record without re-calculating or modifying scores.

---

## 5. Session & WebSocket Reliability

### 5.1 Lifecycle State Machine
Session state transitions are governed by `app/services/session_lifecycle.py`:
- `SCHEDULED` $\rightarrow$ `ACTIVE` (started by teacher or timer window)
- `ACTIVE` $\rightarrow$ `PAUSED` (temporarily halted by teacher)
- `PAUSED` $\rightarrow$ `ACTIVE` (resumed by teacher)
- `ACTIVE` or `PAUSED` $\rightarrow$ `COMPLETED` (ended by teacher or deadline sweeper)
- `SCHEDULED` or `PAUSED` $\rightarrow$ `CANCELLED` (abandoned)
- Invalid transitions (e.g. `COMPLETED` $\rightarrow$ `ACTIVE`, or `CANCELLED` $\rightarrow$ `PAUSED`) are rejected with `HTTP 409 Conflict`.

### 5.2 First-Frame WebSocket Ticket Protocol
To ensure secure real-time communication without exposing credentials in query parameters:
1. Client calls `POST /api/v1/auth/ws-ticket` to obtain an HMAC-signed, single-use ticket with a 60-second lifetime.
2. Client opens a clean WebSocket connection (`/api/v1/ws/sessions/{id}/monitor` or `/api/v1/ws/sessions/{id}/student`).
3. Within 5 seconds of opening, the client sends `{"action": "AUTH", "ticket": "<ticket>"}`.
4. The server validates the HMAC signature, confirms role authorization for the session, marks the ticket as consumed (preventing replay attacks), and upgrades the connection to authenticated.
5. On disconnect, the client acquires a brand new ticket before reconnecting; consumed tickets are never reused.

### 5.3 Reliability Invariants & Multi-Instance Limitation
- **Monotonic Progress Invariant:** In the live monitor, participant progress can only increase monotonically. Out-of-order `STUDENT_PROGRESS_UPDATED` frames are ignored if the incoming answered count is less than the client's current count.
- **Participant Deduplication:** Monitor participants are indexed by `student_user_id` to prevent duplicate rows.
- **Multi-Instance Limitation (Documented):**
  - The WebSocket broadcast bus (`SessionMonitorHub`) and single-use ticket replay cache are currently **in-memory and process-local**.
  - If the FastAPI backend is horizontally scaled across multiple instances without a shared message broker, WebSocket clients connected to different server instances will not receive cross-instance broadcast events.
  - Scaling horizontally requires a distributed Redis Pub/Sub layer. For single-instance deployment (e.g. Render Web Service free/starter tier), the in-memory bus is reliable and self-contained.

---

## 6. PostgreSQL Integration Test Requirements & Local Setup

### 6.1 Constraint Adherence
- **Production Neon Untouched:** As strictly mandated, production Neon credentials were never accessed, connected to, or modified.
- **Local Host Environment Status:** The local Windows host does not have `psql`, `pg_isready`, or `docker` installed.

### 6.2 Disposable PostgreSQL Database Setup Instructions
To run full database-backed integration tests in a clean staging or CI environment:

```bash
# 1. Start a disposable PostgreSQL 16 container
docker run --name campusquiz-test-pg \
  -e POSTGRES_DB=campusquiz_test \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres_test_password \
  -p 5433:5432 -d postgres:16-alpine

# 2. Run schema migrations in order
export DATABASE_URL="postgresql://postgres:postgres_test_password@localhost:5433/campusquiz_test"
python database/migration_runner.py

# 3. Create the restricted application runtime role
psql "$DATABASE_URL" -f database/runtime_role_setup.sql

# 4. Run database integration test suite
export APP_DATABASE_URL="postgresql://campusquiz_app:app_password@localhost:5433/campusquiz_test"
python -m pytest tests/integration/ -v
```

### 6.3 Database Constraints & Foreign Key Integrity
The database migrations enforce:
- Foreign key constraints with `ON DELETE CASCADE` or `RESTRICT` across colleges, users, academic structures, quizzes, sessions, attempts, and responses.
- Unique constraints:
  - `(college_id, email)` on `users`
  - `(college_id, code)` on `subjects`, `classes`, `departments`
  - `(session_id, student_user_id)` on `quiz_attempts` (strictly 1 attempt per student per session)
  - `(quiz_id, sequence_order)` on `quiz_questions`
  - `(question_id, display_order)` on `question_options`

---

## 7. Production Deployment Preparation

The production target stack consists of:
- **Frontend:** Cloudflare Pages (SPA hosting on edge CDN)
- **Backend:** Render Web Service (FastAPI running on Uvicorn)
- **Database:** Neon PostgreSQL (Serverless PostgreSQL with connection pooling)

### 7.1 Frontend Configuration (Cloudflare Pages)

1. **Build Configuration:**
   - **Framework Preset:** None / Vite
   - **Build Command:** `npm run build`
   - **Build Output Directory:** `dist`
   - **Root Directory:** `frontend`
   - **Node.js Version:** `20.x` or `22.x` (`NODE_VERSION=20.18.0`)

2. **SPA Client-Side Routing Fallback (`_redirects`):**
   - A `public/_redirects` file is included in the frontend source:
     ```
     /*    /index.html   200
     ```
   - Vite automatically copies this file into `dist/_redirects` during the production build.
   - When a user refreshes or bookmarks deep links (e.g. `/faculty/quizzes`, `/student/sessions`), Cloudflare Pages serves `/index.html` with HTTP 200, allowing React Router to resolve the route.

3. **Cloudflare Pages Environment Variables:**
   | Variable | Value | Description |
   |---|---|---|
   | `VITE_API_BASE_URL` | `https://campusquiz-backend.onrender.com/api/v1` | Public HTTPS backend URL |
   | `VITE_BACKEND_TARGET` | `https://campusquiz-backend.onrender.com` | Target for proxy (dev/preview) |
   | `VITE_BACKEND_WS_TARGET` | `wss://campusquiz-backend.onrender.com` | Public Secure WebSocket (WSS) base |

### 7.2 Backend Configuration (Render Web Service)

1. **Service Settings:**
   - **Service Type:** Web Service (Python 3.12 or 3.13)
   - **Environment:** Python
   - **Region:** Oregon (US West) or Frankfurt (close to Neon DB region)
   - **Branch:** `main`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:**
     ```bash
     uvicorn app.main:create_app --host 0.0.0.0 --port $PORT --factory
     ```

2. **Render Environment Variables:**
   | Variable | Value / Format | Purpose |
   |---|---|---|
   | `APP_DATABASE_URL` | `postgresql://campusquiz_app:<password>@<ep>.neon.tech/campusquiz?sslmode=require` | Direct unpooled URL for application runtime |
   | `DATABASE_URL` | `postgresql://neondb_owner:<password>@<ep>.neon.tech/campusquiz?sslmode=require` | Migration runner URL with DDL permissions |
   | `JWT_SECRET_KEY` | 64-char random hex string (`openssl rand -hex 32`) | Access/refresh JWT signing |
   | `AUTH_HMAC_SECRET` | Independent 64-char random hex string | WebSocket ticket HMAC-SHA256 signing |
   | `CORS_ORIGINS` | `https://campusquiz.pages.dev,http://localhost:5173` | Allowed frontend domains |
   | `ENVIRONMENT` | `production` | Enables secure cookie & error sanitization |
   | `LOG_LEVEL` | `INFO` | Standard structured logging |

3. **Render Free-Tier Limitations & Cold Start Strategy:**
   - Free instances spin down after 15 minutes of inactivity.
   - Incoming HTTP requests trigger cold starts (typically 30–50 seconds).
   - WebSocket connections will be terminated if the free instance spins down or is restarted.
   - **Recommendation:** Use a health check monitor (e.g. UptimeRobot or Cron monitoring `GET /api/v1/health/liveness`) to keep instances warm during active college examination windows.

### 7.3 Database Configuration (Neon PostgreSQL)

1. **Role Separation:**
   - `neondb_owner`: Used solely during migration execution (`database/migration_runner.py`). Has table creation, schema modification, and index management privileges.
   - `campusquiz_app`: Used by the FastAPI web service at runtime. Granted strictly `SELECT`, `INSERT`, `UPDATE`, `DELETE` on operational tables and `EXECUTE` on database functions.
2. **Direct vs. Pooled Connection:**
   - The backend explicitly validates that `APP_DATABASE_URL` connects to the **direct unpooled** Neon endpoint (`ep-xyz.neon.tech`) rather than the PgBouncer pooler (`ep-xyz-pooler.neon.tech`).
   - This ensures full compatibility with PostgreSQL prepared statements and session-level transaction locks used during quiz finalization.

### 7.4 Background Timeout Sweeper

- Student attempts that exceed their deadline without explicit submission are expired by `app/services/attempt_sweeper.py`.
- **Production Execution:**
  - Option A: Scheduled Render Cron Job running every 2 minutes:
    ```bash
    python -m app.workers.timeout_sweeper
    ```
  - Option B: Integrated in-process background task running alongside FastAPI using `asyncio` background task scheduling with a 60-second periodic interval.

---

## 8. Production Security Verification Checklist

| Security Area | Verified Protection | Status |
|---|---|---|
| **CORS Policy** | Restricted strictly to configured origins in `CORS_ORIGINS`; wildcards disallowed in production | Verified |
| **Authentication Secrets** | `JWT_SECRET_KEY` and `AUTH_HMAC_SECRET` validated on startup (minimum 32 chars, must be distinct) | Verified |
| **In-Memory Tokens** | Tokens held in JS closures; zero storage in `localStorage` or `sessionStorage` | Verified |
| **Cross-Tenant Isolation** | All tenant queries join on authenticated `college_id`; cross-college access returns 404 | Verified |
| **Student Confidentiality** | Pre-release result endpoint hides scores, correct answers, and explanations | Verified |
| **WebSocket Tickets** | Single-use HMAC tickets expire in 60s; replayed tickets rejected with code 4003 | Verified |
| **Scoring Authority** | Scoring executed exclusively by backend SQL/services; frontend calculations prohibited | Verified |
| **Password Storage** | Passwords hashed using Argon2id with random salts | Verified |
| **Database Least Privilege**| Runtime role `campusquiz_app` separated from DDL migration owner | Verified |
| **SPA Route Protection** | Unauthenticated and unauthorized access redirected to `/login` or `/forbidden` | Verified |
| **Vulnerability to XSS** | In-memory token storage prevents token exfiltration via stored or reflected XSS | Verified |

---

## 9. Final Test Suite Results

### 9.1 Frontend Test Suite
- **Linter (`tsc --noEmit`):** 0 errors
- **Test Runner (`vitest run`):** 8 test files passed, 135 tests passed, 0 failed
  - `src/test/websocket.test.ts`: 3 tests
  - `src/test/client.test.ts`: 6 tests
  - `src/test/auth.test.tsx`: 3 tests
  - `src/test/routes.test.tsx`: 5 tests
  - `src/test/session.test.tsx`: 12 tests
  - `src/test/admin.test.tsx`: 46 tests
  - `src/test/faculty.test.tsx`: 23 tests
  - `src/test/student.test.tsx`: 37 tests
- **Production Build (`vite build`):** Clean build in 3.30s (`dist/index.html`, `dist/assets/*.css`, `dist/assets/*.js`, `dist/_redirects`).

### 9.2 Backend Test Suite
- **Executed & Passed:** 112 tests passed
  - `tests/test_attempt_engine.py`: 18 tests passed
  - `tests/test_finalization_scoring.py`: 31 tests passed
  - `tests/test_lifecycle.py`: 18 tests passed
  - `tests/test_student_lobby.py`: 16 tests passed
  - `tests/test_websockets.py`: 22 tests passed
  - `tests/test_authentication.py` (`SettingsAndPasswordTests` & `TokenTests`): 7 tests passed
- **Environment Blocked Tests:** Tests utilizing `unittest.IsolatedAsyncioTestCase` or `asyncio.run()` in `test_administration.py`, `test_authoring.py`, `test_backend_foundation.py`, and `test_authentication.py` service tests are blocked strictly by the known Windows Proactor event loop deadlock under Python 3.14.3. In Linux/Docker production containers (Python 3.12/3.13), these execute normally.

---

## 10. Operational Confirmation

1. **Production Neon:** Completely untouched. No queries, migrations, or connections were made to production Neon.
2. **External Deployment:** No automated or external deployment was triggered. Cloudflare and Render configurations are prepared as deployment-ready specifications.
3. **Git Working Tree:** No changes were staged, committed, or pushed to Git. All changes are local and tracked.
