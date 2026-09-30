import { RadioTower } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useNow } from '@/hooks/useNow'
import { useHealth } from '@/store/health'
import { useSocketStatus } from '@/ws/useSocket'

const GRACE_MS = 1500

/** docs/04 §6: while the socket is reconnecting, say that live updates are paused. The API banner covers a full outage. */
export function LiveBanner() {
  const { state, since, retryAt } = useSocketStatus(useShallow((s) => ({ state: s.state, since: s.since, retryAt: s.retryAt })))
  const api = useHealth((s) => s.connection)
  const now = useNow(1000)
  if (state !== 'reconnecting' || now - since < GRACE_MS || api === 'unreachable' || api === 'degraded') return null
  const retryIn = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : null
  return (
    <div
      data-testid="live-banner"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-warn-line bg-warn-bg px-4 py-2 text-[13px] text-warn-fg lg:px-6"
    >
      <RadioTower aria-hidden="true" className="size-4 shrink-0" />
      <p role="status" className="min-w-0 flex-1">
        Live updates paused — reconnecting… New alerts will appear once the connection is back.
      </p>
      {retryIn !== null && <span className="font-mono text-xs whitespace-nowrap">retrying in {retryIn}s</span>}
    </div>
  )
}
