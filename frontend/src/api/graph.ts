import { api } from './client'
import type { CycleResult, EntitySummary, GraphEdgeType, GraphNodeType, Neighborhood, SearchHit } from './types'

export function searchEntities(q: string, types?: readonly GraphNodeType[], signal?: AbortSignal): Promise<SearchHit[]> {
  const query = new URLSearchParams({ q })
  if (types?.length) query.set('types', types.join(','))
  return api<SearchHit[]>(`/v1/graph/search?${query.toString()}`, { signal })
}

export function getEntity(id: string, signal?: AbortSignal): Promise<EntitySummary> {
  return api<EntitySummary>(`/v1/graph/entity/${encodeURIComponent(id)}`, { signal })
}

export function getNeighbors(
  nodeId: string,
  depth: 1 | 2,
  edgeTypes?: readonly GraphEdgeType[],
  signal?: AbortSignal,
): Promise<Neighborhood> {
  const query = new URLSearchParams({ node_id: nodeId, depth: String(depth) })
  if (edgeTypes?.length) query.set('edge_types', edgeTypes.join(','))
  return api<Neighborhood>(`/v1/graph/neighbors?${query.toString()}`, { signal })
}

export function getCycles(nodeId: string, windowHours = 72, until: string | null = null, signal?: AbortSignal): Promise<CycleResult> {
  const query = new URLSearchParams({ node_id: nodeId, window_hours: String(windowHours) })
  if (until) query.set('until', until)
  return api<CycleResult>(`/v1/graph/cycles?${query.toString()}`, { signal })
}
