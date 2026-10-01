import { ChevronDown, EyeOff, FileLock2, Fingerprint, KeyRound, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import type { DashboardMetrics, Role } from '@/api/types'
import { Skeleton } from '@/components/Skeleton'
import { DATA_ENTRY_ROLES } from '@/lib/screens'

/** Measured in the scenario run (docs/10 §6): shown until this API process has timed alerts of its own. */
const MEASURED_P95_MS = 210
const RULE_COUNT = 7

interface Stage {
  step: string
  title: string
  what: string
  value: (m: DashboardMetrics) => string
  to?: string
  roles?: readonly Role[]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

const STAGES: Stage[] = [
  {
    step: '1',
    title: 'Events arrive',
    what: 'Transfers, staff actions, logins and access grants, from a feed or Add data.',
    value: (m) => plural(m.totals.events, 'event'),
    to: '/add',
    roles: DATA_ENTRY_ROLES,
  },
  {
    step: '2',
    title: 'Linked',
    what: 'Into one graph of the people, accounts and money involved.',
    value: (m) => plural(m.totals.entities, 'person or account', 'people and accounts'),
    to: '/graph',
  },
  {
    step: '3',
    title: 'Checked',
    what: `By ${String(RULE_COUNT)} rules as each event lands: loops, structuring, role mismatches, edits before money moves.`,
    value: (m) =>
      m.detection.latency_p95_ms === null ? `p95 ${String(MEASURED_P95_MS)} ms in tests` : `p95 ${String(Math.round(m.detection.latency_p95_ms))} ms live`,
    to: '/admin/rules',
    roles: ['admin'],
  },
  {
    step: '4',
    title: 'Explained',
    what: 'The score split into weighted factors, with the evidence records attached.',
    value: (m) => plural(m.totals.alerts, 'alert'),
    to: '/alerts',
  },
  { step: '5', title: 'Investigated', what: 'Cases assigned to a person, with notes and a recorded decision.', value: (m) => plural(m.totals.cases, 'case'), to: '/cases' },
  {
    step: '6',
    title: 'Exported',
    what: 'A signed evidence bundle a reviewer or regulator can check.',
    value: (m) => `${plural(m.totals.exported_cases, 'case')} exported`,
    to: '/cases',
  },
]

const SAFEGUARDS: { Icon: LucideIcon; title: string; text: string }[] = [
  { Icon: KeyRound, title: 'Right people only', text: 'Four roles. The server checks the role on every action; hiding a button is never the only guard.' },
  { Icon: EyeOff, title: 'Your bank only', text: 'Every record belongs to one bank. Another bank’s records answer “not found”, never “forbidden”.' },
  { Icon: Fingerprint, title: 'Nothing silent', text: 'Every change, sign-in and export is written to an audit log that cannot be edited.' },
  { Icon: FileLock2, title: 'Evidence holds', text: 'Records are frozen when an alert fires, and each export carries a SHA-256 digest.' },
]

const storageKey = (userId: string) => `sentinel-how-it-works:${userId}`

function readHidden(userId: string): boolean {
  try {
    return localStorage.getItem(storageKey(userId)) === 'hidden'
  } catch {
    return false
  }
}

/**
 * What Sentinel is, told by its own pipeline: six stages from an event arriving to an evidence bundle leaving, each
 * with this bank's live count, and the four guarantees that keep it safe. Collapsible, remembered per person.
 */
export function HowSentinelWorks({ metrics, userId, role }: { metrics: DashboardMetrics | null; userId: string; role: Role }) {
  const [hidden, setHidden] = useState(() => readHidden(userId))
  const toggle = () => {
    const next = !hidden
    setHidden(next)
    try {
      localStorage.setItem(storageKey(userId), next ? 'hidden' : 'shown')
    } catch {
      // Private windows can refuse storage; the section still toggles for this visit.
    }
  }

  return (
    <section aria-labelledby="how-heading" className="flex flex-col rounded-card border border-line-strong bg-panel" data-testid="how-sentinel-works">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
        <h2 id="how-heading" className="text-[13px] font-semibold text-fg">
          How Sentinel works
        </h2>
        <p className="order-last w-full text-xs text-fg-subtle sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">
          Insider activity and money movement in one place: who did what, with what access, and where the money went.
        </p>
        <button
          type="button"
          aria-expanded={!hidden}
          aria-controls="how-body"
          onClick={toggle}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-muted transition-colors duration-150 hover:bg-raised hover:text-fg"
        >
          {hidden ? 'Show' : 'Hide'}
          <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform duration-150 ${hidden ? '' : 'rotate-180'}`} />
        </button>
      </header>
      {!hidden && (
        <div id="how-body" className="flex flex-col gap-4 border-t border-line px-4 pt-3 pb-4">
          <ol className="grid overflow-hidden rounded-md border border-line-strong sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            {STAGES.map((s) => {
              const linked = s.to !== undefined && (!s.roles || s.roles.includes(role))
              const body = (
                <>
                  <span className="font-mono text-[11px] text-fg-subtle">{s.step}</span>
                  <span className="text-[13px] font-semibold text-fg">{s.title}</span>
                  <span className="text-xs text-fg-muted">{s.what}</span>
                  <span className="mt-auto pt-1 font-mono text-xs text-fg tabular-nums" data-testid={`stage-${s.step}`}>
                    {metrics ? s.value(metrics) : <Skeleton className="h-4 w-20" />}
                  </span>
                </>
              )
              return (
                <li key={s.step} className="-mr-px -mb-px flex border-r border-b border-line">
                  {linked && s.to ? (
                    <Link to={s.to} className="flex w-full flex-col gap-1 px-3 py-2.5 transition-colors duration-150 hover:bg-raised">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex w-full flex-col gap-1 px-3 py-2.5">{body}</div>
                  )}
                </li>
              )
            })}
          </ol>
          <ul aria-label="How it is kept safe" className="grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            {SAFEGUARDS.map(({ Icon, title, text }) => (
              <li key={title} className="flex gap-2.5">
                <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-semibold text-fg">{title}</span>
                  <span className="text-xs text-fg-muted">{text}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
