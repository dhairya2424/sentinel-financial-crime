import { ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import { useLocation } from 'react-router'
import type { GuardState } from '@/components/RequireAuth'
import { EmptyState } from '@/components/EmptyState'
import { RiskBadge } from '@/components/RiskBadge'
import { ROLE_CAPABILITIES, ROLE_LABEL } from '@/lib/format'
import { BAND_ORDER, RISK_BANDS } from '@/lib/risk'
import { SCREENS } from '@/lib/screens'
import { useAuth } from '@/store/auth'
import { Page } from './Placeholder'

export function Dashboard() {
  const user = useAuth((s) => s.user)
  const location = useLocation()
  const denied = (location.state as GuardState | null)?.denied
  const [showDenied, setShowDenied] = useState(Boolean(denied))

  return (
    <Page
      title={SCREENS.dashboard.title}
      meta={
        user && (
          <span className="text-[13px] text-fg-muted">
            {user.full_name} · <span className="font-mono">{user.tenant_id}</span>
          </span>
        )
      }
    >
      {denied && showDenied && user && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-card border border-line-strong bg-panel px-4 py-3 text-[13px]"
        >
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warn-fg" />
          <p className="flex-1 text-fg">
            {denied} needs the admin role. You're signed in as {ROLE_LABEL[user.role].toLowerCase()}, so you were
            brought back here.
          </p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => { setShowDenied(false); }}
            className="grid size-6 place-items-center rounded text-fg-muted hover:bg-raised hover:text-fg"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="grid min-h-72 place-items-center rounded-card border border-dashed border-line-strong bg-panel">
          <EmptyState
            icon={SCREENS.dashboard.Icon}
            title={`Arrives in Phase ${SCREENS.dashboard.phase}`}
            description={SCREENS.dashboard.summary}
          />
        </section>

        <aside className="flex flex-col gap-6">
          {user && (
            <section aria-labelledby="access-heading" className="flex flex-col gap-2">
              <h2 id="access-heading" className="text-[13px] font-semibold text-fg">
                Your access
              </h2>
              <p className="text-fg-muted">
                <span className="font-medium text-fg">{ROLE_LABEL[user.role]}.</span> {ROLE_CAPABILITIES[user.role]}
              </p>
            </section>
          )}
          <section aria-labelledby="bands-heading" className="flex flex-col gap-3 border-t border-line pt-5">
            <div className="flex flex-col gap-1">
              <h2 id="bands-heading" className="text-[13px] font-semibold text-fg">
                Risk bands
              </h2>
              <p className="text-fg-muted">Every alert carries a band built from weighted factors, never a bare score.</p>
            </div>
            <dl className="flex flex-col gap-2">
              {BAND_ORDER.map((band) => (
                <div key={band} className="flex items-center justify-between gap-3">
                  <dt>
                    <RiskBadge band={band} />
                  </dt>
                  <dd className="font-mono text-xs text-fg-muted">score {RISK_BANDS[band].range}</dd>
                </div>
              ))}
            </dl>
          </section>
        </aside>
      </div>
    </Page>
  )
}
