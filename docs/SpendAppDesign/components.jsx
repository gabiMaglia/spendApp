// components.jsx — SplitP2P shared atoms & molecules
// All components use --sp-* tokens (see tokens.css). React Native equivalents
// noted inline as: Colors.brand.primary, Typography.bodyL, etc.

/* ─────────────────────────────────────────────────────────────
   ICONS — line icons drawn inline (SF Symbols / Material analogs)
   ─────────────────────────────────────────────────────────────
   Maps to: react-native-vector-icons or expo @expo/vector-icons
   Each icon uses currentColor + stroke for tinting from CSS. */
function Icon({ name, size = 20, stroke = 1.8, color, style }) {
  const s = { width: size, height: size, flexShrink: 0, color, ...style };
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const map = {
    chevronLeft: <path d="M14 6l-6 6 6 6" {...p}/>,
    chevronRight: <path d="M9 6l6 6-6 6" {...p}/>,
    chevronDown: <path d="M6 9l6 6 6-6" {...p}/>,
    plus: <><path d="M12 5v14M5 12h14" {...p}/></>,
    check: <path d="M5 12.5l4.5 4.5L19 7" {...p}/>,
    checkSmall: <path d="M5 12l4 4 10-10" {...p}/>,
    close: <path d="M6 6l12 12M18 6L6 18" {...p}/>,
    search: <><circle cx="11" cy="11" r="7" {...p}/><path d="M20 20l-3.5-3.5" {...p}/></>,
    home: <path d="M4 11L12 4l8 7v9a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1v-9z" {...p}/>,
    users: <><circle cx="9" cy="8" r="3.5" {...p}/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" {...p}/><circle cx="17" cy="9" r="2.5" {...p}/><path d="M15.5 14.5c2.6.4 4.5 2.5 4.5 5" {...p}/></>,
    bell: <><path d="M6 9a6 6 0 1112 0c0 4 1.5 6 1.5 6h-15S6 13 6 9z" {...p}/><path d="M10 19a2 2 0 004 0" {...p}/></>,
    activity: <path d="M3 12h4l3-8 4 16 3-8h4" {...p}/>,
    settings: <><circle cx="12" cy="12" r="3" {...p}/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3h0a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8v0a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" {...p}/></>,
    creditCard: <><rect x="2.5" y="6" width="19" height="13" rx="2.5" {...p}/><path d="M2.5 10h19" {...p}/></>,
    receipt: <path d="M5 3h14v18l-2-1.5L15 21l-2-1.5L11 21l-2-1.5L7 21l-2-1.5V3zm3 5h8m-8 4h8m-8 4h5" {...p}/>,
    camera: <><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" {...p}/><circle cx="12" cy="13" r="3.5" {...p}/></>,
    qr: <><rect x="3" y="3" width="7" height="7" rx="1" {...p}/><rect x="14" y="3" width="7" height="7" rx="1" {...p}/><rect x="3" y="14" width="7" height="7" rx="1" {...p}/><path d="M14 14h2v2m4 0v5M14 18h2v3" {...p}/></>,
    link: <><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 10-5.7-5.7L11 7" {...p}/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 105.7 5.7L13 17" {...p}/></>,
    share: <><circle cx="6" cy="12" r="2.5" {...p}/><circle cx="18" cy="6" r="2.5" {...p}/><circle cx="18" cy="18" r="2.5" {...p}/><path d="M8.2 10.8l7.6-3.6m0 9.6l-7.6-3.6" {...p}/></>,
    arrowRight: <path d="M5 12h14m-5-6l6 6-6 6" {...p}/>,
    arrowLeft: <path d="M19 12H5m6 6l-6-6 6-6" {...p}/>,
    arrowUpRight: <path d="M7 17L17 7M9 7h8v8" {...p}/>,
    edit: <><path d="M11 4H5a1 1 0 00-1 1v14a1 1 0 001 1h14a1 1 0 001-1v-6" {...p}/><path d="M18.5 2.5a2 2 0 113 3L12 15l-4 1 1-4 9.5-9.5z" {...p}/></>,
    trash: <path d="M4 6h16m-2 0v13a1 1 0 01-1 1H7a1 1 0 01-1-1V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2m-5 5v6m4-6v6" {...p}/>,
    moreHorizontal: <><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/></>,
    moreVertical: <><circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/></>,
    sync: <path d="M4 12a8 8 0 0114-5.3L20 9V3m0 9a8 8 0 01-14 5.3L4 15v6" {...p}/>,
    cloudOff: <><path d="M5 18a4 4 0 01-1-7.7A6 6 0 0115 7" {...p}/><path d="M3 3l18 18M19 15.5a3.5 3.5 0 00-2-6.5h-.2" {...p}/></>,
    dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>,
    calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" {...p}/><path d="M3.5 10h17M8 3v4m8-4v4" {...p}/></>,
    info: <><circle cx="12" cy="12" r="9" {...p}/><path d="M12 8v.01M11 11.5h1v5h1" {...p}/></>,
    warning: <><path d="M12 3l10 18H2L12 3z" {...p}/><path d="M12 10v4m0 3v.01" {...p}/></>,
    sparkle: <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3zm7 9l.7 2.3L22 15l-2.3.7L19 18l-.7-2.3L16 15l2.3-.7L19 12z" {...p}/>,
    pro: <path d="M5 4l1.5 4.5L11 10 6.5 11.5 5 16l-1.5-4.5L-1 10l4.5-1.5L5 4zm10 0l1.5 4.5L21 10l-4.5 1.5L15 16l-1.5-4.5L9 10l4.5-1.5L15 4z" fill="currentColor" stroke="none"/>,
    google: <path d="M21.6 11.1c0-.6-.1-1.2-.2-1.7H12v3.4h5.4a4.6 4.6 0 01-2 3v2.5h3.3c1.9-1.8 3-4.4 3-7.2z M12 21c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 01-5.5-4H3.2v2.5A9 9 0 0012 21z M6.5 13.1a5.4 5.4 0 010-3.5V7.1H3.2a9 9 0 000 9.8l3.3-2.5v-1.3z M12 5.4c1.5 0 2.8.5 3.9 1.5l2.9-2.9A9 9 0 0012 1 9 9 0 003.2 7.1l3.3 2.5C7.4 7.1 9.5 5.4 12 5.4z" fill="currentColor" stroke="none"/>,
    apple: <path d="M16.4 12.4c0-2.7 2.2-4 2.3-4.1-1.3-1.8-3.2-2.1-3.9-2.1-1.7-.2-3.3 1-4.1 1-.8 0-2.2-1-3.6-1-1.9 0-3.6 1.1-4.5 2.7C.7 12.2 2 17.1 3.7 19.8c.9 1.3 1.9 2.7 3.2 2.7 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.3 3.1-2.6.5-.8.8-1.6 1.1-2.4-1.8-.7-2.4-2.7-2.4-4.9zM13.8 4.5c.7-.9 1.2-2.1 1.1-3.3-1.1.1-2.4.7-3.1 1.6-.6.8-1.2 2-1 3.2 1.2.1 2.4-.6 3-1.5z" fill="currentColor" stroke="none"/>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" {...p}/><circle cx="12" cy="12" r="3" {...p}/></>,
    bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" {...p}/>,
    /* Category icons */
    catFood: <path d="M5 3v8a3 3 0 003 3v7m-3-9h6m-3-9v9m6-9v6a3 3 0 003 3v6" {...p}/>,
    catTransport: <><path d="M5 11l2-5h10l2 5m-14 0v7h2v-2h10v2h2v-7H5z" {...p}/><circle cx="8" cy="15" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="15" r="1.2" fill="currentColor" stroke="none"/></>,
    catAccommodation: <path d="M3 12L12 4l9 8v9h-6v-6H9v6H3v-9z" {...p}/>,
    catEntertainment: <><circle cx="12" cy="12" r="9" {...p}/><path d="M9 9v6l5-3-5-3z" {...p}/></>,
    catUtilities: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" {...p}/>,
    catHealth: <path d="M12 20s-7-4-7-10a4 4 0 017-2.7A4 4 0 0119 10c0 6-7 10-7 10z" {...p}/>,
    catShopping: <path d="M5 8h14l-1 12H6L5 8zm3 0V6a4 4 0 018 0v2" {...p}/>,
    catOther: <><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/></>,
  };
  return (
    <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
      {map[name] || <circle cx="12" cy="12" r="9" {...p}/>}
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────
   AVATAR — circular, with initials or fixed hue
   Maps to: <Avatar name size colorIndex /> in React Native
   ───────────────────────────────────────────────────────────── */
const AVATAR_HUES = [
  ['#E8965A', '#FFFFFF'], // orange
  ['#4D9FD6', '#FFFFFF'], // blue
  ['#8B7CC4', '#FFFFFF'], // purple
  ['#D4729C', '#FFFFFF'], // pink
  ['#4DAA9E', '#FFFFFF'], // teal
  ['#D4A848', '#1F1A14'], // yellow
  ['#6FA075', '#FFFFFF'], // green
  ['#C45447', '#FFFFFF'], // coral
];
function Avatar({ name = '?', size = 36, hue = 0, ring, style }) {
  const [bg, fg] = AVATAR_HUES[hue % AVATAR_HUES.length];
  const initials = String(name).split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() || '').join('') || '?';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: bg, color: fg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.4), fontWeight: 600, letterSpacing: '-0.02em',
      flexShrink: 0,
      boxShadow: ring ? `0 0 0 2px ${ring}` : 'none',
      ...style,
    }}>{initials}</div>
  );
}

