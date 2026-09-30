import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AlertDetail as AlertDetailData, User } from '@/api/types'
import { useAlerts } from '@/store/alerts'
import { useAuth } from '@/store/auth'
import { json, mockApi } from '@/test/fetch'
import { AlertDetail } from '../AlertDetail'

const investigator: User = { id: 'usr_i', email: 'investigator@demo.dev', role: 'investigator', tenant_id: 'tenant_demo', full_name: 'Ishan Investigator' }

export const DETAIL: AlertDetailData = {
  id: 'alert_loop',
  rule_code: 'R-CIRC',
  rule_version: 1,
  title: 'Circular transfer across 3 accounts',
  risk_band: 'high',
  risk_score: 74,
  status: 'open',
  entity_ids: ['acct_1158', 'acct_5082', 'cust_karan'],
  primary_entity: 'acct_1158',
  entities: [
    { id: 'acct_1158', type: 'account', label: 'XXXXXXXX1158' },
    { id: 'acct_5082', type: 'account', label: 'XXXXXXXX5082' },
    { id: 'cust_karan', type: 'customer', label: 'Karan Apte' },
  ],
  amount_total: '720000.00',
  detected_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  occurrence_count: 1,
  explanation: '₹7,20,000 moved in a loop across 3 accounts within 4h: XXXXXXXX1158 (Karan Apte) → XXXXXXXX5082 (Priya Khan) → XXXXXXXX1158 (Karan Apte).',
  risk_factors: [
    { name: 'linkage_depth', raw_value: '3 hops', weight: 0.25, contribution: 0.25 },
    { name: 'temporal_proximity', raw_value: '4h of 72h window', weight: 0.25, contribution: 0.2361 },
    { name: 'amount', raw_value: 'no baseline', weight: 0.35, contribution: 0.175, imputed: true },
    { name: 'account_velocity', raw_value: 'no baseline', weight: 0.15, contribution: 0.075, imputed: true },
  ],
  window_start: '2026-09-28T03:37:19Z',
  window_end: '2026-09-28T07:37:19Z',
  updated_at: '2026-09-30T04:32:17Z',
  evidence: [
    {
      evidence_type: 'transaction',
      ref_id: 'tx_demo_loop_1',
      captured_at: '2026-09-30T04:32:17Z',
      snapshot: { id: 'tx_demo_loop_1', amount: '240000.00', value_ts: '2026-09-28T03:37:19+00:00', from_account_id: 'acct_1158', to_account_id: 'acct_5082' },
    },
  ],
  linked_case_id: null,
}

const GRAPH = { nodes: [], edges: [], truncated: false }
const TIMELINE = { entity: { type: 'customer', id: 'cust_karan', label: 'Karan Apte', detail: null }, items: [], next_cursor: null }

function show(handlers: Parameters<typeof mockApi>[0]) {
  const api = mockApi({
    'GET /v1/alerts/alert_loop/graph': () => json(GRAPH),
    'GET /v1/timeline/customer/cust_karan': () => json(TIMELINE),
    ...handlers,
  })
  render(
    <MemoryRouter>
      <AlertDetail alertId="alert_loop" />
    </MemoryRouter>,
  )
  return api
}

