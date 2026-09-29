import { useEffect } from 'react'
import { fetchHealth } from '@/api/ops'
import { useHealth } from '@/store/health'

const HEALTHY_INTERVAL_MS = 15_000
const RETRY_INTERVAL_MS = 5_000

export function HealthMonitor() {
  useEffect(() => {
    let timer: number | undefined
    let controller: AbortController | null = null
    let stopped = false

    const check = async () => {
      window.clearTimeout(timer)
      controller?.abort()
      const current = new AbortController()
      controller = current
      try {
        const services = await fetchHealth(current.signal)
        const healthy = services.db === 'ok' && services.redis === 'ok'
        useHealth.setState({ connection: healthy ? 'connected' : 'degraded', services, checkedAt: Date.now() })
      } catch {
        if (current.signal.aborted) return
        useHealth.setState({ connection: 'unreachable', services: null, checkedAt: Date.now() })
      }
      if (stopped) return
      const delay = useHealth.getState().connection === 'connected' ? HEALTHY_INTERVAL_MS : RETRY_INTERVAL_MS
      useHealth.setState({ nextCheckAt: Date.now() + delay })
      timer = window.setTimeout(() => void check(), delay)
    }

    const wake = () => void check()
    useHealth.setState({ recheck: wake })
    wake()
    window.addEventListener('focus', wake)
    window.addEventListener('online', wake)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      controller?.abort()
      window.removeEventListener('focus', wake)
      window.removeEventListener('online', wake)
    }
  }, [])

  return null
}
