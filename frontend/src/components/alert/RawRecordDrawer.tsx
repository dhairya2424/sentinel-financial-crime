import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { Evidence } from '@/api/types'
import { SOURCE_TABLE } from '@/lib/alerts'

interface RawRecordDrawerProps {
  evidence: Evidence
  onClose: () => void
}

/** The frozen source row behind one evidence item (ADR-004), as it was when the alert fired. */
export function RawRecordDrawer({ evidence, onClose }: RawRecordDrawerProps) {
  const titleId = useId()
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    close.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => {
          e.stopPropagation()
        }}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line-strong bg-panel shadow-float"
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-sm font-semibold text-fg">
              Raw record
            </h2>
            <p className="truncate font-mono text-xs text-fg-muted">{evidence.ref_id}</p>
          </div>
          <button
            ref={close}
            type="button"
            onClick={onClose}
            aria-label="Close raw record"
            className="grid size-8 place-items-center rounded-md text-fg-subtle transition-colors duration-150 hover:bg-raised hover:text-fg"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>
        <pre className="min-h-0 flex-1 overflow-auto bg-canvas px-4 py-3 font-mono text-xs leading-relaxed text-fg">
          {JSON.stringify(evidence.snapshot, null, 2)}
        </pre>
        <footer className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2 font-mono text-[11.5px] text-fg-muted">
          <span>source table: {SOURCE_TABLE[evidence.evidence_type]}</span>
          <span>frozen {new Date(evidence.captured_at).toLocaleString()}</span>
        </footer>
      </aside>
    </div>
  )
}
