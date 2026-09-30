import { getCase } from '@/api/cases'
import type { CaseMessage } from '@/api/types'
import { isOwnChange } from '@/lib/cases'
import { toCaseRow, useCases } from '@/store/cases'
import { useAuth } from '@/store/auth'
import { useToasts } from '@/store/toasts'
import { useChannel } from './useSocket'

export const CASE_UPDATED_EVENT = 'case.updated'

export function isCaseMessage(raw: unknown): raw is CaseMessage {
  if (typeof raw !== 'object' || raw === null) return false
  const { type, data } = raw as { type?: unknown; data?: unknown }
  return type === 'case.updated' && typeof data === 'object' && data !== null && typeof (data as { id?: unknown }).id === 'string'
}

/**
 * App-wide listener on this tenant's case channel (mounted once, in AppShell). Every change is fetched in full, so a
 * card moves column with its current title, counts and names, and an open case detail can refresh itself. Being
 * handed a case raises a toast.
 */
export function useCaseFeed(): void {
  const user = useAuth((s) => s.user)
  const tenant = user?.tenant_id ?? null
  useChannel(tenant ? `cases:${tenant}` : null, (raw) => {
    if (!isCaseMessage(raw)) return
    const { data } = raw
    const before = useCases.getState().items.find((x) => x.id === data.id)
    window.dispatchEvent(new CustomEvent(CASE_UPDATED_EVENT, { detail: data }))
    void getCase(data.id)
      .then((detail) => {
        useCases.getState().upsert(toCaseRow(detail))
        const me = useAuth.getState().user?.id
        if (me && data.assignee_id === me && before?.assignee_id !== me && !isOwnChange(data.id)) {
          useToasts.getState().push({ title: `${detail.case_number} was assigned to you: ${detail.title}`, to: `/cases/${encodeURIComponent(detail.id)}` })
        }
      })
      .catch(() => undefined)
  })
}
