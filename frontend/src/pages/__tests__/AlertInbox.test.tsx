import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AlertDetail, AlertRow, User } from '@/api/types'
import { routes } from '@/routes'
import { useAlerts } from '@/store/alerts'
import { useAuth } from '@/store/auth'
import { useHealth } from '@/store/health'
import { useToasts } from '@/store/toasts'
import { json, mockApi } from '@/test/fetch'
import { FakeWebSocket } from '@/test/ws'

const investigator: User = { id: 'usr_i', email: 'investigator@demo.dev', role: 'investigator', tenant_id: 'tenant_demo', full_name: 'Ishan Investigator' }
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const LOOP: AlertRow = {
  id: 'alert_loop',
  rule_code: 'R-CIRC',
  title: 'Circular transfer across 3 accounts',
  risk_band: 'high',
  risk_score: 74,
  status: 'open',
  entity_ids: ['acct_1158', 'cust_karan'],
  primary_entity: 'acct_1158',
  entities: [
    { id: 'acct_1158', type: 'account', label: 'XXXXXXXX1158' },
    { id: 'cust_karan', type: 'customer', label: 'Karan Apte' },
  ],
  amount_total: '720000.00',
  detected_at: ago(12),
  occurrence_count: 1,
}
const OLDER: AlertRow = {
  ...LOOP,
  id: 'alert_old',
  title: 'Role-action mismatch',
  rule_code: 'R-PROFILE_ROLE',
  risk_band: 'medium',
  risk_score: 55,
  status: 'acknowledged',
  amount_total: null,
  entities: [{ id: 'emp_1', type: 'employee', label: 'Tanvi Deshmukh' }],
  entity_ids: ['emp_1'],
  detected_at: ago(60 * 26),
  occurrence_count: 2,
}
const LIVE: AlertRow = {
  ...LOOP,
  id: 'alert_live',
  title: 'Transaction structuring',
  rule_code: 'R-STRUCT',
  risk_band: 'critical',
  risk_score: 88,
  detected_at: new Date().toISOString(),
  amount_total: '141400.00',
  entities: [{ id: 'cust_meera', type: 'customer', label: 'Meera Kulkarni' }],
  entity_ids: ['cust_meera'],
}
const detail = (row: AlertRow): AlertDetail => ({
  ...row,
  rule_version: 1,
  explanation: `${row.title} explained.`,
  risk_factors: [{ name: 'linkage_depth', raw_value: '3 hops', weight: 1, contribution: row.risk_score / 100 }],
  window_start: row.detected_at,
  window_end: row.detected_at,
  updated_at: row.detected_at,
  evidence: [],
  linked_case_id: null,
})

function open(path: string, extra: Parameters<typeof mockApi>[0] = {}, user: User = investigator) {
  useAuth.setState({ user, accessToken: 'token', refreshToken: 'refresh', signOutReason: null })
  const api = mockApi({
    'GET /v1/auth/me': () => json(user),
    'GET /v1/alerts': () => json({ items: [LOOP, OLDER], next_cursor: null }),
    'GET /v1/alerts/alert_loop': () => json(detail(LOOP)),
    'GET /v1/alerts/alert_live': () => json(detail(LIVE)),
    'GET /v1/alerts/alert_loop/graph': () => json({ nodes: [], edges: [], truncated: false }),
    'GET /v1/timeline/customer/cust_karan': () =>
      json({ entity: { type: 'customer', id: 'cust_karan', label: 'Karan Apte', detail: null }, items: [], next_cursor: null }),
    ...extra,
  })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return { ...api, router }
}

const queryOf = (calls: unknown[][], path: string) =>
  calls
    .map(([input]) => new URL(String(input)))
    .filter((u) => u.pathname === path)
    .map((u) => u.searchParams)

