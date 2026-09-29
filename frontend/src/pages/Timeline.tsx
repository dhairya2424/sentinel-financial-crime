import { ArrowUpRight, Compass, History, LoaderCircle, SearchX } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode, type SubmitEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Bar, BarChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ApiError } from '@/api/client'
import { fetchRawRecord, fetchTimeline, TIMELINE_CATEGORIES } from '@/api/timeline'
import type { RawRecord, TimelineCategory, TimelineEntity, TimelineEntityType, TimelineItem } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { EntityChip } from '@/components/EntityChip'
import { ErrorRetry } from '@/components/ErrorRetry'
import { LaneRow, type Relation } from '@/components/LaneRow'
import { Skeleton, SkeletonRows } from '@/components/Skeleton'
import { SCREENS } from '@/lib/screens'
import {
  CATEGORY_META,
  CORRELATION_WINDOW_MS,
  DAY,
  dayFormat,
  dayKey,
  delayLabel,
  densityBins,
  entityTypeOf,
  formatInr,
  fullFormat,
  hourLabel,
  inRange,
  laneLabels,
  shortDate,
  sortNewestFirst,
  targetKind,
  tsOf,
  type BinUnit,
  type DensityBin,
  type TimeRange,
} from '@/lib/timeline'
import { Page } from './Placeholder'

const PAGE_SIZE = 200
const ENTITY_TYPES: readonly TimelineEntityType[] = ['customer', 'account', 'employee']
const QUICK_RANGES = [
  { label: '24 hours', ms: DAY },
  { label: '7 days', ms: 7 * DAY },
  { label: '30 days', ms: 30 * DAY },
] as const
const FIELD_LABEL: Record<string, string> = {
  mobile: 'Mobile number',
  email: 'Email',
  address: 'Address',
  nominee: 'Nominee',
  kyc_document: 'KYC document',
  daily_transfer_limit: 'Daily transfer limit',
  limit: 'Limit',
  status: 'Status',
  amount: 'Amount',
  beneficiaries: 'Beneficiaries',
  added: 'Added',
}

const isEntityType = (value: string | undefined): value is TimelineEntityType =>
  ENTITY_TYPES.includes(value as TimelineEntityType)

const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)))

export function TimelineIndexScreen() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const id = value.trim()
    const type = entityTypeOf(id)
    if (!type) {
      setProblem('Ids start with cust_, acct_ or emp_. Copy one from an alert, the graph or another timeline.')
      return
    }
    void navigate(`/timeline/${type}/${encodeURIComponent(id)}`)
  }

  return (
    <Page title={SCREENS.timeline.title}>
      <section className="grid min-h-72 place-items-center rounded-card border border-line-strong bg-panel">
        <EmptyState
          icon={History}
          title="Choose an entity to see its timeline"
          description="Open a customer, account or employee from an alert or the graph, or paste its id here. Its transactions, profile changes, logins and approvals appear in one ordered view."
          action={
            <form onSubmit={submit} noValidate className="flex w-full max-w-md flex-col gap-2 text-left">
              <label htmlFor="timeline-entity-id" className="text-[13px] font-medium text-fg">
                Entity id
              </label>
              <div className="flex gap-2">
                <input
                  id="timeline-entity-id"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value)
                    setProblem(null)
                  }}
                  placeholder="cust_…, acct_… or emp_…"
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={problem ? 'timeline-entity-id-error' : undefined}
                  spellCheck={false}
                  autoComplete="off"
                  className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-panel px-3 font-mono text-[13px] text-fg transition-colors duration-150 placeholder:text-fg-subtle hover:border-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none aria-invalid:border-danger"
                />
                <button
                  type="submit"
                  className="h-9 shrink-0 rounded-md border border-line-strong bg-panel px-3 text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-raised"
                >
                  Open timeline
                </button>
              </div>
              {problem && (
                <p id="timeline-entity-id-error" className="text-[13px] text-danger">
                  {problem}
                </p>
              )}
            </form>
          }
        />
      </section>
    </Page>
  )
}

