/** Group a rupee amount as it is typed, Indian style (1,85,000.50). Keeps at most two decimals and drops anything else. */
export function groupInr(raw: string): string {
  const digits = raw.replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = digits.split('.')
  const w = whole.replace(/^0+(?=\d)/, '')
  const grouped = w.length > 3 ? `${w.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${w.slice(-3)}` : w
  return digits.includes('.') ? `${grouped}.${rest.join('').slice(0, 2)}` : grouped
}
