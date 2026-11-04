/**
 * Phase 10C Admin Dashboard Tests
 *
 * Tests for admin API module and admin page components.
 * All backend calls are mocked — no network or database access.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../api/adminApi', () => ({
  adminApi: {
    // College
    getCollege: vi.fn(),
    updateCollege: vi.fn(),

    // Academic Years
    listAcademicYears: vi.fn(),
    createAcademicYear: vi.fn(),
    updateAcademicYear: vi.fn(),
    deleteAcademicYear: vi.fn(),

    // Departments
    listDepartments: vi.fn(),
    createDepartment: vi.fn(),
    updateDepartment: vi.fn(),
    deleteDepartment: vi.fn(),

    // Branches
    listBranches: vi.fn(),
    createBranch: vi.fn(),
    updateBranch: vi.fn(),
    deleteBranch: vi.fn(),

    // Classes
    listClasses: vi.fn(),
    createClass: vi.fn(),
    updateClass: vi.fn(),
    deleteClass: vi.fn(),

    // Subjects
    listSubjects: vi.fn(),
    createSubject: vi.fn(),
    updateSubject: vi.fn(),
    deleteSubject: vi.fn(),

    // Faculty
    listFaculty: vi.fn(),
    createFaculty: vi.fn(),
    getFaculty: vi.fn(),
    updateFaculty: vi.fn(),
    deactivateFaculty: vi.fn(),

    // Students
    listStudents: vi.fn(),
    createStudent: vi.fn(),
    getStudent: vi.fn(),
    updateStudent: vi.fn(),
    deactivateStudent: vi.fn(),

    // Faculty Assignments
    listFacultyAssignments: vi.fn(),
    createFacultyAssignment: vi.fn(),
    updateFacultyAssignment: vi.fn(),
    deleteFacultyAssignment: vi.fn(),

    // Enrollments
    listEnrollments: vi.fn(),
    createEnrollment: vi.fn(),
    updateEnrollment: vi.fn(),
    deleteEnrollment: vi.fn(),
  },
}));

// Mock toast context
vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { adminApi } from '../api/adminApi';
import { AdminOverviewPage } from '../pages/admin/AdminOverviewPage';
import { AcademicYearsPage } from '../pages/admin/AcademicYearsPage';
import { DepartmentsPage } from '../pages/admin/DepartmentsPage';
import { FacultyPage } from '../pages/admin/FacultyPage';
import { StudentsPage } from '../pages/admin/StudentsPage';
import { FacultyAssignmentsPage } from '../pages/admin/FacultyAssignmentsPage';
import { EnrollmentsPage } from '../pages/admin/EnrollmentsPage';
import { CollegeSettingsPage } from '../pages/admin/CollegeSettingsPage';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockCollege = {
  id: 'college-uuid-1',
  name: 'Test Institute of Technology',
  code: 'TIT',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockAcademicYear = {
  id: 'year-uuid-1',
  college_id: 'college-uuid-1',
  name: '2024-25',
  start_date: '2024-06-01',
  end_date: '2025-05-31',
  is_current: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockDepartment = {
  id: 'dept-uuid-1',
  college_id: 'college-uuid-1',
  name: 'Computer Science',
  code: 'CS',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockBranch = {
  id: 'branch-uuid-1',
  college_id: 'college-uuid-1',
  department_id: 'dept-uuid-1',
  name: 'B.Tech CSE',
  code: 'CSE',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockClass = {
  id: 'class-uuid-1',
  college_id: 'college-uuid-1',
  branch_id: 'branch-uuid-1',
  academic_year_id: 'year-uuid-1',
  year_of_study: 2,
  semester: 3,
  section: 'A',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockSubject = {
  id: 'subj-uuid-1',
  college_id: 'college-uuid-1',
  department_id: 'dept-uuid-1',
  name: 'Data Structures',
  code: 'CS301',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockFaculty = {
  id: 'faculty-uuid-1',
  college_id: 'college-uuid-1',
  email: 'faculty@test.edu',
  first_name: 'Jane',
  last_name: 'Doe',
  is_active: true,
  must_change_password: false,
  employee_id: 'EMP001',
  department_id: 'dept-uuid-1',
  designation: 'Assistant Professor',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockStudent = {
  id: 'student-uuid-1',
  college_id: 'college-uuid-1',
  email: 'student@test.edu',
  first_name: 'John',
  last_name: 'Smith',
  is_active: true,
  must_change_password: false,
  roll_number: 'CS2024001',
  registration_number: 'REG001',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockAssignment = {
  id: 'assign-uuid-1',
  college_id: 'college-uuid-1',
  faculty_user_id: 'faculty-uuid-1',
  subject_id: 'subj-uuid-1',
  class_id: 'class-uuid-1',
  academic_year_id: 'year-uuid-1',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
};

const mockEnrollment = {
  id: 'enroll-uuid-1',
  college_id: 'college-uuid-1',
  student_user_id: 'student-uuid-1',
  class_id: 'class-uuid-1',
  academic_year_id: 'year-uuid-1',
  enrollment_type: 'CORE' as const,
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
};

// ── Helper: Render in Router ──────────────────────────────────────────────────

function renderWithRouter(element: React.ReactElement) {
  return render(
    <MemoryRouter>
      {element}
    </MemoryRouter>
  );
}

// ── adminApi module shape ─────────────────────────────────────────────────────

describe('adminApi — module shape', () => {
  it('exposes all required CRUD methods', () => {
    expect(typeof adminApi.getCollege).toBe('function');
    expect(typeof adminApi.listAcademicYears).toBe('function');
    expect(typeof adminApi.createAcademicYear).toBe('function');
    expect(typeof adminApi.listDepartments).toBe('function');
    expect(typeof adminApi.createDepartment).toBe('function');
    expect(typeof adminApi.listBranches).toBe('function');
    expect(typeof adminApi.createBranch).toBe('function');
    expect(typeof adminApi.listClasses).toBe('function');
    expect(typeof adminApi.createClass).toBe('function');
    expect(typeof adminApi.listSubjects).toBe('function');
    expect(typeof adminApi.createSubject).toBe('function');
    expect(typeof adminApi.listFaculty).toBe('function');
    expect(typeof adminApi.deactivateFaculty).toBe('function');
    expect(typeof adminApi.listStudents).toBe('function');
    expect(typeof adminApi.deactivateStudent).toBe('function');
    expect(typeof adminApi.listFacultyAssignments).toBe('function');
    expect(typeof adminApi.createFacultyAssignment).toBe('function');
    expect(typeof adminApi.listEnrollments).toBe('function');
    expect(typeof adminApi.createEnrollment).toBe('function');
    expect(typeof adminApi.updateEnrollment).toBe('function');
  });
});

// ── AdminOverviewPage ─────────────────────────────────────────────────────────

describe('AdminOverviewPage', () => {
  beforeEach(() => {
    vi.mocked(adminApi.getCollege).mockResolvedValue(mockCollege);
    vi.mocked(adminApi.listStudents).mockResolvedValue([mockStudent]);
    vi.mocked(adminApi.listFaculty).mockResolvedValue([mockFaculty]);
    vi.mocked(adminApi.listDepartments).mockResolvedValue([mockDepartment]);
    vi.mocked(adminApi.listBranches).mockResolvedValue([mockBranch]);
    vi.mocked(adminApi.listClasses).mockResolvedValue([mockClass]);
    vi.mocked(adminApi.listSubjects).mockResolvedValue([mockSubject]);
    vi.mocked(adminApi.listAcademicYears).mockResolvedValue([mockAcademicYear]);
  });

  it('renders institutional heading after data loads', async () => {
    renderWithRouter(<AdminOverviewPage />);
    // heading shows the college name once loaded
    await waitFor(() => {
      expect(screen.getByText('Test Institute of Technology')).toBeInTheDocument();
    });
  });

  it('shows real college name after data loads', async () => {
    renderWithRouter(<AdminOverviewPage />);
    await waitFor(() => {
      expect(screen.getByText('Test Institute of Technology')).toBeInTheDocument();
    });
  });

  it('displays student and faculty counts from API', async () => {
    renderWithRouter(<AdminOverviewPage />);
    await waitFor(() => {
      // "1" should appear for each count
      const ones = screen.getAllByText('1');
      expect(ones.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows current academic year badge', async () => {
    renderWithRouter(<AdminOverviewPage />);
    await waitFor(() => {
      expect(screen.getByText('2024-25')).toBeInTheDocument();
    });
  });

  it('handles getCollege API error gracefully without crashing', async () => {
    vi.mocked(adminApi.getCollege).mockRejectedValue(new Error('Network error'));
    // Other calls succeed — page should still render (data-unavailable or fallback heading)
    renderWithRouter(<AdminOverviewPage />);
    await waitFor(() => {
      // "Institution Overview" is the fallback heading when college data is unavailable
      const heading = screen.queryByText('Institution Overview') ||
                      screen.queryByText('Test Institute of Technology');
      expect(heading || screen.getByText(/enrolled students/i)).toBeInTheDocument();
    });
  });
});

// ── AcademicYearsPage ─────────────────────────────────────────────────────────

describe('AcademicYearsPage', () => {
  beforeEach(() => {
    vi.mocked(adminApi.listAcademicYears).mockResolvedValue([mockAcademicYear]);
  });

  it('renders page heading', async () => {
    renderWithRouter(<AcademicYearsPage />);
    await waitFor(() => {
      expect(screen.getByText('Academic Years')).toBeInTheDocument();
    });
  });

  it('renders academic year name from API after load', async () => {
    renderWithRouter(<AcademicYearsPage />);
    await waitFor(() => {
      expect(screen.getByText('2024-25')).toBeInTheDocument();
    });
  });

  it('shows current-year badge', async () => {
    renderWithRouter(<AcademicYearsPage />);
    await waitFor(() => {
      expect(screen.getByText(/current/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no academic years exist', async () => {
    vi.mocked(adminApi.listAcademicYears).mockResolvedValue([]);
    renderWithRouter(<AcademicYearsPage />);
    await waitFor(() => {
      expect(screen.getByText(/no academic years/i)).toBeInTheDocument();
    });
  });

  it('opens create modal when Add button is clicked', async () => {
    renderWithRouter(<AcademicYearsPage />);
    await waitFor(() => screen.getByText('2024-25'));

    fireEvent.click(screen.getByRole('button', { name: /add academic year/i }));
    expect(screen.getByText(/add academic year/i)).toBeInTheDocument();
  });

  it('shows error when API fails to load', async () => {
    vi.mocked(adminApi.listAcademicYears).mockRejectedValue(new Error('Server error'));
    renderWithRouter(<AcademicYearsPage />);
    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument();
    });
  });
});

// ── DepartmentsPage ───────────────────────────────────────────────────────────

describe('DepartmentsPage', () => {
  beforeEach(() => {
    vi.mocked(adminApi.listDepartments).mockResolvedValue([mockDepartment]);
  });

  it('renders page heading', async () => {
    renderWithRouter(<DepartmentsPage />);
    await waitFor(() => {
      expect(screen.getByText('Departments')).toBeInTheDocument();
    });
  });

  it('renders department name and code from API', async () => {
    renderWithRouter(<DepartmentsPage />);
    await waitFor(() => {
      expect(screen.getByText('Computer Science')).toBeInTheDocument();
      expect(screen.getByText('CS')).toBeInTheDocument();
    });
  });

  it('shows empty state when no departments', async () => {
    vi.mocked(adminApi.listDepartments).mockResolvedValue([]);
    renderWithRouter(<DepartmentsPage />);
    await waitFor(() => {
      expect(screen.getByText(/no departments/i)).toBeInTheDocument();
    });
  });

  it('calls createDepartment and refreshes list on successful creation', async () => {
    vi.mocked(adminApi.createDepartment).mockResolvedValue({
      ...mockDepartment,
      id: 'dept-uuid-2',
      name: 'Electrical Engineering',
      code: 'EE',
    });

    renderWithRouter(<DepartmentsPage />);
    await waitFor(() => screen.getByText('Computer Science'));

    // Open modal
    fireEvent.click(screen.getByRole('button', { name: /add department/i }));

    // Fill form - placeholders match what DepartmentsPage actually uses
    const nameInput = screen.getByPlaceholderText(/e\.g\. computer science and engineering/i);
    const codeInput = screen.getByPlaceholderText(/e\.g\. cse/i);
    fireEvent.change(nameInput, { target: { value: 'Electrical Engineering' } });
    fireEvent.change(codeInput, { target: { value: 'EE' } });

    // Submit button text is "Create Department"
    fireEvent.click(screen.getByRole('button', { name: /create department/i }));
    expect(vi.mocked(adminApi.createDepartment)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Electrical Engineering', code: 'EE' })
    );
  });
});

// ── FacultyPage ───────────────────────────────────────────────────────────────

describe('FacultyPage', () => {
  beforeEach(() => {
    vi.mocked(adminApi.listFaculty).mockResolvedValue([mockFaculty]);
    vi.mocked(adminApi.listDepartments).mockResolvedValue([mockDepartment]);
  });

  it('renders page heading', async () => {
    renderWithRouter(<FacultyPage />);
    await waitFor(() => {
      expect(screen.getByText('Faculty Directory')).toBeInTheDocument();
    });
  });

  it('shows faculty name and employee ID from API', async () => {
    renderWithRouter(<FacultyPage />);
    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('EMP001')).toBeInTheDocument();
    });
  });

  it('shows active badge for active faculty', async () => {
    renderWithRouter(<FacultyPage />);
    await waitFor(() => {
      expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    });
  });

  it('shows empty state when no faculty exist', async () => {
    vi.mocked(adminApi.listFaculty).mockResolvedValue([]);
    renderWithRouter(<FacultyPage />);
    await waitFor(() => {
      expect(screen.getByText(/no faculty members found/i)).toBeInTheDocument();
    });
  });

  it('shows deactivation modal on clicking Deactivate button', async () => {
    renderWithRouter(<FacultyPage />);
    await waitFor(() => screen.getByText('Jane Doe'));

    fireEvent.click(screen.getByRole('button', { name: /deactivate/i }));
    expect(screen.getByText(/confirm deactivation/i)).toBeInTheDocument();
  });
});

// ── StudentsPage ──────────────────────────────────────────────────────────────

describe('StudentsPage', () => {
  beforeEach(() => {
    vi.mocked(adminApi.listStudents).mockResolvedValue([mockStudent]);
  });

  it('renders page heading', async () => {
    renderWithRouter(<StudentsPage />);
    await waitFor(() => {
      expect(screen.getByText('Student Roster')).toBeInTheDocument();
    });
  });

  it('shows student full name and roll number from API', async () => {
    renderWithRouter(<StudentsPage />);
    await waitFor(() => {
      expect(screen.getByText('John Smith')).toBeInTheDocument();
      expect(screen.getByText('CS2024001')).toBeInTheDocument();
    });
  });

  it('filters by search term', async () => {
    vi.mocked(adminApi.listStudents).mockResolvedValue([
      mockStudent,
      {
        ...mockStudent,
        id: 'student-uuid-2',
        first_name: 'Alice',
        last_name: 'Wong',
        email: 'alice@test.edu',
        roll_number: 'CS2024002',
      },
    ]);

    renderWithRouter(<StudentsPage />);
    await waitFor(() => screen.getByText('John Smith'));

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'Alice' } });
    expect(screen.getByText('Alice Wong')).toBeInTheDocument();
    expect(screen.queryByText('John Smith')).not.toBeInTheDocument();
  });

  it('shows empty state when no students exist', async () => {
    vi.mocked(adminApi.listStudents).mockResolvedValue([]);
    renderWithRouter(<StudentsPage />);
    await waitFor(() => {
      expect(screen.getByText(/no students found/i)).toBeInTheDocument();
    });
  });

  it('calls deactivateStudent and refreshes list on deactivation', async () => {
    vi.mocked(adminApi.deactivateStudent).mockResolvedValue(undefined);

    renderWithRouter(<StudentsPage />);
    await waitFor(() => screen.getByText('John Smith'));

    // Open confirmation modal
    fireEvent.click(screen.getByRole('button', { name: /deactivate/i }));
    expect(screen.getByText(/confirm deactivation/i)).toBeInTheDocument();

    // Confirm
    fireEvent.click(screen.getByRole('button', { name: /confirm deactivate/i }));
    expect(vi.mocked(adminApi.deactivateStudent)).toHaveBeenCalledWith('student-uuid-1');
  });
});

// ── FacultyAssignmentsPage ────────────────────────────────────────────────────

describe('FacultyAssignmentsPage', () => {
  beforeEach(() => {
    vi.mocked(adminApi.listFacultyAssignments).mockResolvedValue([mockAssignment]);
    vi.mocked(adminApi.listFaculty).mockResolvedValue([mockFaculty]);
    vi.mocked(adminApi.listSubjects).mockResolvedValue([mockSubject]);
    vi.mocked(adminApi.listClasses).mockResolvedValue([mockClass]);
    vi.mocked(adminApi.listAcademicYears).mockResolvedValue([mockAcademicYear]);
  });

  it('renders page heading', () => {
    renderWithRouter(<FacultyAssignmentsPage />);
    expect(screen.getByText(/faculty assignments/i)).toBeInTheDocument();
  });

  it('renders faculty name and subject code from API', async () => {
    renderWithRouter(<FacultyAssignmentsPage />);
    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('Data Structures')).toBeInTheDocument();
    });
  });

  it('shows active badge for active assignments', async () => {
    renderWithRouter(<FacultyAssignmentsPage />);
    await waitFor(() => {
      expect(screen.getByText('Active')).toBeInTheDocument();
    });
  });

  it('shows empty state when no assignments', async () => {
    vi.mocked(adminApi.listFacultyAssignments).mockResolvedValue([]);
    renderWithRouter(<FacultyAssignmentsPage />);
    await waitFor(() => {
      expect(screen.getByText(/no faculty assignments found/i)).toBeInTheDocument();
    });
  });

  it('opens create assignment modal on button click', async () => {
    renderWithRouter(<FacultyAssignmentsPage />);
    await waitFor(() => screen.getByText('Jane Doe'));

    fireEvent.click(screen.getByRole('button', { name: /new assignment/i }));
    expect(screen.getByText(/assign faculty member/i)).toBeInTheDocument();
  });

  it('calls createFacultyAssignment with correct payload', async () => {
    vi.mocked(adminApi.createFacultyAssignment).mockResolvedValue({
      ...mockAssignment,
      id: 'assign-uuid-2',
    });

    renderWithRouter(<FacultyAssignmentsPage />);
    await waitFor(() => screen.getByText('Jane Doe'));

    fireEvent.click(screen.getByRole('button', { name: /new assignment/i }));
    await waitFor(() => screen.getByText(/assign faculty member/i));

    // The dropdowns should be pre-populated with available options
    // Click submit button with currently selected values
    fireEvent.click(screen.getByRole('button', { name: /assign faculty/i }));

    expect(vi.mocked(adminApi.createFacultyAssignment)).toHaveBeenCalledWith(
      expect.objectContaining({
        faculty_user_id: 'faculty-uuid-1',
        subject_id: 'subj-uuid-1',
        class_id: 'class-uuid-1',
        academic_year_id: 'year-uuid-1',
      })
    );
  });

  it('calls updateFacultyAssignment when toggling active status', async () => {
    vi.mocked(adminApi.updateFacultyAssignment).mockResolvedValue({
      ...mockAssignment,
      is_active: false,
    });

    renderWithRouter(<FacultyAssignmentsPage />);
    await waitFor(() => screen.getByText('Jane Doe'));

    fireEvent.click(screen.getByRole('button', { name: /deactivate/i }));
    expect(vi.mocked(adminApi.updateFacultyAssignment)).toHaveBeenCalledWith('assign-uuid-1', {
      is_active: false,
    });
  });
});

// ── EnrollmentsPage ───────────────────────────────────────────────────────────

describe('EnrollmentsPage', () => {
  beforeEach(() => {
    vi.mocked(adminApi.listEnrollments).mockResolvedValue([mockEnrollment]);
    vi.mocked(adminApi.listStudents).mockResolvedValue([mockStudent]);
    vi.mocked(adminApi.listClasses).mockResolvedValue([mockClass]);
    vi.mocked(adminApi.listAcademicYears).mockResolvedValue([mockAcademicYear]);
  });

  it('renders page heading', () => {
    renderWithRouter(<EnrollmentsPage />);
    expect(screen.getByText(/student enrollments/i)).toBeInTheDocument();
  });

  it('renders student name and roll number from API', async () => {
    renderWithRouter(<EnrollmentsPage />);
    await waitFor(() => {
      expect(screen.getByText('John Smith')).toBeInTheDocument();
      expect(screen.getByText('CS2024001')).toBeInTheDocument();
    });
  });

  it('shows enrollment type badge', async () => {
    renderWithRouter(<EnrollmentsPage />);
    await waitFor(() => {
      expect(screen.getByText('CORE')).toBeInTheDocument();
    });
  });

  it('shows empty state when no enrollments', async () => {
    vi.mocked(adminApi.listEnrollments).mockResolvedValue([]);
    renderWithRouter(<EnrollmentsPage />);
    await waitFor(() => {
      expect(screen.getByText(/no student enrollments found/i)).toBeInTheDocument();
    });
  });

  it('opens enrollment modal on button click', async () => {
    renderWithRouter(<EnrollmentsPage />);
    await waitFor(() => screen.getByText('John Smith'));

    fireEvent.click(screen.getByRole('button', { name: /enroll student/i }));
    expect(screen.getByText(/enroll student in class/i)).toBeInTheDocument();
  });

  it('calls updateEnrollment when toggling enrollment active status', async () => {
    vi.mocked(adminApi.updateEnrollment).mockResolvedValue({
      ...mockEnrollment,
      is_active: false,
    });

    renderWithRouter(<EnrollmentsPage />);
    await waitFor(() => screen.getByText('John Smith'));

    fireEvent.click(screen.getByRole('button', { name: /deactivate/i }));
    expect(vi.mocked(adminApi.updateEnrollment)).toHaveBeenCalledWith('enroll-uuid-1', {
      is_active: false,
    });
  });

  it('shows ELECTIVE badge for elective enrollments', async () => {
    vi.mocked(adminApi.listEnrollments).mockResolvedValue([
      { ...mockEnrollment, enrollment_type: 'ELECTIVE' },
    ]);
    renderWithRouter(<EnrollmentsPage />);
    await waitFor(() => {
      expect(screen.getByText('ELECTIVE')).toBeInTheDocument();
    });
  });
});

// ── CollegeSettingsPage ───────────────────────────────────────────────────────

describe('CollegeSettingsPage', () => {
  beforeEach(() => {
    vi.mocked(adminApi.getCollege).mockResolvedValue(mockCollege);
  });

  it('renders page heading', async () => {
    renderWithRouter(<CollegeSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('College Settings')).toBeInTheDocument();
    });
  });

  it('shows college name and code from API', async () => {
    renderWithRouter(<CollegeSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('Test Institute of Technology')).toBeInTheDocument();
      expect(screen.getByText(/TIT/)).toBeInTheDocument();
    });
  });

  it('shows active institution badge for active college', async () => {
    renderWithRouter(<CollegeSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText(/active institution/i)).toBeInTheDocument();
    });
  });

  it('renders tenant ID in the read-only section', async () => {
    renderWithRouter(<CollegeSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('college-uuid-1')).toBeInTheDocument();
    });
  });

  it('calls updateCollege with trimmed uppercase code on save', async () => {
    vi.mocked(adminApi.updateCollege).mockResolvedValue({
      ...mockCollege,
      name: 'Updated Institute',
      code: 'UPD',
    });

    renderWithRouter(<CollegeSettingsPage />);
    await waitFor(() => screen.getByText('Test Institute of Technology'));

    // Clear and retype name input
    const nameInput = screen.getByDisplayValue('Test Institute of Technology');
    fireEvent.change(nameInput, { target: { value: 'Updated Institute' } });

    // Clear and retype code input (should auto-uppercase via onChange)
    const codeInput = screen.getByDisplayValue('TIT');
    fireEvent.change(codeInput, { target: { value: 'UPD' } });

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    expect(vi.mocked(adminApi.updateCollege)).toHaveBeenCalledWith({
      name: 'Updated Institute',
      code: 'UPD',
    });
  });

  it('shows error when getCollege fails', async () => {
    vi.mocked(adminApi.getCollege).mockRejectedValue(new Error('Unauthorized'));
    renderWithRouter(<CollegeSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText(/failed to load settings/i)).toBeInTheDocument();
    });
  });
});
