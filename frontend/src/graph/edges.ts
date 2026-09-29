import type { GraphEdgeType } from '@/api/types'

export const EDGE_TYPES: readonly GraphEdgeType[] = ['TRANSFER', 'ACCOUNT_HOLDER', 'EMPLOYEE_ACCESS', 'PROFILE_CHANGE', 'EMPLOYEE_ACTION']

export interface EdgeStyle {
  className: string
  stroke: string
  width: number
  dash?: string
  arrow: boolean
  description: string
}

export const EDGE_STYLES: Record<GraphEdgeType, EdgeStyle> = {
  TRANSFER: { className: 'edge-transfer', stroke: 'var(--fg-muted)', width: 1.75, arrow: true, description: 'Money moved between accounts' },
  ACCOUNT_HOLDER: {
    className: 'edge-account-holder',
    stroke: 'var(--line-strong)',
    width: 1,
    dash: '5 4',
    arrow: false,
    description: 'Customer holds the account',
  },
  EMPLOYEE_ACCESS: {
    className: 'edge-employee-access',
    stroke: 'var(--accent)',
    width: 1.25,
    dash: '1.5 3.5',
    arrow: false,
    description: 'Employee holds and used an entitlement here',
  },
  PROFILE_CHANGE: {
    className: 'edge-profile-change',
    stroke: 'var(--change)',
    width: 1.75,
    arrow: false,
    description: 'Employee changed a profile, beneficiary or limit',
  },
  EMPLOYEE_ACTION: {
    className: 'edge-employee-action',
    stroke: 'var(--ev)',
    width: 1.5,
    arrow: false,
    description: 'Employee acted on a transaction',
  },
}

export const CYCLE_STYLE: EdgeStyle = {
  className: 'edge-cycle',
  stroke: 'var(--cycle)',
  width: 3.25,
  arrow: true,
  description: 'Leg of a detected loop',
}

export function edgeStyle(type: GraphEdgeType, cycle = false): EdgeStyle {
  return cycle ? CYCLE_STYLE : EDGE_STYLES[type]
}

export function bundleWidth(style: EdgeStyle, count: number): number {
  const cap = style.className === 'edge-transfer' ? 4 : 2.5
  return Math.min(style.width + (count > 1 ? Math.log2(count) * 0.5 : 0), cap)
}
