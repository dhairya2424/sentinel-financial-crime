import { api } from './client'
import type { LoginRequest, LoginResponse, User } from './types'

export function login(body: LoginRequest): Promise<LoginResponse> {
  return api<LoginResponse>('/v1/auth/login', { method: 'POST', body, auth: false })
}

export function fetchMe(signal?: AbortSignal): Promise<User> {
  return api<User>('/v1/auth/me', { signal })
}