/* AvatarStack — overlapping avatars w/ +N overflow */
function AvatarStack({ people = [], size = 28, max = 4, ring = 'var(--sp-surface)' }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((p, i) => (
        <div key={i} style={{ marginLeft: i === 0 ? 0 : -size * 0.3 }}>
          <Avatar name={p.name} hue={p.hue ?? i} size={size} ring={ring}/>
        </div>
      ))}
      {extra > 0 && (
        <div style={{
          marginLeft: -size * 0.3, width: size, height: size, borderRadius: '50%',
          background: 'var(--sp-surface-sunken)', color: 'var(--sp-text-secondary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: Math.round(size * 0.35), fontWeight: 600,
          boxShadow: `0 0 0 2px ${ring}`,
        }}>+{extra}</div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   BALANCEPILL — small badge for +/-$N
   Maps to: <BalancePill amount currency /> using Colors.positive/negative
   ───────────────────────────────────────────────────────────── */
function BalancePill({ amount, currency = '$', size = 'md', style }) {
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  const settled = amount === 0;
  const bg = settled ? 'var(--sp-surface-sunken)'
    : amount > 0 ? 'var(--sp-positive-soft)' : 'var(--sp-negative-soft)';
  const fg = settled ? 'var(--sp-text-tertiary)'
    : amount > 0 ? 'var(--sp-positive-onSoft)' : 'var(--sp-negative-onSoft)';
  const pad = size === 'sm' ? '2px 8px' : size === 'lg' ? '6px 12px' : '3px 10px';
  const fs = size === 'sm' ? 12 : size === 'lg' ? 15 : 13;
  return (
    <span className="sp-amount" style={{
      display: 'inline-flex', alignItems: 'center', padding: pad,
      borderRadius: 'var(--sp-r-full)', background: bg, color: fg,
      fontSize: fs, lineHeight: 1.2,
      ...style,
    }}>{sign}{currency}{Math.abs(amount).toLocaleString('es-AR')}</span>
  );
}

/* ─────────────────────────────────────────────────────────────
   CATEGORYICON — filled chip badge w/ white glyph
   Maps to: <CategoryIcon kind="food" size={40} />
   ───────────────────────────────────────────────────────────── */
const CATEGORY_META = {
  food:          { color: 'var(--sp-cat-food)',          icon: 'catFood',          label: 'Comida' },
  transport:     { color: 'var(--sp-cat-transport)',     icon: 'catTransport',     label: 'Transporte' },
  accommodation: { color: 'var(--sp-cat-accommodation)', icon: 'catAccommodation', label: 'Alojamiento' },
  entertainment: { color: 'var(--sp-cat-entertainment)', icon: 'catEntertainment', label: 'Ocio' },
  utilities:     { color: 'var(--sp-cat-utilities)',     icon: 'catUtilities',     label: 'Servicios' },
  health:        { color: 'var(--sp-cat-health)',        icon: 'catHealth',        label: 'Salud' },
  shopping:      { color: 'var(--sp-cat-shopping)',      icon: 'catShopping',      label: 'Compras' },
  other:         { color: 'var(--sp-cat-other)',         icon: 'catOther',         label: 'Otros' },
};
function CategoryIcon({ kind = 'other', size = 40, style }) {
  const m = CATEGORY_META[kind] || CATEGORY_META.other;
  // Read tweak from data-icon-style on the iPhone root.
  // Filled = colored circle + white icon. Outlined = surface bg + colored icon.
  return (
    <div className="sp-cat-icon" data-cat={kind} style={{
      width: size, height: size, borderRadius: '50%',
      background: m.color, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, ...style,
    }}>
      <Icon name={m.icon} size={Math.round(size * 0.55)} stroke={2}/>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   BUTTONS
   Variants: primary | secondary | destructive | ghost | iconOnly
   Maps to: <Button variant="primary" />
   ───────────────────────────────────────────────────────────── */
function Button({ children, variant = 'primary', size = 'md', leftIcon, rightIcon, block, style, onClick }) {
  const v = {
    primary: { background: 'var(--sp-brand-primary)', color: 'var(--sp-text-onBrand)', border: 'none' },
    secondary: { background: 'var(--sp-surface)', color: 'var(--sp-text)', border: '1px solid var(--sp-border-strong)' },
    destructive: { background: 'var(--sp-negative)', color: '#fff', border: 'none' },
    ghost: { background: 'transparent', color: 'var(--sp-brand-primary)', border: 'none' },
    soft: { background: 'var(--sp-brand-primary-soft)', color: 'var(--sp-brand-primary-onSoft)', border: 'none' },
  }[variant];
  const sz = size === 'sm' ? { h: 36, pad: '0 14px', fs: 14, r: 'var(--sp-r-sm)' }
    : size === 'lg' ? { h: 52, pad: '0 22px', fs: 17, r: 'var(--sp-r-md)' }
    : { h: 44, pad: '0 18px', fs: 15, r: 'var(--sp-r-md)' };
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      gap: 8, height: sz.h, padding: sz.pad, borderRadius: sz.r,
      fontFamily: 'var(--sp-font)', fontSize: sz.fs, fontWeight: 600, letterSpacing: '-0.1px',
      cursor: 'pointer', width: block ? '100%' : undefined,
      ...v, ...style,
    }}>
      {leftIcon && <Icon name={leftIcon} size={sz.fs + 3} stroke={2}/>}
      {children}
      {rightIcon && <Icon name={rightIcon} size={sz.fs + 3} stroke={2}/>}
    </button>
  );
}

function IconButton({ name, size = 44, iconSize, variant = 'ghost', style, onClick }) {
  const v = variant === 'soft' ? { background: 'var(--sp-surface-sunken)', color: 'var(--sp-text)' }
    : variant === 'filled' ? { background: 'var(--sp-brand-primary)', color: '#fff' }
    : { background: 'transparent', color: 'var(--sp-text)' };
  return (
    <button onClick={onClick} style={{
      width: size, height: size, borderRadius: '50%', border: 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', flexShrink: 0,
      ...v, ...style,
    }}><Icon name={name} size={iconSize || Math.round(size * 0.5)} stroke={1.9}/></button>
  );
}

/* FAB — floating action button */
function FAB({ icon = 'plus', label, style, onClick }) {
  return (
    <button onClick={onClick} style={{
      position: 'absolute', right: 20, bottom: 96,
      height: 56, paddingLeft: label ? 16 : 0, paddingRight: label ? 20 : 0,
      minWidth: 56, borderRadius: 'var(--sp-r-full)', border: 'none',
      background: 'var(--sp-brand-primary)', color: '#fff',
      boxShadow: '0 8px 24px rgba(10, 110, 143, 0.35), 0 2px 6px rgba(10, 110, 143, 0.20)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      fontFamily: 'var(--sp-font)', fontSize: 16, fontWeight: 600,
      cursor: 'pointer', zIndex: 4, ...style,
    }}>
      <Icon name={icon} size={24} stroke={2.2}/>
      {label}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────
   INPUTS
   ───────────────────────────────────────────────────────────── */
function TextField({ label, value, placeholder, leftIcon, rightAdorn, helper, error, autoFocus, style, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label && <div className="sp-label">{label}</div>}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        height: 48, padding: '0 14px',
        borderRadius: 'var(--sp-r-md)', background: 'var(--sp-surface)',
        border: `1px solid ${error ? 'var(--sp-error)' : 'var(--sp-border)'}`,
        boxShadow: autoFocus ? '0 0 0 3px rgba(10, 110, 143, 0.15)' : 'none',
        borderColor: autoFocus ? 'var(--sp-brand-primary)' : (error ? 'var(--sp-error)' : 'var(--sp-border)'),
      }}>
        {leftIcon && <Icon name={leftIcon} size={18} color="var(--sp-text-tertiary)"/>}
        <input
          {...(onChange ? { value: value || '', onChange } : { defaultValue: value || '' })}
          placeholder={placeholder}
          style={{
            flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
            fontFamily: 'var(--sp-font)', fontSize: 17, color: 'var(--sp-text)',
          }}
        />
        {rightAdorn}
      </div>
      {(helper || error) && (
        <div style={{ fontSize: 12, color: error ? 'var(--sp-error)' : 'var(--sp-text-tertiary)' }}>{error || helper}</div>
      )}
    </div>
  );
}

