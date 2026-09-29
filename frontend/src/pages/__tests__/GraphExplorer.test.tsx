import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { EntitySummary, Neighborhood, User } from '@/api/types'
import { routes } from '@/routes'
import { useAuth } from '@/store/auth'
import { useHealth } from '@/store/health'
import { json, mockApi } from '@/test/fetch'

const investigator: User = {
  id: 'usr_investigator',
  email: 'investigator@demo.dev',
  role: 'investigator',
  tenant_id: 'tenant_demo',
  full_name: 'Ishan Investigator',
}

const HOOD: Neighborhood = {
  truncated: false,
  nodes: [
    { id: 'cust_1', type: 'customer', label: 'Karan Apte', risk: 'low', degree: 3, depth: 0 },
    { id: 'acct_1', type: 'account', label: 'XXXXXXXX1158', risk: 'low', degree: 3, depth: 1 },
    { id: 'acct_2', type: 'account', label: 'XXXXXXXX5082', risk: 'low', degree: 2, depth: 2 },
    { id: 'acct_3', type: 'account', label: 'XXXXXXXX8018', risk: 'low', degree: 2, depth: 2 },
    { id: 'emp_1', type: 'employee', label: 'Ananya Patil', risk: 'low', degree: 2, depth: 1 },
  ],
  edges: [
    { id: 'holder:acct_1', source: 'cust_1', target: 'acct_1', type: 'ACCOUNT_HOLDER', props: {} },
    { id: 'tx_1', source: 'acct_1', target: 'acct_2', type: 'TRANSFER', props: { amount: '240000.00', ts: '2026-09-26T09:15:00Z' } },
    { id: 'tx_2', source: 'acct_2', target: 'acct_3', type: 'TRANSFER', props: { amount: '240000.00', ts: '2026-09-26T11:15:00Z' } },
    { id: 'tx_3', source: 'acct_3', target: 'acct_1', type: 'TRANSFER', props: { amount: '240000.00', ts: '2026-09-26T13:15:00Z' } },
    { id: 'act_1', source: 'emp_1', target: 'cust_1', type: 'PROFILE_CHANGE', props: { action: 'profile.edit', event_ts: '2026-09-25T10:00:00Z' } },
    { id: 'ar_1>cust_1', source: 'emp_1', target: 'cust_1', type: 'EMPLOYEE_ACCESS', props: { entitlement: 'profile.edit' } },
  ],
}

const ENTITY: EntitySummary = {
  type: 'customer',
  id: 'cust_1',
  label: 'Karan Apte',
  detail: 'CIF100018',
  risk_band: 'low',
  stats: { degree: 17, accounts: 2, transfer_count_30d: 25, sum_amount_30d: '115434.97' },
  links: { timeline: '/timeline/customer/cust_1', graph: '/graph?node=cust_1', alerts: '/alerts?entity=cust_1' },
}

function open(path: string, extra: Parameters<typeof mockApi>[0] = {}) {
  useAuth.setState({ user: investigator, accessToken: 'token', refreshToken: 'refresh', signOutReason: null })
  const api = mockApi({
    'GET /v1/auth/me': () => json(investigator),
    'GET /v1/graph/neighbors': () => json(HOOD),
    'GET /v1/graph/entity/cust_1': () => json(ENTITY),
    'GET /v1/graph/cycles': () => json({ cycles: [['acct_1', 'acct_2', 'acct_3']], legs: [['tx_1', 'tx_2', 'tx_3']] }),
    ...extra,
  })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return { ...api, router }
}

const urls = (calls: unknown[][]) => calls.map(([input]) => (input instanceof Request ? input.url : String(input)))

beforeEach(() => {
  useHealth.setState({ connection: 'connected', services: { db: 'ok', redis: 'ok' }, checkedAt: Date.now(), nextCheckAt: null })
})

describe('Graph Explorer', () => {
  it('asks for an entity when no node is in the URL, and search sets ?node', async () => {
    const { router } = open('/graph', {
      'GET /v1/graph/search': () => json([{ type: 'customer', id: 'cust_1', label: 'Karan Apte', detail: 'CIF100018', risk_band: 'low' }]),
    })
    expect(await screen.findByRole('heading', { name: 'Search an entity to start' })).toBeInTheDocument()
    const ue = userEvent.setup()
    await ue.type(screen.getByRole('combobox'), 'Karan')
    await ue.click(await screen.findByRole('option', { name: /Karan Apte/ }))
    expect(router.state.location.search).toBe('?node=cust_1&depth=2')
  })

  it('loads the neighbourhood from ?node&depth and shows the entity panel with its links', async () => {
    const { fetchMock } = open('/graph?node=cust_1&depth=1')
    expect(await screen.findByLabelText('customer Karan Apte')).toBeInTheDocument()
    expect(urls(fetchMock.mock.calls).some((u) => u.includes('/v1/graph/neighbors?node_id=cust_1&depth=1'))).toBe(true)
    const panel = screen.getByRole('complementary', { name: 'Graph details' })
    expect(await within(panel).findByRole('heading', { name: /Karan Apte/ })).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: /View timeline/ })).toHaveAttribute('href', '/timeline/customer/cust_1')
    expect(within(panel).getByRole('link', { name: /Alerts/ })).toHaveAttribute('href', '/alerts?entity=cust_1')
    expect(within(panel).getByText('₹1,15,434.97')).toBeInTheDocument()
  })

  it('T-FE-11: Highlight cycles calls the cycles endpoint for the focus accounts and reports the loop', async () => {
    const { fetchMock } = open('/graph?node=cust_1&depth=2')
    await screen.findByLabelText('customer Karan Apte')
    const toggle = screen.getByRole('switch', { name: 'Highlight cycles' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await userEvent.setup().click(toggle)
    expect(await screen.findByText('1 loop in the last 72 hours')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(urls(fetchMock.mock.calls).some((u) => u.includes('/v1/graph/cycles?node_id=acct_1&window_hours=72'))).toBe(true)
  })

  it('edge-type filters use the enum names and toggle instantly', async () => {
    open('/graph?node=cust_1&depth=2')
    await screen.findByLabelText('customer Karan Apte')
    const group = screen.getByRole('group', { name: 'Edge types' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'TRANSFER',
      'ACCOUNT_HOLDER',
      'EMPLOYEE_ACCESS',
      'PROFILE_CHANGE',
      'EMPLOYEE_ACTION',
    ])
    const transfer = within(group).getByRole('button', { name: 'TRANSFER' })
    await userEvent.setup().click(transfer)
    expect(transfer).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the who-touched-what grid for the employees in view', async () => {
    open('/graph?node=cust_1&depth=2')
    await screen.findByLabelText('customer Karan Apte')
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Who touched what' }))
    const table = screen.getByRole('table', { name: /Employees who changed or can access/ })
    expect(within(table).getByRole('columnheader', { name: /Ananya Patil/ })).toBeInTheDocument()
    expect(within(table).getByText('Ananya Patil on Karan Apte: 1 profile change, has access')).toBeInTheDocument()
  })

  it('shows a retry when the neighbourhood cannot be loaded', async () => {
    let calls = 0
    open('/graph?node=cust_1&depth=2', {
      'GET /v1/graph/neighbors': () => {
        calls += 1
        return calls === 1 ? json({ detail: 'node not found', code: 'not_found' }, 404) : json(HOOD)
      },
    })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('node not found')
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText('customer Karan Apte')).toBeInTheDocument()
  })
})
