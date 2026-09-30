import { BriefcaseBusiness, Columns3, List } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { listAssignees, listCases } from '@/api/cases'
import type { Assignee as AssigneeData, CaseRow, CaseStatus } from '@/api/types'
import { Assignee, PriorityBadge } from '@/components/case/CaseBits'
import { EmptyState } from '@/components/EmptyState'
import { ErrorRetry } from '@/components/ErrorRetry'
import { RiskBadge } from '@/components/RiskBadge'
import { SkeletonRows } from '@/components/Skeleton'
import { timeAgo } from '@/lib/alerts'
import { CASE_STATUS_LABEL, CLOSED_CASE_STATUSES, caseMatches, isClosed, OPEN_CASE_STATUSES } from '@/lib/cases'
import { useAuth } from '@/store/auth'
import { useCases } from '@/store/cases'
import { useLive, useResync } from '@/ws/useSocket'
import { Page } from './Placeholder'

type View = 'list' | 'kanban'
type Scope = 'open' | 'closed' | 'all'
const VIEW_KEY = 'sentinel.cases.view'
const CLOSED_SHOWN = 12

const SCOPE_STATUSES: Record<Scope, readonly CaseStatus[]> = { open: OPEN_CASE_STATUSES, closed: CLOSED_CASE_STATUSES, all: [] }
const COLUMNS = [
  { key: 'open', title: 'Open', statuses: ['open'] },
  { key: 'in_review', title: 'In review', statuses: ['in_review'] },
  { key: 'escalated', title: 'Escalated', statuses: ['escalated'] },
  { key: 'closed', title: 'Closed', statuses: CLOSED_CASE_STATUSES },
] as const

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'kanban'
  } catch {
    return 'kanban'
  }
}

function saveView(view: View): void {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    /* private window: the toggle still works for this visit */
  }
}

type Load = { key: string; status: 'ready' } | { key: string; status: 'error'; message: string }

