import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Evidence } from '@/api/types'
import { EvidencePanel, type EvidenceState } from '../EvidencePanel'

export const EVIDENCE: Evidence[] = [
  {
    evidence_type: 'transaction',
    ref_id: 'tx_demo_loop_1',
    captured_at: '2026-09-30T04:32:17Z',
    snapshot: {
      id: 'tx_demo_loop_1',
      amount: '240000.00',
      value_ts: '2026-09-28T03:37:19+00:00',
      from_account_id: 'acct_1158',
      to_account_id: 'acct_5082',
      channel: 'neft',
    },
  },
  {
    evidence_type: 'transaction',
    ref_id: 'tx_demo_loop_2',
    captured_at: '2026-09-30T04:32:17Z',
    snapshot: {
      id: 'tx_demo_loop_2',
      amount: '240000.00',
      value_ts: '2026-09-28T05:37:19+00:00',
      from_account_id: 'acct_5082',
      to_account_id: 'acct_8018',
      channel: 'neft',
    },
  },
  {
    evidence_type: 'employee_action',
    ref_id: 'act_limit_1',
    captured_at: '2026-09-30T04:32:17Z',
    snapshot: { id: 'act_limit_1', action_type: 'limit.change', target_id: 'acct_1158', event_ts: '2026-09-28T02:00:00+00:00' },
  },
]
const LABELS = { acct_1158: 'XXXXXXXX1158', acct_5082: 'XXXXXXXX5082', acct_8018: 'XXXXXXXX8018' }

const STATES: [string, EvidenceState][] = [
  ['loading', { status: 'loading' }],
  ['loaded', { status: 'loaded', evidence: EVIDENCE }],
  ['error', { status: 'error', message: 'Evidence store unreachable' }],
  ['empty', { status: 'loaded', evidence: [] }],
]

describe('EvidencePanel (ADR-009)', () => {
  it.each(STATES)('T-FE-01..04: evidence-panel is present while %s', (_, state) => {
    render(<EvidencePanel state={state} labels={LABELS} />)
    expect(screen.getByTestId('evidence-panel')).toBeInTheDocument()
  })

  it('T-FE-01: loading shows a skeleton inside the panel', () => {
    render(<EvidencePanel state={{ status: 'loading' }} />)
    expect(within(screen.getByTestId('evidence-panel')).getByRole('status', { name: 'Loading evidence' })).toBeInTheDocument()
  })

  it('T-FE-02: loaded lists every record grouped by type, with names instead of ids', () => {
    render(<EvidencePanel state={{ status: 'loaded', evidence: EVIDENCE }} labels={LABELS} />)
    const panel = screen.getByTestId('evidence-panel')
    expect(within(panel).getByRole('heading', { name: 'Evidence (3)' })).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: /Transactions/ })).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: /Employee actions/ })).toBeInTheDocument()
    expect(within(panel).getByText('XXXXXXXX1158 → XXXXXXXX5082')).toBeInTheDocument()
    expect(within(panel).getAllByText('₹2,40,000')).toHaveLength(2)
    expect(within(panel).getByText('limit.change')).toBeInTheDocument()
  })

  it('T-FE-03: an error renders inside the panel, never as a bare score', () => {
    render(<EvidencePanel state={{ status: 'error', message: 'Evidence store unreachable' }} />)
    const panel = screen.getByTestId('evidence-panel')
    expect(within(panel).getByRole('alert')).toHaveTextContent('Evidence unavailable — data retention issue')
  })

  it('T-FE-04: no evidence renders the empty-refs state inside the panel', () => {
    render(<EvidencePanel state={{ status: 'loaded', evidence: [] }} />)
    expect(within(screen.getByTestId('evidence-panel')).getByText('No evidence records attached — investigate data feed')).toBeInTheDocument()
  })

  it.each(STATES)('T-FE-05: nothing can dismiss or hide the panel while %s', (_, state) => {
    const { container } = render(<EvidencePanel state={state} labels={LABELS} />)
    expect(container.querySelector('[data-testid="dismiss-evidence"], [data-testid="hide-evidence"]')).toBeNull()
    expect(within(screen.getByTestId('evidence-panel')).queryByRole('button', { name: /close|dismiss|hide|collapse/i })).toBeNull()
  })

  it('T-FE-05: the component API has no visibility input (checked by the typecheck)', () => {
    // @ts-expect-error EvidencePanel has no visibility prop by construction (ADR-009)
    const withVisibility = <EvidencePanel state={{ status: 'loading' }} visible={false} />
    // @ts-expect-error nor a "score only" mode
    const scoreOnly = <EvidencePanel state={{ status: 'loading' }} scoreOnly />
    expect(withVisibility).toBeTruthy()
    expect(scoreOnly).toBeTruthy()
  })

  it('a record opens its frozen raw row with the source table named', async () => {
    const user = userEvent.setup()
    render(<EvidencePanel state={{ status: 'loaded', evidence: EVIDENCE }} labels={LABELS} />)
    await user.click(screen.getByRole('button', { name: 'Open raw record tx_demo_loop_1' }))
    const drawer = screen.getByRole('dialog', { name: 'Raw record' })
    expect(drawer).toHaveTextContent('"amount": "240000.00"')
    expect(drawer).toHaveTextContent('source table: transactions')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('evidence-panel')).toBeInTheDocument()
  })
})
