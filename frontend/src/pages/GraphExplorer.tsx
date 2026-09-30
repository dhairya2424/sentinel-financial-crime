import '@xyflow/react/dist/style.css'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeMouseHandler,
  type NodeChange,
  type NodeMouseHandler,
} from '@xyflow/react'
import { Crosshair, History, LoaderCircle, Maximize, Minus, Plus, Search, TriangleAlert, Waypoints, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { getCycles, getEntity, getNeighbors, searchEntities } from '@/api/graph'
import type { EntitySummary, GraphEdgeType, SearchHit } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { ErrorRetry } from '@/components/ErrorRetry'
import { RiskBadge } from '@/components/RiskBadge'
import { Skeleton } from '@/components/Skeleton'
import type { BundleFlowEdge } from '@/graph/BundleEdge'
import { EDGE_STYLES, EDGE_TYPES } from '@/graph/edges'
import {
  bundleEdges,
  cycleRoots,
  emptyStore,
  graphQuery,
  layoutPositions,
  mergeNeighborhood,
  nodeAriaLabel,
  parseGraphParams,
  touchMatrix,
  X_STRETCH,
  type Bundle,
  type Depth,
  type GraphParams,
  type GraphStore,
  type LayoutMode,
  type StoredNode,
  type XY,
} from '@/graph/model'
import type { EntityFlowNode } from '@/graph/nodes'
import { ArrowMarkers } from '@/graph/ArrowMarkers'
import { EDGE_COMPONENTS, NODE_TYPES } from '@/graph/registry'
import { initials, shortId } from '@/lib/format'
import { formatInr } from '@/lib/timeline'
import { SCREENS } from '@/lib/screens'
import { Page } from './Placeholder'

const FIT_PADDING = {
  top: '40px',
  right: '48px',
  bottom: '40px',
  left: '48px',
} as const
const ZOOM =
  'grid size-7 place-items-center rounded-md border border-line-strong bg-panel text-fg-muted transition-colors duration-150 hover:bg-raised hover:text-fg'
const QUIET_TYPES = new Set<GraphEdgeType>(['PROFILE_CHANGE', 'EMPLOYEE_ACCESS', 'EMPLOYEE_ACTION'])

const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)))
const tsFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function GraphExplorer() {
  const [params, setParams] = useSearchParams()
  const current = parseGraphParams(params)
  const go = (next: Partial<GraphParams>) => {
    setParams(graphQuery({ ...current, ...next }))
  }

  if (!current.node) {
    return (
      <Page title={SCREENS.graph.title}>
        <section className="grid min-h-80 place-items-center rounded-card border border-line-strong bg-panel">
          <EmptyState
            icon={Waypoints}
            title="Search an entity to start"
            description="Find a customer, account or employee by name or id. Its money and people appear here two hops out, and you can expand from any node."
            action={
              <div className="w-full max-w-md text-left">
                <GraphSearch
                  onPick={(id) => {
                    go({ node: id })
                  }}
                  autoFocus
                />
              </div>
            }
          />
        </section>
      </Page>
    )
  }

  return (
    <ReactFlowProvider>
      <Explorer key={`${current.node}/${String(current.depth)}`} focus={current.node} depth={current.depth} until={current.until} go={go} />
    </ReactFlowProvider>
  )
}

interface CycleState {
  status: 'off' | 'loading' | 'on'
  legs: Set<string>
  nodes: Set<string>
  loops: number
}

const CYCLES_OFF: CycleState = {
  status: 'off',
  legs: new Set(),
  nodes: new Set(),
  loops: 0,
}

