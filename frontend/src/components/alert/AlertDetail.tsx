import { ArrowRight, CircleCheck, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getAlert } from '@/api/alerts'
import type { AlertDetail as AlertDetailData, AlertStatus } from '@/api/types'
import { EntityChip } from '@/components/EntityChip'
import { ErrorRetry } from '@/components/ErrorRetry'
import { RiskBadge } from '@/components/RiskBadge'
import { Skeleton } from '@/components/Skeleton'
import { acknowledge, money, STATUS_LABEL, timeAgo } from '@/lib/alerts'
import { useAlerts } from '@/store/alerts'
import { useAuth } from '@/store/auth'
import { AlertGraph } from './AlertGraph'
import { CaseDialog } from './CaseDialog'
import { EvidencePanel, type EvidenceState } from './EvidencePanel'
import { EvidenceTimeline } from './EvidenceTimeline'
import { FactorTable } from './FactorTable'

const ENTITY_ORDER = { customer: 0, employee: 1, account: 2 } as const

type DetailState = { status: 'loading' } | { status: 'loaded'; alert: AlertDetailData } | { status: 'error'; message: string }

interface AlertDetailProps {
  alertId: string
  /** Open the case dialog from outside (the inbox's C key). */
  caseRequested?: number
}

const BUTTON =
  'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55'

/**
 * One alert, laid out as docs/03 §7: header, explanation, risk factors, the evidence panel, then the graph
 * snapshot and the evidence Timeline. The evidence panel is mounted in every state of this component.
 */
export function AlertDetail({ alertId, caseRequested = 0 }: AlertDetailProps) {
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [ackState, setAckState] = useState<{ busy: boolean; error: string | null; status: AlertStatus | null }>({ busy: false, error: null, status: null })
  const [caseOpen, setCaseOpen] = useState(false)
  const listStatus = useAlerts((s) => s.items.find((x) => x.id === alertId)?.status)
  const role = useAuth((s) => s.user?.role)
  const canAct = role !== undefined && role !== 'viewer'

  useEffect(() => {
    const controller = new AbortController()
    getAlert(alertId, controller.signal)
      .then((alert) => {
        setState({ status: 'loaded', alert })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      controller.abort()
    }
  }, [alertId, attempt])

  // The inbox's C key bumps caseRequested; open the dialog when it changes (derived during render, not in an effect).
  const [lastCaseRequest, setLastCaseRequest] = useState(caseRequested)
  if (caseRequested !== lastCaseRequest) {
    setLastCaseRequest(caseRequested)
    setCaseOpen(true)
  }

  const alert = state.status === 'loaded' ? state.alert : null
  const status: AlertStatus | null = ackState.status ?? listStatus ?? alert?.status ?? null
  const evidenceIds = useMemo(() => new Set(alert?.evidence.map((e) => e.ref_id) ?? []), [alert])
  const labels = useMemo(() => Object.fromEntries((alert?.entities ?? []).map((e) => [e.id, e.label])), [alert])
  const evidence: EvidenceState =
    state.status === 'loaded'
      ? { status: 'loaded', evidence: state.alert.evidence }
      : state.status === 'error'
        ? { status: 'error', message: state.message }
        : { status: 'loading' }

  const onAcknowledge = () => {
    setAckState({ busy: true, error: null, status: 'acknowledged' })
    acknowledge(alertId)
      .then((updated) => {
        setAckState({ busy: false, error: null, status: updated.status })
      })
      .catch((err: unknown) => {
        setAckState({ busy: false, error: err instanceof Error ? err.message : String(err), status: null })
      })
  }

  return (
    <article aria-label={alert ? alert.title : 'Alert'} className="flex flex-col gap-4">
      {state.status === 'loading' && (
        <div role="status" aria-label="Loading alert" className="flex flex-col gap-2.5">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {state.status === 'error' && (
        <ErrorRetry
          title="This alert could not be loaded"
          message={state.message}
          onRetry={() => {
            setState({ status: 'loading' })
            setAttempt((a) => a + 1)
          }}
        />
      )}

      {alert && (
        <>
          <header className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <RiskBadge band={alert.risk_band} />
              <span className="font-mono text-xs text-fg-muted">{alert.rule_code}</span>
              <h2 className="text-base font-semibold tracking-tight text-fg">{alert.title}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {[...alert.entities]
                .sort((a, b) => ENTITY_ORDER[a.type] - ENTITY_ORDER[b.type])
                .map((e) => (
                  <EntityChip key={e.id} kind={e.type} id={e.id} label={e.label} />
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-fg-muted">
              <time dateTime={alert.detected_at} title={new Date(alert.detected_at).toLocaleString()}>
                Detected {timeAgo(alert.detected_at)}
              </time>
              {alert.amount_total && (
                <span>
                  Total <span className="font-mono text-[13px] font-medium text-fg tabular-nums">{money(alert.amount_total)}</span>
                </span>
              )}
              <span className="font-mono text-xs">occurrence ×{alert.occurrence_count}</span>
              {status && (
                <span data-testid="alert-status" className="rounded border border-line-strong px-1.5 font-mono text-[11px] text-fg-muted">
                  {STATUS_LABEL[status]}
                </span>
              )}
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={onAcknowledge}
                  disabled={!canAct || status !== 'open' || ackState.busy}
                  title={canAct ? undefined : 'Your role can read alerts but not change them'}
                  className={`${BUTTON} bg-accent-fill text-on-accent hover:bg-accent-fill-hover`}
                >
                  {ackState.busy ? (
                    <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  ) : (
                    status !== 'open' && <CircleCheck aria-hidden="true" className="size-3.5" />
                  )}
                  {status === 'open' || status === null ? 'Acknowledge' : 'Acknowledged'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCaseOpen(true)
                  }}
                  disabled={!canAct}
                  className={`${BUTTON} border border-line-strong bg-panel text-fg hover:bg-raised`}
                >
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                  Case
                </button>
              </span>
            </div>
            {ackState.error && (
              <p role="alert" className="text-[13px] text-danger">
                Not acknowledged: {ackState.error}
              </p>
            )}
          </header>

          <section aria-labelledby="explanation-heading" className="flex flex-col gap-1 rounded-card border border-line bg-canvas px-3.5 py-3">
            <h3 id="explanation-heading" className="text-xs font-semibold text-fg-muted">
              Explanation
            </h3>
            <p data-testid="alert-explanation" className="max-w-[80ch] text-[13.5px] leading-relaxed text-fg">
              {alert.explanation}
            </p>
          </section>

          <FactorTable factors={alert.risk_factors} score={alert.risk_score} band={alert.risk_band} />
        </>
      )}

      <EvidencePanel state={evidence} labels={labels} />

      {alert && (
        <div className="flex flex-col gap-4">
          <AlertGraph alertId={alert.id} entityIds={alert.entity_ids} evidenceIds={evidenceIds} />
          <EvidenceTimeline entities={alert.entities} evidenceIds={evidenceIds} />
        </div>
      )}

      {caseOpen && alert && (
        <CaseDialog
          alert={alert}
          status={status ?? alert.status}
          onClose={() => {
            setCaseOpen(false)
          }}
        />
      )}
    </article>
  )
}
