import { ArrowLeft, BriefcaseBusiness, Check, Download, FileText, LoaderCircle, Send } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ApiError } from '@/api/client'
import { addNote, assignCase, downloadExport, getCase, listAssignees, patchCase, type ExportFormat } from '@/api/cases'
import type { AlertRow, Assignee as AssigneeData, CaseAuditRow, CaseDetail as CaseData, CasePatch, CaseStatus, Role } from '@/api/types'
import { AlertDetail } from '@/components/alert/AlertDetail'
import { Assignee, PriorityBadge } from '@/components/case/CaseBits'
import { CloseCaseDialog } from '@/components/case/CloseCaseDialog'
import { Dialog } from '@/components/Dialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorRetry } from '@/components/ErrorRetry'
import { RiskBadge } from '@/components/RiskBadge'
import { Skeleton } from '@/components/Skeleton'
import { money, primaryEntity, STATUS_LABEL, timeAgo } from '@/lib/alerts'
import {
  AUDIT_LABEL,
  CASE_STATUS_LABEL,
  CASE_STATUSES,
  isClosed,
  MANAGER_ROLES,
  markOwnChange,
  PRIORITIES,
  PRIORITY_META,
  STAGES,
  stageOf,
  transitionBlock,
  TRANSITIONS,
} from '@/lib/cases'
import { useAuth } from '@/store/auth'
import { toCaseRow, useCases } from '@/store/cases'
import { CASE_UPDATED_EVENT } from '@/ws/useCaseFeed'
import { useResync } from '@/ws/useSocket'

type Load = { status: 'loading' } | { status: 'loaded'; data: CaseData } | { status: 'error'; message: string; missing: boolean }

const CONTROL = 'h-9 w-full rounded-md border border-line-strong bg-panel px-2 text-[13px] text-fg disabled:cursor-not-allowed disabled:opacity-60'
const BUTTON =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-line-strong bg-panel px-3 text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-raised disabled:cursor-not-allowed disabled:opacity-55'
const RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const
const READ_ONLY = 'Your role can read cases but not change them'

/** Case detail (docs/03 §8, PRD D1–D3): the case file on the left, every decision in the rail on the right. */
export function CaseDetail() {
  const { id = '' } = useParams()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [people, setPeople] = useState<AssigneeData[]>([])
  const user = useAuth((s) => s.user)

  const refresh = useCallback(
    (signal?: AbortSignal) =>
      getCase(id, signal)
        .then((data) => {
          setLoad({ status: 'loaded', data })
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return
          // A background refresh that fails keeps what is on screen; only the first load shows the error.
          setLoad((prev) =>
            prev.status === 'loaded'
              ? prev
              : { status: 'error', message: err instanceof Error ? err.message : String(err), missing: err instanceof ApiError && err.status === 404 },
          )
        }),
    [id],
  )

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => {
      controller.abort()
    }
  }, [refresh, attempt])

  useEffect(() => {
    const controller = new AbortController()
    listAssignees(controller.signal)
      .then(setPeople)
      .catch(() => undefined)
    return () => {
      controller.abort()
    }
  }, [])

  // Someone changed this case (the channel says so): fetch it again so the rail and the trail stay true.
  useEffect(() => {
    const onUpdate = (event: Event) => {
      if ((event as CustomEvent<{ id: string }>).detail.id === id) void refresh()
    }
    window.addEventListener(CASE_UPDATED_EVENT, onUpdate)
    return () => {
      window.removeEventListener(CASE_UPDATED_EVENT, onUpdate)
    }
  }, [id, refresh])
  useResync(() => {
    void refresh()
  })

  const apply = (data: CaseData) => {
    setLoad({ status: 'loaded', data })
    useCases.getState().upsert(toCaseRow(data))
  }

  return (
    <div className="flex w-full flex-col gap-5 px-4 py-5 lg:px-8 lg:py-6">
      <Link to="/cases" className="inline-flex items-center gap-1 self-start text-[13px] font-medium text-accent hover:underline">
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        Case Manager
      </Link>
      {load.status === 'loading' && (
        <div role="status" aria-label="Loading case" className="flex flex-col gap-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {load.status === 'error' &&
        (load.missing ? (
          <section className="rounded-card border border-line-strong bg-panel">
            <EmptyState icon={BriefcaseBusiness} title="Case not found" description="It does not exist, or it belongs to another tenant." />
          </section>
        ) : (
          <ErrorRetry
            title="This case could not be loaded"
            message={load.message}
            onRetry={() => {
              setLoad({ status: 'loading' })
              setAttempt((a) => a + 1)
            }}
          />
        ))}
      {load.status === 'loaded' && user && <CaseFile data={load.data} people={people} me={user.id} role={user.role} onChange={apply} />}
    </div>
  )
}

