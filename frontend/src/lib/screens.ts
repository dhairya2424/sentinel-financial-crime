import type { Role } from '@/api/types'
import {
  BriefcaseBusiness,
  DatabaseZap,
  History,
  LayoutDashboard,
  SlidersHorizontal,
  TriangleAlert,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'

export type Phase = 1 | 2 | 3 | 4 | 5

export interface Screen {
  title: string
  phase: Phase
  summary: string
  Icon: LucideIcon
}

export const SCREENS = {
  dashboard: {
    title: 'Dashboard',
    phase: 3,
    Icon: LayoutDashboard,
    summary: 'Open cases, critical alerts in the last 24 hours, false-positive rate and ingestion lag, updating live.',
  },
  alerts: {
    title: 'Alert Inbox',
    phase: 3,
    Icon: TriangleAlert,
    summary:
      'Explainable alerts for circular transfers, structuring and profile mismatches, each with its evidence panel, arriving live.',
  },
  alert: {
    title: 'Alert',
    phase: 3,
    Icon: TriangleAlert,
    summary: 'The explanation, weighted risk factors and frozen evidence records behind this alert.',
  },
  cases: {
    title: 'Case Manager',
    phase: 4,
    Icon: BriefcaseBusiness,
    summary: 'Group related alerts into cases, assign reviewers, keep notes and export a tamper-evident evidence bundle.',
  },
  case: {
    title: 'Case',
    phase: 4,
    Icon: BriefcaseBusiness,
    summary: 'Linked alerts, notes, the audit trail and JSON or HTML evidence export for this case.',
  },
  graph: {
    title: 'Graph Explorer',
    phase: 2,
    Icon: Waypoints,
    summary: 'Follow money between accounts and see which employees touched them, with circular flows highlighted.',
  },
  timeline: {
    title: 'Timeline',
    phase: 1,
    Icon: History,
    summary: 'Every transaction, profile change, login and approval for one entity, with the employee behind each change.',
  },
  add: {
    title: 'Add data',
    phase: 2,
    Icon: DatabaseZap,
    summary: 'Register customers, accounts and employees, then record what happened: transfers, actions, sessions and access rights.',
  },
  rules: {
    title: 'Admin / Rules',
    phase: 5,
    Icon: SlidersHorizontal,
    summary: 'Tune detection thresholds and factor weights. Every change is versioned and audited.',
  },
} satisfies Record<string, Screen>

export interface NavItem {
  to: string
  screen: Screen
  adminOnly?: boolean
  /** Only these roles see the item; the route enforces the same list. */
  roles?: readonly Role[]
}

export const DATA_ENTRY_ROLES: readonly Role[] = ['admin', 'investigator']

export const NAV: readonly NavItem[] = [
  { to: '/', screen: SCREENS.dashboard },
  { to: '/alerts', screen: SCREENS.alerts },
  { to: '/cases', screen: SCREENS.cases },
  { to: '/graph', screen: SCREENS.graph },
  { to: '/timeline', screen: SCREENS.timeline },
  { to: '/add', screen: SCREENS.add, roles: DATA_ENTRY_ROLES },
  { to: '/admin/rules', screen: SCREENS.rules, adminOnly: true },
]
