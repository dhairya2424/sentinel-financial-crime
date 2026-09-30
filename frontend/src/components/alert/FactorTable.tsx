import type { RiskBand, RiskFactor } from '@/api/types'
import { RiskBadge } from '@/components/RiskBadge'

interface FactorTableProps {
  factors: readonly RiskFactor[]
  score: number
  band: RiskBand
}

/** Neutral ink steps, largest contribution darkest: the bar reads as parts of one score, not as risk colour. */
const INK = ['bg-fg', 'bg-fg-muted', 'bg-fg-subtle', 'bg-line-strong', 'bg-raised']

const pts = (v: number) => (v * 100).toFixed(1)

/**
 * The weighted factors behind a risk band (PRD C5, docs/09 §5): each factor's raw value, weight and contribution,
 * how they compose the score, and the band that score falls in. Names are the frozen factor names, shown as-is.
 */
export function FactorTable({ factors, score, band }: FactorTableProps) {
  const ordered = [...factors].sort((a, b) => b.contribution - a.contribution)
  const total = ordered.reduce((s, f) => s + f.contribution, 0)
  const weights = ordered.reduce((s, f) => s + f.weight, 0)

  return (
    <section aria-labelledby="factors-heading" className="flex flex-col gap-3">
      <h3 id="factors-heading" className="text-[13px] font-semibold text-fg">
        Risk factors
      </h3>

      <div className="flex flex-col gap-1.5">
        <div
          role="img"
          aria-label={`Score ${String(score)} of 100, made of ${ordered.map((f) => `${f.name} ${pts(f.contribution)}`).join(', ')}`}
          className="flex h-2.5 overflow-hidden rounded-sm border border-line-strong bg-canvas"
        >
          {ordered.map((f, i) => (
            <span
              key={f.name}
              title={`${f.name}: ${pts(f.contribution)}`}
              className={`h-full border-r border-panel last:border-r-0 ${INK[Math.min(i, INK.length - 1)] ?? 'bg-raised'}`}
              style={{ width: `${String(f.contribution * 100)}%` }}
            />
          ))}
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-fg-muted">
          {ordered.map((f, i) => (
            <span key={f.name} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`size-2 rounded-[2px] ${INK[Math.min(i, INK.length - 1)] ?? 'bg-raised'}`} />
              <span className="font-mono">{f.name}</span>
              <span className="font-mono text-fg">{pts(f.contribution)}</span>
            </span>
          ))}
          <span className="text-fg-subtle">of 100</span>
        </p>
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[480px] border-collapse text-left text-[13px]">
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
              <tr key={f.name} data-testid="factor-row" className="border-b border-line">
                <td className="py-2 pr-2 font-mono text-xs text-fg">{f.name}</td>
                <td className="px-2 py-2 whitespace-nowrap text-fg">{f.raw_value}</td>
                <td className="px-2 py-2 text-right font-mono text-xs text-fg-muted tabular-nums">{f.weight.toFixed(2)}</td>
                <td className="py-2 pl-2">
                  <div className="flex items-center gap-2">
                    <div className="relative h-2 min-w-20 flex-1" aria-hidden="true">
                      <span
                        className="absolute inset-y-0 left-0 rounded-[2px] ring-1 ring-line-strong ring-inset"
                        style={{ width: `${String(f.weight * 100)}%` }}
                      />
                      <span className="absolute inset-y-0 left-0 rounded-[2px] bg-fg-muted" style={{ width: `${String(f.contribution * 100)}%` }} />
                    </div>
                    <span className="w-10 text-right font-mono text-xs text-fg tabular-nums">{pts(f.contribution)}</span>
                  </div>
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
      </div>
      <p className="text-xs text-fg-subtle">
        Contributions add up to the score: {ordered.map((f) => pts(f.contribution)).join(' + ')} = {pts(total)}, rounded {score}. The outlined track is each
        factor's weight, the most it could add.
      </p>
    </section>
  )
}
