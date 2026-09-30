import { ArrowUpRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { fetchTimeline } from '@/api/timeline'
import type { EntityRef, TimelineItem } from '@/api/types'
import { LaneRow } from '@/components/LaneRow'
import { SkeletonRows } from '@/components/Skeleton'
import { laneLabels, sortNewestFirst } from '@/lib/timeline'

interface EvidenceTimelineProps {
  entities: readonly EntityRef[]
  evidenceIds: ReadonlySet<string>
}

type RowsState = { key: string; status: 'loaded'; items: TimelineItem[] } | { key: string; status: 'error'; message: string }

const MAX_ROWS = 10

/** Whose Timeline to read: the customer people know first, else an employee, else an account (one viewpoint, so signs stay consistent). */
function viewpointOf(entities: readonly EntityRef[]): EntityRef | null {
  return entities.find((e) => e.type === 'customer') ?? entities.find((e) => e.type === 'employee') ?? entities[0] ?? null
}

/**
 * The alert's evidence as it appears on the primary entity's Timeline: the real Timeline rows (LaneRow), newest first,
 * at most ten. Evidence that sits on other entities' Timelines is counted, not redrawn from another viewpoint.
 */
export function EvidenceTimeline({ entities, evidenceIds }: EvidenceTimelineProps) {
  const viewpoint = viewpointOf(entities)
  const key = viewpoint ? `${viewpoint.type}:${viewpoint.id}:${[...evidenceIds].join(',')}` : ''
  const [result, setResult] = useState<RowsState | null>(null)

  useEffect(() => {
    if (!viewpoint) return
    const controller = new AbortController()
    fetchTimeline(viewpoint.type, viewpoint.id, { limit: 200 }, controller.signal)
      .then((page) => {
        const items = sortNewestFirst(page.items.filter((i) => evidenceIds.has(i.ref_id)))
        setResult({ key, status: 'loaded', items })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setResult({ key, status: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers the viewpoint and the evidence set
  }, [key])

  const state = result?.key === key ? result : null
  const lanes = laneLabels(viewpoint?.type ?? 'customer')
  const elsewhere = state?.status === 'loaded' ? evidenceIds.size - state.items.length : 0

  return (
    <section aria-labelledby="evidence-timeline-heading" className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 id="evidence-timeline-heading" className="text-[13px] font-semibold text-fg">
          {viewpoint ? `Evidence on ${viewpoint.label}’s Timeline` : 'Evidence on the Timeline'}
        </h3>
        {viewpoint && (
          <Link
            to={`/timeline/${viewpoint.type}/${encodeURIComponent(viewpoint.id)}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            Open full Timeline
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </Link>
        )}
      </div>
      <div className="overflow-hidden rounded-card border border-line-strong bg-panel">
        <div className="grid h-8 grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-center border-b border-line text-xs font-semibold text-fg-muted">
          <span className="pr-3 text-right">{lanes.left}</span>
          <span className="text-center font-medium text-fg-subtle">Time</span>
          <span className="pl-3">{lanes.right}</span>
        </div>
        {!viewpoint ? (
          <p className="px-3.5 py-4 text-[13px] text-fg-muted">This alert names no customer, employee or account with a Timeline.</p>
        ) : !state ? (
          <SkeletonRows rows={3} label="Loading evidence events" />
        ) : state.status === 'error' ? (
          <p role="alert" className="px-3.5 py-4 text-[13px] text-fg-muted">
            The Timeline could not be read: {state.message}.
          </p>
        ) : state.items.length === 0 ? (
          <p className="px-3.5 py-4 text-[13px] text-fg-muted">None of the evidence records are on {viewpoint.label}’s Timeline.</p>
        ) : (
          <ul>
            {state.items.slice(0, MAX_ROWS).map((item) => (
              <LaneRow key={item.ref_id} item={item} type={viewpoint.type} selected={false} />
            ))}
          </ul>
        )}
        {elsewhere > 0 && (
          <p className="border-t border-line px-3.5 py-2 text-xs text-fg-subtle">
            {elsewhere} more evidence {elsewhere === 1 ? 'record is' : 'records are'} on other entities’ Timelines; all are listed in the evidence panel.
          </p>
        )}
      </div>
    </section>
  )
}
