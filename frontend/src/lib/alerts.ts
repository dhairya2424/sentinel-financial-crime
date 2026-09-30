import { acknowledgeAlert } from '@/api/alerts'
import type { AlertDetail, AlertRow, AlertStatus, EntityRef, EvidenceType, RuleCode } from '@/api/types'
import { formatInr } from '@/lib/timeline'
import { useAlerts } from '@/store/alerts'

/** docs/09 §4, in the order the rule select lists them. */
export const RULES: readonly { code: RuleCode; name: string }[] = [
  { code: 'R-CIRC', name: 'Circular transfer' },
  { code: 'R-STRUCT', name: 'Transaction structuring' },
  { code: 'R-PROFILE_ROLE', name: 'Role-action mismatch' },
  { code: 'R-PROFILE_FLOW', name: 'Edit-then-flow correlation' },
  { code: 'R-VELOCITY', name: 'Transfer velocity' },
  { code: 'R-OFFHOURS', name: 'Off-hours employee action' },
  { code: 'R-DORMANT', name: 'Dormant reactivation' },
]

/** docs/09 §3, with the words an investigator uses. */
export const STATUS_LABEL: Record<AlertStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  linked_to_case: 'Linked to case',
  resolved: 'Resolved',
  closed_confirmed: 'Closed, confirmed',
  closed_false_positive: 'Closed, false positive',
}
export const STATUSES = Object.keys(STATUS_LABEL) as AlertStatus[]

/** The entity a row is named by: the customer people recognise first, then an employee, then an account. */
export function primaryEntity(row: Pick<AlertRow, 'entities'>): EntityRef | null {
  return row.entities.find((e) => e.type === 'customer') ?? row.entities.find((e) => e.type === 'employee') ?? row.entities[0] ?? null
}

export const money = (value: string | null | undefined): string | null => (value == null ? null : formatInr(value))

/** "just now", "12m ago", "3h ago", "2d ago", then a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${String(Math.round(s / 60))}m ago`
  if (s < 86_400) return `${String(Math.round(s / 3600))}h ago`
  if (s < 7 * 86_400) return `${String(Math.round(s / 86_400))}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export const SOURCE_TABLE: Record<EvidenceType, string> = {
  transaction: 'transactions',
  employee_action: 'employee_actions',
  session: 'employee_sessions',
  access_right: 'access_rights',
}

/**
 * Acknowledge optimistically: the ledger shows it at once, the server confirms, and a refusal puts it back.
 * Resolves to the server's alert; rejects with the server's reason.
 */
export async function acknowledge(id: string): Promise<AlertDetail> {
  const store = useAlerts.getState()
  const before = store.items.find((x) => x.id === id)?.status
  store.markAcknowledged(id)
  try {
    return await acknowledgeAlert(id)
  } catch (err) {
    if (before) useAlerts.setState((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, status: before } : x)) }))
    throw err
  }
}