describe('AlertDetail', () => {
  beforeEach(() => {
    useAuth.setState({ user: investigator, accessToken: 'token', refreshToken: 'refresh', signOutReason: null })
    useAlerts.setState({ items: [], fresh: new Set() })
  })

  it('T-FE-01: the evidence panel is mounted while the alert is still loading', () => {
    show({ 'GET /v1/alerts/alert_loop': () => new Promise<Response>(() => undefined) })
    expect(screen.getByTestId('evidence-panel')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading evidence' })).toBeInTheDocument()
  })

  it('T-FE-03: when the alert cannot be read the panel still says why, inside itself', async () => {
    show({ 'GET /v1/alerts/alert_loop': () => json({ detail: 'database unavailable', code: 'error' }, 503) })
    const panel = await screen.findByTestId('evidence-panel')
    expect(await within(panel).findByText('Evidence unavailable — data retention issue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument()
  })

  it('T-FE-06: factors show raw value, weight and contribution, and the composite equals their sum', async () => {
    show({ 'GET /v1/alerts/alert_loop': () => json(DETAIL) })
    const rows = await screen.findAllByTestId('factor-row')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('linkage_depth')
    expect(rows[0]).toHaveTextContent('3 hops')
    expect(rows[0]).toHaveTextContent('0.25')
    expect(rows[0]).toHaveTextContent('25.0')
    expect(rows[1]).toHaveTextContent('4h of 72h window')
    expect(screen.getByTestId('composite')).toHaveTextContent('73.6 → 74')
    expect(screen.getByText(/25\.0 \+ 23\.6 \+ 17\.5 \+ 7\.5 = 73\.6, rounded 74/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Score 74 of 100/ })).toBeInTheDocument()
  })

  it('factors held at a neutral default are marked as such, and the note says how many points they carry', async () => {
    show({ 'GET /v1/alerts/alert_loop': () => json(DETAIL) })
    const rows = await screen.findAllByTestId('factor-row')
    const imputed = rows.filter((r) => r.dataset.imputed === 'true')
    expect(imputed.map((r) => r.textContent)).toEqual([expect.stringContaining('amount'), expect.stringContaining('account_velocity')])
    expect(imputed[0]).toHaveTextContent('no baseline · neutral default')
    expect(rows[0]?.dataset.imputed).toBeUndefined()
    expect(screen.getByTestId('neutral-note')).toHaveTextContent('25.0 of the 74 points are neutral defaults for amount and account_velocity')
    expect(screen.getByRole('img', { name: /amount 17\.5 \(neutral default\)/ })).toBeInTheDocument()
  })

  it('shows the server explanation and every entity by name, with the evidence panel alongside', async () => {
    show({ 'GET /v1/alerts/alert_loop': () => json(DETAIL) })
    expect(await screen.findByTestId('alert-explanation')).toHaveTextContent('moved in a loop across 3 accounts')
    expect(screen.getByRole('link', { name: /Karan Apte, customer/ })).toBeInTheDocument()
    expect(screen.getByText('₹7,20,000').parentElement).toHaveTextContent('Total ₹7,20,000')
    expect(within(screen.getByTestId('evidence-panel')).getByRole('heading', { name: 'Evidence (1)' })).toBeInTheDocument()
  })

  it('Acknowledge calls the API and the status follows', async () => {
    let posted = 0
    show({
      'GET /v1/alerts/alert_loop': () => json(DETAIL),
      'POST /v1/alerts/alert_loop/acknowledge': () => {
        posted += 1
        return json({ ...DETAIL, status: 'acknowledged' })
      },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Acknowledge' }))
    expect(await screen.findByRole('button', { name: 'Acknowledged' })).toBeDisabled()
    expect(screen.getByTestId('alert-status')).toHaveTextContent('Acknowledged')
    expect(posted).toBe(1)
  })

  it('a refused acknowledge is put back and explained', async () => {
    show({
      'GET /v1/alerts/alert_loop': () => json(DETAIL),
      'POST /v1/alerts/alert_loop/acknowledge': () =>
        json({ detail: 'only an open alert can be acknowledged; this one is linked_to_case', code: 'conflict' }, 409),
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Acknowledge' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not acknowledged: only an open alert can be acknowledged')
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeEnabled()
  })

  it('viewers can read everything but not act', async () => {
    useAuth.setState({ user: { ...investigator, role: 'viewer' } })
    show({ 'GET /v1/alerts/alert_loop': () => json(DETAIL) })
    expect(await screen.findByRole('button', { name: 'Acknowledge' })).toBeDisabled()
    expect(screen.getByTestId('evidence-panel')).toBeInTheDocument()
  })

  it('→ Case opens the case dialog, which says when cases arrive', async () => {
    show({ 'GET /v1/alerts/alert_loop': () => json(DETAIL) })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Case/ }))
    const dialog = screen.getByRole('dialog', { name: 'Start a case' })
    expect(dialog).toHaveTextContent('P4')
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