/* AmountInput — prominent monto display with calculator-style keypad below */
function AmountDisplay({ amount = '0', currency = 'ARS', symbol = '$', style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, ...style }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{currency}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, color: 'var(--sp-text)' }}>
        <span style={{ fontSize: 32, fontWeight: 500, color: 'var(--sp-text-tertiary)', lineHeight: 1, paddingBottom: 6 }}>{symbol}</span>
        <span className="sp-amount" style={{ fontSize: 56, lineHeight: 1, letterSpacing: '-1.5px' }}>{amount}</span>
      </div>
    </div>
  );
}

/* Numpad — calculator-style for amounts */
function Numpad({ style }) {
  const keys = ['1','2','3','4','5','6','7','8','9','.','0','⌫'];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6,
      padding: '8px 14px 18px', ...style,
    }}>
      {keys.map((k, i) => (
        <button key={i} style={{
          height: 52, borderRadius: 'var(--sp-r-md)', border: 'none',
          background: 'transparent', color: 'var(--sp-text)',
          fontFamily: 'var(--sp-font)', fontSize: 26, fontWeight: 500,
          cursor: 'pointer',
        }}>{k === '⌫' ? <Icon name="arrowLeft" size={22} stroke={2}/> : k}</button>
      ))}
    </div>
  );
}

