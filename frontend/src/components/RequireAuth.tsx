import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import type { Role } from '@/api/types'
import { useAuth } from '@/store/auth'

export interface GuardState {
  from?: string
  denied?: string
}

export function RequireAuth() {
  const token = useAuth((s) => s.accessToken)
  const location = useLocation()
  if (!token) {
    const state: GuardState = { from: `${location.pathname}${location.search}` }
    return <Navigate to="/login" replace state={state} />
  }
  return <Outlet />
}

interface RequireRoleProps {
  role: Role | readonly Role[]
  area: string
  children: ReactNode
}

export function RequireRole({ role, area, children }: RequireRoleProps) {
  const userRole = useAuth((s) => s.user?.role)
  const allowed: readonly Role[] = typeof role === 'string' ? [role] : role
  if (userRole === undefined || !allowed.includes(userRole)) {
    const state: GuardState = { denied: area }
    return <Navigate to="/" replace state={state} />
  }
  return children
}
