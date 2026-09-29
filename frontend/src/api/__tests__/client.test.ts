import { beforeEach, describe, expect, it, vi } from 'vitest'
import { json, mockApi } from '@/test/fetch'
import { useAuth } from '@/store/auth'
import { api, ApiError, NetworkError } from '../client'

const user = { id: 'usr_1', email: 'investigator@demo.dev', role: 'investigator', tenant_id: 'tenant_demo', full_name: 'Ishan' }

beforeEach(() => {
  useAuth.setState({ user: null, accessToken: 'old-access', refreshToken: 'refresh-1', signOutReason: null })
})

describe('api client', () => {
  it('attaches the bearer token', async () => {
    const { fetchMock } = mockApi({ 'GET /v1/auth/me': () => json(user) })
    await api('/v1/auth/me')
    const init = fetchMock.mock.calls[0]?.[1]
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer old-access')
  })

  it('refreshes once on 401, stores the new token and retries', async () => {
    let meCalls = 0
    const { calls } = mockApi({
      'GET /v1/auth/me': (init) => {
        meCalls += 1
        const auth = (init?.headers as Record<string, string>).Authorization
        return auth === 'Bearer new-access' ? json(user) : json({ detail: 'expired', code: 'unauthorized' }, 401)
      },
      'POST /v1/auth/refresh': () => json({ access_token: 'new-access', token_type: 'bearer' }),
    })
    await expect(api('/v1/auth/me')).resolves.toEqual(user)
    expect(meCalls).toBe(2)
    expect(calls.filter((c) => c === 'POST /v1/auth/refresh')).toHaveLength(1)
    expect(useAuth.getState().accessToken).toBe('new-access')
  })

  it('clears the session when refresh fails, which sends the guard to /login', async () => {
    mockApi({
      'GET /v1/auth/me': () => json({ detail: 'expired', code: 'unauthorized' }, 401),
      'POST /v1/auth/refresh': () => json({ detail: 'invalid', code: 'unauthorized' }, 401),
    })
    await expect(api('/v1/auth/me')).rejects.toBeInstanceOf(ApiError)
    expect(useAuth.getState().accessToken).toBeNull()
    expect(useAuth.getState().signOutReason).toBe('expired')
  })

  it('turns validation errors into a readable message', async () => {
    mockApi({
      'POST /v1/users': () =>
        json(
          { detail: [{ loc: ['body', 'password'], msg: 'Value error, password too short', type: 'value_error' }], code: 'validation_error' },
          422,
        ),
    })
    await expect(api('/v1/users', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 422,
      code: 'validation_error',
      message: 'password too short',
    })
  })

  it('reports an unreachable API as a NetworkError', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(api('/v1/ops/health', { auth: false })).rejects.toBeInstanceOf(NetworkError)
  })
})