/** Case Manager (docs/03 §8, PRD D1): every case as Kanban columns or a list, updating live as cases move. */
export function CaseManager() {
  const me = useAuth((s) => s.user?.id)
  const [view, setView] = useState<View>(readView)
  const [scope, setScope] = useState<Scope>('open')
  const [assignee, setAssignee] = useState<string | null>(null)
  const [people, setPeople] = useState<AssigneeData[]>([])
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<Load | null>(null)
  const { items, fresh, setItems, seen } = useCases()
  const live = useLive()

  // Kanban shows every status as its own column; the list honours the status scope.
  const statuses = view === 'kanban' ? [] : [...SCOPE_STATUSES[scope]]
  const key = `${view}|${scope}|${assignee ?? ''}|${String(attempt)}`
  const state = load?.key === key ? load : null

  useEffect(() => {
    const controller = new AbortController()
    listCases({ statuses: view === 'kanban' ? [] : [...SCOPE_STATUSES[scope]], assignee }, null, controller.signal)
      .then((page) => {
        setItems(page.items)
        setLoad({ key, status: 'ready' })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoad({ key, status: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      controller.abort()
    }
  }, [key, view, scope, assignee, setItems])

  useEffect(() => {
    const controller = new AbortController()
    listAssignees(controller.signal)
      .then(setPeople)
      .catch(() => undefined)
    return () => {
      controller.abort()
    }
  }, [])

  useResync(() => {
    setAttempt((a) => a + 1)
  })

  const shown = items.filter((c) => caseMatches(c, statuses, assignee, me))
  const changeView = (next: View) => {
    setView(next)
    saveView(next)
  }

  return (
    <Page
      wide
      title="Case Manager"
      meta={
        <p className="flex items-center gap-2 text-[13px] text-fg-muted">
          <span aria-hidden="true" className={`size-2 rounded-full ${live === 'connected' ? 'bg-ok' : 'bg-fg-subtle'}`} />
          {live === 'connected' ? 'Live' : 'Live updates paused'}
          {state?.status === 'ready' && <span className="font-mono text-xs">· {shown.length} shown</span>}
        </p>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {view === 'list' && (
          <div role="radiogroup" aria-label="Which cases" className="inline-flex overflow-hidden rounded-md border border-line-strong">
            {(['open', 'closed', 'all'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={scope === s}
                onClick={() => {
                  setScope(s)
                }}
                className={`h-8 border-l border-line px-3 text-[13px] font-medium first:border-l-0 ${scope === s ? 'bg-selected text-fg' : 'bg-panel text-fg-muted hover:bg-raised'}`}
              >
                {s === 'open' ? 'Open' : s === 'closed' ? 'Closed' : 'All'}
              </button>
            ))}
          </div>
        )}
        <label className="sr-only" htmlFor="case-assignee">
          Assignee
        </label>
        <select
          id="case-assignee"
          value={assignee ?? ''}
          onChange={(e) => {
            setAssignee(e.target.value || null)
          }}
          className="h-8 rounded-md border border-line-strong bg-panel px-2 text-[13px] text-fg"
        >
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
        <div role="radiogroup" aria-label="View" className="ml-auto inline-flex overflow-hidden rounded-md border border-line-strong">
          {(
            [
              ['list', 'List', List],
              ['kanban', 'Kanban', Columns3],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => {
                changeView(v)
              }}
              className={`inline-flex h-8 items-center gap-1.5 border-l border-line px-3 text-[13px] font-medium first:border-l-0 ${view === v ? 'bg-selected text-fg' : 'bg-panel text-fg-muted hover:bg-raised'}`}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {!state ? (
        <div className="rounded-card border border-line-strong bg-panel">
          <SkeletonRows rows={5} label="Loading cases" />
        </div>
      ) : state.status === 'error' ? (
        <ErrorRetry
          title="Cases could not be loaded"
          message={state.message}
          onRetry={() => {
            setAttempt((a) => a + 1)
          }}
        />
      ) : shown.length === 0 && (view === 'list' || items.length === 0) ? (
        <section className="rounded-card border border-line-strong bg-panel">
          <EmptyState
            icon={BriefcaseBusiness}
            title={assignee || scope !== 'open' ? 'No cases match' : 'No open cases'}
            description={
              assignee || scope !== 'open'
                ? 'Nothing here for these filters. Try anyone, or all cases.'
                : 'A case starts from an alert: open one in the Alert Inbox and choose Case.'
            }
            action={
              <Link
                to="/alerts"
                className="inline-flex h-8 items-center rounded-md border border-line-strong bg-panel px-3 text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-raised"
              >
                Go to the Alert Inbox
              </Link>
            }
          />
        </section>
      ) : view === 'kanban' ? (
        <Board cases={shown} fresh={fresh} onSeen={seen} />
      ) : (
        <CaseTable cases={shown} fresh={fresh} onSeen={seen} />
      )}
    </Page>
  )
}

interface ListProps {
  cases: CaseRow[]
  fresh: Set<string>
  onSeen: (id: string) => void
}

function Board({ cases, fresh, onSeen }: ListProps) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((col) => {
        const inCol = cases.filter((c) => (col.statuses as readonly CaseStatus[]).includes(c.status))
        const visible = col.key === 'closed' ? inCol.slice(0, CLOSED_SHOWN) : inCol
        return (
          <section
            key={col.key}
            aria-labelledby={`col-${col.key}`}
            data-testid={`column-${col.key}`}
            className="flex min-h-40 flex-col rounded-card border border-line bg-raised"
          >
            <h2 id={`col-${col.key}`} className="flex items-center gap-2 px-3 py-2.5 text-[13px] font-semibold text-fg">
              {col.title}
              <span className="font-mono text-xs font-normal text-fg-subtle">{inCol.length}</span>
            </h2>
            <ol className="flex flex-col gap-2 px-2 pb-2">
              {visible.map((c) => (
                <li key={c.id}>
                  <CaseCard row={c} fresh={fresh.has(c.id)} onSeen={onSeen} />
                </li>
              ))}
              {inCol.length === 0 && <li className="px-2 py-3 text-center text-xs text-fg-subtle">No cases</li>}
              {inCol.length > visible.length && (
                <li className="px-2 py-1 text-center text-xs text-fg-subtle">{inCol.length - visible.length} older closed cases are in the list view.</li>
              )}
            </ol>
          </section>
        )
      })}
    </div>
  )
}

function CaseCard({ row, fresh, onSeen }: { row: CaseRow; fresh: boolean; onSeen: (id: string) => void }) {
  return (
    <Link
      to={`/cases/${encodeURIComponent(row.id)}`}
      data-testid="case-card"
      data-fresh={fresh || undefined}
      onAnimationEnd={() => {
        onSeen(row.id)
      }}
      className={`flex flex-col gap-1.5 rounded-card border border-line-strong bg-panel px-3 py-2.5 transition-colors duration-150 hover:border-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${fresh ? 'alert-fresh' : ''}`}
    >
      <span className="flex items-center gap-2">
        <span className="font-mono text-xs text-fg-muted">{row.case_number}</span>
        {row.top_band && <RiskBadge band={row.top_band} className="ml-auto" />}
      </span>
      <span className="line-clamp-2 text-[13px] leading-snug font-medium text-fg">{row.title}</span>
      <span className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={row.priority} />
        {isClosed(row.status) && (
          <span className="rounded border border-line-strong px-1.5 font-mono text-[11px] text-fg-muted">
            {row.status === 'closed_confirmed' ? 'Confirmed' : 'False positive'}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2 font-mono text-[11px] text-fg-subtle">
        <Assignee name={row.assignee_name} />
        <span>
          {row.alert_count} alert{row.alert_count === 1 ? '' : 's'}
        </span>
        <time className="ml-auto" dateTime={row.created_at} title={`Opened ${new Date(row.created_at).toLocaleString()}`}>
          {timeAgo(row.created_at)}
        </time>
      </span>
    </Link>
  )
}

function CaseTable({ cases, fresh, onSeen }: ListProps) {
  return (
    <div className="overflow-x-auto rounded-card border border-line-strong bg-panel">
      <table className="w-full min-w-[860px] border-collapse text-left text-[13px]">
        <thead className="text-xs text-fg-subtle">
          <tr className="border-b border-line-strong">
            {['Case', 'Title', 'Status', 'Worst alert', 'Priority', 'Assignee', 'Alerts', 'Opened'].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr
              key={c.id}
              data-testid="case-row"
              data-fresh={fresh.has(c.id) || undefined}
              onAnimationEnd={() => {
                onSeen(c.id)
              }}
              className={`border-b border-line last:border-b-0 hover:bg-raised/60 ${fresh.has(c.id) ? 'alert-fresh' : ''}`}
            >
              <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-fg-muted">{c.case_number}</td>
              <td className="max-w-[38ch] px-3 py-2.5">
                <Link
                  to={`/cases/${encodeURIComponent(c.id)}`}
                  className="line-clamp-1 font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {c.title}
                </Link>
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap text-fg-muted">{CASE_STATUS_LABEL[c.status]}</td>
              <td className="px-3 py-2.5">{c.top_band ? <RiskBadge band={c.top_band} /> : <span className="text-fg-subtle">—</span>}</td>
              <td className="px-3 py-2.5">
                <PriorityBadge priority={c.priority} />
              </td>
              <td className="px-3 py-2.5">
                <span className="flex items-center gap-2 whitespace-nowrap text-fg-muted">
                  <Assignee name={c.assignee_name} />
                  {c.assignee_name ?? 'Unassigned'}
                </span>
              </td>
              <td className="px-3 py-2.5 font-mono text-xs">{c.alert_count}</td>
              <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-fg-subtle">
                <time dateTime={c.created_at}>{timeAgo(c.created_at)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
