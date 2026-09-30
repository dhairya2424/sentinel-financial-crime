import { ArrowLeft, FilterX, Inbox, LoaderCircle, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { listAlerts, type AlertFilters, type TimeRange } from '@/api/alerts'
import type { AlertRow, AlertStatus, RiskBand } from '@/api/types'
import { AlertDetail } from '@/components/alert/AlertDetail'
import { EmptyState } from '@/components/EmptyState'
import { ErrorRetry } from '@/components/ErrorRetry'
import { RiskBadge } from '@/components/RiskBadge'
import { SkeletonRows } from '@/components/Skeleton'
import { acknowledge, money, primaryEntity, RULES, STATUS_LABEL, STATUSES, timeAgo } from '@/lib/alerts'
import { shortId } from '@/lib/format'
import { BAND_ORDER, RISK_BANDS } from '@/lib/risk'
import { DEFAULT_FILTERS, useAlerts } from '@/store/alerts'
import { useLive, useResync } from '@/ws/useSocket'
import { Page } from './Placeholder'

const RANGES: readonly TimeRange[] = ['24h', '7d', '30d']
const OPEN_AND_ACKED = 'open,acknowledged'

function readFilters(params: URLSearchParams): AlertFilters {
  const bands = (params.get('band') ?? '').split(',').filter((b): b is RiskBand => (BAND_ORDER as readonly string[]).includes(b))
  const rawStatus = params.get('status')
  const statuses =
    rawStatus === null ? DEFAULT_FILTERS.statuses : rawStatus.split(',').filter((s): s is AlertStatus => (STATUSES as readonly string[]).includes(s))
  const range = params.get('range')
  return {
    bands,
    rule: RULES.some((r) => r.code === params.get('rule')) ? params.get('rule') : null,
    statuses,
    range: range === '24h' || range === '30d' ? range : '7d',
    entity: params.get('entity') || null,
  }
}

function writeFilters(f: AlertFilters): URLSearchParams {
  const q = new URLSearchParams()
  if (f.bands.length) q.set('band', f.bands.join(','))
  if (f.rule) q.set('rule', f.rule)
  const status = f.statuses.join(',')
  if (status !== OPEN_AND_ACKED) q.set('status', status)
  if (f.range !== '7d') q.set('range', f.range)
  if (f.entity) q.set('entity', f.entity)
  return q
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.closest('[role="dialog"]') !== null)

type ListState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string }
type ListResult = { key: string; state: ListState }

