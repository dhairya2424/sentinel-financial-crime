import { api } from './client'
import type { RawRecord, TimelineCategory, TimelineEntityType, TimelineEventKind, TimelinePage } from './types'

export const TIMELINE_CATEGORIES: readonly TimelineCategory[] = ['transaction', 'profile_change', 'access_login', 'approval']

export interface TimelineParams {
  from?: string
  to?: string
  categories?: readonly TimelineCategory[]
  limit?: number
  cursor?: string | null
}

export function fetchTimeline(
  type: TimelineEntityType,
  id: string,
  params: TimelineParams = {},
  signal?: AbortSignal,
): Promise<TimelinePage> {
  const query = new URLSearchParams()
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.categories && params.categories.length < TIMELINE_CATEGORIES.length) {
    query.set('categories', params.categories.join(','))
  }
  if (params.limit) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const qs = query.toString()
  return api<TimelinePage>(`/v1/timeline/${type}/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`, { signal })
}

export function fetchRawRecord(kind: TimelineEventKind, id: string, signal?: AbortSignal): Promise<RawRecord> {
  return api<RawRecord>(`/v1/timeline/raw/${kind}/${encodeURIComponent(id)}`, { signal })
}
