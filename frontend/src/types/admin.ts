export interface College {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CollegeUpdate {
  name?: string;
  code?: string;
}

export interface AcademicYear {
  id: string;
  college_id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

export interface AcademicYearCreate {
  name: string;
  start_date: string;
  end_date: string;
  is_current?: boolean;
}

export interface AcademicYearUpdate {
  name?: string;
  start_date?: string;
  end_date?: string;
  is_current?: boolean;
}

export interface Department {
  id: string;
  college_id: string;
  name: string;
  code: string;
  created_at: string;
  updated_at: string;
}

export interface DepartmentCreate {
  name: string;
  code: string;
}

export interface DepartmentUpdate {
  name?: string;
  code?: string;
}

export interface Branch {
  id: string;
  college_id: string;
  department_id: string;
  name: string;
  code: string;
  created_at: string;
  updated_at: string;
}

export interface BranchCreate {
  department_id: string;
  name: string;
  code: string;
}

export interface BranchUpdate {
  department_id?: string;
  name?: string;
  code?: string;
}

export interface ClassEntity {
  id: string;
  college_id: string;
  branch_id: string;
  academic_year_id: string;
  year_of_study: number;
  semester: number;
  section: string;
  created_at: string;
  updated_at: string;
}

export interface ClassCreate {
  branch_id: string;
  academic_year_id: string;
  year_of_study: number;
  semester: number;
  section: string;
}

export interface ClassUpdate {
  branch_id?: string;
  academic_year_id?: string;
  year_of_study?: number;
  semester?: number;
  section?: string;
}

export interface Subject {
  id: string;
  college_id: string;
  department_id: string;
  name: string;
  code: string;
  created_at: string;
  updated_at: string;
}

export interface SubjectCreate {
  department_id: string;
  name: string;
  code: string;
}

export interface SubjectUpdate {
  department_id?: string;
  name?: string;
  code?: string;
}

export interface FacultyProfile {
  id: string;
  college_id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  must_change_password: boolean;
  employee_id: string;
  department_id: string;
  designation?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FacultyCreate {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  employee_id: string;
  department_id: string;
  designation?: string | null;
}

export interface FacultyUpdate {
  email?: string;
  first_name?: string;
  last_name?: string;
  employee_id?: string;
  department_id?: string;
  designation?: string | null;
}

export interface StudentProfile {
  id: string;
  college_id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  must_change_password: boolean;
  roll_number: string;
  registration_number?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudentCreate {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  roll_number: string;
  registration_number?: string | null;
}

export interface StudentUpdate {
  email?: string;
  first_name?: string;
  last_name?: string;
  roll_number?: string;
  registration_number?: string | null;
}

export interface FacultyAssignment {
  id: string;
  college_id: string;
  faculty_user_id: string;
  subject_id: string;
  class_id: string;
  academic_year_id: string;
  is_active: boolean;
  created_at: string;
}

export interface FacultyAssignmentCreate {
  faculty_user_id: string;
  subject_id: string;
  class_id: string;
  academic_year_id: string;
}

export interface FacultyAssignmentUpdate {
  is_active: boolean;
}

export interface StudentEnrollment {
  id: string;
  college_id: string;
  student_user_id: string;
  class_id: string;
  academic_year_id: string;
  enrollment_type: 'CORE' | 'ELECTIVE';
  is_active: boolean;
  created_at: string;
}

export interface EnrollmentCreate {
  student_user_id: string;
  class_id: string;
  academic_year_id: string;
  enrollment_type?: 'CORE' | 'ELECTIVE';
}

export interface EnrollmentUpdate {
  is_active: boolean;
}
