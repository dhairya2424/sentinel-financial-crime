import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeWebSocket } from '@/test/ws'
import { backoffDelay, RESYNC_EVENT, socket, useSocketStatus } from '../socket'

describe('socket manager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    socket.stop()
    vi.useRealTimers()
  })

  it('backs off from about 1s to at most 30s, with jitter', () => {
    expect(backoffDelay(0, () => 0)).toBe(500)
    expect(backoffDelay(0, () => 1)).toBe(1000)
    expect(backoffDelay(3, () => 1)).toBe(8000)
    expect(backoffDelay(10, () => 1)).toBe(30000)
    expect(backoffDelay(10, () => 0)).toBe(15000)
  })

  it('resubscribes every channel after a reconnect and tells views to refetch', () => {
    const received: unknown[] = []
    const off = socket.subscribe('alerts:tenant_demo', (m) => received.push(m))
    socket.start('token-1', () => Promise.resolve(null))
    const first = FakeWebSocket.latest()
    first?.open()
    expect(useSocketStatus.getState().state).toBe('connected')
    expect(first?.sent).toContainEqual({ op: 'subscribe', channels: ['alerts:tenant_demo'] })

    const resync = vi.fn()
    window.addEventListener(RESYNC_EVENT, resync)
    first?.drop()
    expect(useSocketStatus.getState().state).toBe('reconnecting')
    vi.advanceTimersByTime(1000)
    const second = FakeWebSocket.latest()
    expect(second).not.toBe(first)
    second?.open()
    expect(second?.sent).toContainEqual({ op: 'subscribe', channels: ['alerts:tenant_demo'] })
    expect(resync).toHaveBeenCalledTimes(1)

    second?.receive({ channel: 'alerts:tenant_demo', type: 'alert.created', data: { id: 'a1' } })
    second?.receive({ channel: 'alerts:other', type: 'alert.created', data: { id: 'a2' } })
    expect(received).toEqual([{ channel: 'alerts:tenant_demo', type: 'alert.created', data: { id: 'a1' } }])
    off()
    expect(second?.sent).toContainEqual({ op: 'unsubscribe', channels: ['alerts:tenant_demo'] })
    window.removeEventListener(RESYNC_EVENT, resync)
  })

  it('a 4401 close refreshes the session and reconnects with the new token', async () => {
    const refresh = vi.fn(() => Promise.resolve('token-2'))
    socket.start('token-1', refresh)
    FakeWebSocket.latest()?.drop(4401)
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeWebSocket.latest()?.url).toContain('token=token-2')
  })

  it('signing out stops the socket and marks it down', () => {
    socket.start('token-1', () => Promise.resolve(null))
    FakeWebSocket.latest()?.open()
    socket.stop()
    expect(useSocketStatus.getState().state).toBe('down')
    expect(FakeWebSocket.latest()?.readyState).toBe(FakeWebSocket.CLOSED)
  })
})
