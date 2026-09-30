import type { CasePriority } from '@/api/types'
import { PRIORITY_META } from '@/lib/cases'
import { initials } from '@/lib/format'

/** Urgency in neutral ink with a signal icon: priority is never drawn in a risk colour. */
export function PriorityBadge({ priority }: { priority: CasePriority }) {
  const { label, Icon } = PRIORITY_META[priority]
  return (
    <span
      data-priority={priority}
      className={`inline-flex h-5 items-center gap-1 rounded border border-line-strong px-1.5 text-[11px] ${priority === 'critical' ? 'font-semibold text-fg' : 'font-medium text-fg-muted'}`}
    >
      <Icon aria-hidden="true" className="size-3" strokeWidth={2.25} />
      <span className="sr-only">Priority: </span>
      {label}
    </span>
  )
}

/** The assignee's initials, or a dashed ring for nobody; the full name is always in the accessible name. */
export function Assignee({ name, size = 'sm' }: { name: string | null; size?: 'sm' | 'md' }) {
  const box = size === 'md' ? 'size-7 text-[11px]' : 'size-[22px] text-[9.5px]'
  if (!name) {
    return (
      <span title="Unassigned" className={`grid shrink-0 place-items-center rounded-full border border-dashed border-line-strong ${box}`}>
        <span className="sr-only">Unassigned</span>
      </span>
    )
  }
  return (
    <span title={name} className={`grid shrink-0 place-items-center rounded-full border border-line-strong bg-raised font-semibold text-fg-muted ${box}`}>
      <span aria-hidden="true">{initials(name)}</span>
      <span className="sr-only">Assigned to {name}</span>
    </span>
  )
}
