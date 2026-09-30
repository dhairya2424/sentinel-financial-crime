import { FileSearch } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Evidence, EvidenceType } from '@/api/types'
import { Skeleton } from '@/components/Skeleton'
import { shortId } from '@/lib/format'
import { formatInr } from '@/lib/timeline'
import { RawRecordDrawer } from './RawRecordDrawer'

/** Everything the panel can be. There is deliberately no visibility, collapse or dismiss input (ADR-009). */
export type EvidenceState = { status: 'loading' } | { status: 'loaded'; evidence: Evidence[] } | { status: 'error'; message: string }

interface EvidencePanelProps {
  state: EvidenceState
  /** Readable names for account and customer ids that appear in the snapshots. */
  labels?: Readonly<Record<string, string>>
}

const GROUPS: { type: EvidenceType; title: string }[] = [
  { type: 'transaction', title: 'Transactions' },
  { type: 'employee_action', title: 'Employee actions' },
  { type: 'session', title: 'Sessions' },
  { type: 'access_right', title: 'Access rights' },
]

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const when = (v: unknown) => {
  const s = str(v)
  return s ? new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
}

function columns(type: EvidenceType, e: Evidence, name: (id: string) => string): [string, ReactNode, ReactNode, ReactNode] {
  const s = e.snapshot
  if (type === 'transaction') {
    const from = str(s.from_account_id)
    const to = str(s.to_account_id)
    return ['When', when(s.value_ts), `${from ? name(from) : 'another bank'} → ${to ? name(to) : 'another bank'}`, formatInr(str(s.amount) || 0)]
  }
  if (type === 'employee_action') return ['When', when(s.event_ts), str(s.action_type), name(str(s.target_id))]
  if (type === 'session') return ['Started', when(s.started_at), str(s.outcome), str(s.ip_address) || '—']
  return ['Granted', when(s.granted_at), str(s.entitlement), str(s.scope) || 'all']
}

const HEADS: Record<EvidenceType, [string, string, string]> = {
  transaction: ['When', 'From → to', 'Amount'],
  employee_action: ['When', 'Action', 'Target'],
  session: ['Started', 'Outcome', 'IP address'],
  access_right: ['Granted', 'Entitlement', 'Scope'],
}

/**
 * The evidence behind an alert (PRD C4, docs/03 §7). Always mounted inside AlertDetail, in every state:
 * loading, loaded, empty and error all render here, so no view of an alert can show only a score.
 */
export function EvidencePanel({ state, labels = {} }: EvidencePanelProps) {
  const [open, setOpen] = useState<Evidence | null>(null)
  const name = (id: string) => labels[id] ?? shortId(id)
  const count = state.status === 'loaded' ? state.evidence.length : null

  return (
    <section data-testid="evidence-panel" aria-labelledby="evidence-heading" className="overflow-hidden rounded-card border border-line-strong bg-panel">
      <header className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <FileSearch aria-hidden="true" className="size-4 text-ev" />
        <h3 id="evidence-heading" className="text-[13px] font-semibold text-fg">
          Evidence
          {count !== null && (
            <>
              {' '}
              <span className="font-mono font-normal text-fg-muted">({count})</span>
            </>
          )}
        </h3>
        <span className="ml-auto text-xs text-fg-subtle">Frozen when the alert fired · click a record for its raw row</span>
      </header>

      {state.status === 'loading' && (
        <div role="status" aria-label="Loading evidence" className="flex flex-col gap-2 p-3.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      )}

      {state.status === 'error' && (
        <div role="alert" className="flex flex-col gap-1 px-3.5 py-4">
          <p className="text-[13px] font-medium text-danger">Evidence unavailable — data retention issue</p>
          <p className="text-xs text-fg-muted">
            The frozen records could not be read ({state.message}). The explanation and factors above still show why the alert fired.
          </p>
        </div>
      )}

      {state.status === 'loaded' && state.evidence.length === 0 && (
        <div className="flex flex-col gap-1 px-3.5 py-4">
          <p className="text-[13px] font-medium text-fg">No evidence records attached — investigate data feed</p>
          <p className="text-xs text-fg-muted">Every alert should carry the records it was built from. An empty list means they were missing when it fired.</p>
        </div>
      )}

      {state.status === 'loaded' &&
        GROUPS.map(({ type, title }) => {
          const items = state.evidence.filter((e) => e.evidence_type === type)
          if (!items.length) return null
          const [h1, h2, h3] = HEADS[type]
          return (
            <div key={type}>
              <h4 className="px-3.5 pt-2.5 pb-1 text-xs font-semibold text-fg-muted">
                {title} <span className="font-mono font-normal text-fg-subtle">{items.length}</span>
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="text-fg-subtle">
                    <tr className="border-b border-line">
                      <th scope="col" className="px-3.5 py-1.5 font-medium">
                        Record
                      </th>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        {h1}
                      </th>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        {h2}
                      </th>
                      <th scope="col" className={`py-1.5 pr-3.5 pl-2 font-medium ${type === 'transaction' ? 'text-right' : ''}`}>
                        {h3}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((e) => {
                      const [, c1, c2, c3] = columns(type, e, name)
                      return (
                        <tr
                          key={e.ref_id}
                          onClick={() => {
                            setOpen(e)
                          }}
                          className="cursor-pointer border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-raised/60"
                        >
                          <td className="px-3.5 py-2">
                            <button
                              type="button"
                              title={e.ref_id}
                              aria-label={`Open raw record ${e.ref_id}`}
                              onClick={(ev) => {
                                ev.stopPropagation()
                                setOpen(e)
                              }}
                              className="rounded font-mono text-[11.5px] text-fg hover:underline"
                            >
                              {e.ref_id.length <= 20 ? e.ref_id : shortId(e.ref_id)}
                            </button>
                          </td>
                          <td className="px-2 py-2 font-mono text-[11.5px] whitespace-nowrap text-fg-muted tabular-nums">{c1}</td>
                          <td className="px-2 py-2 text-fg">{c2}</td>
                          <td
                            className={`py-2 pr-3.5 pl-2 font-mono text-[11.5px] whitespace-nowrap tabular-nums ${type === 'transaction' ? 'text-right text-fg' : 'text-fg-muted'}`}
                          >
                            {c3}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}

      {open && (
        <RawRecordDrawer
          evidence={open}
          onClose={() => {
            setOpen(null)
          }}
        />
      )}
    </section>
  )
}
