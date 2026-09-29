import { ArrowLeftRight, BadgeCheck, LogIn, UserCog, type LucideIcon } from 'lucide-react'
import type { TimelineCategory, TimelineEntityType, TimelineItem } from '@/api/types'
import type { EntityKind } from '@/lib/format'

export const CATEGORY_META: Record<TimelineCategory, { label: string; Icon: LucideIcon }> = {
  transaction: { label: 'Transaction', Icon: ArrowLeftRight },
  profile_change: { label: 'Profile change', Icon: UserCog },
  access_login: { label: 'Access/login', Icon: LogIn },
  approval: { label: 'Approval', Icon: BadgeCheck },
}

export const HOUR = 3_600_000
export const DAY = 24 * HOUR
export const CORRELATION_WINDOW_MS = 48 * HOUR
const HOURLY_MAX_SPAN = 3 * DAY

export type Lane = 'left' | 'right'
export type BinUnit = 'hour' | 'day'

export interface TimeRange {
  from: number
  to: number
}

export interface DensityBin {
  index: number
  start: number
  end: number
  left: number
  right: number
}

export function laneLabels(type: TimelineEntityType): Record<Lane, string> {
  return type === 'employee' ? { left: 'Access', right: 'Actions' } : { left: 'Money', right: 'People' }
}

export function laneOf(item: TimelineItem, type: TimelineEntityType): Lane {
  if (type === 'employee') return item.category === 'access_login' ? 'left' : 'right'
  return item.event_kind === 'transaction' ? 'left' : 'right'
}

export const tsOf = (item: TimelineItem): number => new Date(item.ts).getTime()

export function sortNewestFirst(items: readonly TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => tsOf(b) - tsOf(a) || (a.ref_id < b.ref_id ? 1 : -1))
}

export function inRange(item: TimelineItem, range: TimeRange | null): boolean {
  if (!range) return true
  const t = tsOf(item)
  return t >= range.from && t < range.to
}

function floorTo(t: number, unit: BinUnit): number {
  const d = new Date(t)
  return unit === 'hour'
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime()
    : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function nextBoundary(t: number, unit: BinUnit): number {
  const d = new Date(t)
  return unit === 'hour'
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime()
    : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

export function densityBins(
  items: readonly TimelineItem[],
  type: TimelineEntityType,
  span: TimeRange | null,
): { bins: DensityBin[]; unit: BinUnit } {
  const times = items.map(tsOf)
  if (!span && times.length === 0) return { bins: [], unit: 'day' }
  const from = span ? span.from : Math.min(...times)
  const to = span ? span.to : Math.max(...times) + 1
  const unit: BinUnit = to - from <= HOURLY_MAX_SPAN ? 'hour' : 'day'
  const bins: DensityBin[] = []
  for (let start = floorTo(from, unit); start < to; start = nextBoundary(start, unit)) {
    bins.push({ index: bins.length, start, end: nextBoundary(start, unit), left: 0, right: 0 })
  }
  for (const item of items) {
    const t = tsOf(item)
    const bin = bins.find((b) => t >= b.start && t < b.end)
    if (!bin) continue
    if (laneOf(item, type) === 'left') bin.left += 1
    else bin.right -= 1
  }
  return { bins, unit }
}

const inrFormat = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function formatInr(value: string | number): string {
  const n = Number(value)
  return Number.isFinite(n) ? inrFormat.format(n) : String(value)
}

export function signedAmount(item: TimelineItem): string | null {
  if (item.value === null) return null
  const amount = formatInr(item.value)
  if (item.direction === 'out') return `−${amount}`
  if (item.direction === 'in') return `+${amount}`
  return amount
}

export const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
export const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
export const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
export const hourLabel = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', hour12: false })
export const fullFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
})

export function dayKey(t: number): number {
  return floorTo(t, 'day')
}

export function delayLabel(from: number, to: number): string {
  const hours = (to - from) / HOUR
  if (hours < 1) return `+${Math.max(1, Math.round(hours * 60))}m after`
  return `+${Math.round(hours)}h after`
}

export function entityTypeOf(id: string): TimelineEntityType | null {
  if (id.startsWith('cust_')) return 'customer'
  if (id.startsWith('acct_')) return 'account'
  if (id.startsWith('emp_')) return 'employee'
  return null
}

export function targetKind(target: string | null): EntityKind | null {
  if (!target) return null
  return entityTypeOf(target) ?? (target.startsWith('tx_') ? 'transaction' : null)
}
