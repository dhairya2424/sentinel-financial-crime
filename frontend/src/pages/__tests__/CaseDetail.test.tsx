import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaseDetail as CaseData, CaseStatus, Role, User } from '@/api/types'
import { DETAIL } from '@/components/alert/__tests__/AlertDetail.test'
import { routes } from '@/routes'
import { useAuth } from '@/store/auth'
import { useCases } from '@/store/cases'
import { useHealth } from '@/store/health'
import { json, mockApi } from '@/test/fetch'

const userFor = (role: Role): User => ({ id: `usr_${role}`, email: `${role}@demo.dev`, role, tenant_id: 'tenant_demo', full_name: `Demo ${role}` })

const CASE: CaseData = {
  id: 'case_01',
  case_number: 'CASE-2026-0001',
  title: 'Loop through payee accounts',
  description: null,
  priority: 'high',
  status: 'in_review',
  assignee_id: 'usr_investigator',
  assignee_name: 'Demo investigator',
  created_by: 'usr_investigator',
  created_by_name: 'Demo investigator',
  created_at: '2026-09-30T04:40:00Z',
  updated_at: '2026-09-30T04:40:00Z',
  closed_at: null,
  export_digest: null,
  alert_count: 1,
  top_band: 'high',
  alerts: [
    {
      id: 'alert_loop',
      rule_code: 'R-CIRC',
      title: 'Circular transfer across 3 accounts',
      risk_band: 'high',
      risk_score: 74,
      status: 'linked_to_case',
      entity_ids: ['acct_1158'],
      primary_entity: 'acct_1158',
      entities: [{ id: 'acct_1158', type: 'account', label: 'XXXXXXXX1158' }],
      amount_total: '720000.00',
      detected_at: '2026-09-30T04:30:00Z',
      occurrence_count: 1,
    },
  ],
  notes: [{ id: 'note_1', author_id: 'usr_investigator', author_name: 'Demo investigator', body: 'Called the branch.', created_at: '2026-09-30T04:45:00Z' }],
  audit: [
    {
      id: 1,
      at: '2026-09-30T04:40:00Z',
      actor_user: 'usr_manager',
      actor_name: 'Demo manager',
      actor_kind: 'user',
      action: 'case.assign',
      object_type: 'case',
      object_id: 'case_01',
      detail: { from: null, to: 'usr_investigator', status: { from: 'open', to: 'in_review' } },
    },
  ],
}
const PEOPLE = [
  { id: 'usr_investigator', full_name: 'Demo investigator', role: 'investigator' },
  { id: 'usr_manager', full_name: 'Demo manager', role: 'manager' },
]
const LABEL: Record<CaseStatus, string> = {
  open: 'Open',
  in_review: 'In review',
  escalated: 'Escalated',
  closed_confirmed: 'Closed, confirmed',
  closed_false_positive: 'Closed, false positive',
}

function open(role: Role, data: CaseData, extra: Parameters<typeof mockApi>[0] = {}) {
  const user = userFor(role)
  useAuth.setState({ user, accessToken: 'token', refreshToken: 'refresh', signOutReason: null })
  const api = mockApi({
    'GET /v1/auth/me': () => json(user),
    'GET /v1/cases/case_01': () => json(data),
    'GET /v1/users/assignees': () => json(PEOPLE),
    ...extra,
  })
  const router = createMemoryRouter(routes, { initialEntries: ['/cases/case_01'] })
  render(<RouterProvider router={router} />)
  return api
}

const option = (status: CaseStatus) => within(screen.getByLabelText('Status')).getByRole('option', { name: LABEL[status] })

