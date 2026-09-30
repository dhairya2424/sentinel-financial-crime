import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNodeType } from '@/api/types'
import { CYCLE_STYLE, EDGE_STYLES, EDGE_TYPES, edgeStyle } from '../edges'
import { bundleEdges, emptyStore, graphQuery, mergeNeighborhood, nodeAriaLabel, parseGraphParams, touchMatrix } from '../model'
import type { EntityFlowNode } from '../nodes'
import { NODE_TYPES } from '../registry'

const flowNode = (id: string, type: GraphNodeType, label: string, x: number): EntityFlowNode => ({
  id,
  type,
  position: { x, y: 0 },
  data: { label, entityType: type, risk: 'low', focus: false, dim: false },
  ariaLabel: nodeAriaLabel(type, label),
})

describe('graph nodes', () => {
  it('T-FE-10: every node carries the aria-label `${type} ${label}`', () => {
    const nodes = [
      flowNode('cust_1', 'customer', 'Karan Apte', 0),
      flowNode('acct_1', 'account', 'XXXXXXXX1158', 200),
      flowNode('emp_1', 'employee', 'Ananya Patil', 400),
    ]
    render(
      <div style={{ width: 800, height: 400 }}>
        <ReactFlowProvider>
          <ReactFlow nodes={nodes} edges={[]} nodeTypes={NODE_TYPES} />
        </ReactFlowProvider>
      </div>,
    )
    expect(screen.getByLabelText('customer Karan Apte')).toBeInTheDocument()
    expect(screen.getByLabelText('account XXXXXXXX1158')).toBeInTheDocument()
    expect(screen.getByLabelText('employee Ananya Patil')).toBeInTheDocument()
  })
})

describe('edge style map', () => {
  it('returns the TRANSFER class and a distinct cycle style', () => {
    expect(edgeStyle('TRANSFER').className).toBe('edge-transfer')
    expect(EDGE_STYLES.TRANSFER.arrow).toBe(true)
    expect(EDGE_STYLES.ACCOUNT_HOLDER.dash).toBeDefined()
    expect(EDGE_STYLES.EMPLOYEE_ACCESS.stroke).toBe('var(--accent)')
    expect(edgeStyle('TRANSFER', true)).toBe(CYCLE_STYLE)
    expect(EDGE_TYPES).toEqual(['TRANSFER', 'ACCOUNT_HOLDER', 'EMPLOYEE_ACCESS', 'PROFILE_CHANGE', 'EMPLOYEE_ACTION'])
  })
})

describe('URL state', () => {
  it('parses ?node&depth with depth defaulting to 2', () => {
    expect(parseGraphParams(new URLSearchParams('node=acct_123&depth=1'))).toEqual({ node: 'acct_123', depth: 1, until: null })
    expect(parseGraphParams(new URLSearchParams('node=cust_9'))).toEqual({ node: 'cust_9', depth: 2, until: null })
    expect(parseGraphParams(new URLSearchParams('depth=7'))).toEqual({ node: null, depth: 2, until: null })
    expect(parseGraphParams(new URLSearchParams('node=%20%20'))).toEqual({ node: null, depth: 2, until: null })
    expect(graphQuery({ node: 'acct_123', depth: 2, until: null })).toBe('node=acct_123&depth=2')
    const anchored = parseGraphParams(new URLSearchParams('node=cust_9&until=2026-09-28T07%3A37%3A19%2B00%3A00'))
    expect(anchored.until).toBe('2026-09-28T07:37:19+00:00')
    expect(graphQuery(anchored)).toBe('node=cust_9&depth=2&until=2026-09-28T07%3A37%3A19%2B00%3A00')
    expect(parseGraphParams(new URLSearchParams('node=cust_9&until=2026-09-28T07:37:19')).until).toBeNull()
    expect(parseGraphParams(new URLSearchParams('node=cust_9&until=yesterday')).until).toBeNull()
  })
})

const edge = (id: string, source: string, target: string, type: GraphEdge['type'], props: GraphEdge['props'] = {}): GraphEdge => ({
  id,
  source,
  target,
  type,
  props,
})

describe('bundling and the who-touched-what grid', () => {
  const edges = [
    edge('act_1', 'emp_1', 'cust_1', 'PROFILE_CHANGE', { action: 'profile.edit', event_ts: '2026-09-20T10:00:00Z' }),
    edge('act_2', 'emp_1', 'cust_1', 'PROFILE_CHANGE', { action: 'profile.edit', event_ts: '2026-09-22T10:00:00Z' }),
    edge('ar_1>cust_1', 'emp_1', 'cust_1', 'EMPLOYEE_ACCESS', { entitlement: 'profile.edit' }),
    edge('ar_2>cust_2', 'emp_2', 'cust_2', 'EMPLOYEE_ACCESS', { entitlement: 'profile.edit' }),
    edge('tx_1', 'acct_1', 'acct_2', 'TRANSFER', { amount: '1200.50', ts: '2026-09-21T10:00:00Z' }),
    edge('tx_2', 'acct_1', 'acct_2', 'TRANSFER', { amount: '800.00', ts: '2026-09-23T10:00:00Z' }),
  ]

  it('merges repeated edges of one type between two nodes into one bundle', () => {
    const bundles = bundleEdges(edges)
    const changes = bundles.find((b) => b.id === 'PROFILE_CHANGE:emp_1>cust_1')!
    expect(changes.count).toBe(2)
    expect(changes.ids).toEqual(['act_1', 'act_2'])
    expect(changes.last).toBe('2026-09-22T10:00:00Z')
    expect(changes.actions).toEqual({ 'profile.edit': 2 })
    expect(bundles.find((b) => b.type === 'TRANSFER')!.amount).toBeCloseTo(2000.5)
    expect(changes.offset).not.toBe(bundles.find((b) => b.id === 'EMPLOYEE_ACCESS:emp_1>cust_1')!.offset)
  })

  it('builds rows of touched entities against employee columns', () => {
    const store = mergeNeighborhood(emptyStore(), {
      truncated: false,
      edges,
      nodes: [
        { id: 'cust_1', type: 'customer', label: 'Karan Apte', risk: 'low', degree: 3, depth: 0 },
        { id: 'cust_2', type: 'customer', label: 'Isha Sharma', risk: 'low', degree: 1, depth: 2 },
        { id: 'emp_1', type: 'employee', label: 'Ananya Patil', risk: 'low', degree: 3, depth: 1 },
        { id: 'emp_2', type: 'employee', label: 'Omkar Iyer', risk: 'low', degree: 1, depth: 2 },
        { id: 'acct_1', type: 'account', label: 'XXXX0001', risk: 'low', degree: 2, depth: 1 },
        { id: 'acct_2', type: 'account', label: 'XXXX0002', risk: 'low', degree: 2, depth: 2 },
      ],
    })
    const matrix = touchMatrix(store.nodes, bundleEdges(store.edges.values()), 'cust_1')
    expect(matrix.rows.map((r) => r.id)).toEqual(['cust_1', 'cust_2'])
    expect(matrix.employees.map((e) => e.label)).toEqual(['Ananya Patil', 'Omkar Iyer'])
    expect(matrix.cell('cust_1', 'emp_1').changes?.count).toBe(2)
    expect(matrix.cell('cust_1', 'emp_1').access).toBeDefined()
    expect(matrix.cell('cust_2', 'emp_1')).toEqual({ changes: undefined, access: undefined })
  })
})
