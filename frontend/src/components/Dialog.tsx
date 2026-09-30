import { X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef } from 'react'

interface DialogProps {
  title: string
  description?: ReactNode
  onClose: () => void
  children: ReactNode
  /** `sheet` slides in from the right edge and fills the height; `center` is a compact modal. */
  variant?: 'center' | 'sheet'
  /** Escape and the backdrop do nothing while a request is in flight. */
  busy?: boolean
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A modal that behaves: focus moves in, Tab stays inside, Escape and the backdrop close it, and focus returns to
 * whatever opened it.
 */
export function Dialog({ title, description, onClose, children, variant = 'center', busy = false }: DialogProps) {
  const titleId = useId()
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  const blocked = useRef(busy)
  useEffect(() => {
    close.current = onClose
    blocked.current = busy
  })

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !blocked.current) {
        event.stopPropagation()
        close.current()
      }
      if (event.key === 'Tab' && box.current) {
        const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        if (items.length === 0) return
        const head = items[0]
        const tail = items[items.length - 1]
        if (event.shiftKey && document.activeElement === head) {
          event.preventDefault()
          tail?.focus()
        } else if (!event.shiftKey && document.activeElement === tail) {
          event.preventDefault()
          head?.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      previous?.focus()
    }
  }, [])

  const sheet = variant === 'sheet'
  return (
    <div
      className={`fixed inset-0 z-50 flex bg-fg/20 ${sheet ? 'justify-end' : 'items-center justify-center p-4'}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !blocked.current) close.current()
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          sheet
            ? 'sheet-in flex h-full w-full max-w-3xl flex-col border-l border-line-strong bg-panel shadow-float'
            : 'flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-y-auto rounded-card border border-line-strong bg-panel shadow-float'
        }
      >
        <div className={`flex items-start gap-3 ${sheet ? 'border-b border-line px-5 py-3' : 'px-5 pt-5'}`}>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description && <div className="text-[13px] text-fg-muted">{description}</div>}
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-raised hover:text-fg disabled:opacity-50"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className={sheet ? 'min-h-0 flex-1 overflow-y-auto px-5 py-4' : 'px-5 pt-3 pb-5'}>{children}</div>
      </div>
    </div>
  )
}
