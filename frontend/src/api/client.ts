import { useAuth } from '@/store/auth'
import type { ApiErrorBody, RefreshResponse } from './types'

export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export class NetworkError extends Error {
  constructor() {
    super(`Can't reach the Sentinel API at ${API_URL}.`)
    this.name = 'NetworkError'
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  method?: Method
  body?: unknown
  auth?: boolean
  signal?: AbortSignal
}

let refreshInFlight: Promise<boolean> | null = null

function refreshAccessToken(): Promise<boolean> {
  const { refreshToken } = useAuth.getState()
  if (!refreshToken) return Promise.resolve(false)
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!res.ok) return false
      const data = (await res.json()) as RefreshResponse
      useAuth.getState().setAccessToken(data.access_token)
      return true
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody
  try {
    body = (await res.json()) as ApiErrorBody
  } catch {
    body = {}
  }
  const detail = body.detail
  const message =
    typeof detail === 'string'
      ? detail
      : Array.isArray(detail) && detail[0]
        ? detail[0].msg.replace(/^Value error, /, '')
        : res.statusText || `Request failed with status ${res.status}`
  return new ApiError(res.status, body.code ?? 'error', message)
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const token = useAuth.getState().accessToken
    if (auth && token) headers.Authorization = `Bearer ${token}`
    try {
      return await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      throw new NetworkError()
    }
  }

  let res = await send()

  if (res.status === 401 && auth) {
    if (await refreshAccessToken()) res = await send()
    if (res.status === 401) {
      useAuth.getState().clear('expired')
      throw new ApiError(401, 'unauthorized', 'Your session has ended. Sign in again.')
    }
  }

  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
