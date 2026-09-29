import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RawRecord, TimelineCategory, TimelineItem, TimelinePage, User } from '@/api/types'
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
const EMPLOYEE = { id: 'emp_01brn1q120dbtq5cfsxabr9934', name: 'Ananya Patil' }
const PATH = '/v1/timeline/customer/cust_1'

const tx = (ref: string, ts: string, title: string, value: string): TimelineItem => ({
  ts,
  category: 'transaction',
  title,
  actor: null,
  value,
  target: null,
  event_kind: 'transaction',
  ref_id: ref,
  direction: 'out',
})
const action = (ref: string, ts: string, category: TimelineCategory, title: string): TimelineItem => ({
  ts,
  category,
  title,
  actor: EMPLOYEE,
  value: null,
  target: 'cust_1',
  event_kind: 'employee_action',
  ref_id: ref,
})

const ITEMS: TimelineItem[] = [
  tx('tx_b', '2026-09-26T09:00:00Z', 'UPI payment · IRCTC', '2156.35'),
  action('act_2', '2026-08-17T09:08:30Z', 'approval', 'Approved transfer of ₹1,47,000'),
  tx('tx_a', '2026-09-27T15:54:52Z', 'ATM cash withdrawal', '7000.00'),
  tx('tx_c', '2026-08-17T09:20:00Z', 'RTGS · Mutual fund SIP', '147000.00'),
  action('act_1', '2026-09-26T12:44:34Z', 'profile_change', 'Edited profile · KYC document'),
]

const page = (items: TimelineItem[]): TimelinePage => ({
  entity: { type: 'customer', id: 'cust_1', label: 'Karan Apte', detail: 'CIF100018 · salaried · MUM-01' },
  items,
  next_cursor: null,
})

const RAW: Record<string, RawRecord> = {
  act_1: {
    kind: 'employee_action',
    source_table: 'employee_actions',
    record: {
      id: 'act_1',
      action_type: 'profile.edit',
      target_type: 'customer',
      target_id: 'cust_1',
      before_state: { kyc_document: 'Aadhaar XXXX-XXXX-8239' },
      after_state: { kyc_document: 'Passport X2226670' },
      session_id: 'sess_1',
      ip_address: '10.20.3.25',
    },
  },
  tx_a: {
    kind: 'transaction',
    source_table: 'transactions',
    record: {
      id: 'tx_a',
      from_account_id: 'acct_1',
      to_account_id: null,
      amount: '7000.00',
      channel: 'atm',
      reference_no: 'ATM260927123456',
      status: 'completed',
      raw: { narration: 'ATM CASH WITHDRAWAL' },
    },
  },
}

function open(handlers: Parameters<typeof mockApi>[0] = {}) {
  useAuth.setState({ user: investigator, accessToken: 'token', refreshToken: 'refresh', signOutReason: null })
  const api = mockApi({
    'GET /v1/auth/me': () => json(investigator),
    [`GET ${PATH}`]: () => json(page(ITEMS)),
    'GET /v1/timeline/raw/employee_action/act_1': () => json(RAW.act_1),
    'GET /v1/timeline/raw/transaction/tx_a': () => json(RAW.tx_a),
    ...handlers,
  })
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/timeline/customer/cust_1'] })} />)
  return api
}

const rows = () => screen.findAllByTestId('timeline-item')

beforeEach(() => {
  useHealth.setState({ connection: 'connected', services: { db: 'ok', redis: 'ok' }, checkedAt: Date.now(), nextCheckAt: null })
})

