# CampusQuiz — Frontend (Phases 10B, 10C, 10D, 10E & 10F)

This is the frontend single-page application (SPA) for the CampusQuiz multi-tenant assessment platform.

## Technology Stack
- **Framework:** React 18 with TypeScript 5
- **Build Tool & Dev Server:** Vite 5
- **Routing:** React Router v6
- **Styling:** Tailwind CSS 3
- **Icons:** Lucide React
- **Testing:** Vitest 2 with React Testing Library and JSDOM

---

## Getting Started

### 1. Prerequisites
- Node.js v18+ (tested on Node v24.13)
- npm v9+

### 2. Installation
Navigate to the `frontend/` directory and install dependencies:
```bash
cd frontend
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Default variables:
- `VITE_API_BASE_URL`: Base path for API requests (default: `/api/v1`).
- `VITE_BACKEND_TARGET`: FastAPI backend server for Vite proxy (default: `http://127.0.0.1:8000`).
- `VITE_BACKEND_WS_TARGET`: FastAPI WebSocket server for Vite proxy (default: `ws://127.0.0.1:8000`).

### 4. Running the Development Server
Start the Vite development server with hot module replacement (HMR) and reverse proxy:
```bash
npm run dev
```
The application will be available at `http://localhost:5173`.
Vite automatically proxies `/api` and `/ws` requests to the FastAPI backend running on port 8000.

### 5. Running Tests, Typechecking & Build
```bash
# Run Vitest test suites
npm run test

# Typecheck TypeScript files
npm run lint

# Production build
npm run build
```

---

## Authentication & Security Architecture

### In-Memory Access Token Strategy
To strictly comply with security rules and prevent cross-site scripting (XSS) exfiltration via browser storage:
- **Zero LocalStorage / SessionStorage:** Neither access tokens nor refresh tokens are stored in `localStorage`, `sessionStorage`, or `IndexedDB`.
- **In-Memory Retention:** Tokens are held strictly in React memory closures (`client.ts`).
- **Concurrent 401 De-duplication:** When multiple API requests receive 401 Unauthorized simultaneously, they share a single `refreshPromise` to invoke `/api/v1/auth/refresh`. When the refresh resolves, all queued requests are retried with the new token.
- **Full Page Reload Limitation:** Because tokens are kept in memory without browser-accessible cookies, hard-reloading the browser (F5) clears the in-memory token state, returning the user to the `/login` screen.

### Multi-Role Handling & Role Switching
- A single user account may hold multiple roles (`ADMIN`, `FACULTY`, `STUDENT`).
- When a user with multiple roles signs in, they are presented with the `/select-role` page.
- Users can switch their active workspace at any time via the "Switch Role" button in the top navigation bar without logging out or re-authenticating.

---

## WebSocket Protocol & Reconnection

The real-time monitoring channels (`/api/v1/ws/sessions/{id}/monitor` and `/api/v1/ws/sessions/{id}/student`) implement first-frame ticket authentication:
1. Prior to connecting, the client fetches a 60-second single-use ticket from `POST /api/v1/auth/ws-ticket`.
2. The client connects to the clean WebSocket URL (no tickets in query strings).
3. Within 5 seconds of opening, the client sends `{"action": "AUTH", "ticket": "<ticket>"}`.
4. On unexpected disconnect, the client uses exponential backoff and **always obtains a fresh ticket** before reconnecting (consumed tickets are never reused).


---

## Phase 10C — Admin Dashboard

### Overview

Phase 10C delivers the fully functional Admin Dashboard, wired to real backend endpoints from `GET /api/v1/admin/...`. No mock data or placeholder statistics are used.

### Admin Pages