/* SegmentedControl */
function SegmentedControl({ value, options, onChange, style }) {
  return (
    <div style={{
      display: 'inline-flex', padding: 3, background: 'var(--sp-surface-sunken)',
      borderRadius: 'var(--sp-r-md)', gap: 2, ...style,
    }}>
      {options.map(opt => {
        const v = typeof opt === 'string' ? opt : opt.value;
        const lbl = typeof opt === 'string' ? opt : opt.label;
        const active = v === value;
        return (
          <button key={v} onClick={() => onChange && onChange(v)} style={{
            flex: 1, height: 32, padding: '0 14px', minWidth: 0,
            border: 'none', borderRadius: 'var(--sp-r-sm)',
            background: active ? 'var(--sp-surface)' : 'transparent',
            color: active ? 'var(--sp-text)' : 'var(--sp-text-secondary)',
            fontFamily: 'var(--sp-font)', fontSize: 13, fontWeight: 600,
            boxShadow: active ? 'var(--sp-shadow-1)' : 'none',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{lbl}</button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   BADGES
   ───────────────────────────────────────────────────────────── */
function Badge({ children, tone = 'neutral', size = 'md', style }) {
  const tones = {
    neutral: { bg: 'var(--sp-surface-sunken)', fg: 'var(--sp-text-secondary)' },
    positive: { bg: 'var(--sp-positive-soft)', fg: 'var(--sp-positive-onSoft)' },
    negative: { bg: 'var(--sp-negative-soft)', fg: 'var(--sp-negative-onSoft)' },
    warning:  { bg: 'var(--sp-warning-soft)', fg: '#8A6420' },
    brand:    { bg: 'var(--sp-brand-primary-soft)', fg: 'var(--sp-brand-primary-onSoft)' },
    accent:   { bg: 'var(--sp-brand-accent-soft)', fg: 'var(--sp-brand-accent-onSoft)' },
  };
  const t = tones[tone] || tones.neutral;
  const pad = size === 'sm' ? '2px 7px' : '3px 9px';
  const fs = size === 'sm' ? 11 : 12;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: pad,
      borderRadius: 'var(--sp-r-full)', background: t.bg, color: t.fg,
      fontSize: fs, fontWeight: 600, letterSpacing: '0.01em',
      lineHeight: 1.3, ...style,
    }}>{children}</span>
  );
}

function ProBadge({ style }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px 2px 6px', borderRadius: 'var(--sp-r-full)',
      background: 'linear-gradient(135deg, #D4A848, #E8965A)',
      color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
      lineHeight: 1.3, ...style,
    }}>
      <Icon name="sparkle" size={11} stroke={0} color="#fff" style={{ color: '#fff' }}/>
      PRO
    </span>
  );
}

/* SyncStatusBadge — pill in headers showing P2P sync state */
function SyncStatusBadge({ state = 'synced', style }) {
  const map = {
    synced:    { label: 'Sincronizado', color: 'var(--sp-positive)', icon: 'check' },
    syncing:   { label: 'Sincronizando…', color: 'var(--sp-brand-primary)', icon: 'sync' },
    pending:   { label: 'Cambios pendientes', color: 'var(--sp-warning)', icon: 'dot' },
    offline:   { label: 'Sin conexión', color: 'var(--sp-text-tertiary)', icon: 'cloudOff' },
  };
  const s = map[state] || map.synced;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px 4px 8px', borderRadius: 'var(--sp-r-full)',
      background: 'var(--sp-surface)', border: '1px solid var(--sp-border)',
      fontSize: 12, fontWeight: 500, color: 'var(--sp-text-secondary)',
      ...style,
    }}>
      <Icon name={s.icon} size={12} color={s.color} stroke={2.4} style={{ color: s.color }}/>
      {s.label}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────
   CARDS
   ───────────────────────────────────────────────────────────── */

/* Generic card surface */
function Card({ children, padded = true, style, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-lg)',
      padding: padded ? 'var(--sp-card-pad)' : 0,
      border: '1px solid var(--sp-border-hair)',
      ...style,
    }}>{children}</div>
  );
}

