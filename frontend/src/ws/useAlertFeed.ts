import { getAlert } from '@/api/alerts'
import type { AlertMessage, AlertRow } from '@/api/types'
import { RISK_BANDS } from '@/lib/risk'
import { useAlerts } from '@/store/alerts'
import { useAuth } from '@/store/auth'
import { useToasts } from '@/store/toasts'
import { useChannel } from './useSocket'

function toRow(detail: AlertRow): AlertRow {
  const { id, rule_code, title, risk_band, risk_score, status, entity_ids, primary_entity, entities, amount_total, detected_at, occurrence_count } = detail
  return { id, rule_code, title, risk_band, risk_score, status, entity_ids, primary_entity, entities, amount_total, detected_at, occurrence_count }
}

function isAlertMessage(raw: unknown): raw is AlertMessage {
  if (typeof raw !== 'object' || raw === null) return false
  const { type, data } = raw as { type?: unknown; data?: unknown }
  return (type === 'alert.created' || type === 'alert.updated') && typeof data === 'object' && data !== null
}

/**
 * App-wide listener on this tenant's alert channel (mounted once, in AppShell). A new alert raises a toast
 * straight away, then its full row (with entity names) is fetched and prepended to the ledger. The alert
 * someone has open is never replaced: live arrival highlights, it does not steal focus.
 */
export function useAlertFeed(): void {
  const tenant = useAuth((s) => s.user?.tenant_id ?? null)
  useChannel(tenant ? `alerts:${tenant}` : null, (raw) => {
    if (!isAlertMessage(raw)) return
    const { data, type } = raw
    if (type === 'alert.created') {
      useToasts.getState().push({
        title: `New ${RISK_BANDS[data.risk_band].label.toLowerCase()} alert: ${data.title}`,
        band: data.risk_band,
        to: `/alerts/${encodeURIComponent(data.id)}`,
      })
    }
    void getAlert(data.id)
      .then((detail) => {
        const row = toRow(detail)
        const store = useAlerts.getState()
        if (type === 'alert.created' || !store.items.some((x) => x.id === row.id)) store.prependAlert(row)
        else store.replace(row)
      })
      .catch(() => undefined)
  })
}