| Route | Page | Backend API |
|---|---|---|
| `/admin` | Overview Dashboard | `GET /admin/college`, `GET /admin/students`, `GET /admin/faculty`, `GET /admin/academic/*` |
| `/admin/academic-years` | Academic Year CRUD | `GET/POST/PATCH/DELETE /admin/academic/academic-years` |
| `/admin/departments` | Department CRUD | `GET/POST/PATCH/DELETE /admin/academic/departments` |
| `/admin/branches` | Branch CRUD | `GET/POST/PATCH/DELETE /admin/academic/branches` |
| `/admin/classes` | Class Section CRUD | `GET/POST/PATCH/DELETE /admin/academic/classes` |
| `/admin/subjects` | Subject CRUD | `GET/POST/PATCH/DELETE /admin/academic/subjects` |
| `/admin/faculty` | Faculty Management | `GET/POST/PATCH/DELETE /admin/faculty` |
| `/admin/students` | Student Management | `GET/POST/PATCH/DELETE /admin/students` |
| `/admin/assignments` | Faculty Assignment Management | `GET/POST/PATCH/DELETE /admin/academic/faculty-assignments` |
| `/admin/enrollments` | Student Enrollment Management | `GET/POST/PATCH/DELETE /admin/academic/enrollments` |
| `/admin/college` | College Settings | `GET/PATCH /admin/college` |

### Key Design Decisions

- **Real data only** — All dashboard metrics come directly from the API. If an endpoint fails, the specific metric shows "Unavailable" rather than a fabricated value.
- **Promise.allSettled** — The overview page fetches all metrics in parallel; individual failures do not block the rest of the page from rendering.
- **Search & Filtering** — All list pages support client-side text search. Faculty Assignments and Enrollments also support dropdown filters by Academic Year and Subject/Class.
- **Active/Inactive Toggle** — Faculty assignments and student enrollments support `PATCH is_active` toggling without requiring deletion and recreation.
- **Enrollment Types** — Student enrollments distinguish `CORE` and `ELECTIVE` types, surfaced as colour-coded badges.
- **Cascading Dropdowns** — Class sections are populated from the Classes API; Branch dropdown depends on Department selection; Subjects require a parent Department.
- **Deactivation vs. Hard Delete** — Faculty and Student accounts use a soft-deactivate pattern (`DELETE /admin/faculty/{id}` backend behaviour). Assignments and enrollments support both PATCH toggle and hard DELETE.

### TypeScript Interfaces

Admin-domain interfaces are colocated in [`frontend/src/types/admin.ts`](src/types/admin.ts):

- `College`, `CollegeUpdate`
- `AcademicYear`, `AcademicYearCreate`, `AcademicYearUpdate`
- `Department`, `DepartmentCreate`, `DepartmentUpdate`
- `Branch`, `BranchCreate`, `BranchUpdate`
- `ClassEntity`, `ClassCreate`, `ClassUpdate`
- `Subject`, `SubjectCreate`, `SubjectUpdate`
- `FacultyProfile`, `FacultyCreate`, `FacultyUpdate`
- `StudentProfile`, `StudentCreate`, `StudentUpdate`
- `FacultyAssignment`, `FacultyAssignmentCreate`, `FacultyAssignmentUpdate`
- `StudentEnrollment`, `EnrollmentCreate`, `EnrollmentUpdate`

### Admin API Module

All admin API calls are centralised in [`frontend/src/api/adminApi.ts`](src/api/adminApi.ts). Every method is fully typed, returning the same interface shapes defined in `admin.ts`.

### Admin Layout

[`AdminLayout.tsx`](src/components/layout/AdminLayout.tsx) provides a sticky sidebar with NavLinks to all 11 admin sub-routes. It renders its children via React Router's `<Outlet />`, nested under the `/admin` parent route in `App.tsx`.

### Phase 10C Test Suite

Admin tests live in [`frontend/src/test/admin.test.tsx`](src/test/admin.test.tsx).

**Coverage:**
- `adminApi` module shape (all CRUD methods present)
- `AdminOverviewPage` — renders college name, counts, academic year from API; API error handling
- `AcademicYearsPage` — renders list, current badge, empty state, modal, error state
- `DepartmentsPage` — renders list, empty state, create flow
- `FacultyPage` — renders list, active badge, empty state, deactivation modal
- `StudentsPage` — renders list, search filter, empty state, deactivation confirmation
- `FacultyAssignmentsPage` — renders list, empty state, create modal, toggle active, create API call
- `EnrollmentsPage` — renders list, enrollment type badge, empty state, create modal, toggle active
- `CollegeSettingsPage` — renders settings form, tenant ID, active badge, save flow, error state

**Counts:** 46 admin tests + 17 Phase 10B tests = **63 total tests, all passing**.

---

## Phase 10D — Faculty Dashboard & Quiz Authoring

### Overview