/* ExpenseCard — descripción · pagador · monto · splits · categoría */
function ExpenseCard({ category = 'other', title, payer, date, amount, currency = '$', yourShare, splits = [], style }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: 'var(--sp-card-pad)',
      background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-lg)',
      border: '1px solid var(--sp-border-hair)',
      ...style,
    }}>
      <CategoryIcon kind={category} size={42}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <div className="sp-bodyL" style={{ fontWeight: 600, color: 'var(--sp-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>
            {payer} pagó · {date}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <div className="sp-amount sp-amount-m" style={{ color: 'var(--sp-text)' }}>{currency}{amount.toLocaleString('es-AR')}</div>
        {yourShare !== undefined && <BalancePill amount={yourShare} size="sm" currency={currency}/>}
        {splits.length > 0 && yourShare === undefined && <AvatarStack people={splits} size={20} max={4}/>}
      </div>
    </div>
  );
}

/* GroupCard — nombre · cantidad de miembros · balance neto del usuario */
function GroupCard({ name, members = [], memberCount, balance, currency = '$', subtitle, style, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: 'var(--sp-card-pad)',
      background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-lg)',
      border: '1px solid var(--sp-border-hair)',
      cursor: onClick ? 'pointer' : 'default',
      ...style,
    }}>
      {/* group "tile" */}
      <div style={{
        width: 48, height: 48, borderRadius: 'var(--sp-r-md)',
        background: 'var(--sp-brand-primary-soft)',
        color: 'var(--sp-brand-primary-onSoft)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon name="users" size={22} stroke={2}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sp-bodyL" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>{name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <AvatarStack people={members} size={20} max={4}/>
          <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>
            {memberCount ?? members.length} miembros{subtitle ? ` · ${subtitle}` : ''}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        {balance === 0 ? (
          <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>Saldado</div>
        ) : balance > 0 ? (
          <>
            <div className="sp-bodyS" style={{ color: 'var(--sp-positive)', fontWeight: 600 }}>Te deben</div>
            <div className="sp-amount sp-amount-m" style={{ color: 'var(--sp-positive)' }}>{currency}{balance.toLocaleString('es-AR')}</div>
          </>
        ) : (
          <>
            <div className="sp-bodyS" style={{ color: 'var(--sp-negative)', fontWeight: 600 }}>Debés</div>
            <div className="sp-amount sp-amount-m" style={{ color: 'var(--sp-negative)' }}>{currency}{Math.abs(balance).toLocaleString('es-AR')}</div>
          </>
        )}
      </div>
    </div>
  );
}

