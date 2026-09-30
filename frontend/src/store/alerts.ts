import { create } from 'zustand'
import type { AlertFilters } from '@/api/alerts'
import type { AlertRow, RiskBand } from '@/api/types'

export const DEFAULT_FILTERS: AlertFilters = { bands: [], rule: null, statuses: ['open', 'acknowledged'], range: '7d', entity: null }

interface AlertsState {
  items: AlertRow[]
  cursor: string | null
  filters: AlertFilters
  /** Ids that arrived live and have not been seen yet; the ledger highlights them once. */
  fresh: Set<string>
  setPage: (items: AlertRow[], cursor: string | null) => void
  appendPage: (items: AlertRow[], cursor: string | null) => void
  prependAlert: (row: AlertRow) => void
  setFilters: (filters: AlertFilters) => void
  markAcknowledged: (id: string) => void
  replace: (row: AlertRow) => void
  remove: (id: string) => void
  seen: (id: string) => void
}

/** Whether a live alert belongs in the ledger the investigator is looking at. */
export function matches(row: AlertRow, f: AlertFilters): boolean {
  if (f.bands.length && !f.bands.includes(row.risk_band)) return false
  if (f.rule && row.rule_code !== f.rule) return false
  if (f.statuses.length && !f.statuses.includes(row.status)) return false
  if (f.entity && !row.entity_ids.includes(f.entity)) return false
  return true
}

export const useAlerts = create<AlertsState>((set) => ({
  items: [],
  cursor: null,
  filters: DEFAULT_FILTERS,
  fresh: new Set(),
  setPage: (items, cursor) => {
    set({ items, cursor })
  },
  appendPage: (items, cursor) => {
    set((s) => ({ items: [...s.items, ...items.filter((i) => !s.items.some((x) => x.id === i.id))], cursor }))
  },
  prependAlert: (row) => {
    set((s) => {
      if (!matches(row, s.filters)) return s
      const rest = s.items.filter((x) => x.id !== row.id)
      return { items: [row, ...rest], fresh: new Set(s.fresh).add(row.id) }
    })
  },
  setFilters: (filters) => {
    set({ filters })
  },
  markAcknowledged: (id) => {
    set((s) => ({ items: s.items.map((x) => (x.id === id && x.status === 'open' ? { ...x, status: 'acknowledged' } : x)) }))
  },
  replace: (row) => {
    set((s) => ({ items: s.items.map((x) => (x.id === row.id ? row : x)) }))
  },
  remove: (id) => {
    set((s) => (s.items.some((x) => x.id === id) ? { items: s.items.filter((x) => x.id !== id) } : s))
  },
  seen: (id) => {
    set((s) => {
      if (!s.fresh.has(id)) return s
      const fresh = new Set(s.fresh)
      fresh.delete(id)
      return { fresh }
    })
  },
}))

export function countsByBand(items: readonly AlertRow[]): Record<RiskBand, number> {
  const counts: Record<RiskBand, number> = { low: 0, medium: 0, high: 0, critical: 0 }
  for (const i of items) counts[i.risk_band] += 1
  return counts
}
