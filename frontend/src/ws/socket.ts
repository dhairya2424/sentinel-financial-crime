import { create } from 'zustand'
import { API_URL } from '@/api/client'

/** docs/04 §6: connected, or trying again with backoff, or down because there is no session to connect with. */
export type SocketState = 'connected' | 'reconnecting' | 'down'

interface SocketStatus {
  state: SocketState
  /** When the socket last stopped being connected; the banner waits a moment before showing. */
  since: number
  retryAt: number | null
}

export const useSocketStatus = create<SocketStatus>(() => ({ state: 'down', since: Date.now(), retryAt: null }))

export const RESYNC_EVENT = 'ws.resync'
export const WS_URL = (import.meta.env.VITE_WS_URL ?? API_URL.replace(/^http/, 'ws')).replace(/\/+$/, '')

const MIN_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const CLOSE_UNAUTHORIZED = 4401

type Listener = (message: unknown) => void

export function backoffDelay(attempt: number, random = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** attempt)
  return Math.round(base / 2 + random() * (base / 2))
}

/** One shared connection for the whole app; views subscribe to channels and never own the socket. */
class SocketManager {
  private ws: WebSocket | null = null
  private token: string | null = null
  private listeners = new Map<string, Set<Listener>>()
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private everConnected = false
  private onUnauthorized: (() => Promise<string | null>) | null = null

  start(token: string, onUnauthorized: () => Promise<string | null>): void {
    this.onUnauthorized = onUnauthorized
    if (this.token === token && this.ws) return
    this.token = token
    this.open()
  }

  stop(): void {
    this.token = null
    clearTimeout(this.timer)
    this.everConnected = false
    this.attempt = 0
    const ws = this.ws
    this.ws = null
    ws?.close(1000, 'signed out')
    useSocketStatus.setState({ state: 'down', since: Date.now(), retryAt: null })
  }

  subscribe(channel: string, listener: Listener): () => void {
    let set = this.listeners.get(channel)
    if (!set) {
      set = new Set()
      this.listeners.set(channel, set)
      this.send({ op: 'subscribe', channels: [channel] })
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) {
        this.listeners.delete(channel)
        this.send({ op: 'unsubscribe', channels: [channel] })
      }
    }
  }

  private send(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  private open(): void {
    clearTimeout(this.timer)
    const previous = this.ws
    this.ws = null
    previous?.close(1000, 'replaced')
    if (!this.token) return
    if (useSocketStatus.getState().state === 'connected' || useSocketStatus.getState().state === 'down') {
      useSocketStatus.setState({ state: 'reconnecting', since: Date.now(), retryAt: null })
    }
    const ws = new WebSocket(`${WS_URL}/v1/ws?token=${encodeURIComponent(this.token)}`)
    this.ws = ws
    ws.onopen = () => {
      if (this.ws !== ws) return
      const resync = this.everConnected
      this.everConnected = true
      this.attempt = 0
      useSocketStatus.setState({ state: 'connected', retryAt: null })
      const channels = [...this.listeners.keys()]
      if (channels.length) this.send({ op: 'subscribe', channels })
      if (resync) window.dispatchEvent(new Event(RESYNC_EVENT))
    }
    ws.onmessage = (event: MessageEvent<string>) => {
      let message: { channel?: unknown }
      try {
        message = JSON.parse(event.data) as { channel?: unknown }
      } catch {
        return
      }
      if (typeof message.channel !== 'string') return
      this.listeners.get(message.channel)?.forEach((listener) => {
        listener(message)
      })
    }
    ws.onclose = (event: CloseEvent) => {
      if (this.ws !== ws || !this.token) return
      this.ws = null
      if (event.code === CLOSE_UNAUTHORIZED && this.onUnauthorized) {
        void this.onUnauthorized().then((fresh) => {
          if (fresh) this.token = fresh
          if (fresh) this.schedule()
          else this.stop()
        })
        return
      }
      this.schedule()
    }
  }

  private schedule(): void {
    const delay = backoffDelay(this.attempt)
    this.attempt += 1
    const now = Date.now()
    const current = useSocketStatus.getState()
    useSocketStatus.setState({ state: 'reconnecting', since: current.state === 'connected' ? now : current.since, retryAt: now + delay })
    this.timer = setTimeout(() => {
      this.open()
    }, delay)
  }
}

export const socket = new SocketManager()
