import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Role, User } from '@/api/types'
import { routes } from '@/routes'
import { useAuth } from '@/store/auth'
import { useHealth } from '@/store/health'
import { json, mockApi } from '@/test/fetch'

function userFor(role: Role): User {
  return { id: `usr_${role}`, email: `${role}@demo.dev`, role, tenant_id: 'tenant_demo', full_name: 'Ishan Investigator' }
}

function signIn(role: Role) {
  useAuth.setState({ user: userFor(role), accessToken: `token-${role}`, refreshToken: `refresh-${role}`, signOutReason: null })
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  useAuth.setState({ user: null, accessToken: null, refreshToken: null, signOutReason: null })
  useHealth.setState({ connection: 'checking', services: null, checkedAt: null, nextCheckAt: null })
})

describe('routing and guards', () => {
  it('sends a signed-out visitor to /login', async () => {
    mockApi({})
    const router = renderAt('/cases')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('signs in as investigator and lands on the dashboard shell', async () => {
    const investigator = userFor('investigator')
    mockApi({
      'POST /v1/auth/login': () =>
        json({ access_token: 'a', refresh_token: 'r', token_type: 'bearer', user: investigator }),
      'GET /v1/auth/me': () => json(investigator),
    })
    const router = renderAt('/login')
    const ue = userEvent.setup()
    await ue.type(screen.getByLabelText('Email'), 'investigator@demo.dev')
    await ue.type(screen.getByLabelText('Password'), 'Demo!23456')
    await ue.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    for (const label of ['Dashboard', 'Alert Inbox', 'Case Manager', 'Graph Explorer', 'Timeline']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(within(nav).queryByRole('link', { name: 'Admin / Rules' })).toBeNull()
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows a clear error for wrong credentials', async () => {
    mockApi({ 'POST /v1/auth/login': () => json({ detail: 'invalid credentials', code: 'unauthorized' }, 401) })
    renderAt('/login')
    const ue = userEvent.setup()
    await ue.type(screen.getByLabelText('Email'), 'investigator@demo.dev')
    await ue.type(screen.getByLabelText('Password'), 'wrong-password')
    await ue.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("don't match an active account")
  })

  it('redirects an investigator away from /admin/rules and explains why', async () => {
    signIn('investigator')
    mockApi({ 'GET /v1/auth/me': () => json(userFor('investigator')) })
    const router = renderAt('/admin/rules')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(screen.getByRole('alert')).toHaveTextContent('Admin / Rules needs the admin role')
  })

  it('lets an admin open /admin/rules and shows the admin nav item', async () => {
    signIn('admin')
    mockApi({ 'GET /v1/auth/me': () => json(userFor('admin')) })
    renderAt('/admin/rules')
    expect(await screen.findByRole('heading', { name: 'Admin / Rules' })).toBeInTheDocument()
    expect(screen.getByText('Arrives in Phase 5')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: 'Admin / Rules' })).toHaveAttribute('aria-current', 'page')
  })

  it('signs out from the account menu and returns to /login', async () => {
    signIn('investigator')
    mockApi({ 'GET /v1/auth/me': () => json(userFor('investigator')) })
    const router = renderAt('/graph')
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: /Account menu/ }))
    await ue.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(useAuth.getState().accessToken).toBeNull()
  })

  it('renders placeholders for every docs/04 route', async () => {
    signIn('investigator')
    mockApi({ 'GET /v1/auth/me': () => json(userFor('investigator')) })
    renderAt('/cases/case_01')
    expect(await screen.findByText('Arrives in Phase 4')).toBeInTheDocument()
    expect(screen.getByText('case_01')).toBeInTheDocument()
  })
})

describe('real-time honesty', () => {
  it('flips the status strip and shows a banner when the API is unreachable', async () => {
    signIn('investigator')
    mockApi({ 'GET /v1/auth/me': () => json(userFor('investigator')) })
    useHealth.setState({ connection: 'unreachable', services: null, checkedAt: Date.now(), nextCheckAt: Date.now() + 5000 })
    renderAt('/')
    expect(await screen.findByTestId('connection-banner')).toHaveTextContent("Can't reach the Sentinel API")
    expect(screen.getByTestId('status-strip')).toHaveAttribute('data-state', 'unreachable')
    expect(screen.getByTestId('status-strip')).toHaveTextContent('API down')
  })
})
