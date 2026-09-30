import type { RiskBand, RiskFactor } from '@/api/types'
import { RiskBadge } from '@/components/RiskBadge'

interface FactorTableProps {
  factors: readonly RiskFactor[]
  score: number
  band: RiskBand
}

/** Neutral ink steps, largest measured contribution darkest: the bar reads as parts of one score, not as risk colour. */
const INK = ['bg-fg', 'bg-fg-muted', 'bg-fg-subtle', 'bg-line-strong', 'bg-raised']
/** A factor that could not be measured holds a neutral default: drawn as an outline, never as a filled measurement. */
const NEUTRAL = 'border border-dashed border-fg-muted bg-canvas'

const pts = (v: number) => (v * 100).toFixed(1)

function Contribution({ factor, value = true }: { factor: RiskFactor; value?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 min-w-16 flex-1" aria-hidden="true">
        <span className="absolute inset-y-0 left-0 rounded-[2px] ring-1 ring-line-strong ring-inset" style={{ width: `${String(factor.weight * 100)}%` }} />
        <span
          className={`absolute inset-y-0 left-0 rounded-[2px] ${factor.imputed ? NEUTRAL : 'bg-fg-muted'}`}
          style={{ width: `${String(factor.contribution * 100)}%` }}
        />
      </div>
      {value && <span className="w-10 text-right font-mono text-xs text-fg tabular-nums">{pts(factor.contribution)}</span>}
    </div>
  )
}

function RawValue({ factor }: { factor: RiskFactor }) {
  return (
    <>
      {factor.raw_value}
      {factor.imputed && <span className="text-fg-subtle"> · neutral default</span>}
    </>
  )
}

/**
 * The weighted factors behind a risk band (PRD C5, docs/09 §5): each factor's raw value, weight and contribution,
 * how they compose the score, and the band that score falls in. Names are the frozen factor names, shown as-is.
 * Factors that could not be measured are marked as neutral defaults everywhere they appear, and the note says how
 * many points they carry, so the score never looks better evidenced than it is.
 */
export function FactorTable({ factors, score, band }: FactorTableProps) {
  const ordered = [...factors].sort((a, b) => Number(Boolean(a.imputed)) - Number(Boolean(b.imputed)) || b.contribution - a.contribution)
  const total = ordered.reduce((s, f) => s + f.contribution, 0)
  const weights = ordered.reduce((s, f) => s + f.weight, 0)
  const neutral = ordered.filter((f) => f.imputed)
  const neutralPts = neutral.reduce((s, f) => s + f.contribution, 0)
  const ink = (f: RiskFactor, i: number) => (f.imputed ? NEUTRAL : (INK[Math.min(i, INK.length - 1)] ?? 'bg-raised'))

  return (
    <section aria-labelledby="factors-heading" className="flex flex-col gap-3">
      <h3 id="factors-heading" className="text-[13px] font-semibold text-fg">
        Risk factors
      </h3>

      <div className="flex flex-col gap-1.5">
        <div
          role="img"
          aria-label={`Score ${String(score)} of 100, made of ${ordered.map((f) => `${f.name} ${pts(f.contribution)}${f.imputed ? ' (neutral default)' : ''}`).join(', ')}`}
          className="flex h-2.5 overflow-hidden rounded-sm border border-line-strong bg-canvas"
        >
          {ordered.map((f, i) => (
            <span
              key={f.name}
              title={`${f.name}: ${pts(f.contribution)}${f.imputed ? ' (neutral default)' : ''}`}
              className={`h-full border-r border-panel last:border-r-0 ${ink(f, i)}`}
              style={{ width: `${String(f.contribution * 100)}%` }}
            />
          ))}
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-fg-muted">
          {ordered.map((f, i) => (
            <span key={f.name} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`size-2 rounded-[2px] ${ink(f, i)}`} />
              <span className="font-mono">{f.name}</span>
              <span className="font-mono text-fg">{pts(f.contribution)}</span>
            </span>
          ))}
          <span className="text-fg-subtle">of 100</span>
        </p>
      </div>

      <table className="hidden w-full border-collapse text-left text-[13px] sm:table">
        <thead className="text-xs text-fg-subtle">
          <tr className="border-b border-line">
            <th scope="col" className="py-1.5 pr-2 font-medium">
              Factor
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Raw value
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Weight
            </th>
            <th scope="col" className="py-1.5 pl-2 font-medium">
              Contribution
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((f) => (
            <tr key={f.name} data-testid="factor-row" data-imputed={f.imputed || undefined} className="border-b border-line">
              <td className="py-2 pr-2 font-mono text-xs text-fg">{f.name}</td>
              <td className="px-2 py-2 whitespace-nowrap text-fg">
                <RawValue factor={f} />
              </td>
              <td className="px-2 py-2 text-right font-mono text-xs text-fg-muted tabular-nums">{f.weight.toFixed(2)}</td>
              <td className="py-2 pl-2">
                <Contribution factor={f} />
              </td>
            </tr>
          ))}
          <tr className="border-b border-line font-semibold">
            <td className="py-2 pr-2 text-fg">Composite</td>
            <td />
            <td className="px-2 py-2 text-right font-mono text-xs text-fg-muted tabular-nums">{weights.toFixed(2)}</td>
            <td className="py-2 pl-2 text-right font-mono text-xs text-fg tabular-nums" data-testid="composite">
              {pts(total)} → {score}
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-2 font-semibold text-fg">Band</td>
            <td colSpan={3} className="py-2 pl-2 text-right">
              <RiskBadge band={band} />
            </td>
          </tr>
        </tbody>
      </table>

      {/* Below 640px: two lines per factor, so Composite and Band stay in view without sideways scrolling. */}
      <ul className="flex flex-col sm:hidden" aria-label="Risk factors">
        {ordered.map((f) => (
          <li key={f.name} className="flex flex-col gap-1 border-b border-line py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-xs text-fg">{f.name}</span>
              <span className="font-mono text-xs text-fg tabular-nums">{pts(f.contribution)}</span>
            </div>
            <div className="flex items-center gap-3 text-[13px] text-fg">
              <span className="min-w-0 flex-1 truncate">
                <RawValue factor={f} />
              </span>
              <span className="font-mono text-xs text-fg-muted">w {f.weight.toFixed(2)}</span>
              <span className="w-16 shrink-0">
                <Contribution factor={f} value={false} />
              </span>
            </div>
          </li>
        ))}
        <li className="flex items-baseline justify-between border-b border-line py-2 text-[13px] font-semibold text-fg">
          Composite
          <span className="font-mono text-xs tabular-nums">
            {pts(total)} → {score}
          </span>
        </li>
        <li className="flex items-center justify-between py-2 text-[13px] font-semibold text-fg">
          Band
          <RiskBadge band={band} />
        </li>
      </ul>

      <p className="text-xs text-fg-subtle">
        Contributions add up to the score: {ordered.map((f) => pts(f.contribution)).join(' + ')} = {pts(total)}, rounded {score}. The outlined track is each
        factor's weight, the most it could add.
        {neutral.length > 0 && (
          <span data-testid="neutral-note" className="text-fg-muted">
            {' '}
            {pts(neutralPts)} of the {score} points are neutral defaults for {neutral.map((f) => f.name).join(' and ')}, which could not be measured yet:
            there is too little transfer history to compare against.
          </span>
        )}
      </p>
    </section>
  )
}
