import { ArrowLeftRight, Landmark, UserRound } from 'lucide-react'
import { Link } from 'react-router'
import { DESTINATION_LABEL, entityHref, initials, shortId, type ChipDestination, type EntityKind } from '@/lib/format'

interface EntityChipProps {
  kind: EntityKind
  id: string
  label?: string | null
  to?: ChipDestination
  testId?: string
}

export function EntityChip({ kind, id, label, to = 'timeline', testId }: EntityChipProps) {
  const href = entityHref(kind, id, to)
  const name = label ?? id
  const body = (
    <>
      {kind === 'employee' && label ? (
        <span
          aria-hidden="true"
          className="grid size-[18px] shrink-0 place-items-center rounded-full bg-raised text-[9px] font-semibold text-fg-muted"
        >
          {initials(label)}
        </span>
      ) : (
        <ChipIcon kind={kind} />
      )}
      {label && <span className="chip-label truncate">{label}</span>}
      <span className={`font-mono ${label ? 'shrink-0 text-[10.5px] text-fg-subtle' : 'min-w-0 truncate text-[11.5px] text-fg'}`}>
        {label ? shortId(id) : id}
      </span>
    </>
  )
  const shape =
    'inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-line-strong bg-panel pr-2 pl-[3px] text-xs font-medium whitespace-nowrap text-fg'

  if (!href) {
    return (
      <span data-testid={testId} title={id} className={shape}>
        {body}
      </span>
    )
  }
  return (
    <Link
      to={href}
      data-testid={testId}
      title={`${DESTINATION_LABEL[to]}: ${id}`}
      aria-label={`${name}, ${kind}. ${DESTINATION_LABEL[to]}`}
      className={`${shape} transition-colors duration-150 hover:bg-raised hover:[&_.chip-label]:underline`}
    >
      {body}
    </Link>
  )
}

function ChipIcon({ kind }: { kind: EntityKind }) {
  const Icon = kind === 'account' ? Landmark : kind === 'transaction' ? ArrowLeftRight : UserRound
  return (
    <span aria-hidden="true" className="grid size-[18px] shrink-0 place-items-center rounded-full bg-raised text-fg-muted">
      <Icon className="size-3" />
    </span>
  )
}
