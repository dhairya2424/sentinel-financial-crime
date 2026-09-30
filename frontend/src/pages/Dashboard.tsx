import { Activity, ShieldAlert, X } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { alertsSince, getMetrics } from '@/api/dashboard'
import type { AlertRow, DashboardMetrics, RiskBand } from '@/api/types'
import type { GuardState } from '@/components/RequireAuth'
import { ErrorRetry } from '@/components/ErrorRetry'
import { RiskBadge } from '@/components/RiskBadge'
import { Skeleton } from '@/components/Skeleton'
import { PRIORITIES, PRIORITY_META } from '@/lib/cases'
import { ago, entityHref, ROLE_LABEL } from '@/lib/format'
import { BAND_ORDER, RISK_BANDS } from '@/lib/risk'
import { useAuth } from '@/store/auth'
import { useChannel, useLive, useResync } from '@/ws/useSocket'
import { Page } from './Placeholder'

const DAYS = 7
const POLL_MS = 30_000
const SAMPLE_CAP = 60
const BAND_FILL: Record<RiskBand, string> = {
  low: 'var(--color-band-low)',
  medium: 'var(--color-band-medium)',
  high: 'var(--color-band-high)',
  critical: 'var(--color-band-critical)',
}
const dayKey = (d: Date) => `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' })
const timeLabel = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

type Metrics = { status: 'loading' } | { status: 'ready'; data: DashboardMetrics; at: number } | { status: 'error'; message: string }
type Series = { status: 'loading' } | { status: 'ready'; rows: AlertRow[] } | { status: 'error'; message: string }
interface Sample {
  at: number
  events: number
}

function isMetricsMessage(raw: unknown): raw is { type: 'metrics.update'; data: DashboardMetrics } {
  if (typeof raw !== 'object' || raw === null) return false
  const { type, data } = raw as { type?: unknown; data?: unknown }
  return type === 'metrics.update' && typeof data === 'object' && data !== null
}

/** Dashboard (docs/03 §9, PRD E1): the risk overview, fed by the dashboard channel every 15 s. */
export function Dashboard() {
  const user = useAuth((s) => s.user)
  const location = useLocation()
  const denied = (location.state as GuardState | null)?.denied
  const [showDenied, setShowDenied] = useState(Boolean(denied))
  const [metrics, setMetrics] = useState<Metrics>({ status: 'loading' })
  const [series, setSeries] = useState<Series>({ status: 'loading' })
  const [samples, setSamples] = useState<Sample[]>([])
  const [attempt, setAttempt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const live = useLive()
  const tenant = user?.tenant_id ?? null

  // The feed publishes only when a figure changes, so `at` marks the last change, not the last message.
  const accept = (data: DashboardMetrics) => {
    const at = Date.now()
    setMetrics((prev) => (prev.status === 'ready' && JSON.stringify(prev.data) === JSON.stringify(data) ? prev : { status: 'ready', data, at }))
    const events = data.ingest.events_per_min
    // One point per feed tick: a second fetch within a few seconds (a remount, a resync) adds nothing new.
    if (events !== null) setSamples((s) => (s.length && at - (s[s.length - 1]?.at ?? 0) < 5_000 ? s : [...s, { at, events }].slice(-SAMPLE_CAP)))
  }
  const acceptRef = useRef(accept)
  useEffect(() => {
    acceptRef.current = accept
  })

  useEffect(() => {
    const controller = new AbortController()
    getMetrics(controller.signal)
      .then((d) => {
        acceptRef.current(d)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setMetrics({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      controller.abort()
    }
  }, [attempt])

  // Alerts by band are counted from the alert list, read again whenever the 24-hour count moves.
  const alertsKey = metrics.status === 'ready' ? metrics.data.alerts_24h : -1
  useEffect(() => {
    const controller = new AbortController()
    const from = new Date()
    from.setHours(0, 0, 0, 0)
    from.setDate(from.getDate() - (DAYS - 1))
    alertsSince(from, controller.signal)
      .then((rows) => {
        setSeries({ status: 'ready', rows })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setSeries({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      controller.abort()
    }
  }, [alertsKey, attempt])

  useChannel(tenant ? `dashboard:${tenant}` : null, (raw) => {
    if (isMetricsMessage(raw)) accept(raw.data)
  })
  useResync(() => {
    setAttempt((a) => a + 1)
  })

  // Without the socket the page polls, so the numbers never go silently stale.
  useEffect(() => {
    if (live === 'connected') return
    const timer = setInterval(() => {
      getMetrics()
        .then((d) => {
          acceptRef.current(d)
        })
        .catch(() => undefined)
    }, POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [live])

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 5_000)
    return () => {
      clearInterval(timer)
    }
  }, [])

  const data = metrics.status === 'ready' ? metrics.data : null
  return (
    <Page
      wide
      title="Dashboard"
      meta={
        <p className="flex items-center gap-2 text-[13px] text-fg-muted" data-testid="live-badge">
          <span aria-hidden="true" className={`size-2 rounded-full ${live === 'connected' ? 'bg-ok' : 'bg-fg-subtle'}`} />
          {live === 'connected' ? 'Live' : 'Live updates paused, checking every 30 s'}
          {metrics.status === 'ready' && <span className="font-mono text-xs">· last change {ago(now - metrics.at)}</span>}
        </p>
      }
    >
      {denied && showDenied && user && (
        <div role="alert" className="flex items-start gap-3 rounded-card border border-line-strong bg-panel px-4 py-3 text-[13px]">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warn-fg" />
          <p className="flex-1 text-fg">
            {denied} needs the admin role. You're signed in as {ROLE_LABEL[user.role].toLowerCase()}, so you were brought back here.
          </p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setShowDenied(false)
            }}
            className="grid size-6 place-items-center rounded text-fg-muted hover:bg-raised hover:text-fg"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      )}

      {metrics.status === 'error' ? (
        <ErrorRetry
          title="The overview could not be loaded"
          message={metrics.message}
          onRetry={() => {
            setMetrics({ status: 'loading' })
            setAttempt((a) => a + 1)
          }}
        />
      ) : (
        <Kpis metrics={data} />
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <BandsByDay series={series} />
        <TopEntities metrics={data} />
      </div>
      <Ingest metrics={data} samples={samples} />
    </Page>
  )
}

function Kpis({ metrics }: { metrics: DashboardMetrics | null }) {
  const byPriority = metrics
    ? [...PRIORITIES]
        .reverse()
        .filter((p) => metrics.open_cases_by_priority[p] > 0)
        .map((p) => `${String(metrics.open_cases_by_priority[p])} ${PRIORITY_META[p].label.toLowerCase()}`)
        .join(' · ')
    : ''
  const tiles: { key: string; label: ReactNode; value: string | number | undefined; sub: string }[] = [
    {
      key: 'open',
      label: (
        <Link to="/cases" className="hover:underline">
          Open cases
        </Link>
      ),
      value: metrics?.open_cases,
      sub: metrics ? byPriority || 'none open' : '',
    },
    { key: 'critical', label: <RiskBadge band="critical" />, value: metrics?.critical_24h, sub: 'critical alerts, last 24 h' },
    { key: 'high', label: <RiskBadge band="high" />, value: metrics?.high_24h, sub: 'high alerts, last 24 h' },
    {
      key: 'fp',
      label: 'False-positive rate',
      value: metrics ? (metrics.fp_rate_7d === null ? '—' : `${String(Math.round(metrics.fp_rate_7d * 100))}%`) : undefined,
      sub: metrics
        ? metrics.closed_7d
          ? `of ${String(metrics.closed_7d)} case${metrics.closed_7d === 1 ? '' : 's'} closed in 7 days`
          : 'no cases closed in 7 days'
        : '',
    },
  ]
  return (
    <section aria-label="Key figures" className="grid overflow-hidden rounded-card border border-line-strong bg-panel sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.key}
          data-testid={`kpi-${t.key}`}
          className="flex flex-col gap-1 border-line px-4 py-3.5 not-last:border-b sm:odd:border-r xl:border-b-0 xl:not-last:border-r"
        >
          <span className="flex h-6 items-center text-[13px] font-medium text-fg-muted">{t.label}</span>
          {t.value === undefined ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <span className="font-mono text-[28px] leading-tight font-semibold tracking-tight text-fg tabular-nums">{t.value}</span>
          )}
          <span className="text-xs text-fg-subtle">{t.sub}</span>
        </div>
      ))}
    </section>
  )
}

function ChartCard({ title, sub, children, testId }: { title: string; sub?: string; children: ReactNode; testId?: string }) {
  return (
    <section aria-label={title} data-testid={testId} className="flex min-w-0 flex-col gap-3 rounded-card border border-line-strong bg-panel px-4 py-3.5">
      <h2 className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold text-fg">
        {title}
        {sub && <span className="text-xs font-normal text-fg-subtle">{sub}</span>}
      </h2>
      {children}
    </section>
  )
}

function ChartTooltip({ active, lines }: { active?: boolean; lines: string[] | null }) {
  if (!active || !lines) return null
  return (
    <div className="rounded-md border border-line-strong bg-panel px-2.5 py-1.5 text-xs text-fg shadow-float">
      {lines.map((l, i) => (
        <p key={l} className={i === 0 ? 'font-medium' : 'font-mono text-fg-muted'}>
          {l}
        </p>
      ))}
    </div>
  )
}

/**
 * Alerts per day, one row per band on a shared scale. Small multiples rather than a stacked area: the four band
 * colours are too close to tell apart when stacked (high and critical above all), so each row is named by its
 * RiskBadge and colour only repeats what the label says.
 */
function BandsByDay({ series }: { series: Series }) {
  const days = useMemo(() => {
    const out: { key: string; label: string }[] = []
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - (DAYS - 1))
    for (let i = 0; i < DAYS; i += 1) {
      out.push({ key: dayKey(d), label: dayLabel.format(d) })
      d.setDate(d.getDate() + 1)
    }
    return out
  }, [])
  const counts = useMemo(() => {
    const c = new Map<string, number>()
    if (series.status === 'ready') {
      for (const a of series.rows) {
        const k = `${a.risk_band}|${dayKey(new Date(a.detected_at))}`
        c.set(k, (c.get(k) ?? 0) + 1)
      }
    }
    return c
  }, [series])
  const max = Math.max(1, ...counts.values())
  const bands = [...BAND_ORDER].reverse()
  const total = series.status === 'ready' ? series.rows.length : 0

  return (
    <ChartCard title="Alerts by band" sub={`last ${String(DAYS)} days${series.status === 'ready' ? ` · ${String(total)} alerts` : ''}`} testId="chart-bands">
      {series.status === 'loading' && <Skeleton className="h-52 w-full" />}
      {series.status === 'error' && <p className="text-[13px] text-fg-muted">Alerts could not be read: {series.message}.</p>}
      {series.status === 'ready' && total === 0 && (
        <p className="py-10 text-center text-[13px] text-fg-muted">No alerts in the last {DAYS} days. New ones appear here as they are detected.</p>
      )}
      {series.status === 'ready' && total > 0 && (
        <>
          <div className="flex flex-col gap-1.5">
            {bands.map((band, i) => {
              const rows = days.map((d) => ({ day: d.label, n: counts.get(`${band}|${d.key}`) ?? 0 }))
              const sum = rows.reduce((s, d) => s + d.n, 0)
              const last = i === bands.length - 1
              return (
                <div key={band} className="grid grid-cols-[92px_minmax(0,1fr)_32px] items-center gap-2">
                  <RiskBadge band={band} className="justify-self-start" />
                  <div className={last ? 'h-16' : 'h-12'} aria-hidden="true">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={6}>
                        <CartesianGrid vertical={false} stroke="var(--color-line)" />
                        <XAxis dataKey="day" hide={!last} tickLine={false} axisLine={false} tick={{ fill: 'var(--color-fg-subtle)', fontSize: 11 }} />
                        <YAxis hide domain={[0, max]} allowDecimals={false} />
                        <Tooltip
                          cursor={{ fill: 'var(--color-raised)' }}
                          content={(p) => (
                            <ChartTooltip
                              active={p.active}
                              lines={p.payload[0] ? [`${RISK_BANDS[band].label} · ${String(p.label)}`, `${String(p.payload[0].value)} alerts`] : null}
                            />
                          )}
                        />
                        <Bar dataKey="n" fill={BAND_FILL[band]} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <span className="text-right font-mono text-xs text-fg tabular-nums">{sum}</span>
                </div>
              )
            })}
          </div>
          <table className="sr-only">
            <caption>Alerts per day by band</caption>
            <thead>
              <tr>
                <th scope="col">Band</th>
                {days.map((d) => (
                  <th key={d.key} scope="col">
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bands.map((band) => (
                <tr key={band}>
                  <th scope="row">{RISK_BANDS[band].label}</th>
                  {days.map((d) => (
                    <td key={d.key}>{counts.get(`${band}|${d.key}`) ?? 0}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </ChartCard>
  )
}

function TopEntities({ metrics }: { metrics: DashboardMetrics | null }) {
  const rows = (metrics?.top_entities ?? []).map((e) => ({ ...e, name: e.label ?? e.entity_id }))
  return (
    <ChartCard title="Top linked entities" sub="by alerts, 30 days" testId="chart-entities">
      {!metrics && <Skeleton className="h-44 w-full" />}
      {metrics && rows.length === 0 && <p className="py-10 text-center text-[13px] text-fg-muted">No entity has an alert in the last 30 days.</p>}
      {rows.length > 0 && (
        <>
          <div className="h-44" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 28, bottom: 0, left: 0 }} barCategoryGap={8}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} tick={{ fill: 'var(--color-fg)', fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: 'var(--color-raised)' }}
                  content={(p) => <ChartTooltip active={p.active} lines={p.payload[0] ? [String(p.label), `${String(p.payload[0].value)} alerts`] : null} />}
                />
                <Bar
                  dataKey="alert_count"
                  fill="var(--color-fg-muted)"
                  maxBarSize={20}
                  radius={[0, 4, 4, 0]}
                  isAnimationActive={false}
                  label={{ position: 'right', fill: 'var(--color-fg)', fontSize: 11 }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul aria-label="Open an entity's timeline" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
            <li aria-hidden="true" className="text-fg-subtle">
              Open timeline:
            </li>
            {rows.map((e) => {
              const href = e.type ? entityHref(e.type, e.entity_id, 'timeline') : null
              return (
                <li key={e.entity_id}>
                  {href ? (
                    <Link to={href} className="text-accent hover:underline">
                      {e.name}
                    </Link>
                  ) : (
                    <span className="text-fg-muted">{e.name}</span>
                  )}
                  <span className="sr-only">, {e.alert_count} alerts</span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </ChartCard>
  )
}

function Ingest({ metrics, samples }: { metrics: DashboardMetrics | null; samples: Sample[] }) {
  const ingest = metrics?.ingest
  const facts = ingest
    ? [
        `${ingest.events_per_min === null ? '—' : String(ingest.events_per_min)} events in the last minute`,
        `lag ${ingest.lag_ms === null ? '—' : `${String(Math.round(ingest.lag_ms))} ms`}`,
        `backlog ${ingest.backlog === null ? '—' : String(ingest.backlog)}`,
      ].join(' · ')
    : undefined
  const data = samples.map((s) => ({ t: timeLabel.format(s.at), events: s.events }))
  return (
    <ChartCard title="Ingest" sub={facts} testId="chart-ingest">
      {!metrics && <Skeleton className="h-28 w-full" />}
      {metrics && data.length < 2 && (
        <p className="flex items-center gap-2 py-6 text-[13px] text-fg-muted">
          <Activity aria-hidden="true" className="size-4" />
          Events per minute are sampled every 15 s while this page is open; the line starts with the next update.
        </p>
      )}
      {data.length >= 2 && (
        <div className="h-28" aria-label={`Events per minute, ${String(data.length)} samples since this page opened`} role="img">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis dataKey="t" tickLine={false} axisLine={false} minTickGap={48} tick={{ fill: 'var(--color-fg-subtle)', fontSize: 11 }} />
              <YAxis width={32} allowDecimals={false} tickLine={false} axisLine={false} domain={[0, 'auto']} tick={{ fill: 'var(--color-fg-subtle)', fontSize: 11 }} />
              <Tooltip
                cursor={{ stroke: 'var(--color-line-strong)' }}
                content={(p) => <ChartTooltip active={p.active} lines={p.payload[0] ? [String(p.label), `${String(p.payload[0].value)} events/min`] : null} />}
              />
              <Line
                type="monotone"
                dataKey="events"
                stroke="var(--color-fg-muted)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--color-panel)', strokeWidth: 2, fill: 'var(--color-fg-muted)' }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}