Phase 10D delivers the complete Faculty Dashboard and Quiz Authoring workflows using real backend endpoints from `GET/POST/PATCH/PUT/DELETE /api/v1/questions` and `GET/POST/PATCH/PUT/DELETE /api/v1/quizzes`.

Faculty members can create and manage questions across all 3 backend question types (MCQ, TRUE_FALSE, MULTIPLE_SELECT), assemble reusable quizzes, configure mark schemes and overrides, preview assessments with hydrated question bodies, and publish quizzes.

### Faculty Pages & Routes

| Route | Page | Backend API Endpoint(s) | Description |
|---|---|---|---|
| `/faculty` | Overview Dashboard | `GET /questions`, `GET /quizzes` | Question bank summary, draft/published quiz statistics, recent activity, quick actions |
| `/faculty/assignments` | My Assignments | `GET /questions`, `GET /quizzes` | Shows active subject contexts and documents admin-managed assignment architecture |
| `/faculty/questions` | Question Bank | `GET/DELETE /questions` | Searchable/filterable question bank with type, difficulty, marks, and deactivation |
| `/faculty/questions/new` | Create Question | `POST /questions` | Dynamic option editors for MCQ, TRUE_FALSE, and MULTIPLE_SELECT formats |
| `/faculty/questions/:id/edit` | Edit Question | `GET/PATCH /questions/:id`, `PUT /questions/:id/options` | Atomic options replacement and question metadata update |
| `/faculty/quizzes` | My Quizzes | `GET/DELETE /quizzes` | Quizzes management, status filters (DRAFT, PUBLISHED, ARCHIVED), archive action |
| `/faculty/quizzes/new` | Create Quiz | `POST /quizzes` | Metadata configuration (duration, negative penalties, result visibility) |
| `/faculty/quizzes/:id/edit` | Edit Quiz | `GET/PATCH /quizzes/:id` | Quiz settings update with lock enforcement on published quizzes |
| `/faculty/quizzes/:id/build` | Question Builder | `GET /quizzes/:id`, `GET /questions`, `PUT /quizzes/:id/questions` | Sequence questions 1..N, configure mark overrides, add from question bank |
| `/faculty/quizzes/:id/preview` | Quiz Preview | `GET /quizzes/:id`, `GET /questions/:id` (parallel) | Hydrated preview rendering ordered questions, marks, and instructions |
| `/faculty/quizzes/:id/publish` | Publish Workflow | `GET /quizzes/:id`, `POST /quizzes/:id/publish` | Pre-publication validation, lock warning, and status transition to PUBLISHED |

### Key Architectural Findings & Documented Backend Gaps

1. **Option Correctness Exclusion (`QuestionOptionRead`):**
   - The backend `QuestionOptionRead` schema explicitly omits `is_correct` in read responses to prevent test leakage over candidate-facing channels.
   - When editing existing questions, faculty are presented with an advisory badge prompting verification of answer selections before saving options atomically via `PUT /questions/{id}/options`.

2. **Faculty Assignment Endpoint Gap:**
   - In the CampusQuiz backend, faculty-to-class assignments are registered exclusively through `/api/v1/admin/academic/faculty-assignments` which requires the `ADMIN` role.
   - No self-service `GET /api/v1/faculty/me/assignments` endpoint currently exists for faculty.
   - Rather than fabricating endpoints or calling unauthorized admin routes, the Faculty Assignments page cleanly explains this division of responsibilities and displays all Subject UUIDs derived from the faculty's active authoring work.

---

## Phase 10E — Session Management & Live Quiz Integration

### Overview

Phase 10E delivers faculty session lifecycle management, real-time lobby and attempt monitoring, and live WebSocket synchronization.

A **Quiz**, **Quiz Session**, and **Quiz Attempt** are strictly decoupled entities:
- **Quiz:** Reusable authoring blueprint (questions, options, points). Unaltered by session state changes.
- **Quiz Session:** Time-windowed instance of a quiz for a designated class, managed via an 8-character access code (`ALPHA123`).
- **Quiz Attempt:** A single student's candidate attempt under that session.

### Session Routes & APIs

