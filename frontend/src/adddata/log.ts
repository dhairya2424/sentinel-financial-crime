import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type LogState = 'saved' | 'partial' | 'rejected' | 'skipped'

export interface LogLink {
  label: 'Graph' | 'Timeline'
  to: string
}

export interface LogEntry {
  key: string
  at: number
  state: LogState
  summary: string
  reason?: string
  links?: LogLink[]
  /** The Sentinel id of a registered customer, account or employee, for use in import files. */
  id?: string
}

interface AddLogState {
  entries: LogEntry[]
  add: (entry: Omit<LogEntry, 'key' | 'at'>) => void
  clear: () => void
}

const MAX_ENTRIES = 200

/** What was entered in this browser tab, newest first. It lives in sessionStorage so a trip to the Graph and back keeps it. */
export const useAddLog = create<AddLogState>()(
  persist(
    (set) => ({
      entries: [],
      add: (entry) => {
        set((s) => ({ entries: [{ ...entry, key: crypto.randomUUID(), at: Date.now() }, ...s.entries].slice(0, MAX_ENTRIES) }))
      },
      clear: () => {
        set({ entries: [] })
      },
    }),
    { name: 'sentinel-add-log', storage: createJSONStorage(() => sessionStorage) },
  ),
)

export function entityLinks(type: 'customer' | 'account' | 'employee', id: string): LogLink[] {
  return [
    { label: 'Graph', to: `/graph?node=${encodeURIComponent(id)}` },
    { label: 'Timeline', to: `/timeline/${type}/${encodeURIComponent(id)}` },
  ]
}
