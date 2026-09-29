import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { RiskBand } from '@/api/types'
import { RiskBadge } from '../RiskBadge'

describe('RiskBadge', () => {
  const cases: [RiskBand, string][] = [
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
    ['critical', 'Critical'],
  ]

  it.each(cases)('renders %s with an icon and a text label, never colour alone', (band, label) => {
    render(<RiskBadge band={band} />)
    const badge = screen.getByLabelText(`Risk: ${label}`)
    expect(badge).toHaveTextContent(label)
    expect(badge).toHaveAttribute('data-band', band)
    expect(badge.querySelector('svg')).not.toBeNull()
  })
})
