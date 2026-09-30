import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowUpRight, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { getAlertGraph } from '@/api/alerts'
import type { AlertGraph as AlertGraphData, GraphNode } from '@/api/types'
import type { BundleFlowEdge } from '@/graph/BundleEdge'
import { ArrowMarkers } from '@/graph/ArrowMarkers'
import { bundleEdges, nodeAriaLabel, type Bundle, type XY } from '@/graph/model'
import type { EntityFlowNode } from '@/graph/nodes'
import { EDGE_COMPONENTS, NODE_TYPES } from '@/graph/registry'

interface AlertGraphProps {
  alertId: string
  entityIds: readonly string[]
  /** Transfers the alert's evidence names; drawn as cycle legs. */
  evidenceIds: ReadonlySet<string>
}

type GraphState = { status: 'loading' } | { status: 'loaded'; graph: AlertGraphData } | { status: 'error'; message: string }

const ACCOUNT_RADIUS = 100
const X_SCALE = 2.3
/** Holders and outside nodes sit beside their account, not above or below it: the panel is wide and short. */
const SIDE_OFFSET = 175
const OUTER_OFFSET = 330
const STACK = 58

/**
 * A compact, readable layout for a 280px snapshot: the alert's accounts evenly on one circle in loop order (following
 * the evidence legs), each holder just outside its account, other people and outside accounts a step further out.
 * Stretched horizontally to suit the wide panel.
 */
function snapshotLayout(nodes: readonly GraphNode[], bundles: readonly Bundle[], anchors: ReadonlySet<string>, evidenceIds: ReadonlySet<string>) {
  const accounts = nodes.filter((n) => n.type === 'account' && anchors.has(n.id)).map((n) => n.id)
  const next = new Map<string, string>()
  for (const b of bundles) if (b.type === 'TRANSFER' && b.ids.some((id) => evidenceIds.has(id))) next.set(b.source, b.target)
  const ordered: string[] = []
  let cursor = accounts[0]
  while (cursor && accounts.includes(cursor) && !ordered.includes(cursor)) {
    ordered.push(cursor)
    cursor = next.get(cursor)
  }
  for (const a of accounts) if (!ordered.includes(a)) ordered.push(a)

  const angle = new Map<string, number>()
  ordered.forEach((id, i) => angle.set(id, (i / Math.max(1, ordered.length)) * Math.PI * 2 - Math.PI / 2))
  const out = new Map<string, XY>()
  const at = (a: number, r: number): XY => ({ x: Math.cos(a) * r * X_SCALE, y: Math.sin(a) * r })
  for (const id of ordered) out.set(id, at(angle.get(id) ?? 0, ordered.length > 1 ? ACCOUNT_RADIUS : 0))

  const neighbourAngle = (id: string) => {
    for (const b of bundles) {
      const other = b.source === id ? b.target : b.target === id ? b.source : null
      if (other && angle.has(other)) return angle.get(other)
    }
    return undefined
  }
  const rest = nodes.filter((n) => !out.has(n.id))
  const stacked = new Map<string, number>()
  rest.forEach((n, i) => {
    const a = neighbourAngle(n.id)
    const home = a === undefined ? at((i / Math.max(1, rest.length)) * Math.PI * 2, ACCOUNT_RADIUS) : at(a, ACCOUNT_RADIUS)
    const side = Math.cos(a ?? 0) < -0.2 ? -1 : 1
    const slot = `${String(home.x)}:${String(side)}:${String(anchors.has(n.id))}`
    const k = stacked.get(slot) ?? 0
    stacked.set(slot, k + 1)
    out.set(n.id, { x: home.x + side * (anchors.has(n.id) ? SIDE_OFFSET : OUTER_OFFSET), y: home.y + k * STACK })
  })
  return out
}

