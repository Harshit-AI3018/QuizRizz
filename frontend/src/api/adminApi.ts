import { api } from './client';
import type {
  College,
  CollegeUpdate,
  AcademicYear,
  AcademicYearCreate,
  AcademicYearUpdate,
  Department,
  DepartmentCreate,
  DepartmentUpdate,
  Branch,
  BranchCreate,
  BranchUpdate,
  ClassEntity,
  ClassCreate,
  ClassUpdate,
  Subject,
  SubjectCreate,
  SubjectUpdate,
  FacultyProfile,
  FacultyCreate,
  FacultyUpdate,
  StudentProfile,
  StudentCreate,
  StudentUpdate,
  FacultyAssignment,
  FacultyAssignmentCreate,
  FacultyAssignmentUpdate,
  StudentEnrollment,
  EnrollmentCreate,
  EnrollmentUpdate,
} from '../types/admin';

export const adminApi = {
  // College Details
  getCollege(): Promise<College> {
    return api.get<College>('/admin/college');
  },
  updateCollege(data: CollegeUpdate): Promise<College> {
    return api.patch<College>('/admin/college', data);
  },

  // Academic Years
  listAcademicYears(params?: { limit?: number; offset?: number }): Promise<AcademicYear[]> {
    return api.get<AcademicYear[]>('/admin/academic/academic-years', { params });
  },
  createAcademicYear(data: AcademicYearCreate): Promise<AcademicYear> {
    return api.post<AcademicYear>('/admin/academic/academic-years', data);
  },
  getAcademicYear(id: string): Promise<AcademicYear> {
    return api.get<AcademicYear>(`/admin/academic/academic-years/${id}`);
  },
  updateAcademicYear(id: string, data: AcademicYearUpdate): Promise<AcademicYear> {
    return api.patch<AcademicYear>(`/admin/academic/academic-years/${id}`, data);
  },
  deleteAcademicYear(id: string): Promise<void> {
    return api.delete<void>(`/admin/academic/academic-years/${id}`);
  },

  // Departments
  listDepartments(params?: { limit?: number; offset?: number }): Promise<Department[]> {
    return api.get<Department[]>('/admin/academic/departments', { params });
  },
  createDepartment(data: DepartmentCreate): Promise<Department> {
    return api.post<Department>('/admin/academic/departments', data);
  },
  getDepartment(id: string): Promise<Department> {
    return api.get<Department>(`/admin/academic/departments/${id}`);
  },
  updateDepartment(id: string, data: DepartmentUpdate): Promise<Department> {
    return api.patch<Department>(`/admin/academic/departments/${id}`, data);
  },
  deleteDepartment(id: string): Promise<void> {
    return api.delete<void>(`/admin/academic/departments/${id}`);
  },

  // Branches
  listBranches(params?: { limit?: number; offset?: number }): Promise<Branch[]> {
    return api.get<Branch[]>('/admin/academic/branches', { params });
  },
  createBranch(data: BranchCreate): Promise<Branch> {
    return api.post<Branch>('/admin/academic/branches', data);
  },
  getBranch(id: string): Promise<Branch> {
    return api.get<Branch>(`/admin/academic/branches/${id}`);
  },
  updateBranch(id: string, data: BranchUpdate): Promise<Branch> {
    return api.patch<Branch>(`/admin/academic/branches/${id}`, data);
  },
  deleteBranch(id: string): Promise<void> {
    return api.delete<void>(`/admin/academic/branches/${id}`);
  },

  // Classes
  listClasses(params?: { limit?: number; offset?: number }): Promise<ClassEntity[]> {
    return api.get<ClassEntity[]>('/admin/academic/classes', { params });
  },
  createClass(data: ClassCreate): Promise<ClassEntity> {
    return api.post<ClassEntity>('/admin/academic/classes', data);
  },
  getClass(id: string): Promise<ClassEntity> {
    return api.get<ClassEntity>(`/admin/academic/classes/${id}`);
  },
  updateClass(id: string, data: ClassUpdate): Promise<ClassEntity> {
    return api.patch<ClassEntity>(`/admin/academic/classes/${id}`, data);
  },
  deleteClass(id: string): Promise<void> {
    return api.delete<void>(`/admin/academic/classes/${id}`);
  },

  // Subjects
  listSubjects(params?: { limit?: number; offset?: number }): Promise<Subject[]> {
    return api.get<Subject[]>('/admin/academic/subjects', { params });
  },
  createSubject(data: SubjectCreate): Promise<Subject> {
    return api.post<Subject>('/admin/academic/subjects', data);
  },
  getSubject(id: string): Promise<Subject> {
    return api.get<Subject>(`/admin/academic/subjects/${id}`);
  },
  updateSubject(id: string, data: SubjectUpdate): Promise<Subject> {
    return api.patch<Subject>(`/admin/academic/subjects/${id}`, data);
  },
  deleteSubject(id: string): Promise<void> {
    return api.delete<void>(`/admin/academic/subjects/${id}`);
  },

  // Faculty Profiles
  listFaculty(params?: { limit?: number; offset?: number }): Promise<FacultyProfile[]> {
    return api.get<FacultyProfile[]>('/admin/faculty', { params });
  },
  createFaculty(data: FacultyCreate): Promise<FacultyProfile> {
    return api.post<FacultyProfile>('/admin/faculty', data);
  },
  getFaculty(userId: string): Promise<FacultyProfile> {
    return api.get<FacultyProfile>(`/admin/faculty/${userId}`);
  },
  updateFaculty(userId: string, data: FacultyUpdate): Promise<FacultyProfile> {
    return api.patch<FacultyProfile>(`/admin/faculty/${userId}`, data);
  },
  deactivateFaculty(userId: string): Promise<void> {
    return api.delete<void>(`/admin/faculty/${userId}`);
  },

  // Student Profiles
  listStudents(params?: { limit?: number; offset?: number }): Promise<StudentProfile[]> {
    return api.get<StudentProfile[]>('/admin/students', { params });
  },
  createStudent(data: StudentCreate): Promise<StudentProfile> {
    return api.post<StudentProfile>('/admin/students', data);
  },
  getStudent(userId: string): Promise<StudentProfile> {
    return api.get<StudentProfile>(`/admin/students/${userId}`);
  },
  updateStudent(userId: string, data: StudentUpdate): Promise<StudentProfile> {
    return api.patch<StudentProfile>(`/admin/students/${userId}`, data);
  },
  deactivateStudent(userId: string): Promise<void> {
    return api.delete<void>(`/admin/students/${userId}`);
  },

  // Faculty Assignments
  listFacultyAssignments(params?: { limit?: number; offset?: number }): Promise<FacultyAssignment[]> {
    return api.get<FacultyAssignment[]>('/admin/academic/faculty-assignments', { params });
  },
  createFacultyAssignment(data: FacultyAssignmentCreate): Promise<FacultyAssignment> {
    return api.post<FacultyAssignment>('/admin/academic/faculty-assignments', data);
  },
  updateFacultyAssignment(id: string, data: FacultyAssignmentUpdate): Promise<FacultyAssignment> {
    return api.patch<FacultyAssignment>(`/admin/academic/faculty-assignments/${id}`, data);
  },
  deleteFacultyAssignment(id: string): Promise<void> {
    return api.delete<void>(`/admin/academic/faculty-assignments/${id}`);
  },

  // Student Enrollments
  listEnrollments(params?: { limit?: number; offset?: number }): Promise<StudentEnrollment[]> {
    return api.get<StudentEnrollment[]>('/admin/academic/enrollments', { params });
  },
  createEnrollment(data: EnrollmentCreate): Promise<StudentEnrollment> {
    return api.post<StudentEnrollment>('/admin/academic/enrollments', data);
  },
  updateEnrollment(id: string, data: EnrollmentUpdate): Promise<StudentEnrollment> {
    return api.patch<StudentEnrollment>(`/admin/academic/enrollments/${id}`, data);
  },
  deleteEnrollment(id: string): Promise<void> {
    return api.delete<void>(`/admin/academic/enrollments/${id}`);
  },
};
