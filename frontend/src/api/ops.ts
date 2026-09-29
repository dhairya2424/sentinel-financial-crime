import { api } from './client'
import type { Health } from './types'

export function fetchHealth(signal?: AbortSignal): Promise<Health> {
  return api<Health>('/v1/ops/health', { auth: false, signal })
}
