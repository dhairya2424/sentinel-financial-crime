import { api } from './client'
import type { EntityCounts, EventPreview, IngestEvent, IngestResponse, LookupOption, LookupType, Registered } from './types'

export interface CustomerInput {
  name: string
  external_ref: string
  kyc_status: 'verified' | 'pending' | 'rejected'
  risk_rating: 'low' | 'standard' | 'high'
  segment?: string
}

export interface AccountInput {
  customer_id: string
  account_number: string
  type: 'savings' | 'current' | 'salary' | 'loan' | 'fixed_deposit'
  opened_at?: string
}

export interface EmployeeInput {
  name: string
  external_ref: string
  role: string
  department?: string
  manager_id?: string
}

export const registerCustomer = (body: CustomerInput) => api<Registered>('/v1/entities/customers', { method: 'POST', body })
export const registerAccount = (body: AccountInput) => api<Registered>('/v1/entities/accounts', { method: 'POST', body })
export const registerEmployee = (body: EmployeeInput) => api<Registered>('/v1/entities/employees', { method: 'POST', body })

export const getCounts = (signal?: AbortSignal) => api<EntityCounts>('/v1/entities/summary', { signal })

export function lookup(type: LookupType, q: string, opts: { employeeId?: string; signal?: AbortSignal } = {}): Promise<LookupOption[]> {
  const query = new URLSearchParams({ type, q })
  if (opts.employeeId) query.set('employee_id', opts.employeeId)
  return api<LookupOption[]>(`/v1/entities/lookup?${query.toString()}`, { signal: opts.signal })
}

export const ingestEvents = (events: readonly IngestEvent[]) => api<IngestResponse>('/v1/ingest/events', { method: 'POST', body: { events } })

export const previewEvent = (event: IngestEvent, signal?: AbortSignal) => api<EventPreview>('/v1/timeline/preview', { method: 'POST', body: { event }, signal })

const PREFIX: Record<IngestEvent['kind'], string> = { transaction: 'tx', employee_action: 'act', session: 'sess', access_right: 'ar' }

/** Event ids are chosen by the sender (docs/05 §6); records typed in the UI get a random, prefixed one. */
export function newEventId(kind: IngestEvent['kind']): string {
  return `${PREFIX[kind]}_ui_${crypto.randomUUID().replaceAll('-', '')}`
}
