import { api } from './client'
import type { AlertDetail, AlertGraph, AlertPage, AlertStatus, RiskBand } from './types'

export type TimeRange = '24h' | '7d' | '30d'

export interface AlertFilters {
  bands: RiskBand[]
  rule: string | null
  statuses: AlertStatus[]
  range: TimeRange
  entity: string | null
}

const RANGE_MS: Record<TimeRange, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }

export function alertQuery(filters: AlertFilters, cursor?: string | null, now = Date.now()): URLSearchParams {
  const q = new URLSearchParams()
  if (filters.bands.length) q.set('band', filters.bands.join(','))
  if (filters.rule) q.set('rule', filters.rule)
  if (filters.statuses.length) q.set('status', filters.statuses.join(','))
  if (filters.entity) q.set('entity', filters.entity)
  q.set('from', new Date(now - RANGE_MS[filters.range]).toISOString())
  if (cursor) q.set('cursor', cursor)
  q.set('limit', '50')
  return q
}

export const listAlerts = (filters: AlertFilters, cursor?: string | null, signal?: AbortSignal) =>
  api<AlertPage>(`/v1/alerts?${alertQuery(filters, cursor).toString()}`, { signal })

export const getAlert = (id: string, signal?: AbortSignal) => api<AlertDetail>(`/v1/alerts/${encodeURIComponent(id)}`, { signal })

export const acknowledgeAlert = (id: string) => api<AlertDetail>(`/v1/alerts/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' })

export const getAlertGraph = (id: string, signal?: AbortSignal) => api<AlertGraph>(`/v1/alerts/${encodeURIComponent(id)}/graph`, { signal })