describe('Case detail', () => {
  beforeEach(() => {
    useHealth.setState({ connection: 'connected', services: { db: 'ok', redis: 'ok' } })
    useCases.setState({ items: [], fresh: new Set() })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the case file: header, linked alerts, notes and the audit trail', async () => {
    open('investigator', CASE)
    expect(await screen.findByRole('heading', { level: 1, name: CASE.title })).toBeInTheDocument()
    expect(screen.getByText('CASE-2026-0001')).toBeInTheDocument()
    expect(screen.getByTestId('linked-alert')).toHaveTextContent('Circular transfer across 3 accounts')
    expect(screen.getByTestId('case-note')).toHaveTextContent('Called the branch.')
    const trail = screen.getByTestId('audit-row')
    expect(trail).toHaveTextContent('Assigned · Demo manager')
    expect(trail).toHaveTextContent('nobody → Demo investigator · open → in review')
    expect(within(screen.getByRole('list', { name: 'Lifecycle' })).getByText('In review')).toHaveAttribute('aria-current', 'step')
  })

  it('T-FE-12: the status dropdown only enables transitions docs/04 §6 allows', async () => {
    open('investigator', CASE)
    await screen.findByLabelText('Status')
    expect(option('open')).toBeDisabled()
    expect(option('open')).toHaveAttribute('title', 'invalid transition')
    expect(option('escalated')).toBeEnabled()
    expect(option('closed_confirmed')).toBeEnabled()
    expect(option('closed_false_positive')).toBeEnabled()
  })

  it('T-FE-12: from open, escalation is invalid and closing is a manager’s call', async () => {
    open('investigator', { ...CASE, status: 'open' })
    await screen.findByLabelText('Status')
    expect(option('escalated')).toBeDisabled()
    expect(option('escalated')).toHaveAttribute('title', 'invalid transition')
    expect(option('in_review')).toBeEnabled()
    expect(option('closed_confirmed')).toHaveAttribute('title', 'only a manager can close a case that was never reviewed')
  })

  it('T-FE-13: closing needs a note of at least 10 characters and shows the server’s refusal', async () => {
    const patches: unknown[] = []
    open('investigator', CASE, {
      'PATCH /v1/cases/case_01': (init) => {
        patches.push(JSON.parse(init?.body as string))
        return json({ detail: 'close_note required (>=10 chars)', code: 'validation_error' }, 422)
      },
    })
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByLabelText('Status'), 'closed_false_positive')
    const dialog = screen.getByRole('dialog', { name: 'Close CASE-2026-0001' })
    expect(within(dialog).getByRole('radio', { name: /False positive/ })).toBeChecked()
    await user.type(within(dialog).getByLabelText('Disposition note'), 'too short')
    await user.click(within(dialog).getByRole('button', { name: 'Close as false positive' }))
    expect(within(dialog).getByText('Write at least 10 characters.')).toBeInTheDocument()
    expect(patches).toEqual([])

    await user.type(within(dialog).getByLabelText('Disposition note'), ' but now long enough')
    await user.click(within(dialog).getByRole('button', { name: 'Close as false positive' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Not closed: close_note required (>=10 chars)')
    expect(patches).toEqual([{ status: 'closed_false_positive', close_note: 'too short but now long enough' }])
  })

  it('export downloads the bundle through a blob and reports its digest', async () => {
    const digest = 'e83c87a9fcd7c0a192244c45bda928fd14d53f00d3e9d8430bf8f099b7f4762f'
    open('investigator', CASE, {
      'GET /v1/cases/case_01/export': () =>
        new Response(JSON.stringify({ digest_sha256: digest }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="sentinel-case-CASE-2026-0001.json"', 'X-Digest-SHA256': digest },
        }),
    })
    const createUrl = vi.fn<(blob: Blob) => string>(() => 'blob:case')
    URL.createObjectURL = createUrl
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Export JSON' }))
    expect(await screen.findByText(/Saved/)).toHaveTextContent('Saved sentinel-case-CASE-2026-0001.json · SHA-256 e83c87a9…f4762f')
    expect(createUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('T-FE-01 regression: an alert opened from the case drawer still carries its evidence panel', async () => {
    open('investigator', CASE, {
      'GET /v1/alerts/alert_loop': () => json({ ...DETAIL, status: 'linked_to_case', linked_case_id: 'case_01' }),
      'GET /v1/alerts/alert_loop/graph': () => json({ nodes: [], edges: [], truncated: false }),
    })
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('linked-alert'))
    const drawer = screen.getByRole('dialog', { name: 'Circular transfer across 3 accounts' })
    expect(within(drawer).getByTestId('evidence-panel')).toBeInTheDocument()
    expect(await within(drawer).findByTestId('alert-explanation')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('a viewer reads the case but every change is disabled', async () => {
    open('viewer', CASE)
    await screen.findByLabelText('Status')
    for (const label of ['Status', 'Priority', 'Assignee']) expect(screen.getByLabelText(label)).toBeDisabled()
    expect(screen.getByRole('button', { name: /Close case/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeDisabled()
    expect(screen.queryByLabelText('New note')).not.toBeInTheDocument()
    expect(screen.getByText('Your role can read cases but not change them.')).toBeInTheDocument()
  })

  it('an investigator can take a case but not hand it to someone else', async () => {
    open('investigator', { ...CASE, assignee_id: null, assignee_name: null, status: 'open' })
    const select = await screen.findByLabelText('Assignee')
    expect(within(select).getByRole('option', { name: 'Demo investigator (you)' })).toBeEnabled()
    expect(within(select).getByRole('option', { name: 'Demo manager' })).toBeDisabled()
  })
})
