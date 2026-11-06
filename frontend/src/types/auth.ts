export type Role = 'ADMIN' | 'FACULTY' | 'STUDENT';

export interface LoginRequest {
  college_id?: string;
  email: string;
  password: string;
}

export interface RefreshRequest {
  refresh_token: string;
}

export interface UserProfile {
  id: string;
  college_id: string;
  email: string;
  first_name: string;
  last_name: string;
  roles: Role[];
  must_change_password: boolean;
}

export interface AuthenticatedUser extends UserProfile {
  token_version: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: UserProfile;
}

export interface AuthState {
  user: UserProfile | null;
  activeRole: Role | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}
