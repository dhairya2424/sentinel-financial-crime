import { forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, type SimulationNodeDatum } from 'd3-force'
import type { GraphEdge, GraphEdgeType, GraphNode, GraphNodeType, Neighborhood } from '@/api/types'

export type Depth = 1 | 2
export type LayoutMode = 'force' | 'rings'

export interface GraphParams {
  node: string | null
  depth: Depth
  /** End of the 72-hour cycle window; null means now. Links from an alert pin it to the alert's window, so its loop
   * stays findable however long after the transfers someone opens it. */
  until: string | null
}

export function parseGraphParams(params: URLSearchParams): GraphParams {
  const node = params.get('node')?.trim()
  const until = params.get('until')?.trim()
  const valid = until && /[zZ]|[+-]\d{2}:?\d{2}$/.test(until) && !Number.isNaN(Date.parse(until))
  return { node: node ? node : null, depth: params.get('depth') === '1' ? 1 : 2, until: valid ? until : null }
}

export function graphQuery({ node, depth, until }: GraphParams): string {
  const params = new URLSearchParams()
  if (node) params.set('node', node)
  params.set('depth', String(depth))
  if (until) params.set('until', until)
  return params.toString()
}

export interface StoredNode extends GraphNode {
  depth: number
}

export interface GraphStore {
  nodes: Map<string, StoredNode>
  edges: Map<string, GraphEdge>
}

export function emptyStore(): GraphStore {
  return { nodes: new Map(), edges: new Map() }
}

export function mergeNeighborhood(store: GraphStore, hood: Neighborhood, baseDepth = 0): GraphStore {
  const nodes = new Map(store.nodes)
  for (const n of hood.nodes) {
    const depth = baseDepth + (n.depth ?? 0)
    const existing = nodes.get(n.id)
    nodes.set(n.id, { ...n, depth: existing ? Math.min(existing.depth, depth) : depth })
  }
  const edges = new Map(store.edges)
  for (const e of hood.edges) edges.set(e.id, e)
  return { nodes, edges }
}

export interface Bundle {
  id: string
  source: string
  target: string
  type: GraphEdgeType
  count: number
  ids: string[]
  amount: number
  last: string | null
  actions: Record<string, number>
  offset: number
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

export function bundleEdges(edges: Iterable<GraphEdge>): Bundle[] {
  const bundles = new Map<string, Bundle>()
  for (const e of edges) {
    const id = `${e.type}:${e.source}>${e.target}`
    let b = bundles.get(id)
    if (!b) {
      b = { id, source: e.source, target: e.target, type: e.type, count: 0, ids: [], amount: 0, last: null, actions: {}, offset: 0 }
      bundles.set(id, b)
    }
    b.count += 1
    b.ids.push(e.id)
    const amount = Number(e.props.amount)
    if (Number.isFinite(amount)) b.amount += amount
    const ts = text(e.props.ts) ?? text(e.props.event_ts) ?? text(e.props.granted_at) ?? text(e.props.since)
    if (ts && (!b.last || ts > b.last)) b.last = ts
    const action = text(e.props.action) ?? text(e.props.entitlement)
    if (action) b.actions[action] = (b.actions[action] ?? 0) + 1
  }
  const pairs = new Map<string, Bundle[]>()
  for (const b of bundles.values()) {
    const key = [b.source, b.target].sort().join('|')
    pairs.set(key, [...(pairs.get(key) ?? []), b])
  }
  for (const list of pairs.values()) {
    list.forEach((b, i) => {
      b.offset = (i - (list.length - 1) / 2) * 18 * (b.source < b.target ? 1 : -1)
    })
  }
  return [...bundles.values()]
}

export interface XY {
  x: number
  y: number
}

export const X_STRETCH = 1.5
const RADII = [0, 165, 340, 500, 650, 790]
const TYPE_ORDER: Record<GraphNodeType, number> = { customer: 0, account: 1, employee: 2, transaction: 3 }

interface SimNode extends SimulationNodeDatum {
  id: string
  depth: number
  type: GraphNodeType
}

function hashAngle(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return ((h >>> 0) % 360) * (Math.PI / 180)
}

const radius = (depth: number) => RADII[Math.min(depth, RADII.length - 1)] ?? 0

export function layoutPositions(
  nodes: readonly StoredNode[],
  bundles: readonly Bundle[],
  focus: string,
  mode: LayoutMode,
  fixed: ReadonlyMap<string, XY> = new Map(),
): Map<string, XY> {
  if (mode === 'rings') {
    const out = new Map<string, XY>()
    const byDepth = new Map<number, StoredNode[]>()
    for (const n of nodes) byDepth.set(n.depth, [...(byDepth.get(n.depth) ?? []), n])
    for (const [depth, ring] of byDepth) {
      ring.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.label.localeCompare(b.label))
      ring.forEach((n, i) => {
        const angle = (i / Math.max(1, ring.length)) * Math.PI * 2 - Math.PI / 2
        out.set(n.id, { x: Math.cos(angle) * radius(depth), y: Math.sin(angle) * radius(depth) })
      })
    }
    return out
  }
  const neighbour = new Map<string, string>()
  for (const b of bundles) {
    if (fixed.has(b.source) && !fixed.has(b.target)) neighbour.set(b.target, b.source)
    if (fixed.has(b.target) && !fixed.has(b.source)) neighbour.set(b.source, b.target)
  }
  const sim: SimNode[] = nodes.map((n, i) => {
    const pinned = fixed.get(n.id) ?? (n.id === focus ? { x: 0, y: 0 } : undefined)
    if (pinned) return { id: n.id, depth: n.depth, type: n.type, x: pinned.x, y: pinned.y, fx: pinned.x, fy: pinned.y }
    const anchor = fixed.get(neighbour.get(n.id) ?? '')
    const angle = hashAngle(n.id)
    const r = anchor ? 60 : radius(n.depth) || 40 + i
    return { id: n.id, depth: n.depth, type: n.type, x: (anchor?.x ?? 0) + Math.cos(angle) * r, y: (anchor?.y ?? 0) + Math.sin(angle) * r }
  })
  const ids = new Set(sim.map((n) => n.id))
  const links = bundles
    .filter((b) => ids.has(b.source) && ids.has(b.target))
    .map((b) => ({ source: b.source, target: b.target, type: b.type }))
  const simulation = forceSimulation(sim)
    .force(
      'link',
      forceLink<SimNode, { source: string; target: string; type: GraphEdgeType }>(links)
        .id((d) => d.id)
        .distance((l) => (l.type === 'ACCOUNT_HOLDER' ? 70 : 160))
        .strength(0.08),
    )
    .force('charge', forceManyBody().strength(-380))
    .force('collide', forceCollide<SimNode>((d) => (d.type === 'transaction' ? 14 : 40)))
    .force('radial', forceRadial<SimNode>((d) => radius(d.depth), 0, 0).strength(0.9))
    .stop()
  for (let i = 0; i < 300; i++) simulation.tick()
  return new Map(sim.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]))
}

