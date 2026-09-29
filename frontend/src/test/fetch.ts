import { vi } from 'vitest'

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function mockApi(handlers: Record<string, Handler>) {
  const calls: string[] = []
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    const key = `${init?.method ?? 'GET'} ${url.pathname}`
    calls.push(key)
    const handler = handlers[key]
    if (handler) return Promise.resolve(handler(init))
    if (key === 'GET /v1/ops/health') return Promise.resolve(json({ db: 'ok', redis: 'ok' }))
    return Promise.resolve(json({ detail: 'not mocked', code: 'not_found' }, 404))
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}
