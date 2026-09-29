import { useShallow } from 'zustand/react/shallow'
import type { ServiceStatus } from '@/api/types'
import { useNow } from '@/hooks/useNow'
import { ago } from '@/lib/format'
import { isStale, useHealth, type Connection } from '@/store/health'

const LABEL: Record<Connection, string> = {
  checking: 'Checking connection',
  connected: 'Connected',
  degraded: 'Backend degraded',
  unreachable: 'API unreachable',
}

function LiveDot({ connection, checkedAt }: { connection: Connection; checkedAt: number | null }) {
  const tone = connection === 'connected' ? 'bg-ok' : connection === 'checking' ? 'bg-fg-subtle' : 'bg-warn-fg'
  return (
    <span aria-hidden="true" className="relative flex size-2">
      {connection === 'connected' && (
        <span key={checkedAt} className={`absolute inset-0 rounded-full opacity-0 ${tone} motion-safe:live-ping`} />
      )}
      <span className={`relative size-2 rounded-full ${tone}`} />
    </span>
  )
}

function Service({ label, status }: { label: string; status: ServiceStatus | 'unknown' }) {
  const text = status === 'ok' ? 'ok' : status === 'fail' ? 'down' : 'n/a'
  const tone = status === 'ok' ? 'text-ok' : status === 'fail' ? 'font-semibold underline decoration-dotted underline-offset-2' : 'opacity-70'
  return (
    <span className="whitespace-nowrap">
      {label} <span className={`font-medium ${tone}`}>{text}</span>
    </span>
  )
}

export function StatusStrip() {
  const { connection, services, checkedAt, nextCheckAt } = useHealth(
    useShallow((s) => ({
      connection: s.connection,
      services: s.services,
      checkedAt: s.checkedAt,
      nextCheckAt: s.nextCheckAt,
    })),
  )
  const now = useNow(1000)
  const stale = isStale(connection)
  const apiStatus: ServiceStatus | 'unknown' =
    connection === 'unreachable' ? 'fail' : connection === 'checking' ? 'unknown' : 'ok'
  const retryIn = nextCheckAt ? Math.max(0, Math.ceil((nextCheckAt - now) / 1000)) : null

  return (
    <footer
      data-testid="status-strip"
      data-state={connection}
      className={`flex h-7 shrink-0 items-center gap-4 overflow-hidden border-t px-4 font-mono text-[11.5px] transition-colors duration-200 ease-out ${
        stale ? 'border-warn-line bg-warn-bg text-warn-fg' : 'border-line bg-panel text-fg-muted'
      }`}
    >
      <span className="flex items-center gap-2 whitespace-nowrap">
        <LiveDot connection={connection} checkedAt={checkedAt} />
        <span role="status" aria-live="polite">
          {LABEL[connection]}
        </span>
      </span>
      <Service label="API" status={apiStatus} />
      {connection !== 'unreachable' && (
        <>
          <Service label="DB" status={services?.db ?? 'unknown'} />
          <Service label="Redis" status={services?.redis ?? 'unknown'} />
        </>
      )}
      <span className="hidden whitespace-nowrap sm:inline">
        {stale && retryIn !== null ? `retry in ${retryIn}s` : checkedAt ? `checked ${ago(now - checkedAt)}` : ''}
      </span>
      <span className="ml-auto hidden whitespace-nowrap md:inline">Sentinel v{__APP_VERSION__}</span>
    </footer>
  )
}
