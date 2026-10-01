import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Role, User } from '@/api/types'
import { routes } from '@/routes'
import { useAuth } from '@/store/auth'
import { useHealth } from '@/store/health'
import { json, mockApi } from '@/test/fetch'

const METRICS = {
  open_cases: 0,
  open_cases_by_priority: { low: 0, medium: 0, high: 0, critical: 0 },
  critical_24h: 0,
  high_24h: 0,
  alerts_24h: 0,
  fp_rate_7d: null,
  closed_7d: 0,
  top_entities: [],
  ingest: { events_per_min: 0, lag_ms: null, backlog: 0 },
  totals: { events: 0, entities: 0, alerts: 0, cases: 0, exported_cases: 0 },
  detection: { latency_p95_ms: null, latency_samples: 0 },
}

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

  it('T-FE-14: redirects an investigator away from /admin/rules and explains why', async () => {
    signIn('investigator')
    mockApi({
      'GET /v1/auth/me': () => json(userFor('investigator')),
      'GET /v1/dashboard/metrics': () => json(METRICS),
      'GET /v1/alerts': () => json({ items: [], next_cursor: null }),
    })
    const router = renderAt('/admin/rules')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(screen.getByRole('alert')).toHaveTextContent('Admin / Rules needs the admin role')
  })

  it('lets an admin open /admin/rules and shows the admin nav item', async () => {
    signIn('admin')
    mockApi({ 'GET /v1/auth/me': () => json(userFor('admin')), 'GET /v1/rules': () => json([]) })
    renderAt('/admin/rules')
    expect(await screen.findByRole('heading', { name: 'Admin / Rules' })).toBeInTheDocument()
    expect(await screen.findByText('All rules saved')).toBeInTheDocument()
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

  it('answers an unknown address with a page-not-found screen inside the shell', async () => {
    signIn('admin')
    mockApi({ 'GET /v1/auth/me': () => json(userFor('admin')) })
    renderAt('/no-such-page')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/')
  })
})

describe('How Sentinel works', () => {
  const LIVE = {
    ...METRICS,
    totals: { events: 4, entities: 6, alerts: 1, cases: 0, exported_cases: 0 },
    detection: { latency_p95_ms: 118.4, latency_samples: 3 },
  }

  it('tells the pipeline with the bank live counts and the four safeguards', async () => {
    signIn('investigator')
    mockApi({
      'GET /v1/auth/me': () => json(userFor('investigator')),
      'GET /v1/dashboard/metrics': () => json(LIVE),
      'GET /v1/alerts': () => json({ items: [], next_cursor: null }),
    })
    renderAt('/')
    const section = await screen.findByTestId('how-sentinel-works')
    expect(await within(section).findByTestId('stage-1')).toHaveTextContent('4 events')
    expect(within(section).getByTestId('stage-2')).toHaveTextContent('6 people and accounts')
    expect(within(section).getByTestId('stage-3')).toHaveTextContent('p95 118 ms live')
    expect(within(section).getByTestId('stage-4')).toHaveTextContent('1 alert')
    expect(within(section).getByTestId('stage-6')).toHaveTextContent('0 cases exported')
    expect(within(section).getByRole('link', { name: /Events arrive/ })).toHaveAttribute('href', '/add')
    expect(within(section).queryByRole('link', { name: /Checked/ })).toBeNull()
    for (const title of ['Right people only', 'Your bank only', 'Nothing silent', 'Evidence holds']) {
      expect(within(section).getByText(title)).toBeInTheDocument()
    }
  })

  it('says the latency is from tests until this API has timed alerts, and links rules for admins', async () => {
    signIn('admin')
    mockApi({
      'GET /v1/auth/me': () => json(userFor('admin')),
      'GET /v1/dashboard/metrics': () => json({ ...LIVE, detection: { latency_p95_ms: null, latency_samples: 0 } }),
      'GET /v1/alerts': () => json({ items: [], next_cursor: null }),
    })
    renderAt('/')
    const section = await screen.findByTestId('how-sentinel-works')
    expect(await within(section).findByTestId('stage-3')).toHaveTextContent('p95 210 ms in tests')
    expect(within(section).getByRole('link', { name: /Checked/ })).toHaveAttribute('href', '/admin/rules')
  })

  it('hides on request and stays hidden for that person', async () => {
    signIn('investigator')
    const handlers = {
      'GET /v1/auth/me': () => json(userFor('investigator')),
      'GET /v1/dashboard/metrics': () => json(LIVE),
      'GET /v1/alerts': () => json({ items: [], next_cursor: null }),
    }
    mockApi(handlers)
    renderAt('/')
    const section = await screen.findByTestId('how-sentinel-works')
    await userEvent.setup().click(within(section).getByRole('button', { name: 'Hide' }))
    expect(within(section).queryByText('Events arrive')).toBeNull()
    expect(localStorage.getItem('sentinel-how-it-works:usr_investigator')).toBe('hidden')
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
