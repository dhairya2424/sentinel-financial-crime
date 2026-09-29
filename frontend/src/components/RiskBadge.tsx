import type { RiskBand } from '@/api/types'
import { RISK_BANDS } from '@/lib/risk'

interface RiskBadgeProps {
  band: RiskBand
  className?: string
}

export function RiskBadge({ band, className = '' }: RiskBadgeProps) {
  const { label, Icon, className: tone } = RISK_BANDS[band]
  return (
    <span
      data-band={band}
      aria-label={`Risk: ${label}`}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone} ${className}`}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
      <span>{label}</span>
    </span>
  )
}
