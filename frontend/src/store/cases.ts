import { create } from 'zustand'
import type { CaseDetail, CaseRow } from '@/api/types'

interface CasesState {
  items: CaseRow[]
  /** Ids changed live since the board last showed them; the card is highlighted once. */
  fresh: Set<string>
  setItems: (items: CaseRow[]) => void
  upsert: (row: CaseRow) => void
  patch: (id: string, change: Partial<CaseRow>) => void
  seen: (id: string) => void
}

export function toCaseRow(d: CaseDetail): CaseRow {
  const rank = { low: 1, medium: 2, high: 3, critical: 4 } as const
  const top = d.alerts.reduce<CaseRow['top_band']>((best, a) => (best === null || rank[a.risk_band] > rank[best] ? a.risk_band : best), null)
  return {
    id: d.id,
    case_number: d.case_number,
    title: d.title,
    description: d.description,
    priority: d.priority,
    status: d.status,
    assignee_id: d.assignee_id,
    assignee_name: d.assignee_name,
    created_by: d.created_by,
    created_at: d.created_at,
    updated_at: d.updated_at,
    closed_at: d.closed_at,
    export_digest: d.export_digest,
    alert_count: d.alerts.length,
    top_band: top,
  }
}

export const useCases = create<CasesState>((set) => ({
  items: [],
  fresh: new Set(),
  setItems: (items) => {
    set({ items })
  },
  upsert: (row) => {
    set((s) => {
      const rest = s.items.filter((x) => x.id !== row.id)
      return { items: [row, ...rest], fresh: new Set(s.fresh).add(row.id) }
    })
  },
  patch: (id, change) => {
    set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, ...change } : x)), fresh: new Set(s.fresh).add(id) }))
  },
  seen: (id) => {
    set((s) => {
      if (!s.fresh.has(id)) return s
      const next = new Set(s.fresh)
      next.delete(id)
      return { fresh: next }
    })
  },
}))