| Route | Page | Backend API Endpoint(s) | Description |
|---|---|---|---|
| `/faculty/sessions` | Sessions List | `GET /sessions`, `POST /sessions/:id/:action` | Filterable session list with live/scheduled/paused status badges, duration, window times, and quick transition buttons |
| `/faculty/sessions/new` | Create Session | `GET /quizzes`, `POST /sessions` | Schedules a published quiz for a target class with timezone-aware start/end windows and overrides |
| `/faculty/sessions/:sessionId/monitor` | Live Monitor | `GET /sessions/:id`, `GET /sessions/:id/results`, `POST /sessions/:id/:action`, `POST /sessions/:id/results/release`, `WS /api/v1/ws/sessions/:id/monitor` | Real-time monitoring room with live participant table, presence indicators, monotonic progress bars, lifecycle controls, and post-session results reporting |

### Lifecycle State Machine & Transition Rules

The backend enforces strict legal transitions via stored procedures (`sp_activate_quiz_session`, `sp_pause_quiz_session`, `sp_resume_quiz_session`, `sp_complete_quiz_session`, `sp_cancel_quiz_session`):

```
         ┌───────────────┐
         │   SCHEDULED   │
         └──┬─────────┬──┘
    activate│         │cancel
            ▼         ▼
       ┌────────┐ ┌───────────┐
       │ ACTIVE │ │ CANCELLED │ (Terminal)
       └──┬──▲──┘ └───────────┘
     pause│  │resume
          ▼  │
       ┌────────┐
       │ PAUSED │
       └──┬─────┘
  complete│ (from ACTIVE or PAUSED)
          ▼
    ┌───────────┐
    │ COMPLETED │ (Terminal -> supports /results/release)
    └───────────┘
```

### Real-Time WebSocket Monitoring & Reliability

1. **First-Frame Ticket Protocol:**
   - Before connecting to `/api/v1/ws/sessions/{id}/monitor`, the client fetches a single-use 60-second ticket from `POST /api/v1/auth/ws-ticket`.
   - On connection open, the client sends `{"action": "AUTH", "ticket": "<ticket>"}`.
   - Tickets are never exposed in query parameters, browser URLs, or server logs.
   - On reconnect, exponential backoff is applied and a fresh ticket is requested each time.

2. **WebSocket Event Envelope:**
   - `MONITOR_SYNC_STATE`: Authoritative full synchronization from PostgreSQL delivered on connect, during periodic reconciliation (~30s), and on `REQUEST_SYNC`.
   - `SESSION_STATUS_CHANGED`: Live session state changes triggered by teacher controls or timeouts.
   - `STUDENT_PRESENCE_UPDATED`: Student online/offline status updates without modifying student attempts.
   - `ATTEMPT_STATUS_CHANGED`: Student start (`IN_PROGRESS`) and submission (`FINALIZED`).
   - `STUDENT_PROGRESS_UPDATED`: Monotonic answered count progress.

3. **Reconciliation & Progress Invariant:**
   - The frontend enforces a strictly monotonic progress invariant: a stale `STUDENT_PROGRESS_UPDATED` packet can never decrease an answered count.
   - Participants are indexed uniquely by `student_user_id` to prevent duplicate rows.
   - Manual sync button triggers `REQUEST_SYNC` frame and REST refresh.

---

## Phase 10F — Student Dashboard, Lobby & Attempt Workflow

### Overview

Phase 10F delivers the complete student experience for CampusQuiz, integrating with actual backend APIs for session discovery, joining by code, lobby status monitoring, synchronized quiz taking, real-time autosaving with concurrency control, manual submission, and result viewing gated by score release policies.

### Student Pages & Routes

| Route | Page | Backend API | Description |
|---|---|---|---|
| `/student` | Student Dashboard | `GET /student/sessions`, `GET /student/sessions/joined`, `POST /student/sessions/join` | Student home displaying active assessments, recent attempts/results, and quick join-by-code form. |
| `/student/sessions` | Assessments Directory | `GET /student/sessions`, `GET /student/sessions/joined`, `POST /student/sessions/join` | Tabbed listing of available and joined sessions with search filtering and direct lobby entry. |
| `/student/sessions/:sessionId/lobby` | Assessment Lobby | `GET /student/sessions/{id}/lobby`, `POST /student/sessions/{id}/start` | Real-time waiting room showing session status, instructor details, duration, instructions, and start button when live. |
| `/student/attempts/:attemptId` | Live Attempt Workspace | `GET /student/attempts/{id}`, `GET /student/attempts/{id}/questions`, `GET /student/attempts/{id}/responses`, `POST /student/attempts/{id}/responses`, `POST /student/attempts/{id}/submit` | Synchronized assessment interface with question palette, server-authoritative countdown timer, autosave, and submission confirmation. |
| `/student/attempts/:attemptId/result` | Assessment Result | `GET /student/attempts/{id}/result` | Result presentation handling pending release policies and detailed question/option breakdowns with explanations when released. |

