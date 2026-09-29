import { create } from 'zustand'
import type { Health } from '@/api/types'

export type Connection = 'checking' | 'connected' | 'degraded' | 'unreachable'

interface HealthState {
  connection: Connection
  services: Health | null
  checkedAt: number | null
  nextCheckAt: number | null
  recheck: () => void
}

export const useHealth = create<HealthState>()(() => ({
  connection: 'checking',
  services: null,
  checkedAt: null,
  nextCheckAt: null,
  recheck: () => undefined,
}))

export function isStale(connection: Connection): boolean {
  return connection === 'degraded' || connection === 'unreachable'
}

export function downServices(services: Health | null): string[] {
  if (!services) return []
  const down: string[] = []
  if (services.db !== 'ok') down.push('the database')
  if (services.redis !== 'ok') down.push('Redis')
  return down
}
