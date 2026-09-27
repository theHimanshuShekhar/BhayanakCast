// Shared primitive components — Tailwind v4 utilities

const SIZE_CLS = {
  sm: 'w-5 h-5 text-[7px]',
  md: 'w-7 h-7 text-[10px]',
  lg: 'w-10 h-10 text-[14px]',
  xl: 'w-[84px] h-[84px] text-[28px]',
};

const Avatar = ({ name, size = 'md', ring = false, className = '' }) => {
  const { c1, c2 } = avatarFor(name || '??');
  const ringCls = ring
    ? 'shadow-[0_0_0_2px_var(--color-primary),0_0_12px_var(--color-primary-glow)]'
    : 'shadow-[inset_0_0_0_1px_oklch(0_0_0/0.15)]';
  return (
    <span
      className={`inline-grid place-items-center rounded-full text-white font-bold flex-shrink-0 leading-none ${SIZE_CLS[size]} ${ringCls} ${className}`}
      style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
      {initials(name || '??')}
    </span>
  );
};

const AvatarStack = ({ names = [], max = 3, size = 'sm' }) => {
  const visible = names.slice(0, max);
  const rest = Math.max(0, names.length - max);
  return (
    <span className="inline-flex [&>*+*]:-ml-2 [&>*+*]:shadow-[0_0_0_2px_var(--color-bg)_inset,0_0_0_1px_oklch(0_0_0/0.15)_inset]">
      {visible.map((n, i) => <Avatar key={i} name={n} size={size} />)}
      {rest > 0 && (
        <span className={`inline-flex items-center justify-center rounded-full font-semibold flex-shrink-0 ${SIZE_CLS[size]} bg-surface-2 text-fg-muted tabular-nums tracking-tight`}>
          +{rest}
        </span>
      )}
    </span>
  );
};

const CHIP_VARIANTS = {
  '': 'bg-surface-2 border-border text-fg-muted',
  live: 'bg-[color-mix(in_oklch,var(--color-live)_22%,transparent)] border-[color-mix(in_oklch,var(--color-live)_55%,transparent)] text-live-ink',
  accent: 'bg-primary border-transparent text-primary-ink font-semibold',
  liveSolid: 'bg-[color-mix(in_oklch,var(--color-live)_85%,black)] border-transparent text-white font-semibold',
  ok: 'bg-[color-mix(in_oklch,var(--color-success)_22%,transparent)] border-[color-mix(in_oklch,var(--color-success)_40%,transparent)] text-success-ink',
};

const Chip = ({ children, kind = '', dot = false, className = '' }) => {
  const variant = CHIP_VARIANTS[kind] || CHIP_VARIANTS[''];
  const dotBg = kind === 'liveSolid' ? 'bg-white animate-bc-pulse' : kind === 'live' ? 'bg-live shadow-[0_0_8px_var(--color-live)] animate-bc-pulse' : 'bg-current';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-[3px] border rounded-full whitespace-nowrap text-[10.5px] tracking-[0.06em] ${variant} ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotBg}`}/>}
      {children}
    </span>
  );
};

const BTN_SIZES = { md: 'h-[34px] px-3.5 text-[12px]', sm: 'h-7 px-2.5 text-[11.5px]' };
const BTN_ICON_SIZES = { md: 'w-[34px] h-[34px]', sm: 'w-7 h-7' };
const BTN_VARIANTS = {
  default: 'bg-surface border-border text-fg shadow-card hover:bg-surface-2 hover:border-border-strong',
  primary: 'bg-primary border-transparent text-primary-ink font-semibold shadow-[0_1px_0_oklch(1_0_0/0.35)_inset,0_-1px_0_oklch(0_0_0/0.2)_inset,0_6px_20px_var(--color-primary-glow)] hover:brightness-110',
  ghost: 'bg-transparent border-transparent text-fg hover:bg-surface-2',
  danger: 'bg-[color-mix(in_oklch,var(--color-live)_18%,var(--color-surface))] border-[color-mix(in_oklch,var(--color-live)_45%,transparent)] text-live-ink',
};

const Btn = ({ children, variant = 'default', size = 'md', icon = false, className = '', ...rest }) => (
  <button
    className={`inline-flex items-center justify-center gap-2 border rounded-[var(--radius-sm)] font-medium whitespace-nowrap cursor-pointer transition-[background-color,border-color,filter,transform] duration-[120ms] active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed ${icon ? `${BTN_ICON_SIZES[size]} p-0` : BTN_SIZES[size]} ${BTN_VARIANTS[variant]} ${className}`}
    {...rest}>
    {children}
  </button>
);

const IconBtn = ({ children, className = '', ...rest }) => (
  <button
    className={`w-8 h-8 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-fg-muted cursor-pointer hover:bg-surface-2 hover:text-fg transition-colors ${className}`}
    {...rest}>
    {children}
  </button>
);

const MonoCaps = ({ children, className = '' }) => (
  <span className={`uppercase tracking-[0.12em] text-[10px] text-muted font-medium ${className}`}>{children}</span>
);

// Stylized screen-share placeholder — striped bg w/ mono label
const ScreenPlaceholder = ({ kind = 'ableton', label, frame = 0 }) => {
  const k = SCREEN_KINDS[kind] || SCREEN_KINDS.ableton;
  const hue = k.hue;
  // frame shifts the gradient focal points so each snapshot looks like a new capture
  const j = (n) => ((Math.sin((frame + 1) * n * 12.9898 + hue) * 43758.5453) % 1 + 1) % 1;
  const ax = frame ? Math.round(10 + j(1) * 40) : 20, ay = frame ? Math.round(j(2) * 40) : 10;
  const bx = frame ? Math.round(55 + j(3) * 40) : 90, by = frame ? Math.round(55 + j(4) * 40) : 90;
  return (
    <div className="absolute inset-0 overflow-hidden bg-bg">
      <div className="absolute inset-0" style={{
        background: `
          radial-gradient(80% 50% at ${ax}% ${ay}%, oklch(0.3 0.08 ${hue} / 0.55), transparent 60%),
          radial-gradient(60% 50% at ${bx}% ${by}%, oklch(0.4 0.12 ${hue} / 0.45), transparent 60%),
          repeating-linear-gradient(135deg, oklch(0.18 0.02 ${hue}) 0, oklch(0.18 0.02 ${hue}) 14px, oklch(0.14 0.02 ${hue}) 14px, oklch(0.14 0.02 ${hue}) 28px)
        `,
      }}/>
      {label !== false && <div
        className="absolute top-11 left-2.5 z-[1] text-[9.5px] tracking-[0.16em] px-[7px] py-[3px] rounded-[5px] border border-dashed border-white/15 backdrop-blur-[4px] bg-black/45"
        style={{ color: `oklch(0.9 0.05 ${hue} / 0.8)` }}>
        {label || k.label}
      </div>}
    </div>
  );
};

const Wave = ({ on = true }) => (
  <span className="inline-flex items-end gap-[2px] h-3" style={{ opacity: on ? 1 : 0.3 }}>
    {[0, 0.1, 0.2, 0.3, 0.4].map(d => (
      <i key={d} className="block w-[2px] h-1 rounded-[2px] bg-primary animate-bc-wave" style={{ animationDelay: `${d}s` }}/>
    ))}
  </span>
);

Object.assign(window, { Avatar, AvatarStack, Chip, Btn, IconBtn, MonoCaps, ScreenPlaceholder, Wave });
