import { LoaderCircle, Plus, X } from 'lucide-react'
import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { lookup } from '@/api/entities'
import type { LookupOption, LookupType } from '@/api/types'
import { FIELD } from './fields'

const NOUN: Record<LookupType, string> = {
  customer: 'customer',
  account: 'account',
  employee: 'employee',
  session: 'session',
  transaction: 'transaction',
}

const holderOf = (o: LookupOption) => o.detail?.split(' · ')[0] ?? o.label

/** What a closed picker shows: the name people recognise first, then only the part that tells records apart. */
function display(type: LookupType, o: LookupOption): string {
  if (type === 'account') return `${holderOf(o)} · …${o.label.slice(-4)}`
  if (type === 'employee') return [o.label, o.detail?.split(' · ')[0]].filter(Boolean).join(' · ')
  return [o.label, o.detail].filter(Boolean).join(' · ')
}

interface EntityPickerProps {
  id: string
  type: LookupType
  value: LookupOption | null
  onChange: (value: LookupOption | null) => void
  placeholder: string
  /** Sessions are listed for this employee only. */
  employeeId?: string
  invalid?: boolean
  disabled?: boolean
  /** Shown when nothing is registered yet, so an empty list is never a dead end. */
  onRegister?: () => void
}

/** A combobox over registered records only. Opening it lists the newest; typing searches names, references and masked numbers. */
export function EntityPicker({ id, type, value, onChange, placeholder, employeeId, invalid = false, disabled = false, onRegister }: EntityPickerProps) {
  const listId = useId()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [result, setResult] = useState<{ key: string; options: LookupOption[]; error: string | null } | null>(null)
  const term = q.trim()
  const key = `${type}|${employeeId ?? ''}|${term}`

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = setTimeout(
      () => {
        lookup(type, term, { employeeId, signal: controller.signal })
          .then((options) => {
            setResult({ key, options, error: null })
            setActive(0)
          })
          .catch((err: unknown) => {
            if (!controller.signal.aborted) setResult({ key, options: [], error: err instanceof Error ? err.message : String(err) })
          })
      },
      term ? 180 : 0,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, key, type, term, employeeId])

  const current = result?.key === key ? result : null
  const options = current?.options ?? []
  const loading = open && current === null
  const pick = (option: LookupOption | undefined) => {
    if (!option) return
    onChange(option)
    setOpen(false)
    setQ('')
  }
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      pick(options[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }
  const noun = NOUN[type]
  const shown = open ? q : value ? display(type, value) : ''

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-activedescendant={open && options[active] ? `${listId}-${String(active)}` : undefined}
        value={shown}
        disabled={disabled}
        placeholder={value ? `${value.label}. Type to search for another` : placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setOpen(true)
        }}
        onClick={() => {
          // A picker that kept focus after a pick (or a save) must still open when clicked again.
          setOpen(true)
        }}
        onBlur={() => {
          setTimeout(() => {
            setOpen(false)
            setQ('')
          }, 120)
        }}
        onKeyDown={onKey}
        className={`${FIELD} pr-9`}
      />
      {loading ? (
        <LoaderCircle aria-hidden="true" className="absolute top-3 right-3 size-4 animate-spin text-fg-subtle" />
      ) : (
        value &&
        !disabled && (
          <button
            type="button"
            aria-label={`Clear ${noun}`}
            onClick={() => {
              onChange(null)
            }}
            className="absolute top-2 right-2 grid size-6 place-items-center rounded text-fg-subtle transition-colors duration-150 hover:bg-raised hover:text-fg"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        )
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`Registered ${noun}s`}
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-line-strong bg-panel py-1 shadow-float"
        >
          {current?.error ? (
            <li className="px-3 py-2 text-[13px] text-danger">{current.error}</li>
          ) : loading ? (
            <li className="px-3 py-2 text-[13px] text-fg-muted">Looking up {noun}s…</li>
          ) : options.length === 0 ? (
            <li className="flex flex-col items-start gap-1.5 px-3 py-2 text-[13px] text-fg-muted">
              {term ? `No registered ${noun} matches “${term}”.` : `No ${noun}s ${type === 'session' ? 'recorded' : 'registered'} yet.`}
              {onRegister && (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onRegister()
                  }}
                  className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                >
                  <Plus aria-hidden="true" className="size-3.5" />
                  Register {noun === 'employee' ? 'an' : 'a'} {noun}
                </button>
              )}
            </li>
          ) : (
            options.map((option, i) => (
              <li
                key={option.id}
                id={`${listId}-${String(i)}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(option)
                }}
                onMouseEnter={() => {
                  setActive(i)
                }}
                className={`flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-[13px] ${i === active ? 'bg-selected' : ''}`}
              >
                {type === 'account' ? (
                  <>
                    <span className="min-w-0 truncate text-fg">{holderOf(option)}</span>
                    <span className="shrink-0 font-mono text-xs text-fg-muted">{option.label}</span>
                    <span className="min-w-0 flex-1 truncate text-right text-xs text-fg-subtle">{option.detail?.split(' · ')[1]}</span>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 truncate text-fg">{option.label}</span>
                    {option.detail && <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{option.detail}</span>}
                  </>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