function Explorer({ focus, depth, until, go }: { focus: string; depth: Depth; until: string | null; go: (next: Partial<GraphParams>) => void }) {
  const { fitView, zoomIn, zoomOut } = useReactFlow()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [store, setStore] = useState<GraphStore>(emptyStore)
  const [loaded, setLoaded] = useState<{
    attempt: number
    error: Error | null
    truncated: boolean
  } | null>(null)
  const [positions, setPositions] = useState<ReadonlyMap<string, XY>>(new Map())
  const [layout, setLayout] = useState<LayoutMode>('force')
  const [types, setTypes] = useState<ReadonlySet<GraphEdgeType>>(() => new Set(EDGE_TYPES))
  const [selected, setSelected] = useState(focus)
  const [tab, setTab] = useState<'entity' | 'touch'>('entity')
  const [hover, setHover] = useState<ReadonlySet<string> | null>(null)
  const [tip, setTip] = useState<{
    bundle: Bundle
    x: number
    y: number
  } | null>(null)
  const [cycles, setCycles] = useState<CycleState>(CYCLES_OFF)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{
    message: string
    retry?: () => void
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getNeighbors(focus, depth, undefined, controller.signal)
      .then((hood) => {
        setStore(mergeNeighborhood(emptyStore(), hood))
        setPositions(new Map())
        setLoaded({ attempt, error: null, truncated: hood.truncated })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoaded({ attempt, error: toError(err), truncated: false })
      })
    return () => {
      controller.abort()
    }
  }, [focus, depth, attempt])

  const loading = loaded?.attempt !== attempt
  const bundles = useMemo(() => bundleEdges(store.edges.values()), [store])
  const nodes = useMemo(() => [...store.nodes.values()], [store])
  const placed = useMemo(() => {
    const missing = nodes.some((n) => !positions.has(n.id))
    if (!missing) return positions
    const laid = layoutPositions(nodes, bundles, focus, layout, positions)
    return new Map([...laid, ...positions])
  }, [nodes, bundles, focus, layout, positions])

  const fitKey = `${String(loaded?.attempt)}|${layout}|${String(nodes.length > 0)}`
  const fitNear = (duration: number) => {
    const near = nodes.filter((n) => n.depth <= 1).map((n) => ({ id: n.id }))
    void fitView({ nodes: near.length > 1 ? near : undefined, padding: FIT_PADDING, maxZoom: 1.15, duration })
  }
  useEffect(() => {
    if (nodes.length === 0) return
    const frame = requestAnimationFrame(() => {
      fitNear(0)
    })
    return () => {
      cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when a new load or layout lands, not on every expansion
  }, [fitKey])

  const visible = useMemo(() => bundles.filter((b) => types.has(b.type)), [bundles, types])
  const cycleOn = cycles.status === 'on' && cycles.loops > 0

  const flowNodes = useMemo<EntityFlowNode[]>(
    () =>
      nodes.map((n) => {
        const p = placed.get(n.id) ?? { x: 0, y: 0 }
        const hovered = hover ? visible.some((b) => hover.has(b.id) && (b.source === n.id || b.target === n.id)) : true
        const dim = (cycleOn && !cycles.nodes.has(n.id)) || (hover !== null && !hovered && n.id !== selected)
        return {
          id: n.id,
          type: n.type,
          position: { x: p.x * X_STRETCH, y: p.y },
          data: {
            label: n.label,
            entityType: n.type,
            risk: n.risk,
            focus: n.id === focus,
            dim,
          },
          ariaLabel: nodeAriaLabel(n.type, n.label),
          selected: n.id === selected,
        }
      }),
    [nodes, placed, hover, visible, cycleOn, cycles.nodes, selected, focus],
  )

  const flowEdges = useMemo<BundleFlowEdge[]>(
    () =>
      [...visible]
        .sort((a, b) => Number(a.type === 'TRANSFER') - Number(b.type === 'TRANSFER'))
        .map((b) => {
          const cycle = cycleOn && b.ids.some((id) => cycles.legs.has(id))
          const dim = (cycleOn && !cycle) || (hover !== null && !hover.has(b.id))
          const anchored = [focus, selected].some((id) => id === b.source || id === b.target)
          const quiet = !dim && !cycle && hover === null && QUIET_TYPES.has(b.type) && !anchored
          return {
            id: b.id,
            source: b.source,
            target: b.target,
            type: 'bundle',
            data: { bundle: b, cycle, dim, quiet },
            selectable: false,
            focusable: false,
          }
        }),
    [visible, cycleOn, cycles.legs, hover, focus, selected],
  )

  const onNodesChange = (changes: NodeChange<EntityFlowNode>[]) => {
    const moved = changes.flatMap((c) => (c.type === 'position' && c.position ? [{ id: c.id, position: c.position }] : []))
    if (moved.length) {
      const next = new Map(placed)
      for (const m of moved) next.set(m.id, { x: m.position.x / X_STRETCH, y: m.position.y })
      setPositions(next)
    }
    const picked = changes.find((c) => c.type === 'select' && c.selected)
    if (picked?.type === 'select') {
      setSelected(picked.id)
      setTab('entity')
    }
  }

  const expand: NodeMouseHandler<EntityFlowNode> = (_, node) => {
    const base = store.nodes.get(node.id)
    if (!base || busy) return
    setBusy(`Expanding ${node.data.label}`)
    getNeighbors(node.id, 1)
      .then((hood) => {
        setPositions(placed)
        setStore((prev) => mergeNeighborhood(prev, hood, base.depth))
      })
      .catch((err: unknown) => {
        setToast({
          message: `Could not expand ${node.data.label}: ${toError(err).message}`,
        })
      })
      .finally(() => {
        setBusy(null)
      })
  }

  const toggleCycles = () => {
    if (cycles.status !== 'off') {
      setCycles(CYCLES_OFF)
      return
    }
    const roots = cycleRoots(store.nodes.get(focus), bundles)
    setCycles({ ...CYCLES_OFF, status: 'loading' })
    Promise.all(roots.map((r) => getCycles(r, 72, until).then((res) => ({ root: r, res }))))
      .then(async (results) => {
        const legs = new Set(results.flatMap((r) => r.res.legs.flat()))
        const loopNodes = new Set(results.flatMap((r) => r.res.cycles.flat()))
        const loops = new Set(results.flatMap((r) => r.res.legs.map((l) => [...l].sort().join('|')))).size
        const missingRoots = results.filter((r) => r.res.cycles.flat().some((id) => !store.nodes.has(id))).map((r) => r.root)
        if (missingRoots.length) {
          const hoods = await Promise.all(missingRoots.map((r) => getNeighbors(r, 1, ['TRANSFER'])))
          setPositions(placed)
          setStore((prev) => hoods.reduce((acc, hood, i) => mergeNeighborhood(acc, hood, prev.nodes.get(missingRoots[i] ?? '')?.depth ?? 1), prev))
        }
        setCycles({ status: 'on', legs, nodes: loopNodes, loops })
        if (loopNodes.size > 0) {
          requestAnimationFrame(() => {
            void fitView({
              nodes: [...loopNodes].map((id) => ({ id })),
              padding: FIT_PADDING,
              maxZoom: 1.15,
              duration: 200,
            })
          })
        }
      })
      .catch((err: unknown) => {
        setCycles(CYCLES_OFF)
        setToast({
          message: `Could not check for loops: ${toError(err).message}`,
          retry: toggleCycles,
        })
      })
  }

  const edgeTip: EdgeMouseHandler<BundleFlowEdge> = (event, edge) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || !edge.data) return
    setTip({
      bundle: edge.data.bundle,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    })
  }

  const focusNode = store.nodes.get(focus)
  const firstLoad = loading && store.nodes.size === 0
  const loadError = loaded?.error ?? null

  const span = until ? `in the 72 hours to ${tsFormat.format(new Date(until))}` : 'in the last 72 hours'
  const canvasNote =
    cycles.status === 'on'
      ? cycles.loops === 0
        ? `No loops through ${focusNode?.label ?? 'this entity'}'s accounts ${span}`
        : `${String(cycles.loops)} ${cycles.loops === 1 ? 'loop' : 'loops'} ${span}`
      : loaded?.truncated
        ? 'Showing the first 400 nodes. Expand from a node to see more.'
        : 'Double-click a node to expand it. Hover an edge for its transactions.'

  return (
    <Page
      wide
      title={SCREENS.graph.title}
      meta={
        <div className="ml-auto w-full max-w-sm self-center">
          <GraphSearch
            onPick={(id) => {
              go({ node: id })
            }}
            placeholder={focusNode ? `Focused on ${focusNode.label}. Search another entity` : 'Search an entity'}
          />
        </div>
      }
    >
      <ArrowMarkers />

      <Toolbar
        depth={depth}
        onDepth={(d) => {
          go({ depth: d })
        }}
        layout={layout}
        onLayout={(mode) => {
          setLayout(mode)
          setPositions(new Map())
        }}
        types={types}
        onToggleType={(t) => {
          setTypes((prev) => {
            const next = new Set(prev)
            if (next.has(t)) next.delete(t)
            else next.add(t)
            return next
          })
        }}
        cycles={cycles}
        onToggleCycles={toggleCycles}
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div
          ref={wrapRef}
          className="relative flex h-[calc(100dvh-210px)] min-h-[460px] flex-col overflow-hidden rounded-card border border-line-strong bg-canvas"
        >
          <div className="relative min-h-0 flex-1">
            {loadError && store.nodes.size === 0 ? (
              <div className="grid h-full place-items-center p-6">
                <div className="w-full max-w-md">
                  <ErrorRetry
                    title={`The graph around ${shortId(focus)} could not be loaded`}
                    message={loadError.message}
                    onRetry={() => {
                      setAttempt((a) => a + 1)
                    }}
                    retrying={loading}
                  />
                </div>
              </div>
            ) : (
              <ReactFlow<EntityFlowNode, BundleFlowEdge>
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_COMPONENTS}
                nodeOrigin={[0.5, 0.5]}
                onNodesChange={onNodesChange}
                onNodeDoubleClick={expand}
                onEdgeMouseEnter={edgeTip}
                onEdgeMouseMove={edgeTip}
                onEdgeMouseLeave={() => {
                  setTip(null)
                }}
                onPaneClick={() => {
                  setTip(null)
                }}
                zoomOnDoubleClick={false}
                nodesConnectable={false}
                minZoom={0.2}
                maxZoom={2}
                aria-label={`Money-flow graph around ${focusNode?.label ?? focus}`}
              >
                <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--line-strong)" />
              </ReactFlow>
            )}
          </div>
          <div className="flex items-center gap-3 border-t border-line bg-panel py-1 pr-1.5 pl-3">
            <p aria-live="polite" className="min-w-0 flex-1 text-xs text-fg-muted">
              {canvasNote}
            </p>
            <div role="group" aria-label="Zoom" className="flex gap-1">
              <button type="button" aria-label="Zoom in" title="Zoom in" className={ZOOM} onClick={() => void zoomIn({ duration: 150 })}>
                <Plus aria-hidden="true" className="size-3.5" />
              </button>
              <button type="button" aria-label="Zoom out" title="Zoom out" className={ZOOM} onClick={() => void zoomOut({ duration: 150 })}>
                <Minus aria-hidden="true" className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Fit to view"
                title="Fit to view"
                className={ZOOM}
                onClick={() => {
                  fitNear(200)
                }}
              >
                <Maximize aria-hidden="true" className="size-3.5" />
              </button>
            </div>
          </div>

          {(firstLoad || busy) && (
            <div role="status" className="absolute inset-0 grid place-items-center bg-panel/60">
              <span className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-panel px-3 py-2 text-[13px] text-fg-muted shadow-float">
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                {busy ?? 'Loading the graph'}
              </span>
            </div>
          )}
          {tip && <EdgeTip {...tip} nodes={store.nodes} />}
          {toast && (
            <div
              role="alert"
              className="absolute top-3 right-3 flex max-w-sm items-start gap-2 rounded-md border border-line-strong bg-panel px-3 py-2 text-[13px] shadow-float"
            >
              <p className="flex-1 text-fg">{toast.message}</p>
              {toast.retry && (
                <button
                  type="button"
                  className="font-medium text-accent underline"
                  onClick={() => {
                    const retry = toast.retry
                    setToast(null)
                    retry?.()
                  }}
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                aria-label="Dismiss"
                className="text-fg-subtle hover:text-fg"
                onClick={() => {
                  setToast(null)
                }}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
          )}
        </div>

        <SidePanel
          tab={tab}
          onTab={setTab}
          selected={selected}
          focus={focus}
          nodes={store.nodes}
          bundles={visible}
          onFocus={(id) => {
            go({ node: id })
          }}
          onHover={setHover}
          onPick={(id) => {
            setSelected(id)
          }}
        />
      </div>
    </Page>
  )
}

