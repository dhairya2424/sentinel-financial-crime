import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { socket } from '@/ws/socket'
import { FakeWebSocket } from './ws'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, 'ResizeObserver', { writable: true, value: ResizeObserverStub })

// jsdom does no layout, so it has no scrollIntoView; the inbox calls it to keep the keyboard cursor in view.
Element.prototype.scrollIntoView = () => undefined

// Tests never open real sockets; FakeWebSocket lets a test open one and push channel messages.
Object.defineProperty(globalThis, 'WebSocket', { writable: true, value: FakeWebSocket })

afterEach(() => {
  cleanup()
  socket.stop()
  FakeWebSocket.instances = []
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
