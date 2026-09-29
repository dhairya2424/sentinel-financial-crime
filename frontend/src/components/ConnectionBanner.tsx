import { RotateCw, WifiOff } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useNow } from '@/hooks/useNow'
import { apiHost } from '@/lib/format'
import { downServices, useHealth } from '@/store/health'

export function ConnectionBanner() {
  const { connection, services, recheck, nextCheckAt } = useHealth(
    useShallow((s) => ({ connection: s.connection, services: s.services, recheck: s.recheck, nextCheckAt: s.nextCheckAt })),
  )
  const now = useNow(1000)
  if (connection !== 'unreachable' && connection !== 'degraded') return null

  const down = downServices(services)
  const message =
    connection === 'unreachable'
      ? `Can't reach the Sentinel API at ${apiHost}. Anything on screen may be out of date.`
      : `The API is up, but ${down.join(' and ')} ${down.length > 1 ? 'are' : 'is'} unavailable. Sign-in and data may fail until it recovers.`

  const retryIn = nextCheckAt ? Math.max(0, Math.ceil((nextCheckAt - now) / 1000)) : null

  return (
    <div
      data-testid="connection-banner"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-warn-line bg-warn-bg px-4 py-2 text-[13px] text-warn-fg lg:px-6"
    >
      <WifiOff aria-hidden="true" className="size-4 shrink-0" />
      <p role="alert" className="min-w-0 flex-1 basis-56">
        {message}
      </p>
      {retryIn !== null && (
        <span className="shrink-0 whitespace-nowrap font-mono text-xs">retrying in {retryIn}s</span>
      )}
      <button
        type="button"
        onClick={recheck}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-warn-line px-2.5 font-medium transition-colors duration-150 hover:bg-warn-line/40"
      >
        <RotateCw aria-hidden="true" className="size-3.5" />
        Retry now
      </button>
    </div>
  )
}
