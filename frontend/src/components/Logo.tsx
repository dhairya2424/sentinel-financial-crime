const LOGO_SRC: string | null = null

interface LogoProps {
  wordmarkClassName?: string
  large?: boolean
}

export function Logo({ wordmarkClassName = '', large = false }: LogoProps) {
  const box = large ? 'size-9' : 'size-7'
  return (
    <span className="flex items-center gap-2.5">
      {LOGO_SRC ? (
        <img src={LOGO_SRC} alt="" className={`${box} shrink-0 object-contain`} />
      ) : (
        <span
          aria-hidden="true"
          className={`${box} grid shrink-0 place-items-center rounded-md border border-dashed border-line-strong font-mono text-[7px] tracking-[0.08em] text-fg-subtle`}
        >
          LOGO
        </span>
      )}
      <span className={`font-semibold tracking-tight text-fg ${large ? 'text-lg' : 'text-[15px]'} ${wordmarkClassName}`}>
        Sentinel
      </span>
    </span>
  )
}