interface ToolbarProps {
  depth: Depth
  onDepth: (d: Depth) => void
  layout: LayoutMode
  onLayout: (mode: LayoutMode) => void
  types: ReadonlySet<GraphEdgeType>
  onToggleType: (t: GraphEdgeType) => void
  cycles: CycleState
  onToggleCycles: () => void
}

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-line-strong bg-panel">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => {
            onChange(o.value)
          }}
          className={`h-8 px-2.5 text-[13px] font-medium transition-colors duration-150 ${
            o.value === value ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-raised'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function EdgeSwatch({ type }: { type: GraphEdgeType }) {
  const s = EDGE_STYLES[type]
  return (
    <svg width="14" height="8" aria-hidden="true" className="shrink-0">
      <line x1="1" y1="4" x2="13" y2="4" style={{ stroke: s.stroke }} strokeWidth={Math.max(1.5, s.width)} strokeDasharray={s.dash} />
    </svg>
  )
}

function Toolbar({ depth, onDepth, layout, onLayout, types, onToggleType, cycles, onToggleCycles }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Segmented
        label="Depth"
        value={depth}
        onChange={onDepth}
        options={[
          { value: 1, label: '1-hop' },
          { value: 2, label: '2-hop' },
        ]}
      />
      <Segmented
        label="Layout"
        value={layout}
        onChange={onLayout}
        options={[
          { value: 'force', label: 'Force' },
          { value: 'rings', label: 'Rings' },
        ]}
      />
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-line-strong" />
      <div role="group" aria-label="Edge types" className="flex flex-wrap gap-1">
        {EDGE_TYPES.map((t) => {
          const on = types.has(t)
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              title={EDGE_STYLES[t].description}
              onClick={() => {
                onToggleType(t)
              }}
              className={`inline-flex h-8 items-center gap-1 rounded-md border px-1.5 font-mono text-[11px] font-medium transition-colors duration-150 ${
                on ? 'border-line-strong bg-selected text-fg' : 'border-line bg-panel text-fg-subtle hover:bg-raised'
              }`}
            >
              <EdgeSwatch type={t} />
              {t}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={cycles.status !== 'off'}
        onClick={onToggleCycles}
        className="ml-auto inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-raised"
      >
        {cycles.status === 'loading' ? (
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
        ) : (
          <span
            aria-hidden="true"
            className={`relative h-3.5 w-6.5 rounded-full transition-colors duration-150 ${cycles.status === 'on' ? 'bg-cycle' : 'bg-line-strong'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 size-2.5 rounded-full bg-panel transition-transform duration-150 ${cycles.status === 'on' ? 'translate-x-3' : ''}`}
            />
          </span>
        )}
        Highlight cycles
      </button>
    </div>
  )
}

function EdgeTip({ bundle, x, y, nodes }: { bundle: Bundle; x: number; y: number; nodes: ReadonlyMap<string, StoredNode> }) {
  const from = nodes.get(bundle.source)?.label ?? bundle.source
  const to = nodes.get(bundle.target)?.label ?? bundle.target
  const actions = Object.entries(bundle.actions)
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 max-w-72 rounded-md border border-line-strong bg-panel px-2.5 py-1.5 text-xs shadow-float"
      style={{ left: x + 14, top: y + 12 }}
    >
      <p className="font-mono text-[11px] font-medium text-fg">{bundle.type}</p>
      <p className="text-fg">
        {from} → {to}
      </p>
      {bundle.type === 'TRANSFER' && (
        <p className="font-mono text-fg-muted">
          {formatInr(bundle.amount)} in {bundle.count} {bundle.count === 1 ? 'transfer' : 'transfers'}
        </p>
      )}
      {actions.length > 0 && <p className="font-mono text-fg-muted">{actions.map(([a, c]) => `${a} ×${String(c)}`).join(' · ')}</p>}
      {bundle.last && <p className="font-mono text-fg-muted">last {tsFormat.format(new Date(bundle.last))}</p>}
    </div>
  )
}

interface SidePanelProps {
  tab: 'entity' | 'touch'
  onTab: (tab: 'entity' | 'touch') => void
  selected: string
  focus: string
  nodes: ReadonlyMap<string, StoredNode>
  bundles: readonly Bundle[]
  onFocus: (id: string) => void
  onHover: (ids: ReadonlySet<string> | null) => void
  onPick: (id: string) => void
}

function SidePanel({ tab, onTab, selected, focus, nodes, bundles, onFocus, onHover, onPick }: SidePanelProps) {
  const base = useId()
  const tabs = [
    { id: 'entity', label: 'Entity' },
    { id: 'touch', label: 'Who touched what' },
  ] as const
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    onTab(tab === 'entity' ? 'touch' : 'entity')
  }
  return (
    <aside
      aria-label="Graph details"
      className="flex h-[calc(100dvh-210px)] min-h-[460px] flex-col overflow-hidden rounded-card border border-line-strong bg-panel"
    >
      <div role="tablist" aria-label="Details" className="flex gap-1 border-b border-line px-2" onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`${base}-${t.id}-tab`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`${base}-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => {
              onTab(t.id)
            }}
            className={`-mb-px h-10 border-b-2 px-2.5 text-[13px] font-medium transition-colors duration-150 ${
              tab === t.id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`${base}-${tab}`} role="tabpanel" aria-labelledby={`${base}-${tab}-tab`} className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'entity' ? (
          <EntityCard key={selected} id={selected} focus={focus} bundles={bundles} onFocus={onFocus} />
        ) : (
          <TouchGrid nodes={nodes} bundles={bundles} focus={focus} selected={selected} onHover={onHover} onPick={onPick} />
        )}
      </div>
    </aside>
  )
}

const ACTION =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-raised'

const STAT_LABELS: Record<string, string> = {
  degree: 'Degree',
  accounts: 'Accounts',
  transfer_count_30d: 'Transfers, 30 days',
  sum_amount_30d: 'Moved, 30 days',
  action_count_30d: 'Actions, 30 days',
}

function EntityCard({ id, focus, bundles, onFocus }: { id: string; focus: string; bundles: readonly Bundle[]; onFocus: (id: string) => void }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    attempt: number
    entity: EntitySummary | null
    error: Error | null
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getEntity(id, controller.signal)
      .then((entity) => {
        setState({ attempt, entity, error: null })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ attempt, entity: null, error: toError(err) })
      })
    return () => {
      controller.abort()
    }
  }, [id, attempt])

  const counts = EDGE_TYPES.map(
    (t) => [t, bundles.filter((b) => b.type === t && (b.source === id || b.target === id)).reduce((s, b) => s + b.count, 0)] as const,
  ).filter(([, c]) => c > 0)

  if (state?.error && state.attempt === attempt) {
    return (
      <ErrorRetry
        title="These details could not be loaded"
        message={state.error.message}
        onRetry={() => {
          setAttempt((a) => a + 1)
        }}
      />
    )
  }
  const entity = state?.entity
  if (!entity) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-2.5">
        <span className="sr-only">Loading details</span>
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <span className="self-start rounded border border-line-strong px-1.5 py-0.5 text-[11px] font-medium text-fg-muted capitalize">{entity.type}</span>
        <h2 className="flex flex-wrap items-center gap-2 text-[17px] font-semibold tracking-tight text-fg">
          <span className={entity.type === 'account' ? 'font-mono text-[15px]' : ''}>{entity.label}</span>
          <RiskBadge band={entity.risk_band} />
        </h2>
        <code className="font-mono text-[11.5px] break-all text-fg-subtle">{entity.id}</code>
        {entity.detail && <p className="text-[13px] text-fg-muted first-letter:uppercase">{entity.detail}</p>}
      </div>
      <dl className="grid grid-cols-[128px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
        {Object.entries(entity.stats).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-fg-subtle">{STAT_LABELS[key] ?? key.replace(/_/g, ' ')}</dt>
            <dd className="font-mono text-fg">{key.startsWith('sum_amount') ? formatInr(value) : String(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-1.5">
        {entity.links.timeline && (
          <Link to={entity.links.timeline} className={ACTION}>
            <History aria-hidden="true" className="size-3.5" />
            View timeline
          </Link>
        )}
        {entity.links.alerts && (
          <Link to={entity.links.alerts} className={ACTION}>
            <TriangleAlert aria-hidden="true" className="size-3.5" />
            Alerts
          </Link>
        )}
        {entity.id !== focus && (
          <button
            type="button"
            onClick={() => {
              onFocus(entity.id)
            }}
            className={ACTION}
          >
            <Crosshair aria-hidden="true" className="size-3.5" />
            Focus here
          </button>
        )}
      </div>
      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-semibold text-fg-muted">Connections in view</h3>
        {counts.length === 0 ? (
          <p className="text-[13px] text-fg-muted">None with the current edge filters.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-[13px]">
            {counts.map(([t, c]) => (
              <li key={t} className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-mono text-[11.5px] text-fg">
                  <EdgeSwatch type={t} />
                  {t}
                </span>
                <span className="font-mono text-xs text-fg-muted">{c}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function TouchGrid({
  nodes,
  bundles,
  focus,
  selected,
  onHover,
  onPick,
}: {
  nodes: ReadonlyMap<string, StoredNode>
  bundles: readonly Bundle[]
  focus: string
  selected: string
  onHover: (ids: ReadonlySet<string> | null) => void
  onPick: (id: string) => void
}) {
  const matrix = useMemo(() => touchMatrix(nodes, bundles, focus), [nodes, bundles, focus])
  if (matrix.rows.length === 0 || matrix.employees.length === 0) {
    return (
      <p className="text-[13px] text-fg-muted">
        No employee changes or access among the entities in view. Turn on PROFILE_CHANGE and EMPLOYEE_ACCESS, or expand from a customer.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-fg-muted">
        Employees in view against the customers and accounts they changed or can access. Hover over a cell to light up those edges.
      </p>
      <div className="flex flex-wrap gap-3 text-[11.5px] text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-change" />
          Profile changes, size is the count
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-full border-[1.5px] border-dotted border-accent" />
          Access only
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px]">
          <caption className="sr-only">Employees who changed or can access each customer and account</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Entity</span>
              </th>
              {matrix.employees.map((e) => (
                <th key={e.id} scope="col" title={e.label} className={`px-0.5 pb-1 ${selected === e.id ? 'bg-selected' : ''}`}>
                  <span aria-hidden="true" className="grid size-[22px] place-items-center rounded-full bg-raised text-[9.5px] font-semibold text-fg-muted">
                    {initials(e.label)}
                  </span>
                  <span className="sr-only">{e.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.id}>
                <th
                  scope="row"
                  className={`max-w-[132px] truncate pr-2 text-right font-medium text-fg-muted ${row.type === 'account' ? 'font-mono text-[10.5px]' : ''} ${
                    selected === row.id ? 'bg-selected text-fg' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="max-w-full truncate hover:underline"
                    onClick={() => {
                      onPick(row.id)
                    }}
                  >
                    {row.label}
                  </button>
                </th>
                {matrix.employees.map((e) => {
                  const { changes, access } = matrix.cell(row.id, e.id)
                  const ids = [changes?.id, access?.id].filter((x): x is string => Boolean(x))
                  const size = changes ? 5 + Math.min(11, changes.count * 2) : 0
                  const summary = `${e.label} on ${row.label}: ${
                    changes ? `${String(changes.count)} profile ${changes.count === 1 ? 'change' : 'changes'}` : 'no changes'
                  }${access ? ', has access' : ''}`
                  return (
                    <td
                      key={e.id}
                      title={summary}
                      className={`h-6 w-[30px] border border-line p-0 text-center ${selected === row.id || selected === e.id ? 'bg-selected' : ''}`}
                      onMouseEnter={() => {
                        if (ids.length) onHover(new Set(ids))
                      }}
                      onMouseLeave={() => {
                        onHover(null)
                      }}
                    >
                      <span className="sr-only">{summary}</span>
                      {changes ? (
                        <span aria-hidden="true" className="inline-block rounded-[2px] bg-change align-middle" style={{ width: size, height: size }} />
                      ) : access ? (
                        <span aria-hidden="true" className="inline-block size-1.5 rounded-full border-[1.5px] border-dotted border-accent align-middle" />
                      ) : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-fg-muted">
        {matrix.employees.map((e, i) => (
          <span key={e.id}>
            {i > 0 && ' · '}
            <b className="font-semibold">{initials(e.label)}</b> {e.label}
          </span>
        ))}
      </p>
    </div>
  )
}

interface GraphSearchProps {
  onPick: (id: string) => void
  placeholder?: string
  autoFocus?: boolean
}

function GraphSearch({ onPick, placeholder = 'Search customers, accounts, employees', autoFocus = false }: GraphSearchProps) {
  const listId = useId()
  const [q, setQ] = useState('')
  const [result, setResult] = useState<{
    q: string
    hits: SearchHit[]
    error: string | null
  } | null>(null)
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const term = q.trim()

  useEffect(() => {
    if (!term) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchEntities(term, undefined, controller.signal)
        .then((hits) => {
          setResult({ q: term, hits, error: null })
          setActive(0)
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) setResult({ q: term, hits: [], error: toError(err).message })
        })
    }, 180)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [term])

  const hits = result && result.q === term ? result.hits : []
  const searching = term !== '' && result?.q !== term
  const show = open && term !== ''
  const pick = (hit: SearchHit | undefined) => {
    if (!hit) return
    setOpen(false)
    setQ('')
    onPick(hit.id)
  }
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((a) => Math.min(a + 1, hits.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(hits[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <label className="flex h-9 items-center gap-2 rounded-md border border-line-strong bg-panel px-3 transition-colors duration-150 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30 hover:border-fg-subtle">
        <Search aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
        <span className="sr-only">Search the graph</span>
        <input
          role="combobox"
          aria-expanded={show}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={show && hits[active] ? `${listId}-${String(active)}` : undefined}
          value={q}
          autoFocus={autoFocus}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            setOpen(true)
          }}
          onBlur={() => {
            setTimeout(() => {
              setOpen(false)
            }, 120)
          }}
          onKeyDown={onKey}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-fg-subtle focus:outline-none"
        />
        {searching && <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-fg-subtle" />}
      </label>
      {show && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-80 overflow-y-auto rounded-md border border-line-strong bg-panel py-1 shadow-float"
        >
          {result?.error && result.q === term ? (
            <li className="px-3 py-2 text-[13px] text-danger">{result.error}</li>
          ) : hits.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-fg-muted">{searching ? 'Searching…' : `Nothing matches “${term}”.`}</li>
          ) : (
            hits.map((hit, i) => (
              <li
                key={hit.id}
                id={`${listId}-${String(i)}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(hit)
                }}
                onMouseEnter={() => {
                  setActive(i)
                }}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] ${i === active ? 'bg-selected' : ''}`}
              >
                <span className="w-16 shrink-0 rounded border border-line-strong px-1 text-center text-[10.5px] font-medium text-fg-muted capitalize">
                  {hit.type}
                </span>
                <span className={`min-w-0 flex-1 truncate text-fg ${hit.type === 'account' ? 'font-mono text-xs' : ''}`}>{hit.label}</span>
                {hit.detail && <span className="max-w-[40%] truncate text-xs text-fg-muted">{hit.detail}</span>}
                <span className="shrink-0 font-mono text-[10.5px] text-fg-subtle">{shortId(hit.id)}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
