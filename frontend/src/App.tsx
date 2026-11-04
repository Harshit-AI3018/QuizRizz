import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { RootLayout } from './components/layout/RootLayout';
import { ProtectedRoute } from './components/auth/ProtectedRoute';

// Pages
import { LoginPage } from './pages/auth/LoginPage';
import { RoleSelectionPage } from './pages/auth/RoleSelectionPage';
import { ForbiddenPage } from './pages/auth/ForbiddenPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AdminLayout } from './components/layout/AdminLayout';
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage';
import { AcademicYearsPage } from './pages/admin/AcademicYearsPage';
import { DepartmentsPage } from './pages/admin/DepartmentsPage';
import { BranchesPage } from './pages/admin/BranchesPage';
import { ClassesPage } from './pages/admin/ClassesPage';
import { SubjectsPage } from './pages/admin/SubjectsPage';
import { FacultyPage } from './pages/admin/FacultyPage';
import { StudentsPage } from './pages/admin/StudentsPage';
import { FacultyAssignmentsPage } from './pages/admin/FacultyAssignmentsPage';
import { EnrollmentsPage } from './pages/admin/EnrollmentsPage';
import { CollegeSettingsPage } from './pages/admin/CollegeSettingsPage';
import { FacultyLayout } from './components/layout/FacultyLayout';
import { FacultyOverviewPage } from './pages/faculty/FacultyOverviewPage';
import { FacultyAssignmentsPage as FacultySelfAssignmentsPage } from './pages/faculty/FacultyAssignmentsPage';
import { QuestionBankPage } from './pages/faculty/QuestionBankPage';
import { QuestionFormPage } from './pages/faculty/QuestionFormPage';
import { QuizzesPage } from './pages/faculty/QuizzesPage';
import { QuizFormPage } from './pages/faculty/QuizFormPage';
import { QuizBuilderPage } from './pages/faculty/QuizBuilderPage';
import { QuizPreviewPage } from './pages/faculty/QuizPreviewPage';
import { QuizPublishPage } from './pages/faculty/QuizPublishPage';
import { SessionsPage } from './pages/faculty/SessionsPage';
import { SessionFormPage } from './pages/faculty/SessionFormPage';
import { SessionMonitorPage } from './pages/faculty/SessionMonitorPage';
import { StudentLayout } from './components/layout/StudentLayout';
import { StudentDashboardPage } from './pages/student/StudentDashboardPage';
import { StudentSessionsPage } from './pages/student/StudentSessionsPage';
import { StudentLobbyPage } from './pages/student/StudentLobbyPage';
import { StudentAttemptPage } from './pages/student/StudentAttemptPage';
import { StudentResultPage } from './pages/student/StudentResultPage';

const HomeRedirect: React.FC = () => {
  const { isAuthenticated, activeRole, user, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (user.roles.length > 1 && !activeRole) {
    return <Navigate to="/select-role" replace />;
  }

  if (activeRole === 'ADMIN') return <Navigate to="/admin" replace />;
  if (activeRole === 'FACULTY') return <Navigate to="/faculty" replace />;
  if (activeRole === 'STUDENT') return <Navigate to="/student" replace />;

  return <Navigate to="/login" replace />;
};

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forbidden" element={<ForbiddenPage />} />

      {/* Protected Root Layout */}
      <Route element={<RootLayout />}>
        <Route path="/" element={<HomeRedirect />} />

        {/* Role Selection (multi-role users) */}
        <Route
          path="/select-role"
          element={
            <ProtectedRoute>
              <RoleSelectionPage />
            </ProtectedRoute>
          }
        />

        {/* Role Dashboards */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminOverviewPage />} />
          <Route path="academic-years" element={<AcademicYearsPage />} />
          <Route path="departments" element={<DepartmentsPage />} />
          <Route path="branches" element={<BranchesPage />} />
          <Route path="classes" element={<ClassesPage />} />
          <Route path="subjects" element={<SubjectsPage />} />
          <Route path="faculty" element={<FacultyPage />} />
          <Route path="students" element={<StudentsPage />} />
          <Route path="assignments" element={<FacultyAssignmentsPage />} />
          <Route path="enrollments" element={<EnrollmentsPage />} />
          <Route path="college" element={<CollegeSettingsPage />} />
        </Route>
        <Route
          path="/faculty"
          element={
            <ProtectedRoute allowedRoles={['FACULTY', 'ADMIN']}>
              <FacultyLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<FacultyOverviewPage />} />
          <Route path="assignments" element={<FacultySelfAssignmentsPage />} />
          <Route path="questions" element={<QuestionBankPage />} />
          <Route path="questions/new" element={<QuestionFormPage />} />
          <Route path="questions/:questionId/edit" element={<QuestionFormPage />} />
          <Route path="quizzes" element={<QuizzesPage />} />
          <Route path="quizzes/new" element={<QuizFormPage />} />
          <Route path="quizzes/:quizId/edit" element={<QuizFormPage />} />
          <Route path="quizzes/:quizId/build" element={<QuizBuilderPage />} />
          <Route path="quizzes/:quizId/preview" element={<QuizPreviewPage />} />
          <Route path="quizzes/:quizId/publish" element={<QuizPublishPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="sessions/new" element={<SessionFormPage />} />
          <Route path="sessions/:sessionId/monitor" element={<SessionMonitorPage />} />
        </Route>
        <Route
          path="/student"
          element={
            <ProtectedRoute allowedRoles={['STUDENT']}>
              <StudentLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<StudentDashboardPage />} />
          <Route path="sessions" element={<StudentSessionsPage />} />
          <Route path="sessions/:sessionId/lobby" element={<StudentLobbyPage />} />
          <Route path="attempts/:attemptId" element={<StudentAttemptPage />} />
          <Route path="attempts/:attemptId/result" element={<StudentResultPage />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};
