// Shared primitive components — Tailwind v4 utilities

const SIZE_CLS = {
  sm: 'w-5 h-5 text-[7px]',
  md: 'w-7 h-7 text-[10px]',
  lg: 'w-10 h-10 text-[14px]',
  xl: 'w-[84px] h-[84px] text-[28px]',
}

const Avatar = ({ name, size = 'md', ring = false }) => {
  const { c1, c2 } = avatarFor(name || '??')
  const ringCls = ring
    ? 'shadow-[0_0_0_2px_var(--color-primary),0_0_12px_var(--color-primary-glow)]'
    : 'shadow-[inset_0_0_0_1px_oklch(0_0_0/0.15)]'
  return (
    <span
      className={`inline-grid place-items-center rounded-full text-white font-bold flex-shrink-0 leading-none ${SIZE_CLS[size]} ${ringCls}`}
      style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
    >
      {initials(name || '??')}
    </span>
  )
}

const AvatarStack = ({ names = [], max = 3, size = 'sm' }) => {
  const visible = names.slice(0, max)
  const rest = Math.max(0, names.length - max)
  return (
    <span className="inline-flex [&>*+*]:-ml-2 [&>*+*]:shadow-[0_0_0_2px_var(--color-bg)_inset,0_0_0_1px_oklch(0_0_0/0.15)_inset]">
      {visible.map((n, i) => (
        <Avatar key={i} name={n} size={size} />
      ))}
      {rest > 0 && (
        <span
          className={`inline-flex items-center justify-center rounded-full font-semibold flex-shrink-0 ${SIZE_CLS[size]} bg-surface-2 text-fg-muted tabular-nums tracking-tight`}
        >
          +{rest}
        </span>
      )}
    </span>
  )
}

const CHIP_VARIANTS = {
  '': 'bg-surface-2 border-border text-fg-muted',
  live: 'bg-[color-mix(in_oklch,var(--color-live)_22%,transparent)] border-[color-mix(in_oklch,var(--color-live)_55%,transparent)] text-[oklch(0.98_0.02_25)]',
  accent: 'bg-primary border-transparent text-primary-ink font-semibold',
  ok: 'bg-[color-mix(in_oklch,var(--color-success)_22%,transparent)] border-[color-mix(in_oklch,var(--color-success)_40%,transparent)] text-success',
}

const Chip = ({ children, kind = '', dot = false }) => {
  const variant = CHIP_VARIANTS[kind] || CHIP_VARIANTS['']
  const dotBg =
    kind === 'live'
      ? 'bg-live shadow-[0_0_8px_var(--color-live)] animate-[pulse_1.6s_infinite]'
      : 'bg-current'
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-[3px] border rounded-full text-[10.5px] tracking-[0.06em] ${variant}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotBg}`} />}
      {children}
    </span>
  )
}

// Stylized screen-share placeholder — striped bg w/ mono label
const ScreenPlaceholder = ({ kind = 'ableton', label }) => {
  const k = SCREEN_KINDS[kind] || SCREEN_KINDS.ableton
  const hue = k.hue
  return (
    <div className="absolute inset-0 overflow-hidden bg-bg">
      <div
        className="absolute inset-0"
        style={{
          background: `
          radial-gradient(80% 50% at 20% 10%, oklch(0.3 0.08 ${hue} / 0.55), transparent 60%),
          radial-gradient(60% 50% at 90% 90%, oklch(0.4 0.12 ${hue} / 0.45), transparent 60%),
          repeating-linear-gradient(135deg, oklch(0.18 0.02 ${hue}) 0, oklch(0.18 0.02 ${hue}) 14px, oklch(0.14 0.02 ${hue}) 14px, oklch(0.14 0.02 ${hue}) 28px)
        `,
        }}
      />
      <div
        className="absolute bottom-11 left-2.5 z-[1] text-[9.5px] tracking-[0.16em] px-[7px] py-[3px] rounded-[5px] border border-dashed border-white/15 backdrop-blur-[4px]"
        style={{
          color: `oklch(0.9 0.05 ${hue} / 0.8)`,
          background: 'oklch(0 0 0 / 0.45)',
        }}
      >
        {label || k.label}
      </div>
    </div>
  )
}

// Wave bars — staggered animation requires @keyframes; kept as a class.
const Wave = ({ on = true }) => (
  <span
    className="wave inline-flex items-end gap-[2px] h-3"
    style={{ opacity: on ? 1 : 0.3 }}
  >
    <i />
    <i />
    <i />
    <i />
    <i />
  </span>
)

Object.assign(window, { Avatar, AvatarStack, Chip, ScreenPlaceholder, Wave })
