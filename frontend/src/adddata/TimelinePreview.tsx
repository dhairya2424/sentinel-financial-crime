import { CircleAlert, Info, LoaderCircle } from 'lucide-react'
import { LaneRow } from '@/components/LaneRow'
import { laneLabels } from '@/lib/timeline'
import type { PreviewState } from './preview'

const LIST = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })

interface TimelinePreviewProps {
  state: PreviewState
  /** Names of the required fields still empty, shown while the record is incomplete. */
  missing: readonly string[]
}

/** The Timeline row this record will become, drawn with the Timeline's own row before anything is saved. */
export function TimelinePreview({ state, missing }: TimelinePreviewProps) {
  const ready = state.status === 'ready' ? state.preview : null
  const viewpoint = ready?.viewpoint ?? null
  const lanes = laneLabels(viewpoint?.type ?? 'customer')

  return (
    <section aria-labelledby="preview-heading" aria-live="polite" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 id="preview-heading" className="text-[13px] font-semibold text-fg">
          Timeline preview
        </h3>
        <p className="text-xs text-fg-subtle">
          {viewpoint ? (
            <>
              As it will appear on <span className="font-medium text-fg-muted">{viewpoint.label}</span>’s Timeline
            </>
          ) : (
            'Nothing is saved until you press the button below'
          )}
        </p>
      </div>
      <div className="overflow-hidden rounded-card border border-line-strong bg-panel">
        <div className="grid h-8 grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-center border-b border-line text-xs font-semibold text-fg-muted">
          <span className="pr-3 text-right">{lanes.left}</span>
          <span className="text-center font-medium text-fg-subtle">Time</span>
          <span className="pl-3">{lanes.right}</span>
        </div>
        {ready?.item && viewpoint ? (
          <ul>
            <LaneRow item={ready.item} type={viewpoint.type} selected />
          </ul>
        ) : (
          <div className="flex min-h-[58px] items-center gap-2 px-3.5 py-3 text-[13px]">
            {state.status === 'loading' ? (
              <>
                <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-fg-subtle" />
                <span className="text-fg-muted">Checking the record against what’s registered</span>
              </>
            ) : state.status === 'error' ? (
              <>
                <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-danger" />
                <span className="text-fg-muted">The preview could not be drawn: {state.message}</span>
              </>
            ) : ready?.problem ? (
              <>
                <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-danger" />
                <span className="text-danger">This can’t be saved: {ready.problem}.</span>
              </>
            ) : ready?.note ? (
              <>
                <Info aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                <span className="text-fg-muted">{ready.note}</span>
              </>
            ) : (
              <span className="text-fg-subtle">{missing.length ? `Fill in ${LIST.format(missing)} to see the row.` : 'Fill in the form to see the row.'}</span>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