### Real-Time Lobby Synchronization

1. **Student WebSocket Channel:**
   - Connects to `/api/v1/ws/sessions/{session_id}/student` using the first-frame ticket authentication protocol.
   - Listens for `SESSION_STATUS_CHANGED` events triggered when the instructor starts, pauses, resumes, or completes a session.
   - Automatically re-fetches authoritative REST lobby data upon state changes to update student controls seamlessly.
2. **Lifecycle States Handled:**
   - `WAITING_FOR_TEACHER`: Session is scheduled or awaiting teacher activation. Start button disabled; live waiting spinner shown.
   - `READY_TO_START` / `ACTIVE`: Session is live. "Start Assessment Now" action available.
   - `SESSION_PAUSED`: Instructor paused session; student notified to wait for resumption.
   - `COMPLETED`: Session closed. If the student previously submitted, a direct link to the result page is provided.

### Live Attempt Engine & Question Types

1. **Server-Authoritative Timing:**
   - The attempt deadline is returned directly by the server in ISO 8601 format (`StudentAttemptRead.deadline`).
   - The frontend timer counts down to `Date.parse(deadline)` rather than relying on local duration counters.
   - When the countdown reaches zero, the attempt is automatically submitted via `POST /student/attempts/{id}/submit` and the user is redirected to results.

2. **Question Interaction Support:**
   - **MCQ (Single Choice):** Standard radio-style single option selection.
   - **TRUE_FALSE:** Two-option single select preserving the backend's boolean option mapping.
   - **MULTIPLE_SELECT:** Checkbox-style multi-option selection allowing any number of choices.

3. **Debounced Autosave & Concurrency Control:**
   - Option selections trigger debounced background saving (300ms debounce per question).
   - Each save maintains a strictly monotonic `client_version` integer starting at 1.
   - Backend responses return `sync_status`:
     - `ACCEPTED`: Successfully saved and persisted on PostgreSQL.
     - `IDEMPOTENT_RETRY`: Duplicate submission safely acknowledged.
     - `VERSION_CONFLICT` / `STALE_REJECTED`: Handled gracefully without overwriting newer client state.
   - UI displays clear visual indicator tags (`Saving...`, `Saved`, `Unsaved`) beside the active question.

4. **Question Palette & Review Tracking:**
   - Interactive question palette grid enabling rapid navigation to any question.
   - Color coding:
     - Blue: Currently active question.
     - Emerald/Green: Answered question with saved responses.
     - Amber: Marked for review (with or without answer).
     - Slate/Gray: Unanswered question.
   - "Mark for Review" toggle button available on every question.

5. **Submission Flow:**
   - "Submit Assessment" button prompts a confirmation modal.
   - The modal summarizes total questions answered versus unanswered to prevent accidental premature submissions.
   - Submitting finalizes the attempt on the backend (`POST /student/attempts/{id}/submit`) and navigates to the result view.
   - If an attempt is already `FINALIZED` when visiting `/student/attempts/:id`, the application automatically redirects to the result page.

### Score Release Policy & Security Rules

1. **Active Attempt Security:**
   - Correct options (`is_correct`) and answer explanations are never exposed during an active attempt (guaranteed by backend `StudentQuestion` and `StudentSavedResponse` schemas).
   - No client-side score computation is performed.
2. **Post-Submission Release Gate:**
   - The result page strictly adheres to `StudentAttemptResult.is_results_released`.
   - **When unreleased (`false`):** Displays a clean confirmation card informing the student that scores will be released per session policy. No scores, correct answers, or question breakdowns are rendered.
   - **When released (`true`):** Displays total score, awarded marks per question, correct/incorrect badges, student choices, correct answers, and faculty explanations.

---

## Project Structure

