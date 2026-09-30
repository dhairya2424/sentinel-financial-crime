import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useToasts, type Toast } from '@/store/toasts'
import { RiskBadge } from './RiskBadge'

const LIFETIME_MS = 6000

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss)
  const navigate = useNavigate()
  const [paused, setPaused] = useState(false)
  const left = useRef(LIFETIME_MS)

  useEffect(() => {
    if (paused) return
    const started = Date.now()
    const timer = setTimeout(() => {
      dismiss(toast.id)
    }, left.current)
    return () => {
      clearTimeout(timer)
      left.current -= Date.now() - started
    }
  }, [paused, dismiss, toast.id])

  const open = () => {
    dismiss(toast.id)
    if (toast.to) void navigate(toast.to)
  }

  return (
    <li
      onMouseEnter={() => {
        setPaused(true)
      }}
      onMouseLeave={() => {
        setPaused(false)
      }}
      onFocus={() => {
        setPaused(true)
      }}
      onBlur={() => {
        setPaused(false)
      }}
      className="pointer-events-auto flex w-96 max-w-[calc(100vw-2rem)] items-center gap-2 rounded-card border border-line-strong bg-panel py-2 pr-2 pl-3 text-[13px] shadow-float motion-safe:animate-[toast-in_180ms_ease-out]"
    >
      {toast.band && <RiskBadge band={toast.band} />}
      {toast.to ? (
        <button type="button" onClick={open} className="line-clamp-2 min-w-0 flex-1 text-left text-fg hover:underline">
          {toast.title}
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate text-fg">{toast.title}</span>
      )}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => {
          dismiss(toast.id)
        }}
        className="grid size-7 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors duration-150 hover:bg-raised hover:text-fg"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </li>
  )
}

/** Non-blocking notices, top right under the topbar (docs/03 §11). */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <ol aria-live="polite" aria-label="Notifications" className="pointer-events-none fixed top-16 right-4 z-40 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </ol>
  )
}
