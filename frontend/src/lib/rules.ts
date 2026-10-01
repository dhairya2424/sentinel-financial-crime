import type { RuleParamValue } from '@/api/types'

/** What each rule setting means, in an investigator's words (docs/02 §4, docs/09 §4). */
export const PARAM_META: Record<string, { label: string; hint: string; unit?: string }> = {
  window_hours: { label: 'Window', hint: 'How far around each event the rule looks.', unit: 'h' },
  min_cycle_amount: { label: 'Smallest loop total', hint: 'A loop counts only when this much money goes round it.', unit: '₹' },
  min_length: { label: 'Fewest accounts', hint: 'Shortest loop the rule reports.' },
  max_length: { label: 'Most accounts', hint: 'Longest loop the rule searches for.' },
  history_min: { label: 'History needed', hint: 'Transfers an account needs before its amount is compared with its past.' },
  reporting_threshold: { label: 'Reporting limit', hint: 'The limit people try to stay under.', unit: '₹' },
  band_floor_ratio: { label: 'Just under starts at', hint: 'Share of the limit where a payment counts as just under it.', unit: '×' },
  min_in_band: { label: 'Just-under payments', hint: 'How many just-under payments start a structuring alert.' },
  total_multiple: { label: 'Total needed', hint: 'The just-under payments must add up to this many times the limit.', unit: '×' },
  baseline_multiple: { label: 'Burst size', hint: 'Payments in the window compared with the customer’s usual count.', unit: '×' },
  revocation_window_hours: { label: 'Recently revoked', hint: 'Access removed this recently still counts as a mismatch.', unit: 'h' },
  business_hours: { label: 'Business hours', hint: 'Actions outside these hours add the off-hours factor.' },
  correlation_window_hours: { label: 'Edit to money', hint: 'Longest gap between a profile edit and the money movement it enabled.', unit: 'h' },
  flow_amount_ratio: { label: 'Flow counts at', hint: 'Share of the reporting limit that makes a transfer a flow.', unit: '×' },
  ratio_trigger: { label: 'Starts at', hint: 'Transfer rate, against the account’s usual rate, that starts the signal.', unit: '×' },
  full_at_ratio: { label: 'Full points at', hint: 'Rate that earns the signal its full points.', unit: '×' },
  cap: { label: 'Adds at most', hint: 'The most this signal adds to an alert’s score, as a share of 100.', unit: '×' },
  standalone_min_score: { label: 'Own alert at', hint: 'Score the supporting signals need to raise an alert by themselves.' },
  start: { label: 'Quiet hours start', hint: 'Employee actions from this time count as off-hours.' },
  end: { label: 'Quiet hours end', hint: 'Off-hours end at this time.' },
  idle_days: { label: 'Idle for', hint: 'Days without activity before an account counts as dormant.', unit: 'days' },
  amount_ratio: { label: 'Counts from', hint: 'Share of the reporting limit a reactivating transfer must reach.', unit: '×' },
  allowed_roles: { label: 'Roles allowed per action', hint: 'Which bank roles may perform each sensitive action.' },
  action_sensitivity: { label: 'Action sensitivity', hint: 'How much each action type weighs in the score.' },
  edit_actions: { label: 'Profile edits', hint: 'Actions that count as editing a customer.' },
  amount_trigger_actions: { label: 'Edits that move money', hint: 'Edits that make a later transfer suspicious.' },
}

export const paramLabel = (key: string) => PARAM_META[key]?.label ?? key.replace(/_/g, ' ')

export type ParamKind = 'int' | 'float' | 'time' | 'fixed'
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** How a setting is edited: whole numbers, decimals and HH:MM times inline; lists and maps are shown, not edited here. */
export function paramKind(value: RuleParamValue): ParamKind {
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float'
  if (typeof value === 'string' && TIME.test(value)) return 'time'
  return 'fixed'
}

/** A setting's draft text read back as a value, or an error a person can act on. `kind` is the setting's kind. */
export function parseParam(kind: ParamKind, text: string): { value?: number | string; error?: string } {
  const t = text.trim().replace(/,/g, '')
  if (kind === 'time') return TIME.test(t) ? { value: t } : { error: 'Use HH:MM, 24-hour' }
  if (t === '' || Number.isNaN(Number(t))) return { error: 'Enter a number' }
  const n = Number(t)
  if (n < 0) return { error: 'Cannot be negative' }
  if (kind === 'int' && !Number.isInteger(n)) return { error: 'Whole numbers only' }
  return { value: n }
}

/** The settings edited elsewhere, as one readable line: "tx.approve → teller, manager", "09:00–19:00". */
export function describeFixed(value: RuleParamValue): string {
  if (Array.isArray(value)) {
    const times = value.length === 2 && value.every((v) => TIME.test(v))
    return times ? `${String(value[0])}–${String(value[1])}` : value.join(', ')
  }
  if (typeof value === 'object')
    return Object.entries(value)
      .map(([k, v]) => `${k} → ${Array.isArray(v) ? v.map(String).join(', ') : String(v)}`)
      .join(' · ')
  return String(value)
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * Move weight across the divider after factor `i`: factor i gains `delta` and factor i+1 loses it, both clamped at
 * zero, so the total never changes. Values keep three decimals, the precision the API checks the sum at.
 */
export function moveWeight(weights: readonly number[], i: number, delta: number): number[] {
  const out = [...weights]
  const a = out[i]
  const b = out[i + 1]
  if (a === undefined || b === undefined) return out
  const d = Math.max(-a, Math.min(b, delta))
  out[i] = round3(a + d)
  out[i + 1] = round3(b - d)
  return out
}

export const weightSum = (weights: readonly number[]) => round3(weights.reduce((s, w) => s + w, 0))

export const fmtWeight = (w: number) => w.toFixed(3)

/** A setting's value as people read it: "72 h", "₹5,00,000", "0.8×", "teller, manager". */
export function fmtParam(key: string, value: RuleParamValue): string {
  if (typeof value === 'number') {
    const unit = PARAM_META[key]?.unit
    if (unit === '₹') return `₹${value.toLocaleString('en-IN')}`
    if (unit === '×') return `${String(value)}×`
    if (unit) return `${String(value)} ${unit}`
    return String(value)
  }
  return describeFixed(value)
}
