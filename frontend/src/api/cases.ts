import { API_URL, ApiError, api } from './client'
import type { Assignee, CaseCreate, CaseDetail, CaseNote, CasePage, CasePatch, CaseStatus } from './types'
import { useAuth } from '@/store/auth'

export interface CaseFilters {
  statuses: CaseStatus[]
  /** A user id, `me`, `none` (unassigned) or null for anyone. */
  assignee: string | null
}

export function caseQuery(filters: CaseFilters, cursor?: string | null): URLSearchParams {
  const q = new URLSearchParams()
  if (filters.statuses.length) q.set('status', filters.statuses.join(','))
  if (filters.assignee) q.set('assignee', filters.assignee)
  if (cursor) q.set('cursor', cursor)
  q.set('limit', '200')
  return q
}

const path = (id: string) => `/v1/cases/${encodeURIComponent(id)}`

export const listCases = (filters: CaseFilters, cursor?: string | null, signal?: AbortSignal) =>
  api<CasePage>(`/v1/cases?${caseQuery(filters, cursor).toString()}`, { signal })
export const getCase = (id: string, signal?: AbortSignal) => api<CaseDetail>(path(id), { signal })
export const createCase = (body: CaseCreate) => api<CaseDetail>('/v1/cases', { method: 'POST', body })
export const patchCase = (id: string, body: CasePatch) => api<CaseDetail>(path(id), { method: 'PATCH', body })
export const assignCase = (id: string, assigneeId: string) => api<CaseDetail>(`${path(id)}/assign`, { method: 'POST', body: { assignee_id: assigneeId } })
export const addNote = (id: string, body: string) => api<CaseNote>(`${path(id)}/notes`, { method: 'POST', body: { body } })
export const listAssignees = (signal?: AbortSignal) => api<Assignee[]>('/v1/users/assignees', { signal })

export type ExportFormat = 'json' | 'html'

/**
 * Fetch the evidence bundle as a file and hand it to the browser as a download. It goes through fetch rather than a
 * link because the route needs the bearer token. The server's attachment name is kept.
 */
export async function downloadExport(id: string, format: ExportFormat): Promise<{ filename: string; digest: string | null }> {
  const token = useAuth.getState().accessToken
  const res = await fetch(`${API_URL}${path(id)}/export?format=${format}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown; code?: string }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      /* the status text is the best we have */
    }
    throw new ApiError(res.status, 'export_failed', detail || `Export failed with status ${String(res.status)}`)
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `sentinel-case-${id}.${format}`
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
  return { filename, digest: res.headers.get('x-digest-sha256') }
}
