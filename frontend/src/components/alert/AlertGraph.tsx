import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, useReactFlow, type FitViewOptions } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowUpRight, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
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
const X_SCALE = 1.6
/** A holder sits under an account on the lower half of the loop, and beside one on the upper half. */
const SIDE_OFFSET = 150
const BELOW = 56
const STACK = 52
/**
 * At 1x the labels are 10px or larger, and a 3-account loop fits at about 1x on desktop. A bigger loop or a phone-width
 * panel zooms out further rather than cutting an entity off; the Graph Explorer is one click away for detail.
 */
const FIT: FitViewOptions = { padding: 0.08, minZoom: 0.5, maxZoom: 1.2 }

/**
 * A compact, readable layout for a 320px snapshot: the alert's accounts evenly on one circle in loop order (following
 * the evidence legs) and each holder just outside its account. Stretched horizontally to suit the wide panel.
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
    const lower = Math.sin(a ?? 0) > 0.2
    const side = Math.cos(a ?? 0) < -0.2 ? -1 : 1
    const slot = `${String(home.x)}:${lower ? 'below' : String(side)}`
    const k = stacked.get(slot) ?? 0
    stacked.set(slot, k + 1)
    out.set(n.id, lower ? { x: home.x, y: home.y + BELOW + k * STACK } : { x: home.x + side * SIDE_OFFSET, y: home.y + k * STACK })
  })
  return out
}

/** Fits the snapshot again whenever the panel changes size; the first fit is React Flow's own, once nodes are measured. */
function Refit({ box }: { box: RefObject<HTMLDivElement | null> }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    const el = box.current
    if (!el) return
    let frame = 0
    // React Flow measures its own pane on resize too; fitting a frame later uses the new size, not the old one.
    const refit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        void fitView(FIT)
      })
    }
    const observer = new ResizeObserver(refit)
    observer.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [fitView, box])
  return null
}

/** A read-only snapshot of the alert's entities and their direct transfer neighbours (docs/03 §7). */
export function AlertGraph({ alertId, entityIds, evidenceIds }: AlertGraphProps) {
  const [state, setState] = useState<GraphState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const box = useRef<HTMLDivElement>(null)

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
    // Only the alert's own entities are drawn; neighbours outside it are counted and left to the Graph Explorer.
    const nodes = state.graph.nodes.filter((n) => anchors.has(n.id))
    const kept = new Set(nodes.map((n) => n.id))
    const bundles = bundleEdges(state.graph.edges.filter((e) => kept.has(e.source) && kept.has(e.target)))
    const placed = snapshotLayout(nodes, bundles, anchors, evidenceIds)
    const flowNodes: EntityFlowNode[] = nodes.map((n) => {
      const p = placed.get(n.id) ?? { x: 0, y: 0 }
      return {
        id: n.id,
        type: n.type,
        position: p,
        data: { label: n.label, entityType: n.type, risk: n.risk, focus: true, dim: false },
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
    return { flowNodes, flowEdges, count: nodes.length, outside: state.graph.nodes.length - nodes.length }
  }, [state, entityIds, evidenceIds])

  const primary = entityIds.find((id) => id.startsWith('cust_')) ?? entityIds[0]

  return (
    <section aria-labelledby="alert-graph-heading" className="flex min-w-0 flex-col gap-2">
      <h3 id="alert-graph-heading" className="text-[13px] font-semibold text-fg">
        Graph snapshot
      </h3>
      <div className="flex h-[320px] flex-col overflow-hidden rounded-card border border-line-strong bg-canvas">
        <div ref={box} className="relative min-h-0 flex-1">
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
                fitViewOptions={FIT}
                minZoom={FIT.minZoom}
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
                <Refit box={box} />
              </ReactFlow>
            </ReactFlowProvider>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-line bg-panel px-3 py-1.5 text-xs text-fg-muted">
          <span className="min-w-0 flex-1">
            Loop legs in amber.
            {flow && flow.outside > 0 && ` +${String(flow.outside)} connected ${flow.outside === 1 ? 'entity' : 'entities'} outside this alert.`}
          </span>
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
