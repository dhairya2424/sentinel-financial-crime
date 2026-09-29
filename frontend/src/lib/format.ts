import { API_URL } from '@/api/client'
import type { Role } from '@/api/types'

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Manager',
  investigator: 'Investigator',
  viewer: 'Viewer',
}

export const ROLE_CAPABILITIES: Record<Role, string> = {
  viewer: 'Read alerts, cases, the graph and timelines. Changes are turned off for your role.',
  investigator: 'Acknowledge alerts, open cases, add notes, export evidence and send ingest batches.',
  manager: 'Acknowledge alerts, open and assign cases, add notes and export evidence.',
  admin: 'Full access, including detection rules, batch replay and user management.',
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  return `${Math.round(s / 60)}m ago`
}

export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
  if (letters.length === 2 && letters[0] === letters[1]) {
    const first = name.trim()
    return first.charAt(0).toUpperCase() + first.charAt(1).toLowerCase()
  }
  return letters || '?'
}

export const apiHost = (() => {
  try {
    return new URL(API_URL).host
  } catch {
    return API_URL
  }
})()

export type EntityKind = 'customer' | 'account' | 'employee' | 'transaction'
export type ChipDestination = 'timeline' | 'graph' | 'alerts'

export const DESTINATION_LABEL: Record<ChipDestination, string> = {
  timeline: 'Open timeline',
  graph: 'Open in graph',
  alerts: 'Open alerts',
}

export function entityHref(kind: EntityKind, id: string, to: ChipDestination): string | null {
  const encoded = encodeURIComponent(id)
  if (to === 'graph') return `/graph?node=${encoded}`
  if (to === 'alerts') return `/alerts?entity=${encoded}`
  return kind === 'transaction' ? null : `/timeline/${kind}/${encoded}`
}

export function shortId(id: string): string {
  const cut = id.indexOf('_')
  if (cut < 0 || id.length <= cut + 9) return id
  return `${id.slice(0, cut + 1)}…${id.slice(-4)}`
}