```
frontend/
├── src/
│   ├── api/
│   │   ├── adminApi.ts          # Admin CRUD client (Phase 10C)
│   │   ├── authApi.ts           # Auth endpoints
│   │   ├── client.ts            # Fetch-based API client with 401/refresh logic
│   │   ├── facultyApi.ts        # Faculty authoring API client (Phase 10D)
│   │   ├── sessionApi.ts        # Session lifecycle API client (Phase 10E)
│   │   └── studentApi.ts        # Student session, attempt & result API client (Phase 10F)
│   ├── components/
│   │   ├── auth/
│   │   │   └── ProtectedRoute.tsx
│   │   ├── common/
│   │   │   ├── Badge.tsx
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   ├── ErrorDisplay.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Modal.tsx
│   │   │   └── Spinner.tsx
│   │   └── layout/
│   │       ├── AdminLayout.tsx   # Admin sidebar layout (Phase 10C)
│   │       ├── FacultyLayout.tsx # Faculty sidebar layout (Phase 10D)
│   │       ├── StudentLayout.tsx # Student sidebar layout (Phase 10F)
│   │       ├── NavigationShell.tsx
│   │       └── RootLayout.tsx
│   ├── context/
│   │   ├── AuthContext.tsx
│   │   └── ToastContext.tsx
│   ├── pages/
│   │   ├── admin/               # Phase 10C admin pages
│   │   │   ├── AdminDashboardPlaceholder.tsx
│   │   │   ├── AdminOverviewPage.tsx
│   │   │   ├── AcademicYearsPage.tsx
│   │   │   ├── BranchesPage.tsx
│   │   │   ├── ClassesPage.tsx
│   │   │   ├── CollegeSettingsPage.tsx
│   │   │   ├── DepartmentsPage.tsx
│   │   │   ├── EnrollmentsPage.tsx
│   │   │   ├── FacultyAssignmentsPage.tsx
│   │   │   ├── FacultyPage.tsx
│   │   │   ├── StudentsPage.tsx
│   │   │   └── SubjectsPage.tsx
│   │   ├── auth/
│   │   │   ├── ForbiddenPage.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   └── RoleSelectionPage.tsx
│   │   ├── faculty/             # Phase 10D & 10E faculty pages
│   │   │   ├── FacultyAssignmentsPage.tsx
│   │   │   ├── FacultyDashboardPlaceholder.tsx
│   │   │   ├── FacultyOverviewPage.tsx
│   │   │   ├── QuestionBankPage.tsx
│   │   │   ├── QuestionFormPage.tsx
│   │   │   ├── QuizBuilderPage.tsx
│   │   │   ├── QuizFormPage.tsx
│   │   │   ├── QuizPreviewPage.tsx
│   │   │   ├── QuizPublishPage.tsx
│   │   │   ├── QuizzesPage.tsx
│   │   │   ├── SessionFormPage.tsx
│   │   │   ├── SessionMonitorPage.tsx
│   │   │   └── SessionsPage.tsx
│   │   ├── student/             # Phase 10F student pages
│   │   │   ├── StudentDashboardPage.tsx
│   │   │   ├── StudentSessionsPage.tsx
│   │   │   ├── StudentLobbyPage.tsx
│   │   │   ├── StudentAttemptPage.tsx
│   │   │   └── StudentResultPage.tsx
│   │   └── NotFoundPage.tsx
│   ├── test/
│   │   ├── admin.test.tsx       # Phase 10C admin tests (46 tests)
│   │   ├── auth.test.tsx
│   │   ├── client.test.ts
│   │   ├── faculty.test.tsx     # Phase 10D faculty tests (23 tests)
│   │   ├── routes.test.tsx
│   │   ├── session.test.tsx     # Phase 10E session & monitor tests (12 tests)
│   │   ├── student.test.tsx     # Phase 10F student workflow tests (37 tests)
│   │   ├── setup.ts
│   │   └── websocket.test.ts
│   ├── types/
│   │   ├── admin.ts             # Admin domain interfaces (Phase 10C)
│   │   ├── auth.ts
│   │   ├── faculty.ts           # Faculty authoring interfaces (Phase 10D)
│   │   ├── session.ts           # Session lifecycle interfaces (Phase 10E)
│   │   ├── student.ts           # Student attempt & result interfaces (Phase 10F)
│   │   └── websocket.ts
│   ├── utils/
│   │   └── websocket.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── vite-env.d.ts
├── .env.example
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```