/* BalanceSummaryCard — hero del Dashboard */
function BalanceSummaryCard({ owedToYou = 0, youOwe = 0, currency = '$', style }) {
  const net = owedToYou - youOwe;
  return (
    <div style={{
      padding: 20,
      background: 'var(--sp-surface)',
      borderRadius: 'var(--sp-r-2xl)',
      border: '1px solid var(--sp-border-hair)',
      boxShadow: 'var(--sp-shadow-1)',
      ...style,
    }}>
      <div className="sp-label" style={{ marginBottom: 4 }}>Balance global</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 14 }}>
        <span style={{
          fontSize: 12, fontWeight: 600,
          color: net >= 0 ? 'var(--sp-positive)' : 'var(--sp-negative)',
        }}>{net >= 0 ? 'A favor' : 'En contra'}</span>
        <span className="sp-amount" style={{
          fontSize: 36, lineHeight: 1, letterSpacing: '-0.8px',
          color: net >= 0 ? 'var(--sp-positive)' : 'var(--sp-negative)',
        }}>
          {net >= 0 ? '+' : '−'}{currency}{Math.abs(net).toLocaleString('es-AR')}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{
          padding: 12, borderRadius: 'var(--sp-r-md)',
          background: 'var(--sp-positive-soft)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-positive-onSoft)', letterSpacing: '0.04em' }}>TE DEBEN</div>
          <div className="sp-amount" style={{ fontSize: 20, marginTop: 4, color: 'var(--sp-positive-onSoft)' }}>{currency}{owedToYou.toLocaleString('es-AR')}</div>
        </div>
        <div style={{
          padding: 12, borderRadius: 'var(--sp-r-md)',
          background: 'var(--sp-negative-soft)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-negative-onSoft)', letterSpacing: '0.04em' }}>DEBÉS</div>
          <div className="sp-amount" style={{ fontSize: 20, marginTop: 4, color: 'var(--sp-negative-onSoft)' }}>{currency}{youOwe.toLocaleString('es-AR')}</div>
        </div>
      </div>
    </div>
  );
}

