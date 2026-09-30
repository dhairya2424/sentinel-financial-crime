import { BriefcaseBusiness, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'

interface CaseDialogProps {
  alertTitle: string
  onClose: () => void
}

/** Starting a case from an alert. The case module is built in P4; until then the dialog says so plainly. */
export function CaseDialog({ alertTitle, onClose }: CaseDialogProps) {
  const titleId = useId()
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    close.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab') {
        event.preventDefault()
        close.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-fg/20 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => {
          e.stopPropagation()
        }}
        className="flex w-full max-w-md flex-col gap-3 rounded-card border border-line-strong bg-panel p-5 shadow-float"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line-strong bg-raised text-fg-muted">
            <BriefcaseBusiness aria-hidden="true" className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              Start a case
            </h2>
            <p className="text-[13px] text-fg-muted">
              The case module arrives in the next build phase (P4). Then this will open a case for “{alertTitle}”, prefilled from the alert, ready to assign and
              export.
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            ref={close}
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong bg-panel px-3 text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-raised"
          >
            <X aria-hidden="true" className="size-3.5" />
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