export function TimelineScreen() {
  const { type, id } = useParams()
  if (!isEntityType(type) || !id) {
    return (
      <Page title={SCREENS.timeline.title}>
        <EmptyState
          icon={Compass}
          title="Unknown entity type"
          description="Timelines exist for customers, accounts and employees."
          action={
            <Link to="/timeline" className="font-medium text-accent underline">
              Back to Timeline
            </Link>
          }
        />
      </Page>
    )
  }
  return <TimelineView key={`${type}/${id}`} type={type} id={id} />
}

interface Loaded {
  entity: TimelineEntity
  items: TimelineItem[]
  nextCursor: string | null
}

interface TimelineRequest {
  type: TimelineEntityType
  id: string
  categories: TimelineCategory[]
  attempt: number
}

const requestKey = (r: TimelineRequest) => `${r.type}|${r.id}|${r.categories.join(',')}|${r.attempt}`

function useTimeline(type: TimelineEntityType, id: string, categories: ReadonlySet<TimelineCategory>) {
  const [attempt, setAttempt] = useState(0)
  const request = useMemo<TimelineRequest>(
    () => ({ type, id, categories: TIMELINE_CATEGORIES.filter((c) => categories.has(c)), attempt }),
    [type, id, categories, attempt],
  )
  const [data, setData] = useState<Loaded | null>(null)
  const [settled, setSettled] = useState<{ key: string; error: Error | null } | null>(null)
  const [more, setMore] = useState<{ loading: boolean; error: Error | null }>({ loading: false, error: null })

  useEffect(() => {
    if (request.categories.length === 0) return
    const controller = new AbortController()
    const key = requestKey(request)
    fetchTimeline(request.type, request.id, { categories: request.categories, limit: PAGE_SIZE }, controller.signal)
      .then((page) => {
        setData({ entity: page.entity, items: page.items, nextCursor: page.next_cursor })
        setSettled({ key, error: null })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setSettled({ key, error: toError(err) })
      })
    return () => {
      controller.abort()
    }
  }, [request])

  const current = settled?.key === requestKey(request) ? settled : null
  const loading = request.categories.length > 0 && current === null

  const loadMore = async () => {
    if (!data?.nextCursor || more.loading) return
    setMore({ loading: true, error: null })
    try {
      const page = await fetchTimeline(type, id, { categories: request.categories, limit: PAGE_SIZE, cursor: data.nextCursor })
      setData((prev) => {
        if (!prev) return prev
        const seen = new Set(prev.items.map((i) => i.ref_id))
        return { ...prev, items: [...prev.items, ...page.items.filter((i) => !seen.has(i.ref_id))], nextCursor: page.next_cursor }
      })
      setMore({ loading: false, error: null })
    } catch (err) {
      setMore({ loading: false, error: toError(err) })
    }
  }

  return {
    data,
    loading,
    error: current?.error ?? null,
    retry: () => {
      setAttempt((a) => a + 1)
    },
    more,
    loadMore,
  }
}

function useRawRecord(item: TimelineItem | null) {
  const [records, setRecords] = useState<Record<string, RawRecord>>({})
  const [failures, setFailures] = useState<Record<string, Error>>({})
  const ref = item?.ref_id
  const kind = item?.event_kind

  useEffect(() => {
    if (!ref || !kind || ref in records || ref in failures) return
    const controller = new AbortController()
    fetchRawRecord(kind, ref, controller.signal)
      .then((record) => {
        setRecords((r) => ({ ...r, [ref]: record }))
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setFailures((f) => ({ ...f, [ref]: toError(err) }))
      })
    return () => {
      controller.abort()
    }
  }, [ref, kind, records, failures])

  return {
    record: ref ? (records[ref] ?? null) : null,
    error: ref ? (failures[ref] ?? null) : null,
    retry: () => {
      if (!ref) return
      setFailures((f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== ref)))
    },
  }
}

interface FollowThrough {
  start: number
  items: TimelineItem[]
  hidden: number
}

