import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { EntityCounts, EventPreview, User } from '@/api/types'
import { useAddLog } from '@/adddata/log'
import { routes } from '@/routes'
import { useAuth } from '@/store/auth'
import { useHealth } from '@/store/health'
import { json, mockApi } from '@/test/fetch'

const person = (role: User['role']): User => ({ id: `usr_${role}`, email: `${role}@demo.dev`, role, tenant_id: 'tenant_demo', full_name: `Demo ${role}` })

const COUNTS: EntityCounts = { customers: 3, accounts: 3, employees: 0, transactions: 3, employee_actions: 0, sessions: 0, access_rights: 0 }
const ACCOUNTS = [
  { id: 'acct_1158', label: 'XXXXXXXX1158', detail: 'Karan Apte · savings' },
  { id: 'acct_5082', label: 'XXXXXXXX5082', detail: 'Priya Khan · savings' },
]
const PREVIEW: EventPreview = {
  viewpoint: { type: 'customer', id: 'cust_karan', label: 'Karan Apte', detail: 'CIF100018' },
  item: {
    ts: '2026-09-28T05:00:00Z',
    category: 'transaction',
    title: 'Transfer to Priya Khan',
    actor: null,
    value: '240000.00',
    target: 'acct_5082',
    event_kind: 'transaction',
    ref_id: 'tx_ui_x',
    direction: 'out',
  },
  problem: null,
  note: null,
}

type Handlers = Parameters<typeof mockApi>[0]

function open(path: string, role: User['role'] = 'investigator', extra: Handlers = {}) {
  const user = person(role)
  useAuth.setState({ user, accessToken: 'token', refreshToken: 'refresh', signOutReason: null })
  const api = mockApi({
    'GET /v1/auth/me': () => json(user),
    'GET /v1/entities/summary': () => json(COUNTS),
    'GET /v1/entities/lookup': () => json(ACCOUNTS),
    ...extra,
  })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return { ...api, router }
}

const bodyOf = (init: RequestInit | undefined) => JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>

