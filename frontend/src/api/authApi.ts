import { api } from './client';
import type { LoginRequest, RefreshRequest, TokenResponse, UserProfile } from '../types/auth';
import type { WebSocketTicketRequest, WebSocketTicketResponse } from '../types/websocket';

export const authApi = {
  login(request: LoginRequest): Promise<TokenResponse> {
    return api.post<TokenResponse>('/auth/login', request, { skipAuth: true });
  },

  refresh(request: RefreshRequest): Promise<TokenResponse> {
    return api.post<TokenResponse>('/auth/refresh', request, { skipAuth: true });
  },

  logout(request: RefreshRequest): Promise<void> {
    return api.post<void>('/auth/logout', request);
  },

  getCurrentUser(): Promise<UserProfile> {
    return api.get<UserProfile>('/auth/me');
  },

  createWsTicket(request?: WebSocketTicketRequest): Promise<WebSocketTicketResponse> {
    return api.post<WebSocketTicketResponse>('/auth/ws-ticket', request || {});
  },
};