describe('Activity Timeline', () => {
  it('T-FE-08: renders items in descending ts order', async () => {
    open()
    const stamps = (await rows()).map((row) => row.dataset.ts ?? '')
    expect(stamps).toEqual([...stamps].sort().reverse())
    expect(stamps[0]).toBe('2026-09-27T15:54:52Z')
    expect(screen.getByRole('heading', { level: 1, name: 'Karan Apte' })).toBeInTheDocument()
  })

  it('T-FE-09: shows the actor chip on every profile change and approval row, linking to the employee timeline', async () => {
    open()
    for (const row of await rows()) {
      const chip = within(row).queryByTestId('timeline-actor')
      if (row.dataset.category === 'transaction') {
        expect(chip).toBeNull()
      } else {
        expect(chip).toHaveAttribute('href', `/timeline/employee/${EMPLOYEE.id}`)
        expect(chip).toHaveTextContent('Ananya Patil')
      }
    }
  })

  it('filters by category chip on the client and refetches with the categories param', async () => {
    const { fetchMock } = open()
    await rows()
    const ue = userEvent.setup()
    const chip = screen.getByRole('button', { name: 'Transaction' })
    await ue.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    const categories = (await rows()).map((row) => row.dataset.category)
    expect(categories).not.toContain('transaction')
    expect(categories).toHaveLength(2)
    const urls = fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : input.toString()))
    expect(urls.some((u) => u.includes(`${PATH}?categories=profile_change%2Caccess_login%2Capproval`))).toBe(true)
  })

  it('shows the empty state when nothing is in range', async () => {
    open({ [`GET ${PATH}`]: () => json(page([])) })
    expect(await screen.findByRole('heading', { name: 'No activity in range' })).toBeInTheDocument()
  })

  it('shows an error with retry, and recovers when the retry succeeds', async () => {
    let calls = 0
    open({
      [`GET ${PATH}`]: () => {
        calls += 1
        return calls === 1 ? json({ detail: 'database unavailable', code: 'error' }, 503) : json(page(ITEMS))
      },
    })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The timeline could not be loaded')
    expect(alert).toHaveTextContent('database unavailable')
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await rows()).toHaveLength(5)
  })

  it('reports a missing or foreign entity as not found', async () => {
    open({ [`GET ${PATH}`]: () => json({ detail: 'customer not found', code: 'not_found' }, 404) })
    expect(await screen.findByRole('heading', { name: 'No customer with this id' })).toBeInTheDocument()
  })

  it('opens an employee change in the inspector by default, with before and after values', async () => {
    open()
    const inspector = await screen.findByRole('complementary', { name: 'Event details' })
    expect(within(inspector).getByRole('heading', { name: 'Edited profile · KYC document' })).toBeInTheDocument()
    expect(await within(inspector).findByText('Passport X2226670')).toBeInTheDocument()
    expect(within(inspector).getByText('Aadhaar XXXX-XXXX-8239')).toHaveClass('line-through')
    expect(within(inspector).getByTestId('timeline-raw')).toHaveTextContent('"action_type": "profile.edit"')
  })

  it('shows full transaction details and the raw record when a transaction is selected', async () => {
    open()
    await rows()
    await userEvent.setup().click(screen.getByRole('button', { name: /ATM cash withdrawal/ }))
    const inspector = screen.getByRole('complementary', { name: 'Event details' })
    expect(await within(inspector).findByText('ATM260927123456')).toBeInTheDocument()
    expect(within(inspector).getByText('Money out')).toBeInTheDocument()
    expect(within(inspector).getByText('atm')).toBeInTheDocument()
    expect(within(inspector).getByText('₹7,000')).toBeInTheDocument()
    expect(within(inspector).getByTestId('timeline-raw')).toHaveTextContent('"reference_no": "ATM260927123456"')
  })

  it('marks the transfers that followed a selected employee change within 48 hours', async () => {
    open()
    const all = await rows()
    const byTs = (ts: string) => all.find((row) => row.dataset.ts === ts)!
    expect(byTs('2026-09-27T15:54:52Z')).toHaveAttribute('data-linked', 'true')
    expect(within(byTs('2026-09-27T15:54:52Z')).getByText('+27h after')).toBeInTheDocument()
    expect(byTs('2026-09-26T09:00:00Z')).not.toHaveAttribute('data-linked')
    const follow = screen.getByTestId('follow-through')
    expect(follow).toHaveTextContent('₹7,000 out in 1 transfer')
  })

  it('counts only outgoing transfers in the 48-hour follow-through', async () => {
    const incoming = { ...tx('tx_in', '2026-09-27T10:00:00Z', 'Salary credit · Infosys', '62400.00'), direction: 'in' as const }
    open({ [`GET ${PATH}`]: () => json(page([...ITEMS, incoming])) })
    await rows()
    expect(screen.getByTestId('follow-through')).toHaveTextContent('₹7,000 out in 1 transfer')
    const salary = (await rows()).find((row) => row.dataset.ts === '2026-09-27T10:00:00Z')!
    expect(salary).not.toHaveAttribute('data-linked')
  })

  it('on an employee timeline, keeps the actor chip on changes but not logins, names targets and lists transfers that followed', async () => {
    const emp = `/v1/timeline/employee/${EMPLOYEE.id}`
    const edit = { ...action('act_1', '2026-09-26T12:44:34Z', 'profile_change', 'Edited profile · KYC document'), target_label: 'Karan Apte' }
    const login: TimelineItem = {
      ts: '2026-09-26T04:18:00Z',
      category: 'access_login',
      title: 'Session started from 10.20.3.22',
      actor: EMPLOYEE,
      value: null,
      target: 'WS-MUM-01-07',
      event_kind: 'session',
      ref_id: 'sess_1',
    }
    useAuth.setState({ user: investigator, accessToken: 'token', refreshToken: 'refresh', signOutReason: null })
    mockApi({
      'GET /v1/auth/me': () => json(investigator),
      [`GET ${emp}`]: () =>
        json({ entity: { type: 'employee', id: EMPLOYEE.id, label: EMPLOYEE.name, detail: 'manager' }, items: [edit, login], next_cursor: null }),
      'GET /v1/timeline/raw/employee_action/act_1': () => json(RAW.act_1),
      [`GET ${PATH}`]: () => json(page([tx('tx_a', '2026-09-27T15:54:52Z', 'ATM cash withdrawal', '7000.00')])),
    })
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [`/timeline/employee/${EMPLOYEE.id}`] })} />)
    const [editRow, loginRow] = await rows()
    expect(within(editRow!).getByTestId('timeline-actor')).toHaveAttribute('href', `/timeline/employee/${EMPLOYEE.id}`)
    expect(within(loginRow!).queryByTestId('timeline-actor')).toBeNull()
    expect(within(editRow!).getByRole('link', { name: /Karan Apte, customer/ })).toHaveAttribute('href', '/timeline/customer/cust_1')
    const follow = await screen.findByTestId('follow-through')
    expect(follow).toHaveTextContent('₹7,000 out in 1 transfer')
    expect(within(follow).getByRole('link', { name: "Open Karan Apte's timeline at this change" })).toHaveAttribute(
      'href',
      '/timeline/customer/cust_1?event=act_1',
    )
  })
})
