import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CaseRow, User } from '@/api/types'
import { routes } from '@/routes'
import { useAuth } from '@/store/auth'
import { useCases } from '@/store/cases'
import { useHealth } from '@/store/health'
import { json, mockApi } from '@/test/fetch'
import { FakeWebSocket } from '@/test/ws'

const manager: User = { id: 'usr_manager', email: 'manager@demo.dev', role: 'manager', tenant_id: 'tenant_demo', full_name: 'Sneha Manager' }
const ROW: CaseRow = {
  id: 'case_01',
  case_number: 'CASE-2026-0001',
  title: 'Loop through payee accounts',
  description: null,
  priority: 'high',
  status: 'open',
  assignee_id: null,
  assignee_name: null,
  created_by: 'usr_manager',
  created_at: new Date(Date.now() - 3_600_000).toISOString(),
  updated_at: new Date().toISOString(),
  closed_at: null,
  export_digest: null,
  alert_count: 2,
  top_band: 'critical',
}

function open(extra: Parameters<typeof mockApi>[0] = {}) {
  useAuth.setState({ user: manager, accessToken: 'token', refreshToken: 'refresh', signOutReason: null })
  const api = mockApi({
    'GET /v1/auth/me': () => json(manager),
    'GET /v1/cases': () => json({ items: [ROW], next_cursor: null }),
    'GET /v1/users/assignees': () => json([{ id: 'usr_priya', full_name: 'Priya Khan', role: 'investigator' }]),
    ...extra,
  })
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/cases'] })} />)
  return api
}

describe('Case Manager', () => {
  beforeEach(() => {
    useHealth.setState({ connection: 'connected', services: { db: 'ok', redis: 'ok' } })
    useCases.setState({ items: [], fresh: new Set() })
    localStorage.clear()
  })

  it('lays cases out as Kanban columns with the card anatomy', async () => {
    open()
    const card = await within(await screen.findByTestId('column-open')).findByTestId('case-card')
    expect(card).toHaveTextContent('CASE-2026-0001')
    expect(card).toHaveTextContent('Loop through payee accounts')
    expect(card).toHaveTextContent('High')
    expect(card).toHaveTextContent('2 alerts')
    expect(card).toHaveTextContent('1h ago')
    expect(within(card).getByLabelText('Risk: Critical')).toBeInTheDocument()
    expect(within(card).getByText('Unassigned')).toBeInTheDocument()
    expect(card).toHaveAttribute('href', '/cases/case_01')
  })

  it('remembers the List view', async () => {
    open()
    await screen.findByTestId('case-card')
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'List' }))
    expect(await screen.findByTestId('case-row')).toHaveTextContent('Unassigned')
    expect(localStorage.getItem('sentinel.cases.view')).toBe('list')
  })

  it('a case.updated message moves the card to its new column, live', async () => {
    open({ 'GET /v1/cases/case_01': () => json({ ...ROW, status: 'in_review', assignee_id: 'usr_priya', assignee_name: 'Priya Khan', alerts: [], notes: [], audit: [] }) })
    await within(await screen.findByTestId('column-open')).findByTestId('case-card')
    act(() => {
      FakeWebSocket.latest()?.open()
    })
    act(() => {
      FakeWebSocket.latest()?.receive({
        channel: 'cases:tenant_demo',
        type: 'case.updated',
        data: { id: 'case_01', status: 'in_review', assignee_id: 'usr_priya', updated_at: new Date().toISOString() },
      })
    })
    const moved = await within(screen.getByTestId('column-in_review')).findByTestId('case-card')
    expect(moved).toHaveAttribute('data-fresh', 'true')
    expect(within(moved).getByText('Assigned to Priya Khan')).toBeInTheDocument()
    await waitFor(() => {
      expect(within(screen.getByTestId('column-open')).queryByTestId('case-card')).not.toBeInTheDocument()
    })
  })
})
