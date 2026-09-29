import { CircleAlert, CircleCheck, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { RiskBand } from '@/api/types'

export interface BandMeta {
  label: string
  range: string
  Icon: LucideIcon
  className: string
}

export const RISK_BANDS: Record<RiskBand, BandMeta> = {
  low: { label: 'Low', range: '0–39', Icon: CircleCheck, className: 'text-band-low bg-band-low/10 ring-band-low/30' },
  medium: {
    label: 'Medium',
    range: '40–69',
    Icon: CircleAlert,
    className: 'text-band-medium bg-band-medium/10 ring-band-medium/35',
  },
  high: { label: 'High', range: '70–84', Icon: TriangleAlert, className: 'text-band-high bg-band-high/10 ring-band-high/35' },
  critical: {
    label: 'Critical',
    range: '85–100',
    Icon: OctagonAlert,
    className: 'text-band-critical bg-band-critical/10 ring-band-critical/35',
  },
}

export const BAND_ORDER: readonly RiskBand[] = ['low', 'medium', 'high', 'critical']