/* PaymentCard — quién le pagó a quién */
function PaymentCard({ from, to, amount, currency = '$', date, note, style }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: 'var(--sp-card-pad)',
      background: 'var(--sp-positive-soft)', borderRadius: 'var(--sp-r-lg)',
      ...style,
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: '50%',
        background: 'var(--sp-positive)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon name="arrowRight" size={22} stroke={2.2}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sp-bodyL" style={{ fontWeight: 600, color: 'var(--sp-positive-onSoft)' }}>
          {from} → {to}
        </div>
        <div className="sp-bodyS" style={{ color: 'var(--sp-positive-onSoft)', opacity: 0.75, marginTop: 2 }}>
          Pago registrado · {date}{note ? ` · ${note}` : ''}
        </div>
      </div>
      <div className="sp-amount sp-amount-m" style={{ color: 'var(--sp-positive-onSoft)' }}>{currency}{amount.toLocaleString('es-AR')}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   EMPTY STATE
   ───────────────────────────────────────────────────────────── */
function EmptyState({ illustration, title, body, action, style }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 14, padding: '32px 24px', textAlign: 'center', ...style,
    }}>
      {illustration || (
        <div style={{
          width: 96, height: 96, borderRadius: 'var(--sp-r-2xl)',
          background: 'var(--sp-brand-primary-soft)',
          color: 'var(--sp-brand-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="users" size={40} stroke={1.6}/>
        </div>
      )}
      <div style={{ textAlign: 'center' }}>
        <div className="sp-h3" style={{ color: 'var(--sp-text)', marginBottom: 6 }}>{title}</div>
        <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)', maxWidth: 280 }}>{body}</div>
      </div>
      {action}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   BOTTOM SHEET wrapper
   ───────────────────────────────────────────────────────────── */
function BottomSheet({ children, style }) {
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      background: 'var(--sp-surface)',
      borderTopLeftRadius: 'var(--sp-r-2xl)', borderTopRightRadius: 'var(--sp-r-2xl)',
      padding: '8px 0 28px',
      boxShadow: '0 -8px 32px rgba(31,26,20,0.12)',
      ...style,
    }}>
      <div style={{
        width: 36, height: 5, borderRadius: 3,
        background: 'var(--sp-gray-200)',
        margin: '6px auto 8px',
      }}/>
      {children}
    </div>
  );
}

