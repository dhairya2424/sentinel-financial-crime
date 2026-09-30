/** The arrowheads BundleEdge points at (url(#sentinel-arrow…)); mount once per page that draws graph edges. */
export function ArrowMarkers() {
  return (
    <svg aria-hidden="true" className="absolute h-0 w-0">
      <defs>
        <marker id="sentinel-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" style={{ fill: 'var(--fg-subtle)' }} />
        </marker>
        <marker id="sentinel-arrow-cycle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" style={{ fill: 'var(--cycle)' }} />
        </marker>
      </defs>
    </svg>
  )
}
