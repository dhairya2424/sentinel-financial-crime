export type Role = 'admin' | 'manager' | 'investigator' | 'viewer'

export const ROLES: readonly Role[] = ['admin', 'manager', 'investigator', 'viewer']

export type RiskBand = 'low' | 'medium' | 'high' | 'critical'

export interface User {
  id: string
  email: string
  role: Role
  tenant_id: string
  full_name: string
}

export interface LoginRequest {
  email: string
  password: string
  tenant_id: string
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
  user: User
}

export interface RefreshResponse {
  access_token: string
  token_type: 'bearer'
}

export type ServiceStatus = 'ok' | 'fail'

export interface Health {
  db: ServiceStatus
  redis: ServiceStatus
}

export interface ValidationIssue {
  loc: (string | number)[]
  msg: string
  type: string
}

export interface ApiErrorBody {
  detail?: string | ValidationIssue[]
  code?: string
}

export type TimelineEntityType = 'customer' | 'account' | 'employee'

export type TimelineCategory = 'transaction' | 'profile_change' | 'access_login' | 'approval'

export type TimelineEventKind = 'transaction' | 'employee_action' | 'session' | 'access_right'

export type MoneyDirection = 'in' | 'out' | 'internal'

export interface TimelineActor {
  id: string
  name: string
}

export interface TimelineItem {
  ts: string
  category: TimelineCategory
  title: string
  actor: TimelineActor | null
  value: string | null
  target: string | null
  event_kind: TimelineEventKind
  ref_id: string
  direction?: MoneyDirection | null
  target_label?: string | null
}

export interface TimelineEntity {
  type: TimelineEntityType
  id: string
  label: string
  detail: string | null
}

export interface TimelinePage {
  entity: TimelineEntity
  items: TimelineItem[]
  next_cursor: string | null
}

export interface RawRecord {
  kind: TimelineEventKind
  source_table: string
  record: Record<string, unknown>
}

export type GraphEdgeType = 'TRANSFER' | 'ACCOUNT_HOLDER' | 'EMPLOYEE_ACCESS' | 'PROFILE_CHANGE' | 'EMPLOYEE_ACTION'

export type GraphNodeType = 'customer' | 'account' | 'employee' | 'transaction'

export interface GraphNode {
  id: string
  type: GraphNodeType
  label: string
  risk: RiskBand
  degree: number
  depth?: number | null
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  type: GraphEdgeType
  props: Record<string, string | number | null>
}

export interface Neighborhood {
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated: boolean
}

export interface CycleResult {
  cycles: string[][]
  legs: string[][]
}

export interface SearchHit {
  type: GraphNodeType
  id: string
  label: string
  detail: string | null
  risk_band: RiskBand
}

export interface EntitySummary {
  type: GraphNodeType
  id: string
  label: string
  detail: string | null
  risk_band: RiskBand
  stats: Record<string, string | number>
  links: { timeline: string | null; graph: string | null; alerts: string | null }
}

export type RegisteredKind = 'customer' | 'account' | 'employee'

export interface Registered {
  id: string
  label: string
  type: RegisteredKind
}

export interface EntityCounts {
  customers: number
  accounts: number
  employees: number
  transactions: number
  employee_actions: number
  sessions: number
  access_rights: number
}

export type LookupType = 'customer' | 'account' | 'employee' | 'session' | 'transaction'

export interface LookupOption {
  id: string
  label: string
  detail: string | null
}

export type Channel = 'upi' | 'neft' | 'rtgs' | 'atm' | 'pos' | 'internal'
export type ActionType = 'login' | 'logout' | 'profile.edit' | 'beneficiary.add' | 'limit.change' | 'tx.approve' | 'export.data'
export type TargetType = 'customer' | 'account' | 'transaction' | 'employee' | 'system'

export interface TransactionEvent {
  kind: 'transaction'
  id: string
  from_account_id?: string
  to_account_id?: string
  amount: string
  channel?: Channel
  reference_no?: string
  status?: 'pending' | 'completed' | 'failed'
  value_ts: string
  raw?: Record<string, unknown>
}

export interface EmployeeActionEvent {
  kind: 'employee_action'
  id: string
  employee_id: string
  session_id?: string
  action_type: ActionType
  target_type: TargetType
  target_id: string
  before_state?: Record<string, unknown>
  after_state?: Record<string, unknown>
  ip_address?: string
  event_ts: string
}

export interface SessionEvent {
  kind: 'session'
  id: string
  employee_id: string
  ip_address?: string
  device?: string
  started_at: string
  ended_at?: string
  outcome?: 'success' | 'fail' | 'lockout'
}

export interface AccessRightEvent {
  kind: 'access_right'
  id: string
  employee_id: string
  entitlement: string
  scope?: string
  granted_at: string
  granted_by?: string
}

export type IngestEvent = TransactionEvent | EmployeeActionEvent | SessionEvent | AccessRightEvent

export interface IngestResponse {
  accepted: number
  skipped: number
  failed: number
  batch_id: string
  errors: { id: string; error: string }[]
  skipped_ids: string[]
}

export interface EventPreview {
  viewpoint: TimelineEntity | null
  item: TimelineItem | null
  problem: string | null
  note: string | null
}

export type AlertStatus = 'open' | 'acknowledged' | 'linked_to_case' | 'resolved' | 'closed_confirmed' | 'closed_false_positive'

export type RuleCode = 'R-CIRC' | 'R-STRUCT' | 'R-PROFILE_ROLE' | 'R-PROFILE_FLOW' | 'R-VELOCITY' | 'R-OFFHOURS' | 'R-DORMANT'

export interface EntityRef {
  id: string
  type: 'customer' | 'account' | 'employee'
  label: string
}

export interface AlertRow {
  id: string
  rule_code: string
  title: string
  risk_band: RiskBand
  risk_score: number
  status: AlertStatus
  entity_ids: string[]
  primary_entity: string | null
  entities: EntityRef[]
  amount_total: string | null
  detected_at: string
  occurrence_count: number
}

export interface AlertPage {
  items: AlertRow[]
  next_cursor: string | null
}

export interface RiskFactor {
  name: string
  raw_value: string
  weight: number
  contribution: number
  /** The factor could not be measured (e.g. no baseline yet) and holds a neutral default rather than a finding. */
  imputed?: boolean
}

export type EvidenceType = 'transaction' | 'employee_action' | 'access_right' | 'session'

export interface Evidence {
  evidence_type: EvidenceType
  ref_id: string
  snapshot: Record<string, unknown>
  captured_at: string
}

export interface AlertDetail extends AlertRow {
  rule_version: number
  explanation: string
  risk_factors: RiskFactor[]
  window_start: string
  window_end: string
  updated_at: string
  evidence: Evidence[]
  linked_case_id: string | null
}

export interface AlertGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated: boolean
}

export interface AlertMessage {
  channel: string
  type: 'alert.created' | 'alert.updated'
  data: {
    id: string
    rule_code: string
    title: string
    risk_band: RiskBand
    risk_score: number
    entity_ids: string[]
    detected_at: string
    occurrence_count: number
  }
}
