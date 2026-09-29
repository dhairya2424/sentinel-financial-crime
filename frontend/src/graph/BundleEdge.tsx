import { BaseEdge, EdgeLabelRenderer, useInternalNode, useStore, type Edge, type EdgeProps, type InternalNode } from '@xyflow/react'
import { bundleWidth, edgeStyle } from './edges'
import type { Bundle } from './model'

export interface BundleEdgeData extends Record<string, unknown> {
  bundle: Bundle
  cycle: boolean
  dim: boolean
  quiet: boolean
}

export type BundleFlowEdge = Edge<BundleEdgeData, 'bundle'>

function box(node: InternalNode) {
  const w = node.measured.width ?? 0
  const h = node.measured.height ?? 0
  const { x, y } = node.internals.positionAbsolute
  return { cx: x + w / 2, cy: y + h / 2, hw: w / 2 + 5, hh: h / 2 + 5 }
}

function exit(from: ReturnType<typeof box>, dx: number, dy: number) {
  const scale = Math.min(from.hw / Math.max(Math.abs(dx), 1e-6), from.hh / Math.max(Math.abs(dy), 1e-6))
  return { x: from.cx + dx * Math.min(scale, 0.49), y: from.cy + dy * Math.min(scale, 0.49) }
}

export function BundleEdge({ id, source, target, data }: EdgeProps<BundleFlowEdge>) {
  const s = useInternalNode(source)
  const t = useInternalNode(target)
  const zoom = useStore((state) => state.transform[2])
  if (!s || !t || !data) return null
  const a = box(s)
  const b = box(t)
  const dx = b.cx - a.cx
  const dy = b.cy - a.cy
  const len = Math.hypot(dx, dy) || 1
  const { offset, count, type } = data.bundle
  const mx = (a.cx + b.cx) / 2 - (dy / len) * offset
  const my = (a.cy + b.cy) / 2 + (dx / len) * offset
  const start = exit(a, mx - a.cx, my - a.cy)
  const end = exit(b, mx - b.cx, my - b.cy)
  const path = `M${start.x},${start.y} Q${mx},${my} ${end.x},${end.y}`
  const lx = (start.x + 2 * mx + end.x) / 4
  const ly = (start.y + 2 * my + end.y) / 4
  const style = edgeStyle(type, data.cycle)
  const marker = style.arrow ? `url(#${data.cycle ? 'sentinel-arrow-cycle' : 'sentinel-arrow'})` : undefined

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={marker}
        interactionWidth={14}
        className={style.className}
        style={{
          stroke: style.stroke,
          strokeWidth: data.quiet ? 1 : data.cycle ? style.width : bundleWidth(style, count),
          strokeDasharray: data.cycle ? undefined : style.dash,
          opacity: data.dim ? 0.14 : data.quiet ? 0.28 : 1,
          transition: 'opacity 150ms ease-out',
        }}
      />
      {(data.cycle || (count > 1 && !data.dim && !data.quiet)) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          >
            {data.cycle ? (
              <span
                className="rounded border border-warn-line bg-warn-bg px-1.5 py-px font-semibold text-warn-fg"
                style={{ fontSize: Math.min(Math.max(11 / zoom, 10), 20) }}
              >
                Cycle
              </span>
            ) : (
              <span
                className="font-mono text-fg-muted [text-shadow:0_0_3px_var(--canvas),0_0_3px_var(--canvas)]"
                style={{ fontSize: Math.min(Math.max(11 / zoom, 9.5), 20) }}
              >
                ×{count}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