/* TabBar — bottom tabs */
function TabBar({ active = 'home', badges = {}, style }) {
  const tabs = [
    { key: 'home', label: 'Inicio', icon: 'home' },
    { key: 'groups', label: 'Grupos', icon: 'users' },
    { key: 'activity', label: 'Actividad', icon: 'activity' },
  ];
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      padding: '8px 8px 28px',
      background: 'var(--sp-surface)',
      borderTop: '1px solid var(--sp-border-hair)',
      backdropFilter: 'blur(20px)',
      display: 'flex', justifyContent: 'space-around',
      ...style,
    }}>
      {tabs.map(t => {
        const isActive = active === t.key;
        return (
          <div key={t.key} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            padding: '6px 14px', minWidth: 64,
            color: isActive ? 'var(--sp-brand-primary)' : 'var(--sp-text-tertiary)',
            position: 'relative',
          }}>
            <Icon name={t.icon} size={26} stroke={isActive ? 2.4 : 1.8}/>
            <div style={{ fontSize: 10.5, fontWeight: isActive ? 700 : 500 }}>{t.label}</div>
            {badges[t.key] && (
              <div style={{
                position: 'absolute', top: 4, right: 12,
                minWidth: 16, height: 16, padding: '0 4px',
                borderRadius: 8, background: 'var(--sp-negative)', color: '#fff',
                fontSize: 10, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{badges[t.key]}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* Header — for tabs (large title style) */
function ScreenHeader({ title, subtitle, leftIcon, rightSlot, syncState = 'synced', style }) {
  return (
    <div style={{
      padding: '8px 20px 12px',
      ...style,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        {syncState && <SyncStatusBadge state={syncState}/>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{rightSlot}</div>
      </div>
      <div className="sp-display" style={{ color: 'var(--sp-text)' }}>{title}</div>
      {subtitle && <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)', marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   IPHONE FRAME WRAPPER — applies tokens + theme + density per artboard
   ───────────────────────────────────────────────────────────── */
function PhoneFrame({ children, dark, density = 'regular', iconStyle = 'filled', width = 390, height = 844 }) {
  return (
    <div data-theme={dark ? 'dark' : 'light'} data-density={density} data-icon-style={iconStyle}
      style={{
        width, height, borderRadius: 44, overflow: 'hidden', position: 'relative',
        background: 'var(--sp-bg)', fontFamily: 'var(--sp-font)',
        color: 'var(--sp-text)',
        boxShadow: 'inset 0 0 0 1px ' + (dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)'),
        WebkitFontSmoothing: 'antialiased',
      }} className="sp-screen">
      {/* status bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 48,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 28px 0', zIndex: 30, pointerEvents: 'none',
      }}>
        <span style={{ fontFamily: 'var(--sp-font)', fontSize: 15, fontWeight: 600, color: 'var(--sp-text)' }}>9:41</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--sp-text)' }}>
          <svg width="17" height="11" viewBox="0 0 19 12"><rect x="0" y="7.5" width="3.2" height="4.5" rx="0.7" fill="currentColor"/><rect x="4.8" y="5" width="3.2" height="7" rx="0.7" fill="currentColor"/><rect x="9.6" y="2.5" width="3.2" height="9.5" rx="0.7" fill="currentColor"/><rect x="14.4" y="0" width="3.2" height="12" rx="0.7" fill="currentColor"/></svg>
          <svg width="15" height="11" viewBox="0 0 17 12"><path d="M8.5 3.2C10.8 3.2 12.9 4.1 14.4 5.6L15.5 4.5C13.7 2.7 11.2 1.5 8.5 1.5C5.8 1.5 3.3 2.7 1.5 4.5L2.6 5.6C4.1 4.1 6.2 3.2 8.5 3.2Z" fill="currentColor"/><path d="M8.5 6.8C9.9 6.8 11.1 7.3 12 8.2L13.1 7.1C11.8 5.9 10.2 5.1 8.5 5.1C6.8 5.1 5.2 5.9 3.9 7.1L5 8.2C5.9 7.3 7.1 6.8 8.5 6.8Z" fill="currentColor"/><circle cx="8.5" cy="10.5" r="1.5" fill="currentColor"/></svg>
          <svg width="24" height="11" viewBox="0 0 27 13"><rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke="currentColor" strokeOpacity="0.4" fill="none"/><rect x="2" y="2" width="20" height="9" rx="2" fill="currentColor"/><path d="M25 4.5V8.5C25.8 8.2 26.5 7.2 26.5 6.5C26.5 5.8 25.8 4.8 25 4.5Z" fill="currentColor" fillOpacity="0.4"/></svg>
        </span>
      </div>
      {/* dynamic island */}
      <div style={{
        position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)',
        width: 120, height: 35, borderRadius: 22, background: '#000', zIndex: 40,
      }}/>
      {/* content */}
      <div style={{ position: 'absolute', inset: 0, paddingTop: 50, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
      {/* home indicator */}
      <div style={{
        position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
        width: 134, height: 5, borderRadius: 3,
        background: dark ? 'rgba(245,241,234,0.7)' : 'rgba(31,26,20,0.32)',
        zIndex: 50,
      }}/>
    </div>
  );
}

Object.assign(window, {
  Icon, Avatar, AvatarStack, BalancePill, CategoryIcon, CATEGORY_META,
  Button, IconButton, FAB, TextField, AmountDisplay, Numpad, SegmentedControl,
  Badge, ProBadge, SyncStatusBadge, Card, ExpenseCard, GroupCard,
  BalanceSummaryCard, PaymentCard, EmptyState, BottomSheet, TabBar, ScreenHeader,
  PhoneFrame,
});
