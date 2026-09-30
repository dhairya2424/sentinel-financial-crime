import type { TimelineEntityType, TimelineItem } from '@/api/types'
import { EntityChip } from '@/components/EntityChip'
import { CATEGORY_META, laneOf, signedAmount, targetKind, timeFormat, tsOf } from '@/lib/timeline'

export interface Relation {
  linked: boolean
  dim: boolean
  tag: string | null
}

const NO_RELATION: Relation = { linked: false, dim: false, tag: null }

interface LaneRowProps {
  item: TimelineItem
  type: TimelineEntityType
  selected: boolean
  relation?: Relation
  /** Omit for a static row (the Add data preview): the title renders as text, not a button. */
  onSelect?: (ref: string) => void
  /** Every row in the list sits in this lane: drop the empty one and read time, then the card, left to right. */
  single?: boolean
}

export function LaneRow({ item, type, selected, relation = NO_RELATION, onSelect, single = false }: LaneRowProps) {
  const lane = laneOf(item, type)
  const { Icon, label } = CATEGORY_META[item.category]
  const t = tsOf(item)
  const amount = signedAmount(item)
  const target = type === 'employee' && item.event_kind === 'employee_action' ? targetKind(item.target) : null
  const reverse = lane === 'left' && !single
  const actor = item.category === 'access_login' ? null : item.actor
  const amountTone = relation.dim ? 'text-fg-subtle' : item.direction === 'in' ? 'text-fg' : 'text-fg-muted'

  const heading = (
    <>
      <Icon aria-hidden="true" className={`size-4 shrink-0 ${selected ? 'text-accent' : relation.dim ? 'text-fg-subtle' : 'text-fg-muted'}`} />
      <span
        className={`${onSelect ? 'truncate' : 'line-clamp-2 [overflow-wrap:anywhere]'} ${relation.dim ? 'text-fg-subtle' : 'text-fg'} ${item.event_kind === 'transaction' ? '' : 'font-medium'}`}
      >
        {item.title}
      </span>
      <span className="sr-only">
        {label}, {timeFormat.format(t)}
      </span>
    </>
  )

  const card = (
    <div className={`relative flex min-w-0 flex-col gap-1 px-3 py-2 ${reverse ? 'items-end text-right' : 'items-start'}`}>
      {onSelect ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => {
            onSelect(item.ref_id)
          }}
          className={`flex max-w-full min-w-0 items-center gap-2 outline-none after:absolute after:inset-0 after:rounded-[3px] after:content-[''] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent ${
            reverse ? 'flex-row-reverse text-right' : 'text-left'
          }`}
        >
          {heading}
        </button>
      ) : (
        <div className={`flex max-w-full min-w-0 items-center gap-2 ${reverse ? 'flex-row-reverse text-right' : ''}`}>{heading}</div>
      )}
      {(amount !== null || actor || target || relation.tag) && (
        <div className={`relative z-10 flex max-w-full min-w-0 flex-wrap items-center gap-2 ${reverse ? 'flex-row-reverse' : ''}`}>
          {amount !== null && <span className={`font-mono text-xs ${amountTone}`}>{amount}</span>}
          {actor && <EntityChip kind="employee" id={actor.id} label={actor.name} testId="timeline-actor" />}
          {target && item.target && <EntityChip kind={target} id={item.target} label={item.target_label} />}
          {relation.tag && <span className="rounded border border-line-strong px-1.5 font-mono text-[11px] text-fg-muted">{relation.tag}</span>}
        </div>
      )}
    </div>
  )

  return (
    <li
      data-testid="timeline-item"
      data-ts={item.ts}
      data-category={item.category}
      data-linked={relation.linked || undefined}
      className={`grid ${single ? 'grid-cols-[64px_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)]'} border-b border-line transition-colors duration-150 last:border-b-0 ${
        selected ? 'bg-selected ring-1 ring-accent ring-inset' : onSelect ? 'hover:bg-raised/60' : ''
      }`}
    >
      {!single && <div className="min-w-0">{lane === 'left' && card}</div>}
      <div className={`${single ? 'border-r' : 'border-x'} border-line py-2 text-center font-mono text-xs ${selected ? 'text-accent' : 'text-fg-subtle'}`}>
        <time dateTime={item.ts}>{timeFormat.format(t)}</time>
      </div>
      <div className="min-w-0">{(single || lane === 'right') && card}</div>
    </li>
  )
}