/** A read-only snapshot of the alert's entities and their direct transfer neighbours (docs/03 §7). */
export function AlertGraph({ alertId, entityIds, evidenceIds }: AlertGraphProps) {
  const [state, setState] = useState<GraphState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getAlertGraph(alertId, controller.signal)
      .then((graph) => {
        setState({ status: 'loaded', graph })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      controller.abort()
    }
  }, [alertId, attempt])

  const flow = useMemo(() => {
    if (state.status !== 'loaded') return null
    const anchors = new Set(entityIds)
    const nodes = state.graph.nodes
    const bundles = bundleEdges(state.graph.edges)
    const placed = snapshotLayout(nodes, bundles, anchors, evidenceIds)
    const flowNodes: EntityFlowNode[] = nodes.map((n) => {
      const p = placed.get(n.id) ?? { x: 0, y: 0 }
      return {
        id: n.id,
        type: n.type,
        position: p,
        data: { label: n.label, entityType: n.type, risk: n.risk, focus: anchors.has(n.id), dim: !anchors.has(n.id) },
        ariaLabel: nodeAriaLabel(n.type, n.label),
        draggable: false,
        selectable: false,
      }
    })
    const flowEdges: BundleFlowEdge[] = [...bundles]
      .sort((a, b) => Number(a.type === 'TRANSFER') - Number(b.type === 'TRANSFER'))
      .map((b) => ({
        id: b.id,
        source: b.source,
        target: b.target,
        type: 'bundle',
        data: { bundle: b, cycle: b.ids.some((id) => evidenceIds.has(id)), dim: false, quiet: b.type !== 'TRANSFER' },
        selectable: false,
        focusable: false,
      }))
    return { flowNodes, flowEdges, count: nodes.length }
  }, [state, entityIds, evidenceIds])

  const primary = entityIds.find((id) => id.startsWith('cust_')) ?? entityIds[0]

  return (
    <section aria-labelledby="alert-graph-heading" className="flex min-w-0 flex-col gap-2">
      <h3 id="alert-graph-heading" className="text-[13px] font-semibold text-fg">
        Graph snapshot
      </h3>
      <div className="flex h-[280px] flex-col overflow-hidden rounded-card border border-line-strong bg-canvas">
        <div className="relative min-h-0 flex-1">
          {state.status === 'loading' && (
            <div role="status" className="grid h-full place-items-center text-[13px] text-fg-muted">
              <span className="inline-flex items-center gap-2">
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                Drawing the graph
              </span>
            </div>
          )}
          {state.status === 'error' && (
            <div role="alert" className="grid h-full place-items-center px-6 text-center text-[13px] text-fg-muted">
              <p>
                The graph could not be drawn: {state.message}.{' '}
                <button
                  type="button"
                  onClick={() => {
                    setState({ status: 'loading' })
                    setAttempt((a) => a + 1)
                  }}
                  className="font-medium text-accent hover:underline"
                >
                  Try again
                </button>
              </p>
            </div>
          )}
          {flow && flow.count === 0 && (
            <p className="grid h-full place-items-center text-[13px] text-fg-muted">None of this alert's entities are on the graph.</p>
          )}
          {flow && flow.count > 0 && (
            <ReactFlowProvider>
              <ArrowMarkers />
              <ReactFlow<EntityFlowNode, BundleFlowEdge>
                nodes={flow.flowNodes}
                edges={flow.flowEdges}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_COMPONENTS}
                nodeOrigin={[0.5, 0.5]}
                fitView
                fitViewOptions={{ padding: 0.12, maxZoom: 1.1 }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                panOnDrag={false}
                zoomOnScroll={false}
                zoomOnPinch={false}
                zoomOnDoubleClick={false}
                preventScrolling={false}
                aria-label="Graph of the alert's accounts and people"
              >
                <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--line-strong)" />
              </ReactFlow>
            </ReactFlowProvider>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-line bg-panel px-3 py-1.5 text-xs text-fg-muted">
          <span className="min-w-0 flex-1">Loop legs in amber; the alert's entities at full ink.</span>
          {primary && (
            <Link to={`/graph?node=${encodeURIComponent(primary)}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              Open in Graph Explorer
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}
