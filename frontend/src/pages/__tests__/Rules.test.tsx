import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RuleRow, RuleVersion, User } from '@/api/types'
import { moveWeight, parseParam, weightSum } from '@/lib/rules'
import { routes } from '@/routes'
import { useAuth } from '@/store/auth'
import { useHealth } from '@/store/health'
import { useToasts } from '@/store/toasts'
import { json, mockApi } from '@/test/fetch'

const admin: User = { id: 'usr_a', email: 'admin@demo.dev', role: 'admin', tenant_id: 'tenant_demo', full_name: 'Asha Admin' }

const CIRC: RuleRow = {
  code: 'R-CIRC',
  name: 'Circular transfer',
  kind: 'primary',
  version: 1,
  enabled: true,
  params: { window_hours: 72, min_cycle_amount: 500000, min_length: 3, max_length: 6, history_min: 5 },
  weights: { linkage_depth: 0.25, amount: 0.35, temporal_proximity: 0.25, account_velocity: 0.15 },
  updated_by: null,
  updated_by_name: null,
  updated_at: null,
}
const ROLE: RuleRow = {
  ...CIRC,
  code: 'R-PROFILE_ROLE',
  name: 'Role-action mismatch',
  params: { allowed_roles: { 'tx.approve': ['teller', 'manager'] }, revocation_window_hours: 48, business_hours: ['09:00', '19:00'] },
  weights: { access_anomaly: 0.35, action_sensitivity: 0.25, temporal_proximity: 0.25, employee_off_hours: 0.15 },
}
const DORMANT: RuleRow = {
  ...CIRC,
  code: 'R-DORMANT',
  name: 'Dormant reactivation',
  kind: 'supporting',
  params: { idle_days: 90, reporting_threshold: 50000, amount_ratio: 0.8, window_hours: 48, cap: 0.45, standalone_min_score: 60 },
  weights: { dormancy_gap: 1 },
}
const HISTORY: RuleVersion[] = [
  {
    version: 2,
    enabled: true,
    params: { ...CIRC.params, window_hours: 96 },
    weights: CIRC.weights,
    updated_by: 'usr_a',
    updated_by_name: 'Asha Admin',
    updated_at: new Date().toISOString(),
    changes: [{ field: 'params.window_hours', before: 72, after: 96 }],
  },
  { version: 1, enabled: true, params: CIRC.params, weights: CIRC.weights, updated_by: null, updated_by_name: null, updated_at: null, changes: [] },
  { version: 0, enabled: true, params: CIRC.params, weights: CIRC.weights, updated_by: null, updated_by_name: null, updated_at: null, changes: [] },
]

function open(extra: Parameters<typeof mockApi>[0] = {}) {
  useAuth.setState({ user: admin, accessToken: 'token', refreshToken: 'refresh', signOutReason: null })
  const api = mockApi({
    'GET /v1/auth/me': () => json(admin),
    'GET /v1/rules': () => json([CIRC, ROLE, DORMANT]),
    'GET /v1/rules/R-CIRC/history': () => json(HISTORY),
    ...extra,
  })
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/admin/rules'] })} />)
  return api
}

describe('rule weights', () => {
  it('moves weight between neighbours without changing the total, and never below zero', () => {
    const w = [0.25, 0.35, 0.25, 0.15]
    expect(moveWeight(w, 0, 0.05)).toEqual([0.3, 0.3, 0.25, 0.15])
    expect(moveWeight(w, 2, 0.4)).toEqual([0.25, 0.35, 0.4, 0])
    expect(weightSum(moveWeight(w, 2, 0.4))).toBe(1)
    expect(moveWeight(w, 1, -1)).toEqual([0.25, 0, 0.6, 0.15])
  })

  it('reads settings as typed, with errors a person can act on', () => {
    expect(parseParam('int', '1,00,000')).toEqual({ value: 100000 })
    expect(parseParam('int', '2.5').error).toBe('Whole numbers only')
    expect(parseParam('float', '-1').error).toBe('Cannot be negative')
    expect(parseParam('time', '25:00').error).toBe('Use HH:MM, 24-hour')
  })
})