describe('Alert Inbox', () => {
  beforeEach(() => {
    useHealth.setState({ connection: 'connected', services: { db: 'ok', redis: 'ok' } })
    useAlerts.setState({ items: [], cursor: null, fresh: new Set() })
    useToasts.setState({ toasts: [] })
  })

  it('lists alerts newest first with the names people know, amounts and status', async () => {
    open('/alerts')
    const rows = await screen.findAllByTestId('alert-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Circular transfer across 3 accounts')
    expect(rows[0]).toHaveTextContent('Karan Apte')
    expect(rows[0]).toHaveTextContent('₹7,20,000')
    expect(rows[0]).toHaveTextContent('12m ago')
    expect(rows[1]).toHaveTextContent('Tanvi Deshmukh')
    expect(rows[1]).toHaveTextContent('Acknowledged')
    expect(rows[1]).toHaveTextContent('×2')
    expect(screen.getByRole('heading', { name: 'Pick an alert' })).toBeInTheDocument()
  })

  it('opens the detail on the right with the evidence panel mounted', async () => {
    open('/alerts/alert_loop')
    const detailPane = await screen.findByRole('region', { name: 'Alert detail' })
    expect(await within(detailPane).findByTestId('alert-explanation')).toHaveTextContent('Circular transfer across 3 accounts explained.')
    expect(within(detailPane).getByTestId('evidence-panel')).toBeInTheDocument()
    expect(screen.getAllByTestId('alert-row')[0]?.querySelector('button')).toHaveAttribute('aria-current', 'true')
  })

  it('T-FE-07: an alert.created message raises a toast and prepends the row without taking over the open alert', async () => {
    const { router } = open('/alerts/alert_loop')
    await screen.findAllByTestId('alert-row')
    const ws = FakeWebSocket.latest()
    expect(ws?.url).toContain('/v1/ws?token=token')
    act(() => {
      ws?.open()
    })
    expect(ws?.sent).toContainEqual({ op: 'subscribe', channels: expect.arrayContaining(['alerts:tenant_demo', 'cases:tenant_demo']) as unknown })
    act(() => {
      ws?.receive({ channel: 'alerts:tenant_demo', type: 'alert.created', data: { ...LIVE, entity_ids: LIVE.entity_ids } })
    })
    expect(await screen.findByRole('button', { name: 'New critical alert: Transaction structuring' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByTestId('alert-row')).toHaveLength(3)
    })
    const first = screen.getAllByTestId('alert-row')[0]
    expect(first).toHaveTextContent('Transaction structuring')
    expect(first).toHaveTextContent('Meera Kulkarni')
    expect(first).toHaveAttribute('data-fresh', 'true')
    expect(router.state.location.pathname).toBe('/alerts/alert_loop')
  })

  it('band chips and the rule select drive the API query and the URL', async () => {
    const { fetchMock, router } = open('/alerts')
    await screen.findAllByTestId('alert-row')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Critical' }))
    await user.selectOptions(screen.getByLabelText('Rule'), 'R-CIRC')
    await waitFor(() => {
      const last = queryOf(fetchMock.mock.calls, '/v1/alerts').at(-1)
      expect(last?.get('band')).toBe('critical')
      expect(last?.get('rule')).toBe('R-CIRC')
      expect(last?.get('status')).toBe('open,acknowledged')
    })
    expect(router.state.location.search).toContain('band=critical')
  })

  it('an entity deep link filters by that entity', async () => {
    const { fetchMock } = open('/alerts?entity=cust_karan')
    await screen.findAllByTestId('alert-row')
    expect(queryOf(fetchMock.mock.calls, '/v1/alerts').at(-1)?.get('entity')).toBe('cust_karan')
    expect(screen.getByRole('button', { name: 'Clear entity filter' })).toBeInTheDocument()
  })

  it('the keyboard cursor stays on its alert when a live one arrives above it, and only shows after keyboard use', async () => {
    const { router } = open('/alerts/alert_loop', { 'GET /v1/alerts/alert_old': () => json(detail(OLDER)) })
    await screen.findAllByTestId('alert-row')
    expect(document.querySelector('[data-cursor]')).toBeNull()
    const user = userEvent.setup()
    await user.keyboard('{ArrowDown}')
    expect(document.querySelector('[data-cursor]')).toHaveAttribute('data-id', 'alert_old')
    act(() => {
      FakeWebSocket.latest()?.open()
    })
    act(() => {
      FakeWebSocket.latest()?.receive({ channel: 'alerts:tenant_demo', type: 'alert.created', data: LIVE })
    })
    await waitFor(() => {
      expect(screen.getAllByTestId('alert-row')).toHaveLength(3)
    })
    expect(document.querySelector('[data-cursor]')).toHaveAttribute('data-id', 'alert_old')
    await user.keyboard('{Enter}')
    expect(router.state.location.pathname).toBe('/alerts/alert_old')
    expect(document.querySelector('[data-cursor]')).toBeNull()
  })

  it('A acknowledges the row under the keyboard cursor', async () => {
    let posted = 0
    open('/alerts', {
      'POST /v1/alerts/alert_loop/acknowledge': () => {
        posted += 1
        return json({ ...detail(LOOP), status: 'acknowledged' })
      },
    })
    await screen.findAllByTestId('alert-row')
    const user = userEvent.setup()
    await user.keyboard('a')
    await waitFor(() => {
      expect(posted).toBe(1)
    })
    expect(screen.getAllByTestId('alert-row')[0]).toHaveTextContent('Acknowledged')
  })

  it('shows the empty state with a way to clear filters', async () => {
    open('/alerts?band=low', { 'GET /v1/alerts': () => json({ items: [], next_cursor: null }) })
    expect(await screen.findByRole('heading', { name: 'No alerts match filters' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  it('T-FE-15: a dropped socket shows the live-updates banner', async () => {
    open('/alerts')
    await screen.findAllByTestId('alert-row')
    act(() => {
      FakeWebSocket.latest()?.open()
    })
    act(() => {
      FakeWebSocket.latest()?.drop()
    })
    expect(await screen.findByTestId('live-banner', {}, { timeout: 3000 })).toHaveTextContent('Live updates paused — reconnecting…')
  })
})