const isOutgoingTransfer = (item: TimelineItem) =>
  item.event_kind === 'transaction' && (item.direction === 'out' || item.direction === 'internal')

type ChartBin = Omit<DensityBin, 'left' | 'right'> & { left: number | null; right: number | null }

function TimelineView({ type, id }: { type: TimelineEntityType; id: string }) {
  const [categories, setCategories] = useState<ReadonlySet<TimelineCategory>>(() => new Set(TIMELINE_CATEGORIES))
  const [range, setRange] = useState<TimeRange | null>(null)
  const [params] = useSearchParams()
  const [selectedRef, setSelectedRef] = useState<string | null>(() => params.get('event'))
  const { data, loading, error, retry, more, loadMore } = useTimeline(type, id, categories)

  const sorted = useMemo(() => sortNewestFirst(data?.items ?? []), [data])
  const byCategory = useMemo(() => sorted.filter((i) => categories.has(i.category)), [sorted, categories])
  const visible = useMemo(() => byCategory.filter((i) => inRange(i, range)), [byCategory, range])

  const fallbackRef =
    (type !== 'employee' ? visible.find((i) => i.event_kind === 'employee_action') : undefined)?.ref_id ??
    visible[0]?.ref_id ??
    null
  const selected = visible.find((i) => i.ref_id === selectedRef) ?? visible.find((i) => i.ref_id === fallbackRef) ?? null

  const followThrough = useMemo<FollowThrough | null>(() => {
    if (!selected || type === 'employee' || selected.event_kind !== 'employee_action') return null
    const start = tsOf(selected)
    const items = sorted
      .filter((i) => isOutgoingTransfer(i) && tsOf(i) >= start && tsOf(i) <= start + CORRELATION_WINDOW_MS)
      .reverse()
    const shown = new Set(visible.map((i) => i.ref_id))
    return { start, items, hidden: items.filter((i) => !shown.has(i.ref_id)).length }
  }, [selected, sorted, visible, type])

  const followers = useMemo(
    () => (followThrough ? new Map(followThrough.items.map((i) => [i.ref_id, delayLabel(followThrough.start, tsOf(i))])) : null),
    [followThrough],
  )

  const relation = (item: TimelineItem): Relation => {
    if (!followers) return { linked: false, dim: false, tag: null }
    const tag = followers.get(item.ref_id) ?? null
    return { linked: tag !== null, tag, dim: tag === null && item.event_kind === 'transaction' }
  }
  const highlight = followThrough ? { from: followThrough.start, to: followThrough.start + CORRELATION_WINDOW_MS } : null

  const toggleCategory = (category: TimelineCategory) => {
    setCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const notFound = error instanceof ApiError && error.status === 404
  const entity = data?.entity

  return (
    <Page
      title={entity?.label ?? (notFound ? 'Not found' : SCREENS.timeline.title)}
      meta={
        <>
          <span className="self-center rounded border border-line-strong px-1.5 py-0.5 text-[11px] font-medium text-fg-muted capitalize">
            {type}
          </span>
          <span className="text-[13px] text-fg-muted">
            <code className="font-mono text-[13px]">{id}</code>
            {entity?.detail && <span> · {entity.detail}</span>}
          </span>
          <Link
            to={`/graph?node=${encodeURIComponent(id)}`}
            className="ml-auto inline-flex h-8 items-center gap-1.5 self-center rounded-md border border-line-strong bg-panel px-3 text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-raised"
          >
            Open in graph
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </Link>
        </>
      }
    >
      {notFound ? (
        <section className="rounded-card border border-line-strong bg-panel">
          <EmptyState
            icon={SearchX}
            title={`No ${type} with this id`}
            description="It may have been mistyped, or it belongs to a different tenant."
            action={
              <Link to="/timeline" className="font-medium text-accent underline">
                Open another timeline
              </Link>
            }
          />
        </section>
      ) : (
        <>
          <Toolbar
            categories={categories}
            onToggle={toggleCategory}
            range={range}
            onRange={setRange}
            count={visible.length}
            updating={loading && data !== null}
          />
          {data === null && loading ? (
            <Skeleton className="h-[92px] w-full rounded-card" />
          ) : (
            byCategory.length > 0 && (
              <DensityBar items={byCategory} type={type} range={range} onRange={setRange} highlight={highlight} />
            )
          )}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="flex min-w-0 flex-col gap-3">
              {error && data !== null && (
                <ErrorRetry title="The timeline could not be refreshed" message={error.message} onRetry={retry} />
              )}
              {data === null && error ? (
                <ErrorRetry title="The timeline could not be loaded" message={error.message} onRetry={retry} retrying={loading} />
              ) : data === null ? (
                <SkeletonRows rows={8} label="Loading timeline" />
              ) : visible.length === 0 ? (
                <section className="rounded-card border border-line-strong bg-panel">
                  <EmptyState
                    icon={History}
                    title="No activity in range"
                    description={
                      categories.size === 0
                        ? 'Every category is turned off. Turn one back on to see events.'
                        : 'Nothing matches these categories and this time range. Clear the range or turn more categories on.'
                    }
                    action={
                      range && (
                        <button
                          type="button"
                          onClick={() => {
                            setRange(null)
                          }}
                          className="font-medium text-accent underline"
                        >
                          Clear time range
                        </button>
                      )
                    }
                  />
                </section>
              ) : (
                <Lanes
                  items={visible}
                  type={type}
                  selectedRef={selected?.ref_id ?? null}
                  onSelect={setSelectedRef}
                  relation={relation}
                />
              )}
              {data?.nextCursor && categories.size > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={more.loading}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-panel px-3 text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-raised disabled:cursor-wait disabled:opacity-60"
                  >
                    {more.loading && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />}
                    Load older events
                  </button>
                  {more.error && <span className="text-[13px] text-danger">{more.error.message}</span>}
                </div>
              )}
            </div>
            <Inspector item={selected} type={type} followThrough={followThrough} />
          </div>
        </>
      )}
    </Page>
  )
}

