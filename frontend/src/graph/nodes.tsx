import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { ReactNode } from 'react'
import type { GraphNodeType, RiskBand } from '@/api/types'
import { initials, shortId } from '@/lib/format'

export interface EntityNodeData extends Record<string, unknown> {
  label: string
  entityType: GraphNodeType
  risk: RiskBand
  focus: boolean
  dim: boolean
}

export type EntityFlowNode = Node<EntityNodeData, GraphNodeType>

const HEX = 'polygon(10% 0, 90% 0, 100% 50%, 90% 100%, 10% 100%, 0 50%)'
const RISK_BORDER: Record<RiskBand, string | null> = {
  low: null,
  medium: 'var(--band-medium)',
  high: 'var(--band-high)',
  critical: 'var(--band-critical)',
}
const HANDLE = '!pointer-events-none !h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0'

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} className={HANDLE} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className={HANDLE} />
    </>
  )
}

function borderColor(data: EntityNodeData): string {
  if (data.dim) return 'var(--line)'
  return RISK_BORDER[data.risk] ?? (data.focus ? 'var(--fg)' : 'var(--line-strong)')
}

const ink = (data: EntityNodeData) => (data.dim ? 'text-fg-subtle' : 'text-fg')

function Frame({ selected, round, children }: { data: EntityNodeData; selected: boolean; round: string; children: ReactNode }) {
  return (
    <div
      className={`${round} transition-colors duration-150 ${selected ? 'outline-2 outline-offset-4 outline-accent' : ''}`}
    >
      {children}
      <Handles />
    </div>
  )
}

export function CustomerNode({ id, data, selected }: NodeProps<EntityFlowNode>) {
  return (
    <Frame data={data} selected={selected} round="rounded-[9px]">
      <div
        className="min-w-24 rounded-[7px] border bg-panel px-3 py-1.5 text-center"
        style={{ borderColor: borderColor(data), borderWidth: data.focus || data.risk !== 'low' ? 1.5 : 1 }}
      >
        <div className={`text-xs font-medium whitespace-nowrap ${ink(data)}`}>{data.label}</div>
        <div className="font-mono text-[10px] text-fg-subtle">{shortId(id)}</div>
      </div>
    </Frame>
  )
}

export function AccountNode({ data, selected }: NodeProps<EntityFlowNode>) {
  return (
    <Frame data={data} selected={selected} round="rounded-md">
      <div className="relative h-[30px] w-[108px]" style={{ clipPath: HEX, background: borderColor(data) }}>
        <div className={`absolute inset-px grid place-items-center bg-panel font-mono text-[10.5px] ${ink(data)}`} style={{ clipPath: HEX }}>
          {data.label}
        </div>
      </div>
    </Frame>
  )
}

export function EmployeeNode({ data, selected }: NodeProps<EntityFlowNode>) {
  return (
    <Frame data={data} selected={selected} round="rounded-full">
      <div
        className="inline-flex h-7 items-center gap-2 rounded-full border bg-panel pr-3 pl-1"
        style={{ borderColor: borderColor(data), borderWidth: data.focus || data.risk !== 'low' ? 1.5 : 1 }}
      >
        <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-raised text-[9px] font-semibold text-fg-muted">
          {initials(data.label)}
        </span>
        <span className={`text-xs font-medium whitespace-nowrap ${ink(data)}`}>{data.label}</span>
      </div>
    </Frame>
  )
}

export function TransactionNode({ id, data, selected }: NodeProps<EntityFlowNode>) {
  return (
    <Frame data={data} selected={selected} round="rounded-sm">
      <div className="inline-flex items-center gap-1.5 rounded-sm bg-panel px-1 py-0.5" title={id}>
        <span aria-hidden="true" className="size-2.5 rotate-45 border border-ev bg-panel" />
        <span className={`font-mono text-[10px] ${data.dim ? 'text-fg-subtle' : 'text-fg-muted'}`}>{shortId(id)}</span>
      </div>
    </Frame>
  )
}
