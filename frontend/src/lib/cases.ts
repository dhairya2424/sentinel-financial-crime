import { Signal, SignalHigh, SignalLow, SignalMedium, type LucideIcon } from 'lucide-react'
import type { CasePriority, CaseRow, CaseStatus, Role } from '@/api/types'

/** docs/09 §3, with the words an investigator uses. */
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  open: 'Open',
  in_review: 'In review',
  escalated: 'Escalated',
  closed_confirmed: 'Closed, confirmed',
  closed_false_positive: 'Closed, false positive',
}
export const CASE_STATUSES = Object.keys(CASE_STATUS_LABEL) as CaseStatus[]
export const OPEN_CASE_STATUSES: readonly CaseStatus[] = ['open', 'in_review', 'escalated']
export const CLOSED_CASE_STATUSES: readonly CaseStatus[] = ['closed_confirmed', 'closed_false_positive']
export const isClosed = (s: CaseStatus) => s === 'closed_confirmed' || s === 'closed_false_positive'

/** docs/04 §6: forward only; any open state may close; closed is final. Mirrors the server's table. */
export const TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  open: ['in_review', 'closed_confirmed', 'closed_false_positive'],
  in_review: ['escalated', 'closed_confirmed', 'closed_false_positive'],
  escalated: ['closed_confirmed', 'closed_false_positive'],
  closed_confirmed: [],
  closed_false_positive: [],
}

export const MANAGER_ROLES: readonly Role[] = ['manager', 'admin']

/** Why a status option is unavailable, or null when the move is allowed for this user. */
export function transitionBlock(from: CaseStatus, to: CaseStatus, role: Role | undefined): string | null {
  if (to === from) return null
  if (!TRANSITIONS[from].includes(to)) return 'invalid transition'
  if (from === 'open' && isClosed(to) && !MANAGER_ROLES.includes(role ?? 'viewer')) return 'only a manager can close a case that was never reviewed'
  return null
}

/** The lifecycle track: four steps, closed_* folded into one. */
export const STAGES = [
  { key: 'open', label: 'Open' },
  { key: 'in_review', label: 'In review' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'closed', label: 'Closed' },
] as const
export type Stage = (typeof STAGES)[number]['key']
export const stageOf = (s: CaseStatus): Stage => (isClosed(s) ? 'closed' : s)

export const PRIORITIES: readonly CasePriority[] = ['low', 'medium', 'high', 'critical']
/** Priority is urgency, not risk: neutral ink and a signal icon, never a band colour (DESIGN.md, The Four Families Rule). */
export const PRIORITY_META: Record<CasePriority, { label: string; Icon: LucideIcon }> = {
  low: { label: 'Low', Icon: SignalLow },
  medium: { label: 'Medium', Icon: SignalMedium },
  high: { label: 'High', Icon: SignalHigh },
  critical: { label: 'Critical', Icon: Signal },
}

/** What an audit row says, in words. */
export const AUDIT_LABEL: Record<string, string> = {
  'case.create': 'Opened the case',
  'case.assign': 'Assigned',
  'case.note': 'Added a note',
  'case.status': 'Changed status',
  'case.update': 'Edited the case',
  'case.export': 'Exported evidence',
  'alert.link': 'Linked an alert',
  'alert.ack': 'Acknowledged an alert',
}

export function caseMatches(row: Pick<CaseRow, 'status' | 'assignee_id'>, statuses: readonly CaseStatus[], assignee: string | null, me: string | undefined): boolean {
  if (statuses.length && !statuses.includes(row.status)) return false
  if (assignee === 'none') return row.assignee_id === null
  if (assignee === 'me') return row.assignee_id === me
  if (assignee) return row.assignee_id === assignee
  return true
}

/** Cases this browser changed in the last few seconds: their echo on the channel is not news to this user. */
const ownChanges = new Map<string, number>()
export function markOwnChange(id: string, now = Date.now()): void {
  ownChanges.set(id, now)
}
export function isOwnChange(id: string, now = Date.now()): boolean {
  const at = ownChanges.get(id)
  return at !== undefined && now - at < 5_000
}