export function AlertInbox() {
  const { id: openId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const filters = useMemo(() => readFilters(params), [params])
  const qs = params.toString()
  const { items, cursor, fresh, setPage, appendPage, setFilters, seen } = useAlerts()
  const [result, setResult] = useState<ListResult | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // The keyboard cursor follows an alert, not a position, so a live arrival above it never moves it to another row.
  const [cursorId, setCursorId] = useState<string | null>(null)
  const [keyboardNav, setKeyboardNav] = useState(false)
  const [caseRequested, setCaseRequested] = useState(0)
  const live = useLive()
  const listRef = useRef<HTMLOListElement>(null)

  const found = items.findIndex((r) => r.id === (cursorId ?? openId))
  const cursorIndex = found === -1 ? 0 : found

  const requestKey = `${JSON.stringify(filters)}|${String(attempt)}`
  const list: ListState = result?.key === requestKey ? result.state : { status: 'loading' }

  useEffect(() => {
    setFilters(filters)
    const controller = new AbortController()
    listAlerts(filters, null, controller.signal)
      .then((page) => {
        setPage(page.items, page.next_cursor)
        setResult({ key: requestKey, state: { status: 'ready' } })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, state: { status: 'error', message: err instanceof Error ? err.message : String(err) } })
      })
    return () => {
      controller.abort()
    }
  }, [filters, requestKey, setFilters, setPage])

  useResync(() => {
    setAttempt((a) => a + 1)
  })

  const go = useCallback(
    (next: AlertFilters) => {
      const q = writeFilters(next).toString()
      void navigate({ pathname: openId ? `/alerts/${encodeURIComponent(openId)}` : '/alerts', search: q ? `?${q}` : '' })
    },
    [navigate, openId],
  )
  const openAlert = useCallback(
    (id: string) => {
      void navigate({ pathname: `/alerts/${encodeURIComponent(id)}`, search: qs ? `?${qs}` : '' })
    },
    [navigate, qs],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target) || items.length === 0) return
      const current = items[Math.min(cursorIndex, items.length - 1)]
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const next = items[Math.max(0, Math.min(items.length - 1, cursorIndex + (event.key === 'ArrowDown' ? 1 : -1)))]
        setKeyboardNav(true)
        if (next) setCursorId(next.id)
      } else if (event.key === 'Enter' && current) {
        event.preventDefault()
        openAlert(current.id)
      } else if ((event.key === 'a' || event.key === 'A') && current && current.status === 'open') {
        event.preventDefault()
        void acknowledge(current.id).catch(() => undefined)
      } else if ((event.key === 'c' || event.key === 'C') && openId) {
        event.preventDefault()
        setCaseRequested((n) => n + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [items, cursorIndex, openAlert, openId])

  useEffect(() => {
    if (!keyboardNav || !cursorId) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(cursorId)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [cursorId, keyboardNav])

  const loadMore = () => {
    if (!cursor) return
    setLoadingMore(true)
    listAlerts(filters, cursor)
      .then((page) => {
        appendPage(page.items, page.next_cursor)
      })
      .catch(() => undefined)
      .finally(() => {
        setLoadingMore(false)
      })
  }

  const filtered = filters.bands.length > 0 || filters.rule !== null || filters.entity !== null || filters.statuses.join(',') !== OPEN_AND_ACKED
  const shown = items.length

  return (
    <Page
      wide
      title="Alert Inbox"
      meta={
        <p className="flex items-center gap-2 text-[13px] text-fg-muted">
          <span aria-hidden="true" className={`size-2 rounded-full ${live === 'connected' ? 'bg-ok' : 'bg-fg-subtle'}`} />
          {live === 'connected' ? 'Live' : 'Live updates paused'}
          {list.status === 'ready' && (
            <span className="font-mono text-xs">
              · {shown}
              {cursor ? '+' : ''} shown
            </span>
          )}
        </p>
      }
    >
      <FilterBar filters={filters} onChange={go} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section
          aria-label="Alerts"
          className="flex flex-col overflow-hidden rounded-card border border-line-strong bg-panel lg:h-[calc(100dvh-218px)] lg:min-h-[460px]"
        >
          {list.status === 'loading' ? (
            <SkeletonRows rows={6} label="Loading alerts" />
          ) : list.status === 'error' ? (
            <div className="p-3">
              <ErrorRetry
                title="Alerts could not be loaded"
                message={list.message}
                onRetry={() => {
                  setAttempt((a) => a + 1)
                }}
              />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No alerts match filters"
              description={
                filtered
                  ? 'Nothing in this range matches every filter. Clear them to see all open alerts.'
                  : 'No open alerts in this range. New ones appear here the moment they are detected.'
              }
              action={
                filtered ? (
                  <button
                    type="button"
                    onClick={() => {
                      go({ ...DEFAULT_FILTERS, range: filters.range })
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-panel px-3 text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-raised"
                  >
                    <FilterX aria-hidden="true" className="size-3.5" />
                    Clear filters
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ol ref={listRef}>
                {items.map((row, i) => (
                  <AlertLedgerRow
                    key={row.id}
                    row={row}
                    open={row.id === openId}
                    cursor={keyboardNav && i === cursorIndex && row.id !== openId}
                    fresh={fresh.has(row.id)}
                    onSeen={seen}
                    onOpen={() => {
                      setCursorId(row.id)
                      setKeyboardNav(false)
                      openAlert(row.id)
                    }}
                  />
                ))}
              </ol>
              {cursor && (
                <div className="border-t border-line p-2">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-[13px] font-medium text-fg-muted transition-colors duration-150 hover:bg-raised hover:text-fg"
                  >
                    {loadingMore && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />}
                    Load older alerts
                  </button>
                </div>
              )}
            </div>
          )}
          <p className="hidden shrink-0 items-center gap-2 border-t border-line px-3 py-1.5 text-xs text-fg-subtle lg:flex">
            <kbd className="rounded border border-line-strong px-1 font-mono text-[10.5px]">↑</kbd>
            <kbd className="rounded border border-line-strong px-1 font-mono text-[10.5px]">↓</kbd>
            move
            <kbd className="rounded border border-line-strong px-1 font-mono text-[10.5px]">Enter</kbd>
            open
            <kbd className="rounded border border-line-strong px-1 font-mono text-[10.5px]">A</kbd>
            acknowledge
            <kbd className="rounded border border-line-strong px-1 font-mono text-[10.5px]">C</kbd>
            case
          </p>
        </section>

        <section
          aria-label="Alert detail"
          className={`rounded-card border border-line-strong bg-panel lg:h-[calc(100dvh-218px)] lg:min-h-[460px] lg:overflow-y-auto ${
            openId ? 'fixed inset-x-0 top-13 bottom-7 z-30 overflow-y-auto rounded-none border-x-0 lg:static lg:rounded-card lg:border-x' : 'hidden lg:block'
          }`}
        >
          {openId ? (
            <div className="flex flex-col gap-3 p-4 lg:p-5">
              <Link
                to={{ pathname: '/alerts', search: qs ? `?${qs}` : '' }}
                className="inline-flex items-center gap-1 self-start text-[13px] font-medium text-accent hover:underline lg:hidden"
              >
                <ArrowLeft aria-hidden="true" className="size-3.5" />
                Back to alerts
              </Link>
              <AlertDetail key={openId} alertId={openId} caseRequested={caseRequested} />
            </div>
          ) : (
            <EmptyState
              icon={Inbox}
              title="Pick an alert"
              description="Open any alert to see why it fired: the explanation, the factors behind its score and the evidence records."
            />
          )}
        </section>
      </div>
    </Page>
  )
}

interface RowProps {
  row: AlertRow
  open: boolean
  cursor: boolean
  fresh: boolean
  onSeen: (id: string) => void
  onOpen: () => void
}

function AlertLedgerRow({ row, open, cursor, fresh, onSeen, onOpen }: RowProps) {
  const entity = primaryEntity(row)
  const amount = money(row.amount_total)
  return (
    <li
      data-testid="alert-row"
      data-id={row.id}
      data-fresh={fresh || undefined}
      data-cursor={cursor || undefined}
      onAnimationEnd={() => {
        onSeen(row.id)
      }}
      className={`relative border-b border-line ${open ? 'bg-selected' : 'hover:bg-raised/60'} ${fresh ? 'alert-fresh' : ''} ${
        cursor ? 'outline-2 -outline-offset-2 outline-accent/60' : ''
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={open ? 'true' : undefined}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 px-3.5 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <RiskBadge band={row.risk_band} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13px] font-medium text-fg">{row.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
            <span className="truncate">{entity ? entity.label : shortId(row.primary_entity ?? '')}</span>
            {row.status !== 'open' && (
              <span className="shrink-0 rounded border border-line-strong px-1 font-mono text-[10.5px] text-fg-muted">{STATUS_LABEL[row.status]}</span>
            )}
          </span>
        </span>
        <span className="flex flex-col items-end gap-0.5 font-mono text-xs whitespace-nowrap tabular-nums">
          <span className="text-fg">{amount ?? '—'}</span>
          <span className="text-fg-subtle">
            {timeAgo(row.detected_at)}
            {row.occurrence_count > 1 && <span className="text-fg-muted"> · ×{row.occurrence_count}</span>}
          </span>
        </span>
      </button>
    </li>
  )
}

function FilterBar({ filters, onChange }: { filters: AlertFilters; onChange: (f: AlertFilters) => void }) {
  const toggleBand = (band: RiskBand) => {
    onChange({ ...filters, bands: filters.bands.includes(band) ? filters.bands.filter((b) => b !== band) : [...filters.bands, band] })
  }
  const statusValue = filters.statuses.length === 0 ? 'any' : filters.statuses.join(',')
  const CHIP = 'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors duration-150'
  return (
    <div role="group" aria-label="Filter alerts" className="flex flex-wrap items-center gap-1.5">
      {[...BAND_ORDER].reverse().map((band) => {
        const on = filters.bands.includes(band)
        const { label, Icon } = RISK_BANDS[band]
        return (
          <button
            key={band}
            type="button"
            aria-pressed={on}
            onClick={() => {
              toggleBand(band)
            }}
            className={`${CHIP} ${on ? 'border-line-strong bg-selected text-fg' : 'border-line bg-panel text-fg-muted hover:bg-raised'}`}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {label}
          </button>
        )
      })}
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-line-strong" />
      <label className="sr-only" htmlFor="alert-rule">
        Rule
      </label>
      <select
        id="alert-rule"
        value={filters.rule ?? ''}
        onChange={(e) => {
          onChange({ ...filters, rule: e.target.value || null })
        }}
        className="h-8 rounded-md border border-line-strong bg-panel px-2 text-[13px] text-fg"
      >
        <option value="">All rules</option>
        {RULES.map((r) => (
          <option key={r.code} value={r.code}>
            {r.code} · {r.name}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="alert-status">
        Status
      </label>
      <select
        id="alert-status"
        value={statusValue}
        onChange={(e) => {
          const v = e.target.value
          onChange({ ...filters, statuses: v === 'any' ? [] : (v.split(',') as AlertStatus[]) })
        }}
        className="h-8 rounded-md border border-line-strong bg-panel px-2 text-[13px] text-fg"
      >
        <option value={OPEN_AND_ACKED}>Open and acknowledged</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
        <option value="any">Any status</option>
      </select>
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-line-strong" />
      <div role="radiogroup" aria-label="Time range" className="inline-flex overflow-hidden rounded-md border border-line-strong">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={filters.range === r}
            onClick={() => {
              onChange({ ...filters, range: r })
            }}
            className={`h-8 border-l border-line px-2.5 font-mono text-xs first:border-l-0 ${filters.range === r ? 'bg-selected font-medium text-fg' : 'bg-panel text-fg-muted hover:bg-raised'}`}
          >
            {r}
          </button>
        ))}
      </div>
      {filters.entity && (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-selected pr-1 pl-2.5 text-[13px] text-fg">
          Entity <span className="font-mono text-xs">{shortId(filters.entity)}</span>
          <button
            type="button"
            aria-label="Clear entity filter"
            onClick={() => {
              onChange({ ...filters, entity: null })
            }}
            className="grid size-6 place-items-center rounded text-fg-subtle hover:bg-raised hover:text-fg"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      )}
    </div>
  )
}
