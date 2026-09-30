import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { createCase, getCase } from '@/api/cases'
import type { AlertDetail, AlertStatus, CaseDetail, CasePriority } from '@/api/types'
import { Dialog } from '@/components/Dialog'
import { STATUS_LABEL } from '@/lib/alerts'
import { CASE_STATUS_LABEL, markOwnChange, PRIORITIES, PRIORITY_META } from '@/lib/cases'
import { toCaseRow, useCases } from '@/store/cases'

interface CaseDialogProps {
  alert: AlertDetail
  /** The status the inbox shows now, which may be newer than the loaded alert. */
  status: AlertStatus
  onClose: () => void
}

const STARTABLE: readonly AlertStatus[] = ['open', 'acknowledged']
const CONTROL = 'h-9 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] text-fg'

type Linked = { status: 'loading' } | { status: 'loaded'; data: CaseDetail } | { status: 'error' }

/**
 * Start a case from an alert (docs/04 §2 step 9): the title comes from the alert and the priority from its band.
 * Grouping pulls in every other open alert that shares an entity. An alert already in a case links to that case.
 */
export function CaseDialog({ alert, status, onClose }: CaseDialogProps) {
  const navigate = useNavigate()
  const [title, setTitle] = useState(alert.title)
  const [priority, setPriority] = useState<CasePriority>(alert.risk_band)
  const [group, setGroup] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linked, setLinked] = useState<Linked | null>(alert.linked_case_id ? { status: 'loading' } : null)
  const titleId = useId()
  const priorityId = useId()
  const hintId = useId()

  useEffect(() => {
    if (!alert.linked_case_id) return
    const controller = new AbortController()
    getCase(alert.linked_case_id, controller.signal)
      .then((data) => {
        setLinked({ status: 'loaded', data })
      })
      .catch(() => {
        if (!controller.signal.aborted) setLinked({ status: 'error' })
      })
    return () => {
      controller.abort()
    }
  }, [alert.linked_case_id])

  const submit = () => {
    if (title.trim().length < 3) {
      setError('Give the case a title of at least 3 characters.')
      return
    }
    setBusy(true)
    setError(null)
    createCase({ title: title.trim(), priority, alert_ids: [alert.id], group_by_entities: group })
      .then((created) => {
        markOwnChange(created.id)
        useCases.getState().upsert(toCaseRow(created))
        void navigate(`/cases/${encodeURIComponent(created.id)}`)
      })
      .catch((err: unknown) => {
        setBusy(false)
        setError(err instanceof Error ? err.message : String(err))
      })
  }

  if (alert.linked_case_id) {
    const c = linked?.status === 'loaded' ? linked.data : null
    return (
      <Dialog title="Already in a case" description="This alert is linked to a case; open it there." onClose={onClose}>
        <div className="flex flex-col gap-4">
          {linked?.status === 'loading' && <p className="text-[13px] text-fg-muted">Finding the case…</p>}
          {c && (
            <p className="flex flex-col gap-0.5 rounded-md border border-line bg-canvas px-3 py-2">
              <span className="font-mono text-xs text-fg-muted">
                {c.case_number} · {CASE_STATUS_LABEL[c.status]}
              </span>
              <span className="text-[13px] font-medium text-fg">{c.title}</span>
            </p>
          )}
          <div className="flex justify-end">
            <Link
              data-autofocus
              to={`/cases/${encodeURIComponent(alert.linked_case_id)}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent-fill px-3 text-[13px] font-semibold text-on-accent hover:bg-accent-fill-hover"
            >
              Open {c?.case_number ?? 'the case'}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
        </div>
      </Dialog>
    )
  }

  if (!STARTABLE.includes(status)) {
    return (
      <Dialog title="This alert cannot start a case" onClose={onClose}>
        <p className="text-[13px] text-fg-muted">Only open or acknowledged alerts start a case. This one is {STATUS_LABEL[status].toLowerCase()}.</p>
      </Dialog>
    )
  }

  return (
    <Dialog title="Start a case" description="The case opens in the Case Manager with this alert linked." onClose={onClose} busy={busy}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={titleId} className="text-[13px] font-medium text-fg">
            Title
          </label>
          <input
            id={titleId}
            data-autofocus
            value={title}
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value)
            }}
            className={CONTROL}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={priorityId} className="text-[13px] font-medium text-fg">
            Priority
          </label>
          <select
            id={priorityId}
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value as CasePriority)
            }}
            className={CONTROL}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_META[p].label}
              </option>
            ))}
          </select>
          <p className="text-xs text-fg-subtle">Set from the alert's {alert.risk_band} band; change it if the case is more or less urgent.</p>
        </div>
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={group}
            aria-describedby={hintId}
            onChange={(e) => {
              setGroup(e.target.checked)
            }}
            className="mt-0.5 accent-accent"
          />
          <span className="flex flex-col">
            <span className="text-[13px] font-medium text-fg">Group linked alerts by shared entities</span>
            <span id={hintId} className="text-xs text-fg-muted">
              Adds every other open or acknowledged alert naming one of this alert's customers, accounts or employees (up to 50).
            </span>
          </span>
        </label>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            Not created: {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-md border border-line-strong bg-panel px-3 text-[13px] font-medium text-fg hover:bg-raised disabled:opacity-55"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent-fill px-3 text-[13px] font-semibold text-on-accent hover:bg-accent-fill-hover disabled:opacity-55"
          >
            {busy && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />}
            Open case
          </button>
        </div>
      </form>
    </Dialog>
  )
}
