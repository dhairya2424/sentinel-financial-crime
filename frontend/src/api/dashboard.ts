import { api } from './client'
import type { AlertRow, DashboardMetrics } from './types'

export const getMetrics = (signal?: AbortSignal) => api<DashboardMetrics>('/v1/dashboard/metrics', { signal })

const PAGE_CAP = 10

/** Every alert detected since `from`, any status, following the cursor (at most 2,000 rows). */
export async function alertsSince(from: Date, signal?: AbortSignal): Promise<AlertRow[]> {
  const out: AlertRow[] = []
  let cursor: string | null = null
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const q = new URLSearchParams({ from: from.toISOString(), limit: '200' })
    if (cursor) q.set('cursor', cursor)
    const res: { items: AlertRow[]; next_cursor: string | null } = await api(`/v1/alerts?${q.toString()}`, { signal })
    out.push(...res.items)
    cursor = res.next_cursor
    if (!cursor) break
  }
  return out
}
