import { CircleAlert, LoaderCircle, RotateCw } from 'lucide-react'

interface ErrorRetryProps {
  title?: string
  message: string
  onRetry: () => void
  retrying?: boolean
}

export function ErrorRetry({ title = 'This could not be loaded', message, onRetry, retrying = false }: ErrorRetryProps) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-card border border-line-strong bg-panel px-4 py-3">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-medium text-fg">{title}</p>
        <p className="text-fg-muted">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-panel px-3 text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-raised disabled:cursor-wait disabled:opacity-60"
      >
        {retrying ? (
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
        ) : (
          <RotateCw aria-hidden="true" className="size-3.5" />
        )}
        {retrying ? 'Retrying' : 'Retry'}
      </button>
    </div>
  )
}