interface ToolbarProps {
  categories: ReadonlySet<TimelineCategory>
  onToggle: (category: TimelineCategory) => void
  range: TimeRange | null
  onRange: (range: TimeRange | null) => void
  count: number
  updating: boolean
}

function Toolbar({ categories, onToggle, range, onRange, count, updating }: ToolbarProps) {
  const [now] = useState(() => Date.now())
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div role="group" aria-label="Event categories" className="flex flex-wrap gap-2">
        {TIMELINE_CATEGORIES.map((category) => {
          const { label, Icon } = CATEGORY_META[category]
          const on = categories.has(category)
          return (
            <button
              key={category}
              type="button"
              aria-pressed={on}
              onClick={() => {
                onToggle(category)
              }}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors duration-150 ${
                on ? 'border-line-strong bg-selected text-fg' : 'border-line bg-panel text-fg-subtle hover:bg-raised'
              }`}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              {label}
            </button>
          )
        })}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2 text-[13px] text-fg-muted">
        <div role="group" aria-label="Time range" className="flex gap-1">
          {QUICK_RANGES.map((q) => {
            const active = range !== null && range.to === now && range.from === now - q.ms
            return (
              <button
                key={q.label}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onRange(active ? null : { from: now - q.ms, to: now })
                }}
                className={`h-8 rounded-md border px-2.5 text-[13px] font-medium transition-colors duration-150 ${
                  active ? 'border-line-strong bg-selected text-fg' : 'border-line bg-panel text-fg-muted hover:bg-raised'
                }`}
              >
                {q.label}
              </button>
            )
          })}
        </div>
        <span className="font-mono text-xs" aria-live="polite">
          {count} {count === 1 ? 'event' : 'events'}
          {range && ` · ${shortDate.format(range.from)} – ${shortDate.format(range.to - 1)}`}
        </span>
        {range && (
          <button
            type="button"
            onClick={() => {
              onRange(null)
            }}
            className="font-medium text-accent underline underline-offset-3"
          >
            Clear range
          </button>
        )}
        {updating && (
          <span className="inline-flex items-center gap-1 text-xs">
            <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
            Updating
          </span>
        )}
      </div>
    </div>
  )
}

interface DensityBarProps {
  items: readonly TimelineItem[]
  type: TimelineEntityType
  range: TimeRange | null
  onRange: (range: TimeRange) => void
  highlight: TimeRange | null
}

function binLabel(start: number, unit: BinUnit): string {
  return unit === 'hour' ? `${hourLabel.format(start)}:00` : dayFormat.format(start)
}

function DensityBar({ items, type, range, onRange, highlight }: DensityBarProps) {
  const { bins, unit } = useMemo(
    () => densityBins(range ? items.filter((i) => inRange(i, range)) : items, type, range),
    [items, type, range],
  )
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null)
  const lanes = laneLabels(type)
  const max = Math.max(1, ...bins.map((b) => Math.max(b.left, -b.right)))
  const indexOf = (state: { activeIndex?: unknown }): number | null => {
    if (state.activeIndex === undefined || state.activeIndex === null) return null
    const n = Number(state.activeIndex)
    return Number.isInteger(n) ? n : null
  }
  const finish = () => {
    if (!drag) return
    const lo = bins[Math.min(drag.a, drag.b)]
    const hi = bins[Math.max(drag.a, drag.b)]
    setDrag(null)
    if (lo && hi) onRange({ from: lo.start, to: hi.end })
  }
  const first = bins[0]
  const last = bins[bins.length - 1]
  const chartData = bins.map((b) => ({ ...b, left: b.left || null, right: b.right || null }))
  const windowBins = highlight ? bins.filter((b) => b.end > highlight.from && b.start <= highlight.to) : []
  const windowFirst = windowBins[0]
  const windowLast = windowBins.at(-1)

  return (
    <section
      aria-label={`${lanes.left} and ${lanes.right} events per ${unit}. Drag across the bars to select a time range.`}
      className="flex flex-col gap-1 rounded-card border border-line-strong bg-panel px-3 pt-2 pb-1.5"
    >
      <div className="h-16 w-full select-none [&_g[tabindex='-1']:focus]:outline-none">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            stackOffset="sign"
            barCategoryGap={1}
            margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
            onMouseDown={(state) => {
              const i = indexOf(state)
              if (i !== null) setDrag({ a: i, b: i })
            }}
            onMouseMove={(state) => {
              const i = indexOf(state)
              if (drag && i !== null && i !== drag.b) setDrag({ a: drag.a, b: i })
            }}
            onMouseUp={finish}
            onMouseLeave={() => {
              setDrag(null)
            }}
            style={{ cursor: 'crosshair' }}
          >
            <XAxis dataKey="index" hide />
            <YAxis hide domain={[-max, max]} />
            {windowFirst && windowLast && (
              <ReferenceArea x1={windowFirst.index} x2={windowLast.index} fill="var(--selected)" fillOpacity={0.9} ifOverflow="hidden" />
            )}
            <ReferenceLine y={0} stroke="var(--line-strong)" />
            <Tooltip
              cursor={{ fill: 'var(--raised)' }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const bin = (payload[0] as { payload?: ChartBin } | undefined)?.payload
                if (!active || !bin) return null
                return (
                  <div className="rounded-md border border-line-strong bg-panel px-2.5 py-1.5 text-xs shadow-float">
                    <p className="font-medium text-fg">{binLabel(bin.start, unit)}</p>
                    <p className="font-mono text-fg-muted">
                      {bin.left ?? 0} {lanes.left.toLowerCase()} · {-(bin.right ?? 0)} {lanes.right.toLowerCase()}
                    </p>
                  </div>
                )
              }}
            />
            <Bar dataKey="left" stackId="lanes" fill="var(--fg-subtle)" isAnimationActive={false} />
            <Bar dataKey="right" stackId="lanes" fill="var(--fg)" isAnimationActive={false} />
            {drag && (
              <ReferenceArea
                x1={Math.min(drag.a, drag.b)}
                x2={Math.max(drag.a, drag.b)}
                fill="var(--selected)"
                fillOpacity={0.6}
                stroke="var(--accent)"
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[11px] text-fg-subtle">
        <span className="whitespace-nowrap">{first ? binLabel(first.start, unit) : ''}</span>
        <span className="order-last flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 font-sans text-[11.5px] text-fg-muted sm:order-none sm:w-auto">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-fg-subtle" />
            {lanes.left}, above the line
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-fg" />
            {lanes.right}, below
          </span>
          {windowFirst && (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-[2px] border border-line-strong bg-selected" />
              48 hours after the selected change
            </span>
          )}
          <span>{unit === 'hour' ? 'Hourly' : 'Daily'} bars · drag to zoom</span>
        </span>
        <span className="whitespace-nowrap">{last ? binLabel(last.start, unit) : ''}</span>
      </div>
    </section>
  )
}

interface LanesProps {
  items: readonly TimelineItem[]
  type: TimelineEntityType
  selectedRef: string | null
  onSelect: (ref: string) => void
  relation: (item: TimelineItem) => Relation
}

function Lanes({ items, type, selectedRef, onSelect, relation }: LanesProps) {
  const lanes = laneLabels(type)
  const days = useMemo(() => {
    const groups: { day: number; items: TimelineItem[] }[] = []
    for (const item of items) {
      const day = dayKey(tsOf(item))
      const group = groups.at(-1)
      if (group?.day === day) group.items.push(item)
      else groups.push({ day, items: [item] })
    }
    return groups
  }, [items])

  return (
    <div className="max-h-[max(420px,calc(100dvh-360px))] overflow-y-auto rounded-card border border-line-strong bg-panel">
      <div className="sticky top-0 z-20 grid h-8 grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-center border-b border-line bg-panel text-xs font-semibold text-fg-muted">
        <span className="pr-3 text-right">{lanes.left}</span>
        <span className="text-center font-medium text-fg-subtle">Time</span>
        <span className="pl-3">{lanes.right}</span>
      </div>
      {days.map((group) => (
        <section key={group.day} aria-label={dayFormat.format(group.day)}>
          <h3 className="sticky top-8 z-10 flex justify-between border-b border-line bg-raised px-3.5 py-1 text-xs font-semibold text-fg-muted">
            <span>{dayFormat.format(group.day)}</span>
            <span className="font-mono text-[11px] font-normal">
              {group.items.length} {group.items.length === 1 ? 'event' : 'events'}
            </span>
          </h3>
          <ul>
            {group.items.map((item) => (
              <LaneRow
                key={item.ref_id}
                item={item}
                type={type}
                selected={item.ref_id === selectedRef}
                relation={relation(item)}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : typeof value === 'number' ? String(value) : null

function formatField(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number' && /limit|amount/.test(key)) return formatInr(value)
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v)))
      .join(' · ')
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

interface InspectorProps {
  item: TimelineItem | null
  type: TimelineEntityType
  followThrough: FollowThrough | null
}

function Inspector({ item, type, followThrough }: InspectorProps) {
  const { record, error, retry } = useRawRecord(item)

  if (!item) {
    return (
      <aside aria-label="Event details" className="rounded-card border border-line-strong bg-panel lg:sticky lg:top-4">
        <EmptyState icon={History} title="Select an event" description="Its details and source record appear here." />
      </aside>
    )
  }

  const { Icon, label } = CATEGORY_META[item.category]
  const r = record?.record
  const mono = (value: string | null) => <span className="font-mono">{value ?? '—'}</span>
  const facts: [string, ReactNode][] = [
    ['Category', label],
    ['When', mono(fullFormat.format(tsOf(item)))],
  ]

  if (item.event_kind === 'transaction') {
    const raw = (r?.raw ?? {}) as Record<string, unknown>
    const account = (value: unknown) => {
      const acct = str(value)
      return acct ? <EntityChip kind="account" id={acct} /> : <span className="text-fg-muted">External</span>
    }
    facts.push(
      ['Amount', mono(item.value ? formatInr(item.value) : null)],
      ['Direction', item.direction === 'in' ? 'Money in' : item.direction === 'out' ? 'Money out' : 'Between own accounts'],
    )
    if (r) {
      facts.push(
        ['Channel', <span className="font-mono uppercase">{str(r.channel) ?? '—'}</span>],
        ['Reference', mono(str(r.reference_no))],
        ['Status', <span className="capitalize">{str(r.status) ?? '—'}</span>],
        ['From', account(r.from_account_id)],
        ['To', account(r.to_account_id)],
      )
      const counterparty = str(raw.counterparty)
      const narration = str(raw.narration)
      if (counterparty) facts.push(['Counterparty', counterparty])
      if (narration) facts.push(['Narration', mono(narration)])
    }
  } else if (item.event_kind === 'employee_action') {
    if (item.actor) facts.push(['Performed by', <EntityChip kind="employee" id={item.actor.id} label={item.actor.name} />])
    if (r) {
      const targetId = str(r.target_id)
      const kind = targetKind(targetId)
      facts.push(
        ['Action', mono(str(r.action_type))],
        [
          'Target',
          targetId && kind ? (
            <EntityChip kind={kind} id={targetId} label={targetId === item.target ? item.target_label : null} />
          ) : (
            mono(targetId)
          ),
        ],
        ['Session', mono(str(r.session_id))],
        ['IP address', mono(str(r.ip_address))],
      )
    }
  } else if (r) {
    const ended = str(r.ended_at)
    facts.push(
      ['Outcome', <span className="capitalize">{str(r.outcome) ?? '—'}</span>],
      ['Ended', mono(ended ? fullFormat.format(new Date(ended)) : null)],
      ['Device', mono(str(r.device))],
      ['IP address', mono(str(r.ip_address))],
    )
  }

  const before = (r?.before_state ?? null) as Record<string, unknown> | null
  const after = (r?.after_state ?? null) as Record<string, unknown> | null
  const changedKeys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]

  return (
    <aside
      aria-label="Event details"
      className="flex max-h-[calc(100dvh-7rem)] min-w-0 flex-col gap-4 overflow-y-auto rounded-card border border-line-strong bg-panel p-4 lg:sticky lg:top-4"
    >
      <h2 className="flex items-start gap-2 text-[15px] font-semibold text-fg">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
        {item.title}
      </h2>

      <dl className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-[13px]">
        {facts.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-fg-subtle">{term}</dt>
            <dd className="min-w-0 break-words text-fg">{value}</dd>
          </div>
        ))}
      </dl>

      {!r && !error && (
        <div role="status" aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Loading the source record</span>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {changedKeys.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold text-fg-muted">What changed</h3>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
            {changedKeys.map((key) => (
              <div key={key} className="contents">
                <dt className="text-fg-subtle">{FIELD_LABEL[key] ?? key.replace(/_/g, ' ')}</dt>
                <dd className="min-w-0 break-words">
                  <span className="text-fg-subtle line-through">{formatField(key, before?.[key])}</span>
                  <span className="text-fg-subtle"> → </span>
                  <span className="font-medium text-fg">{formatField(key, after?.[key])}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {followThrough ? (
        <FollowList
          start={followThrough.start}
          items={followThrough.items}
          hidden={followThrough.hidden}
          footer={followThrough.items.length > 0 && 'Each one is tagged in the Money lane with its delay after this change.'}
        />
      ) : (
        type === 'employee' && <TargetFollowThrough item={item} />
      )}

      {error ? (
        <ErrorRetry title="The source record could not be loaded" message={error.message} onRetry={retry} />
      ) : (
        record && (
          <section className="flex min-w-0 flex-col gap-1.5">
            <h3 className="flex items-baseline justify-between gap-2 text-xs font-semibold text-fg-muted">
              Source record
              <span className="font-mono text-[11px] font-normal text-fg-subtle">{record.source_table}</span>
            </h3>
            <pre
              data-testid="timeline-raw"
              className="max-h-72 overflow-auto rounded-md border border-line bg-canvas px-3 py-2.5 font-mono text-[11.5px] leading-normal text-fg-muted"
            >
              {JSON.stringify(record.record, null, 2)}
            </pre>
          </section>
        )
      )}
    </aside>
  )
}

const FOLLOW_LIST_MAX = 8

interface FollowListProps {
  start: number
  items: readonly TimelineItem[]
  hidden?: number
  footer?: ReactNode
}

function FollowList({ start, items, hidden = 0, footer }: FollowListProps) {
  const total = items.reduce((sum, i) => sum + Number(i.value ?? 0), 0)
  return (
    <section className="flex flex-col gap-1.5" data-testid="follow-through">
      <h3 className="text-xs font-semibold text-fg-muted">Outgoing transfers within 48 hours</h3>
      {items.length === 0 ? (
        <p className="text-[13px] text-fg">None after this change.</p>
      ) : (
        <>
          <p className="text-[13px] text-fg">
            <span className="font-mono">{formatInr(total)}</span> out in {items.length} {items.length === 1 ? 'transfer' : 'transfers'}
          </p>
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line text-[13px]">
            {items.slice(0, FOLLOW_LIST_MAX).map((i) => (
              <li key={i.ref_id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2 px-2.5 py-1.5">
                <span className="font-mono text-[11px] text-fg-subtle">{delayLabel(start, tsOf(i))}</span>
                <span className="truncate text-fg">{i.title}</span>
                <span className="font-mono text-xs text-fg-muted">{formatInr(i.value ?? 0)}</span>
              </li>
            ))}
          </ul>
          {items.length > FOLLOW_LIST_MAX && <p className="text-xs text-fg-muted">and {items.length - FOLLOW_LIST_MAX} more</p>}
        </>
      )}
      {hidden > 0 && (
        <p className="text-xs text-fg-muted">
          {hidden} of {items.length} {items.length === 1 ? 'is' : 'are'} hidden by the current categories or time range.
        </p>
      )}
      {footer && <p className="text-xs text-fg-muted">{footer}</p>}
    </section>
  )
}

function TargetFollowThrough({ item }: { item: TimelineItem }) {
  const targetType = item.event_kind === 'employee_action' && item.target ? entityTypeOf(item.target) : null
  const target = targetType === 'customer' || targetType === 'account' ? item.target : null
  const ref = item.ref_id
  const start = tsOf(item)
  const [state, setState] = useState<{ ref: string; label: string; items: TimelineItem[] } | { ref: string; error: Error } | null>(null)

  useEffect(() => {
    if (!target || (targetType !== 'customer' && targetType !== 'account')) return
    const controller = new AbortController()
    fetchTimeline(
      targetType,
      target,
      {
        from: new Date(start).toISOString(),
        to: new Date(start + CORRELATION_WINDOW_MS).toISOString(),
        categories: ['transaction'],
        limit: 200,
      },
      controller.signal,
    )
      .then((page) => {
        setState({ ref, label: page.entity.label, items: sortNewestFirst(page.items).filter(isOutgoingTransfer).reverse() })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ ref, error: toError(err) })
      })
    return () => {
      controller.abort()
    }
  }, [ref, target, targetType, start])

  if (!target || !targetType) return null
  const current = state?.ref === ref ? state : null
  if (!current) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-1.5">
        <span className="sr-only">Loading transfers after this change</span>
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }
  if ('error' in current) {
    return <p className="text-[13px] text-danger">Transfers after this change could not be loaded: {current.error.message}</p>
  }
  return (
    <FollowList
      start={start}
      items={current.items}
      footer={
        <Link
          to={`/timeline/${targetType}/${encodeURIComponent(target)}?event=${encodeURIComponent(ref)}`}
          className="font-medium text-accent underline"
        >
          Open {current.label}'s timeline at this change
        </Link>
      }
    />
  )
}