describe('Admin / Rules', () => {
  beforeEach(() => {
    useHealth.setState({ connection: 'connected', services: { db: 'ok', redis: 'ok' } })
    useToasts.setState({ toasts: [] })
  })

  it('lists primary and supporting rules with their weights, key settings and version', async () => {
    open()
    const circ = await screen.findByTestId('rule-R-CIRC')
    expect(circ).toHaveTextContent('Circular transfer')
    expect(circ).toHaveTextContent('v1 · seeded')
    expect(circ).toHaveTextContent('72 h · ₹5,00,000')
    expect(within(circ).getByTestId('sum-R-CIRC')).toHaveTextContent('total 1.000')
    expect(within(circ).getAllByRole('slider')).toHaveLength(3)
    const dormant = screen.getByTestId('rule-R-DORMANT')
    expect(dormant).toHaveTextContent('adding at most 45 points')
    expect(within(dormant).queryByRole('slider')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Supporting rules' })).toBeInTheDocument()
  })

  it('moves weight with the keyboard and saves the rule as a new version', async () => {
    const saved: RuleRow = {
      ...CIRC,
      version: 2,
      weights: { linkage_depth: 0.26, amount: 0.34, temporal_proximity: 0.25, account_velocity: 0.15 },
      updated_by: 'usr_a',
      updated_by_name: 'Asha Admin',
      updated_at: new Date().toISOString(),
    }
    let sent: unknown = null
    open({
      'PUT /v1/rules/R-CIRC': (init) => {
        sent = JSON.parse(init?.body as string)
        return json(saved)
      },
    })
    const circ = await screen.findByTestId('rule-R-CIRC')
    const divider = within(circ).getByRole('slider', { name: 'Weight between linkage_depth and amount' })
    divider.focus()
    const user = userEvent.setup()
    await user.keyboard('{ArrowRight}')
    expect(divider).toHaveAttribute('aria-valuetext', 'linkage_depth 0.260, amount 0.340')
    expect(within(circ).getByTestId('sum-R-CIRC')).toHaveTextContent('total 1.000')
    expect(circ).toHaveTextContent('unsaved, becomes v2')
    expect(screen.getByTestId('rules-status')).toHaveTextContent('1 change in 1 rule')
    await user.click(screen.getByRole('button', { name: 'Save 1 rule' }))
    await waitFor(() => {
      expect(sent).toEqual({ weights: { linkage_depth: 0.26, amount: 0.34, temporal_proximity: 0.25, account_velocity: 0.15 } })
    })
    expect(await screen.findByText('All rules saved')).toBeInTheDocument()
    expect(screen.getByTestId('rule-R-CIRC')).toHaveTextContent('v2 · Asha Admin')
    expect(useToasts.getState().toasts[0]?.title).toBe('Saved R-CIRC as version 2')
  })

  it('switching a rule off sends enabled false', async () => {
    let sent: unknown = null
    open({
      'PUT /v1/rules/R-DORMANT': (init) => {
        sent = JSON.parse(init?.body as string)
        return json({ ...DORMANT, version: 2, enabled: false })
      },
    })
    const dormant = await screen.findByTestId('rule-R-DORMANT')
    const user = userEvent.setup()
    await user.click(within(dormant).getByRole('switch', { name: 'R-DORMANT detects' }))
    expect(within(dormant).getByRole('switch', { name: 'R-DORMANT detects' })).toHaveAttribute('aria-checked', 'false')
    await user.click(screen.getByRole('button', { name: 'Save 1 rule' }))
    await waitFor(() => {
      expect(sent).toEqual({ enabled: false })
    })
  })

  it('opens settings and history: edits are checked as typed, history names who changed what', async () => {
    open()
    const circ = await screen.findByTestId('rule-R-CIRC')
    const user = userEvent.setup()
    await user.click(within(circ).getByRole('button', { name: /Settings & history/ }))
    expect(await within(circ).findByText(/Asha Admin/)).toBeInTheDocument()
    expect(within(circ).getByText((_, el) => el?.tagName === 'LI' && el.textContent === 'window_hours 72 → 96')).toBeInTheDocument()
    const field = within(circ).getByLabelText(/^Window/)
    await user.clear(field)
    await user.type(field, '-4')
    expect(within(circ).getByText('Cannot be negative')).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('rules-status')).toHaveTextContent('Fix the highlighted settings to save')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.getByTestId('rules-status')).toHaveTextContent('All rules saved')
  })

  it('shows lists and maps as read-only lines', async () => {
    open({ 'GET /v1/rules/R-PROFILE_ROLE/history': () => json([]) })
    const role = await screen.findByTestId('rule-R-PROFILE_ROLE')
    await userEvent.setup().click(within(role).getByRole('button', { name: /Settings & history/ }))
    expect(within(role).getByText('tx.approve → teller, manager')).toBeInTheDocument()
    expect(within(role).getByText('09:00–19:00')).toBeInTheDocument()
    expect(within(role).queryByLabelText('Business hours')).toBeNull()
  })

  it('keeps a rule unsaved and says why when the server refuses it', async () => {
    open({ 'PUT /v1/rules/R-CIRC': () => json({ detail: 'weights must sum to 1.0 (±0.001); they sum to 0.9900', code: 'validation_error' }, 422) })
    const circ = await screen.findByTestId('rule-R-CIRC')
    within(circ).getAllByRole('slider')[0]?.focus()
    const user = userEvent.setup()
    await user.keyboard('{ArrowRight}')
    await user.click(screen.getByRole('button', { name: 'Save 1 rule' }))
    expect(await within(circ).findByRole('alert')).toHaveTextContent('R-CIRC was not saved: weights must sum to 1.0')
    expect(circ).toHaveTextContent('unsaved, becomes v2')
  })
})
