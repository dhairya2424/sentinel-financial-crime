import { Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { useRef, useState, type SubmitEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { login } from '@/api/auth'
import { ApiError, NetworkError } from '@/api/client'
import { ConnectionBanner } from '@/components/ConnectionBanner'
import { Logo } from '@/components/Logo'
import type { GuardState } from '@/components/RequireAuth'
import { StatusStrip } from '@/components/StatusStrip'
import { apiHost } from '@/lib/format'
import { useAuth } from '@/store/auth'

const DEMO_ACCOUNTS = [
  { role: 'Investigator', email: 'investigator@demo.dev' },
  { role: 'Manager', email: 'manager@demo.dev' },
  { role: 'Admin', email: 'admin@demo.dev' },
  { role: 'Viewer', email: 'viewer@demo.dev' },
] as const
const DEMO_PASSWORD = 'Demo!23456'

const fieldClass =
  'h-10 w-full rounded-md border border-line-strong bg-panel px-3 text-sm text-fg transition-colors duration-150 placeholder:text-fg-subtle hover:border-fg-subtle focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 aria-invalid:border-danger'

function describeError(err: unknown): string {
  if (err instanceof NetworkError) return `Can't reach the Sentinel API at ${apiHost}. Start the backend, then try again.`
  if (err instanceof ApiError) {
    if (err.status === 401) return "That email, password and tenant don't match an active account."
    return err.message
  }
  return 'Sign-in failed for an unexpected reason. Try again.'
}

export function Login() {
  const token = useAuth((s) => s.accessToken)
  const signOutReason = useAuth((s) => s.signOutReason)
  const setAuth = useAuth((s) => s.setAuth)
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as GuardState | null)?.from

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tenantId, setTenantId] = useState('tenant_demo')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitRef = useRef<HTMLButtonElement>(null)

  if (token) return <Navigate to={from ?? '/'} replace />

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const response = await login({ email: email.trim(), password, tenant_id: tenantId.trim() })
      setAuth(response)
      void navigate(from && from !== '/login' ? from : '/', { replace: true })
    } catch (err) {
      setError(describeError(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <ConnectionBanner />
      <main className="grid flex-1 place-items-center px-4 py-12">
        <div className="flex w-full max-w-[380px] flex-col gap-7">
          <Logo large />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Sign in</h1>
            <p className="text-fg-muted">Employees, access rights, customers and transactions, investigated in one place.</p>
          </div>

          {signOutReason === 'expired' && !error && (
            <p role="status" className="rounded-md border border-line-strong bg-panel px-3 py-2 text-[13px] text-fg-muted">
              Your session ended. Sign in again to continue.
            </p>
          )}

          <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-[13px] font-medium text-fg">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => { setEmail(e.target.value); }}
                aria-invalid={error ? true : undefined}
                className={fieldClass}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-[13px] font-medium text-fg">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); }}
                  aria-invalid={error ? true : undefined}
                  className={`${fieldClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => { setShowPassword((v) => !v); }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-fg-subtle transition-colors duration-150 hover:bg-raised hover:text-fg"
                >
                  {showPassword ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tenant" className="text-[13px] font-medium text-fg">
                Tenant
              </label>
              <input
                id="tenant"
                type="text"
                required
                autoComplete="organization"
                spellCheck={false}
                value={tenantId}
                onChange={(e) => { setTenantId(e.target.value); }}
                className={`${fieldClass} font-mono text-[13px]`}
              />
            </div>

            {error && (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            )}

            <button
              ref={submitRef}
              type="submit"
              disabled={submitting}
              className="mt-1 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent-fill text-sm font-semibold text-on-accent transition-colors duration-150 hover:bg-accent-fill-hover disabled:cursor-wait disabled:opacity-70"
            >
              {submitting && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
              {submitting ? 'Signing in' : 'Sign in'}
            </button>
          </form>

          {import.meta.env.DEV && (
            <section aria-labelledby="demo-heading" className="flex flex-col gap-2 border-t border-line pt-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="demo-heading" className="text-[13px] font-semibold text-fg">
                  Demo accounts
                </h2>
                <span className="font-mono text-xs text-fg-subtle">password {DEMO_PASSWORD}</span>
              </div>
              <ul className="flex flex-col">
                {DEMO_ACCOUNTS.map((account) => (
                  <li key={account.email}>
                    <button
                      type="button"
                      onClick={() => {
                        setEmail(account.email)
                        setPassword(DEMO_PASSWORD)
                        setTenantId('tenant_demo')
                        setError(null)
                        submitRef.current?.focus()
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150 hover:bg-raised"
                    >
                      <span className="text-fg">{account.role}</span>
                      <span className="font-mono text-xs text-fg-muted">{account.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
      <StatusStrip />
    </div>
  )
}