interface CaseFileProps {
  data: CaseData
  people: AssigneeData[]
  me: string
  role: Role
  onChange: (data: CaseData) => void
}

function canChange(data: CaseData, me: string, role: Role): boolean {
  return role !== 'viewer' && (MANAGER_ROLES.includes(role) || me === data.created_by || me === data.assignee_id)
}

function CaseFile({ data, people, me, role, onChange }: CaseFileProps) {
  const [drawer, setDrawer] = useState<AlertRow | null>(null)
  const worst = data.alerts.reduce<AlertRow['risk_band'] | null>((w, a) => (w === null || RANK[a.risk_band] > RANK[w] ? a.risk_band : w), null)
  const total = data.alerts.reduce((sum, a) => sum + (a.amount_total ? Number(a.amount_total) : 0), 0)
  const names = new Map<string, string>(people.map((p) => [p.id, p.full_name] as const))
  if (data.assignee_id && data.assignee_name) names.set(data.assignee_id, data.assignee_name)
  if (data.created_by_name) names.set(data.created_by, data.created_by_name)
  for (const a of data.alerts) names.set(a.id, a.title)

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] text-fg-muted">{data.case_number}</span>
            <span data-testid="case-status" className="rounded border border-line-strong px-1.5 font-mono text-[11px] text-fg-muted">
              {CASE_STATUS_LABEL[data.status]}
            </span>
            <PriorityBadge priority={data.priority} />
            {worst && <RiskBadge band={worst} />}
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">{data.title}</h1>
          <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-fg-muted">
            <time dateTime={data.created_at} title={new Date(data.created_at).toLocaleString()}>
              Opened {timeAgo(data.created_at)}
            </time>
            <span>by {data.created_by_name ?? data.created_by}</span>
            <span aria-hidden="true">·</span>
            <span>
              {data.alerts.length} alert{data.alerts.length === 1 ? '' : 's'}
            </span>
            {total > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Total <span className="font-mono font-medium text-fg tabular-nums">{money(total.toFixed(2))}</span>
                </span>
              </>
            )}
          </p>
          {data.description && <p className="max-w-[80ch] text-[13.5px] text-fg">{data.description}</p>}
        </header>

        <section aria-labelledby="linked-heading" className="flex flex-col gap-2">
          <h2 id="linked-heading" className="flex items-center gap-2 text-[13px] font-semibold text-fg">
            Linked alerts <span className="font-mono text-xs font-normal text-fg-subtle">{data.alerts.length}</span>
          </h2>
          {data.alerts.length === 0 ? (
            <p className="rounded-card border border-line bg-panel px-4 py-3 text-[13px] text-fg-muted">No alerts are linked to this case.</p>
          ) : (
            <ul className="overflow-hidden rounded-card border border-line-strong bg-panel">
              {data.alerts.map((a) => (
                <li key={a.id} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    data-testid="linked-alert"
                    onClick={() => {
                      setDrawer(a)
                    }}
                    className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3.5 py-2.5 text-left hover:bg-raised/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                  >
                    <RiskBadge band={a.risk_band} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-medium text-fg">{a.title}</span>
                      <span className="truncate text-xs text-fg-muted">
                        {STATUS_LABEL[a.status]} · {a.entities.length ? a.entities.map((e) => e.label).join(' · ') : (primaryEntity(a)?.label ?? a.rule_code)}
                      </span>
                    </span>
                    <span className="font-mono text-xs whitespace-nowrap text-fg">{money(a.amount_total) ?? '—'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Notes data={data} me={me} role={role} onChange={onChange} />
      </div>

      <aside aria-label="Decisions and history" className="flex flex-col gap-4 lg:sticky lg:top-4">
        <DecisionRail data={data} people={people} me={me} role={role} onChange={onChange} />
        <AuditTrail rows={data.audit} names={names} />
      </aside>

      {drawer && (
        <Dialog
          variant="sheet"
          title={drawer.title}
          description={<span className="font-mono text-xs">{drawer.rule_code}</span>}
          onClose={() => {
            setDrawer(null)
          }}
        >
          <AlertDetail alertId={drawer.id} />
        </Dialog>
      )}
    </div>
  )
}

function DecisionRail({ data, people, me, role, onChange }: CaseFileProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState<'closed_confirmed' | 'closed_false_positive' | null>(null)
  const [exported, setExported] = useState<{ filename: string; digest: string | null } | null>(null)
  const statusId = useId()
  const priorityId = useId()
  const assigneeId = useId()
  const closed = isClosed(data.status)
  const viewer = role === 'viewer'
  const manager = MANAGER_ROLES.includes(role)
  const lockReason = viewer
    ? READ_ONLY
    : closed
      ? 'This case is closed'
      : !canChange(data, me, role)
        ? 'Only the case creator, its assignee or a manager can change it'
        : undefined

  const run = (key: string, action: () => Promise<CaseData>) => {
    setBusy(key)
    setError(null)
    markOwnChange(data.id)
    action()
      .then(onChange)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        setBusy(null)
      })
  }
  const patch = (key: string, body: CasePatch) => {
    run(key, () => patchCase(data.id, body))
  }

  const exportAs = (format: ExportFormat) => {
    setBusy(`export-${format}`)
    setError(null)
    downloadExport(data.id, format)
      .then(setExported)
      .catch((err: unknown) => {
        setError(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        setBusy(null)
      })
  }

  return (
    <section aria-labelledby="decision-heading" className="flex flex-col gap-4 rounded-card border border-line-strong bg-panel p-4">
      <h2 id="decision-heading" className="text-[13px] font-semibold text-fg">
        Decision
      </h2>
      <LifecycleTrack status={data.status} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={statusId} className="text-xs font-medium text-fg-subtle">
          Status
        </label>
        <select
          id={statusId}
          value={data.status}
          disabled={Boolean(lockReason) || busy !== null}
          title={lockReason}
          onChange={(e) => {
            const next = e.target.value as CaseStatus
            if (next === 'closed_confirmed' || next === 'closed_false_positive') setClosing(next)
            else patch('status', { status: next })
          }}
          className={CONTROL}
        >
          {CASE_STATUSES.map((s) => {
            const block = transitionBlock(data.status, s, role)
            return (
              <option key={s} value={s} disabled={block !== null} title={block ?? undefined}>
                {CASE_STATUS_LABEL[s]}
              </option>
            )
          })}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={priorityId} className="text-xs font-medium text-fg-subtle">
          Priority
        </label>
        <select
          id={priorityId}
          value={data.priority}
          disabled={Boolean(lockReason) || busy !== null}
          title={lockReason}
          onChange={(e) => {
            patch('priority', { priority: e.target.value as CaseData['priority'] })
          }}
          className={CONTROL}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={assigneeId} className="text-xs font-medium text-fg-subtle">
          Assignee
        </label>
        <div className="flex items-center gap-2">
          <Assignee name={data.assignee_name} size="md" />
          <select
            id={assigneeId}
            value={data.assignee_id ?? ''}
            disabled={viewer || closed || busy !== null}
            title={viewer ? READ_ONLY : closed ? 'This case is closed' : undefined}
            onChange={(e) => {
              const to = e.target.value
              if (to) run('assign', () => assignCase(data.id, to))
            }}
            className={CONTROL}
          >
            {!data.assignee_id && <option value="">Unassigned</option>}
            {people.map((p) => {
              const blocked = !manager && p.id !== me
              return (
                <option key={p.id} value={p.id} disabled={blocked} title={blocked ? 'Only a manager can assign a case to someone else' : undefined}>
                  {p.full_name}
                  {p.id === me ? ' (you)' : ''}
                </option>
              )
            })}
          </select>
        </div>
      </div>

      <button
        type="button"
        disabled={Boolean(lockReason) || busy !== null || transitionBlock(data.status, 'closed_confirmed', role) !== null}
        title={lockReason ?? transitionBlock(data.status, 'closed_confirmed', role) ?? undefined}
        onClick={() => {
          setClosing('closed_confirmed')
        }}
        className={BUTTON}
      >
        <Check aria-hidden="true" className="size-3.5" />
        Close case…
      </button>

      <div className="flex flex-col gap-1.5 border-t border-line pt-4">
        <span className="text-xs font-medium text-fg-subtle">Export evidence</span>
        <div className="grid grid-cols-2 gap-2">
          {(['json', 'html'] as const).map((f) => (
            <button
              key={f}
              type="button"
              disabled={viewer || busy !== null}
              title={viewer ? 'Exporting evidence needs the investigator role or above' : undefined}
              onClick={() => {
                exportAs(f)
              }}
              className={BUTTON}
            >
              {busy === `export-${f}` ? (
                <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              ) : f === 'json' ? (
                <Download aria-hidden="true" className="size-3.5" />
              ) : (
                <FileText aria-hidden="true" className="size-3.5" />
              )}
              Export {f.toUpperCase()}
            </button>
          ))}
        </div>
        {exported && (
          <p role="status" className="text-xs text-fg-muted">
            Saved <span className="font-mono [overflow-wrap:anywhere]">{exported.filename}</span>
            {exported.digest && (
              <>
                {' '}
                · SHA-256{' '}
                <span className="font-mono" title={exported.digest}>
                  {`${exported.digest.slice(0, 8)}…${exported.digest.slice(-6)}`}
                </span>
              </>
            )}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      {closing && (
        <CloseCaseDialog
          caseNumber={data.case_number}
          initial={closing}
          onClose={() => {
            setClosing(null)
          }}
          onSubmit={async (status, note) => {
            markOwnChange(data.id)
            onChange(await patchCase(data.id, { status, close_note: note }))
          }}
        />
      )}
    </section>
  )
}

/** Open → In review → Escalated → Closed: done steps quiet, the current one filled, allowed next steps dashed. */
function LifecycleTrack({ status }: { status: CaseStatus }) {
  const now = stageOf(status)
  const at = STAGES.findIndex((s) => s.key === now)
  const next = new Set(TRANSITIONS[status].map(stageOf))
  return (
    <ol aria-label="Lifecycle" className="grid grid-cols-4 overflow-hidden rounded-md border border-line-strong text-center text-[11.5px]">
      {STAGES.map((s, i) => {
        const current = s.key === now
        const done = i < at
        const allowed = next.has(s.key)
        return (
          <li
            key={s.key}
            aria-current={current ? 'step' : undefined}
            data-stage={current ? 'current' : done ? 'done' : allowed ? 'next' : 'later'}
            className={`flex h-8 items-center justify-center border-l border-line-strong px-1 first:border-l-0 ${
              current
                ? 'bg-selected font-semibold text-fg shadow-[inset_0_-2px_0_var(--accent)]'
                : done
                  ? 'bg-raised text-fg-muted'
                  : allowed
                    ? 'text-accent outline-1 -outline-offset-4 outline-accent/50 outline-dashed'
                    : 'text-fg-subtle'
            }`}
          >
            {current && status === 'closed_false_positive' ? 'Closed, FP' : s.label}
          </li>
        )
      })}
    </ol>
  )
}

function Notes({ data, me, role, onChange }: Omit<CaseFileProps, 'people'>) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldId = useId()
  const closed = isClosed(data.status)
  const allowed = canChange(data, me, role) && !closed
  const reason = role === 'viewer' ? READ_ONLY : closed ? 'This case is closed' : 'Only the case creator, its assignee or a manager can add notes'

  const submit = () => {
    const text = body.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    markOwnChange(data.id)
    addNote(data.id, text)
      .then((note) => {
        setBody('')
        onChange({ ...data, notes: [...data.notes, note] })
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <section aria-labelledby="notes-heading" className="flex flex-col gap-2">
      <h2 id="notes-heading" className="flex items-center gap-2 text-[13px] font-semibold text-fg">
        Notes <span className="font-mono text-xs font-normal text-fg-subtle">{data.notes.length}</span>
      </h2>
      {data.notes.length === 0 ? (
        <p className="text-[13px] text-fg-muted">No notes yet.</p>
      ) : (
        <ol className="flex flex-col">
          {data.notes.map((n) => (
            <li key={n.id} data-testid="case-note" className="flex flex-col gap-0.5 border-b border-line py-2.5 last:border-b-0">
              <p className="text-xs text-fg-muted">
                <span className="font-semibold text-fg">{n.author_name ?? n.author_id}</span> ·{' '}
                <time dateTime={n.created_at} title={new Date(n.created_at).toLocaleString()}>
                  {timeAgo(n.created_at)}
                </time>
              </p>
              <p className="max-w-[80ch] text-[13.5px] whitespace-pre-wrap text-fg">{n.body}</p>
            </li>
          ))}
        </ol>
      )}
      {allowed ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="flex flex-col gap-1.5"
        >
          <label htmlFor={fieldId} className="sr-only">
            New note
          </label>
          <div className="flex items-end gap-2 rounded-md border border-line-strong bg-panel p-1.5 focus-within:outline-2 focus-within:outline-accent">
            <textarea
              id={fieldId}
              rows={2}
              value={body}
              maxLength={5000}
              onChange={(e) => {
                setBody(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder="Add a note. Enter saves, Shift+Enter starts a new line."
              className="min-h-9 flex-1 resize-y border-0 bg-transparent px-1.5 py-1 text-[13px] text-fg outline-none placeholder:text-fg-subtle"
            />
            <button
              type="submit"
              disabled={busy || !body.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent-fill px-3 text-[13px] font-semibold text-on-accent hover:bg-accent-fill-hover disabled:opacity-55"
            >
              {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Send aria-hidden="true" className="size-3.5" />}
              Add note
            </button>
          </div>
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              Not saved: {error}
            </p>
          )}
        </form>
      ) : (
        <p className="text-xs text-fg-subtle">{reason}.</p>
      )}
    </section>
  )
}

function describe(row: CaseAuditRow, names: Map<string, string>): string | null {
  const d = row.detail
  const who = (v: unknown) => (typeof v === 'string' ? (names.get(v) ?? v) : 'nobody')
  const alertStatus = (v: unknown) => (typeof v === 'string' && v in STATUS_LABEL ? STATUS_LABEL[v as AlertRow['status']].toLowerCase() : String(v))
  const status = (v: unknown) => (typeof v === 'string' && v in CASE_STATUS_LABEL ? CASE_STATUS_LABEL[v as CaseStatus].toLowerCase() : String(v))
  switch (row.action) {
    case 'case.status':
      return `${status(d.from)} → ${status(d.to)}`
    case 'case.assign': {
      const moved = d.status as { from?: unknown; to?: unknown } | undefined
      return `${who(d.from)} → ${who(d.to)}${moved ? ` · ${status(moved.from)} → ${status(moved.to)}` : ''}`
    }
    case 'case.update':
      return Object.entries(d)
        .map(([k, v]) => {
          const c = v as { from?: unknown; to?: unknown }
          return k === 'priority' ? `priority ${String(c.from)} → ${String(c.to)}` : 'description edited'
        })
        .join(' · ')
    case 'case.create': {
      const n = Array.isArray(d.alert_ids) ? d.alert_ids.length : 0
      return `${String(n)} alert${n === 1 ? '' : 's'}${d.grouped ? ', grouped by shared entities' : ''}`
    }
    case 'alert.link':
      return `${who(row.object_id)} · ${alertStatus(d.from)} → ${alertStatus(d.to)}`
    case 'alert.ack':
      return who(row.object_id)
    case 'case.export':
      return typeof d.digest_sha256 === 'string' ? `${String(d.format).toUpperCase()} · SHA-256 ${d.digest_sha256.slice(0, 8)}…` : String(d.format)
    default:
      return null
  }
}

function AuditTrail({ rows, names }: { rows: CaseAuditRow[]; names: Map<string, string> }) {
  return (
    <section aria-labelledby="audit-heading" className="flex flex-col gap-3 rounded-card border border-line-strong bg-panel p-4">
      <h2 id="audit-heading" className="flex items-center gap-2 text-[13px] font-semibold text-fg">
        Audit trail <span className="font-mono text-xs font-normal text-fg-subtle">{rows.length}</span>
      </h2>
      <ol className="relative flex flex-col gap-3 pl-4 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3px] before:w-px before:bg-line-strong">
        {[...rows].reverse().map((r) => {
          const detail = describe(r, names)
          return (
            <li key={r.id} data-testid="audit-row" className="relative flex flex-col text-xs">
              <span aria-hidden="true" className="absolute top-1 -left-4 size-[7px] rounded-full border border-fg-subtle bg-panel" />
              <span className="text-[12.5px] text-fg">
                <span className="font-medium">{AUDIT_LABEL[r.action] ?? r.action}</span>
                <span className="text-fg-muted"> · {r.actor_name ?? r.actor_user ?? r.actor_kind}</span>
              </span>
              {detail && <span className="text-fg-muted [overflow-wrap:anywhere]">{detail}</span>}
              <span className="font-mono text-[11px] text-fg-subtle">
                <time dateTime={r.at} title={new Date(r.at).toLocaleString()}>
                  {timeAgo(r.at)}
                </time>{' '}
                · {r.action}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