describe('Add data', () => {
  beforeEach(() => {
    useHealth.setState({ connection: 'connected', services: { db: 'ok', redis: 'ok' } })
    sessionStorage.clear()
    useAddLog.setState({ entries: [] })
  })

  it('is hidden from viewers and their direct link goes back to the dashboard', async () => {
    const { router } = open('/add', 'viewer')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(screen.queryByRole('link', { name: 'Add data' })).not.toBeInTheDocument()
  })

  it('lists every record type with the tenant counts', async () => {
    open('/add')
    const rail = await screen.findByRole('navigation', { name: 'Record type' })
    const labels = within(rail)
      .getAllByRole('button')
      .map((b) => b.firstChild?.textContent)
    expect(labels).toEqual(['Customer', 'Account', 'Employee', 'Transaction', 'Employee action', 'Session', 'Access right', 'Import file'])
    expect(await within(rail).findByRole('button', { name: 'Customer, 3 saved' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Employee, 0 saved' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Import file' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add data' })).toHaveAttribute('aria-current', 'page')
  })

  it('registers a customer and logs it with links and the new id', async () => {
    let sent: Record<string, unknown> | null = null
    open('/add?type=customer', 'investigator', {
      'POST /v1/entities/customers': (init) => {
        sent = bodyOf(init)
        return json({ id: 'cust_new01', label: 'Meera Kulkarni', type: 'customer' }, 201)
      },
    })
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Full name'), 'Meera Kulkarni')
    await user.type(screen.getByLabelText('Customer reference (CIF)'), 'CIF100231')
    expect(screen.getByRole('button', { name: 'Register customer' })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('KYC status'), 'verified')
    await user.selectOptions(screen.getByLabelText('Risk rating'), 'standard')
    await user.click(screen.getByRole('button', { name: 'Register customer' }))

    const log = screen.getByRole('region', { name: /Saved this session/ })
    expect(await within(log).findByText('Customer Meera Kulkarni · CIF100231')).toBeInTheDocument()
    expect(sent).toEqual({ name: 'Meera Kulkarni', external_ref: 'CIF100231', kyc_status: 'verified', risk_rating: 'standard' })
    expect(within(log).getByRole('link', { name: 'Open in Graph' })).toHaveAttribute('href', '/graph?node=cust_new01')
    expect(within(log).getByRole('button', { name: 'Copy id cust_new01' })).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveValue('')
  })

  it('shows a rejected registration in the form and the log', async () => {
    open('/add?type=customer', 'investigator', {
      'POST /v1/entities/customers': () => json({ detail: 'a customer with reference CIF1 already exists', code: 'conflict' }, 409),
    })
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Full name'), 'Someone')
    await user.type(screen.getByLabelText('Customer reference (CIF)'), 'CIF1')
    await user.selectOptions(screen.getByLabelText('KYC status'), 'verified')
    await user.selectOptions(screen.getByLabelText('Risk rating'), 'standard')
    await user.click(screen.getByRole('button', { name: 'Register customer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('a customer with reference CIF1 already exists')
    const log = screen.getByRole('region', { name: /Saved this session/ })
    expect(within(log).getByText('rejected')).toBeInTheDocument()
  })

  it('previews a transfer as its Timeline row, then records it through ingest', async () => {
    let ingested: Record<string, unknown> | null = null
    let previewed = 0
    open('/add?type=tx', 'investigator', {
      'POST /v1/timeline/preview': () => {
        previewed += 1
        return json(PREVIEW)
      },
      'POST /v1/ingest/events': (init) => {
        ingested = bodyOf(init)
        return json({ accepted: 1, skipped: 0, failed: 0, batch_id: 'b1', errors: [], skipped_ids: [] }, 202)
      },
    })
    const user = userEvent.setup()
    const save = await screen.findByRole('button', { name: 'Record transaction' })
    expect(save).toBeDisabled()
    expect(screen.getByText(/Fill in the sending account, the receiving account, and the amount to see the row/)).toBeInTheDocument()

    await user.click(screen.getByLabelText('From account'))
    await user.click(await screen.findByRole('option', { name: /XXXXXXXX1158/ }))
    await user.click(screen.getByLabelText('To account'))
    await user.click(await screen.findByRole('option', { name: /XXXXXXXX5082/ }))
    await user.type(screen.getByLabelText('Amount (₹)'), '2,40,000')

    const preview = screen.getByRole('region', { name: 'Timeline preview' })
    expect(await within(preview).findByText('Transfer to Priya Khan', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(within(preview).getByText(/Karan Apte/)).toBeInTheDocument()
    expect(within(preview).queryByRole('button', { name: /Transfer to Priya Khan/ })).not.toBeInTheDocument()
    expect(previewed).toBeGreaterThan(0)

    await user.click(save)
    const log = screen.getByRole('region', { name: /Saved this session/ })
    expect(await within(log).findByText('saved')).toBeInTheDocument()
    const events = (ingested as { events: Record<string, unknown>[] } | null)?.events ?? []
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'transaction',
      from_account_id: 'acct_1158',
      to_account_id: 'acct_5082',
      amount: '240000',
      channel: 'neft',
      status: 'completed',
    })
    expect(within(log).getByRole('link', { name: 'Open Timeline' })).toHaveAttribute('href', '/timeline/customer/cust_karan')
    expect(screen.getByLabelText('Amount (₹)')).toHaveValue('')
  })

  it('blocks saving when the preview says a reference is not registered', async () => {
    open('/add?type=tx', 'investigator', {
      'POST /v1/timeline/preview': () => json({ viewpoint: null, item: null, problem: 'account acct_5082 is not registered', note: null }),
    })
    const user = userEvent.setup()
    await user.click(await screen.findByLabelText('From account'))
    await user.click(await screen.findByRole('option', { name: /XXXXXXXX1158/ }))
    await user.click(screen.getByLabelText('To account'))
    await user.click(await screen.findByRole('option', { name: /XXXXXXXX5082/ }))
    await user.type(screen.getByLabelText('Amount (₹)'), '500')
    expect(await screen.findByText('This can’t be saved: account acct_5082 is not registered.', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record transaction' })).toBeDisabled()
  })

  it('reopens a picker that kept focus when it is clicked again', async () => {
    open('/add?type=account', 'investigator', {
      'GET /v1/entities/lookup': () => json([{ id: 'cust_1', label: 'Rhea Kulkarni', detail: 'CIF-UI-001' }]),
    })
    const user = userEvent.setup()
    const holder = await screen.findByLabelText('Holder')
    await user.click(holder)
    await user.click(await screen.findByRole('option', { name: /Rhea Kulkarni/ }))
    expect(holder).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.click(holder)
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
  })

  it('turns an empty employee list into a way to register one', async () => {
    const { router } = open('/add?type=act', 'investigator', { 'GET /v1/entities/lookup': () => json([]) })
    const user = userEvent.setup()
    await user.click(await screen.findByLabelText('Employee'))
    expect(await screen.findByText('No employees registered yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Register an employee' }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('?type=employee')
    })
    expect(await screen.findByRole('heading', { name: 'Register an employee' })).toBeInTheDocument()
  })

  it('imports the valid rows of a file and reports each row', async () => {
    let sent: Record<string, unknown>[] = []
    open('/add?type=import', 'investigator', {
      'POST /v1/ingest/events': (init) => {
        sent = (bodyOf(init) as { events: Record<string, unknown>[] }).events
        return json(
          { accepted: 0, skipped: 0, failed: 1, batch_id: 'b2', errors: [{ id: sent[0]?.id, error: 'account acct_9 is not registered' }], skipped_ids: [] },
          202,
        )
      },
    })
    const user = userEvent.setup()
    const csv = 'kind,from_account_id,amount,value_ts\ntransaction,acct_9,100,2026-09-28T10:00:00Z\ntransaction,acct_1158,,2026-09-28T10:00:00Z\n'
    await user.upload(await screen.findByLabelText(/Choose a file/), new File([csv], 'bank.csv', { type: 'text/csv' }))
    expect(await screen.findByText('missing amount')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Import 1 record' }))
    expect(await screen.findByText('account acct_9 is not registered')).toBeInTheDocument()
    expect(sent).toHaveLength(1)
    const log = screen.getByRole('region', { name: /Saved this session/ })
    expect(within(log).getByText('Imported bank.csv: 0 saved, 2 rejected')).toBeInTheDocument()
  })
})