export interface TouchCell {
  changes?: Bundle
  access?: Bundle
}

export interface TouchMatrix {
  employees: StoredNode[]
  rows: StoredNode[]
  cell: (rowId: string, employeeId: string) => TouchCell
}

const TOUCH_TYPES = new Set<GraphEdgeType>(['PROFILE_CHANGE', 'EMPLOYEE_ACCESS'])

export function touchMatrix(nodes: ReadonlyMap<string, StoredNode>, bundles: readonly Bundle[], focus: string, maxRows = 14): TouchMatrix {
  const touching = bundles.filter((b) => TOUCH_TYPES.has(b.type) && nodes.has(b.source) && nodes.has(b.target))
  const touches = new Map<string, number>()
  for (const b of touching) touches.set(b.target, (touches.get(b.target) ?? 0) + b.count)
  const rows = [...touches.keys()]
    .map((id) => nodes.get(id))
    .filter((n): n is StoredNode => n !== undefined && (n.type === 'customer' || n.type === 'account'))
    .sort((a, b) => Number(b.id === focus) - Number(a.id === focus) || (touches.get(b.id) ?? 0) - (touches.get(a.id) ?? 0))
    .slice(0, maxRows)
  const employeeIds = new Set(touching.filter((b) => rows.some((r) => r.id === b.target)).map((b) => b.source))
  const employees = [...employeeIds]
    .map((id) => nodes.get(id))
    .filter((n): n is StoredNode => n !== undefined)
    .sort((a, b) => a.label.localeCompare(b.label))
  const index = new Map(touching.map((b) => [`${b.type}|${b.source}|${b.target}`, b]))
  return {
    employees,
    rows,
    cell: (rowId, employeeId) => ({
      changes: index.get(`PROFILE_CHANGE|${employeeId}|${rowId}`),
      access: index.get(`EMPLOYEE_ACCESS|${employeeId}|${rowId}`),
    }),
  }
}

export function nodeAriaLabel(type: GraphNodeType, label: string): string {
  return `${type} ${label}`
}

export function cycleRoots(focus: StoredNode | undefined, bundles: readonly Bundle[], limit = 6): string[] {
  if (!focus) return []
  if (focus.type === 'account') return [focus.id]
  const owned = bundles.filter((b) => b.type === 'ACCOUNT_HOLDER' && b.source === focus.id).map((b) => b.target)
  const touched = bundles.filter((b) => b.source === focus.id && (b.type === 'PROFILE_CHANGE' || b.type === 'EMPLOYEE_ACCESS')).map((b) => b.target)
  return [...new Set([...owned, ...touched])].filter((id) => id.startsWith('acct_')).slice(0, limit)
}
