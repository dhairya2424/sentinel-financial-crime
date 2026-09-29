import { Compass } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { SCREENS, type Screen } from '@/lib/screens'

interface PageProps {
  title: string
  meta?: ReactNode
  children: ReactNode
  wide?: boolean
}

export function Page({ title, meta, children, wide = false }: PageProps) {
  return (
    <div className={`flex w-full flex-col px-4 lg:px-8 ${wide ? 'gap-4 py-5 lg:py-6' : 'max-w-6xl gap-6 py-6 lg:py-8'}`}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {meta}
      </header>
      {children}
    </div>
  )
}

interface ScreenPlaceholderProps {
  screen: Screen
  title?: string
  meta?: ReactNode
}

export function ScreenPlaceholder({ screen, title, meta }: ScreenPlaceholderProps) {
  return (
    <Page title={title ?? screen.title} meta={meta}>
      <section className="grid min-h-72 place-items-center rounded-card border border-dashed border-line-strong bg-panel">
        <EmptyState icon={screen.Icon} title={`Arrives in Phase ${screen.phase}`} description={screen.summary} />
      </section>
    </Page>
  )
}

function IdMeta({ id }: { id: string | undefined }) {
  return id ? <code className="font-mono text-[13px] text-fg-muted">{id}</code> : null
}

export function AlertsScreen() {
  return <ScreenPlaceholder screen={SCREENS.alerts} />
}

export function AlertDetailScreen() {
  const { id } = useParams()
  return <ScreenPlaceholder screen={SCREENS.alert} meta={<IdMeta id={id} />} />
}

export function CasesScreen() {
  return <ScreenPlaceholder screen={SCREENS.cases} />
}

export function CaseDetailScreen() {
  const { id } = useParams()
  return <ScreenPlaceholder screen={SCREENS.case} meta={<IdMeta id={id} />} />
}

export function RulesScreen() {
  return <ScreenPlaceholder screen={SCREENS.rules} />
}

export function NotFoundScreen() {
  return (
    <Page title="Page not found">
      <EmptyState
        icon={Compass}
        title="This page doesn't exist"
        description="The address may be mistyped, or the page may belong to a phase that isn't built yet."
        action={
          <Link to="/" className="font-medium text-accent underline">
            Go to the dashboard
          </Link>
        }
      />
    </Page>
  )
}
