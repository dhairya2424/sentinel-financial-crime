interface SkeletonProps {
  className?: string
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-md bg-raised ${className}`} />
}

interface SkeletonRowsProps {
  rows?: number
  label?: string
}

export function SkeletonRows({ rows = 6, label = 'Loading' }: SkeletonRowsProps) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-md border border-line bg-panel px-3 py-2.5">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  )
}
