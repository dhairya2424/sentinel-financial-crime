import type { ReactNode } from 'react'

export const FIELD =
  'h-10 w-full rounded-md border border-line-strong bg-panel px-3 text-sm text-fg transition-colors duration-150 placeholder:text-fg-subtle hover:border-fg-subtle focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-60'

export const MONO_FIELD = `${FIELD} font-mono text-[13px] tabular-nums`

interface FieldProps {
  id: string
  label: string
  optional?: boolean
  hint?: ReactNode
  error?: string | null
  children: ReactNode
  className?: string
}

/** A labelled form row. The label says "(optional)" when the field may be left empty; everything else is required. */
export function Field({ id, label, optional = false, hint, error, children, className = '' }: FieldProps) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
        {optional && <span className="font-normal text-fg-subtle"> (optional)</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-fg-subtle">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

interface SegmentedProps<T extends string> {
  id: string
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}

export function Segmented<T extends string>({ id, label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span id={id} className="text-[13px] font-medium text-fg">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="inline-flex h-10 max-w-full self-start overflow-x-auto rounded-md border border-line-strong">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => {
              onChange(o.value)
            }}
            className={`shrink-0 border-l border-line px-2.5 text-[13px] whitespace-nowrap transition-colors duration-150 first:border-l-0 focus-visible:relative focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
              o.value === value ? 'bg-selected font-medium text-fg' : 'bg-panel text-fg-muted hover:bg-raised hover:text-fg'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Pair({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>
}

export type TabKey = 'customer' | 'account' | 'employee' | 'tx' | 'act' | 'session' | 'right' | 'import'
