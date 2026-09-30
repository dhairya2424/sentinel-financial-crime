import { useEffect, useLayoutEffect, useRef } from 'react'
import { fetchMe } from '@/api/auth'
import { useAuth } from '@/store/auth'
import { RESYNC_EVENT, socket, useSocketStatus } from './socket'

export { useSocketStatus } from './socket'

/** Keeps the app's single socket open while someone is signed in (mounted once, in AppShell). */
export function useSocketLifecycle(): void {
  const token = useAuth((s) => s.accessToken)
  useEffect(() => {
    if (!token) {
      socket.stop()
      return
    }
    // A 4401 means the access token expired; any authenticated call refreshes it, then the socket retries.
    const refresh = async () => {
      try {
        await fetchMe()
      } catch {
        return null
      }
      return useAuth.getState().accessToken
    }
    socket.start(token, refresh)
  }, [token])
  useEffect(
    () => () => {
      socket.stop()
    },
    [],
  )
}

/** Receive every message on one channel; the handler may change between renders without resubscribing. */
export function useChannel(channel: string | null, onMessage: (message: unknown) => void): void {
  const handler = useRef(onMessage)
  useLayoutEffect(() => {
    handler.current = onMessage
  })
  useEffect(() => {
    if (!channel) return
    return socket.subscribe(channel, (message) => {
      handler.current(message)
    })
  }, [channel])
}

/** Run when the socket comes back after a drop, so a view can refetch what it may have missed. */
export function useResync(onResync: () => void): void {
  const handler = useRef(onResync)
  useLayoutEffect(() => {
    handler.current = onResync
  })
  useEffect(() => {
    const listener = () => {
      handler.current()
    }
    window.addEventListener(RESYNC_EVENT, listener)
    return () => {
      window.removeEventListener(RESYNC_EVENT, listener)
    }
  }, [])
}

export const useLive = () => useSocketStatus((s) => s.state)
