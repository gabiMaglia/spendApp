// system.jsx — Design System showcase artboards
// Wider artboards (not phone-framed) for design tokens reference.

function Swatch({ name, token, hex, fg = '#fff', size = 'md' }) {
  const w = size === 'sm' ? 56 : 80;
  const h = size === 'sm' ? 56 : 64;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{
        width: w, height: h, background: hex, color: fg, borderRadius: 'var(--sp-r-md)',
        display: 'flex', alignItems: 'flex-end', padding: 8,
        fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
        border: '1px solid var(--sp-border-hair)',
      }}>{hex}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-text)' }}>{name}</div>
      <div style={{ fontSize: 10, color: 'var(--sp-text-tertiary)', fontFamily: 'var(--sp-font-mono)' }}>{token}</div>
    </div>
  );
}

function DSPanel({ title, children, span = 1, style }) {
  return (
    <div style={{
      gridColumn: `span ${span}`,
      background: 'var(--sp-surface)',
      borderRadius: 'var(--sp-r-lg)',
      border: '1px solid var(--sp-border-hair)',
      padding: 20, ...style,
    }}>
      <div className="sp-label" style={{ marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   COLORS artboard
   ───────────────────────────────────────────────────────────── */
function DSColors({ dark }) {
  return (
    <div data-theme={dark ? 'dark' : 'light'} className="sp-screen" style={{
      width: 1240, padding: 40, background: 'var(--sp-bg)',
      fontFamily: 'var(--sp-font)', color: 'var(--sp-text)',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      <div>
        <div className="sp-h1">Colores</div>
        <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)', marginTop: 4 }}>
          Petróleo profundo + salvia + neutros cálidos · variante <b style={{ color: 'var(--sp-text)' }}>{dark ? 'oscuro' : 'claro'}</b> ·
          tokens listos para Colors.brand.* / Colors.semantic.* en React Native.
        </div>
      </div>

      <DSPanel title="Brand">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
          <Swatch name="Primary (petróleo)" token="Colors.brand.primary" hex={dark ? '#4DB0CC' : '#0A6E8F'} fg={dark ? '#0F2C36' : '#fff'}/>
          <Swatch name="Primary strong" token="Colors.brand.primaryStrong" hex={dark ? '#6BC2DA' : '#08597A'} fg={dark ? '#0F2C36' : '#fff'}/>
          <Swatch name="Primary soft" token="Colors.brand.primarySoft" hex={dark ? '#1E3038' : '#E4F0F4'} fg={dark ? '#9BD3E2' : '#0A4D66'}/>
          <Swatch name="Accent (salvia)" token="Colors.brand.accent" hex={dark ? '#A7CFAB' : '#8FBC94'} fg="#1F1A14"/>
          <Swatch name="Accent strong" token="Colors.brand.accentStrong" hex={dark ? '#B8DCB9' : '#6FA075'} fg="#1F1A14"/>
          <Swatch name="Accent soft" token="Colors.brand.accentSoft" hex={dark ? '#1F2B22' : '#E8F0E5'} fg={dark ? '#C4DEC6' : '#3D6644'}/>
        </div>
      </DSPanel>

      <DSPanel title="Semántica (dinero)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
          <Swatch name="Positive · te deben" token="Colors.semantic.positive" hex={dark ? '#67BA81' : '#2E8B57'} fg="#fff"/>
          <Swatch name="Positive soft" token="Colors.semantic.positiveSoft" hex={dark ? '#1F2E25' : '#E3F0E8'} fg={dark ? '#8FD0A3' : '#1F6740'}/>
          <Swatch name="Negative · debés" token="Colors.semantic.negative" hex={dark ? '#E5816F' : '#C45447'} fg="#fff"/>
          <Swatch name="Negative soft" token="Colors.semantic.negativeSoft" hex={dark ? '#3A201D' : '#FBE7E3'} fg={dark ? '#F0A294' : '#8E382E'}/>
          <Swatch name="Neutral · saldado" token="Colors.semantic.neutral" hex={dark ? '#968D80' : '#8B8275'} fg="#fff"/>
          <Swatch name="Warning" token="Colors.semantic.warning" hex={dark ? '#E0B765' : '#D4A24A'} fg="#1F1A14"/>
          <Swatch name="Error" token="Colors.semantic.error" hex={dark ? '#D85C50' : '#B83A2F'} fg="#fff"/>
        </div>
      </DSPanel>

      <DSPanel title="Surfaces & backgrounds">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
          <Swatch name="bg" token="Colors.bg" hex={dark ? '#14110D' : '#FAF7F2'} fg={dark ? '#F5F1EA' : '#1F1A14'}/>
          <Swatch name="bg grouped" token="Colors.bgGrouped" hex={dark ? '#1A1611' : '#F2EEE6'} fg={dark ? '#F5F1EA' : '#1F1A14'}/>
          <Swatch name="surface" token="Colors.surface" hex={dark ? '#221E17' : '#FFFFFF'} fg={dark ? '#F5F1EA' : '#1F1A14'}/>
          <Swatch name="surface warm" token="Colors.surfaceWarm" hex={dark ? '#2A2520' : '#F7F2EA'} fg={dark ? '#F5F1EA' : '#1F1A14'}/>
          <Swatch name="surface sunken" token="Colors.surfaceSunken" hex={dark ? '#1A1611' : '#EDE7DC'} fg={dark ? '#B8AFA1' : '#5C5246'}/>
        </div>
      </DSPanel>

      <DSPanel title="Texto + bordes">
        <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div className="sp-label" style={{ marginBottom: 8 }}>Texto</div>
            {[
              { tk: 'text', label: 'Primario', cls: 'sp-bodyL', col: 'var(--sp-text)' },
              { tk: 'textSecondary', label: 'Secundario', cls: 'sp-bodyM', col: 'var(--sp-text-secondary)' },
              { tk: 'textTertiary', label: 'Terciario / captions', cls: 'sp-bodyS', col: 'var(--sp-text-tertiary)' },
              { tk: 'textDisabled', label: 'Deshabilitado', cls: 'sp-bodyM', col: 'var(--sp-text-disabled)' },
            ].map(t => (
              <div key={t.tk} style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
                <div className={t.cls} style={{ color: t.col, minWidth: 220 }}>{t.label} · Aa Bb 123</div>
                <code style={{ fontSize: 11, color: 'var(--sp-text-tertiary)', fontFamily: 'var(--sp-font-mono)' }}>Colors.{t.tk}</code>
              </div>
            ))}
          </div>
          <div style={{ flex: 1 }}>
            <div className="sp-label" style={{ marginBottom: 8 }}>Bordes & sombras</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {['hair', 'default', 'strong'].map((b, i) => (
                <div key={b} style={{
                  height: 44, padding: 12, borderRadius: 'var(--sp-r-md)',
                  background: 'var(--sp-surface)',
                  border: `1px solid var(--sp-border${b === 'default' ? '' : '-' + b})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 13, color: 'var(--sp-text-secondary)',
                }}><span>Border {b}</span><code style={{ fontSize: 11, color: 'var(--sp-text-tertiary)' }}>Borders.{b}</code></div>
              ))}
              {[1, 2, 3].map(n => (
                <div key={n} style={{
                  height: 44, padding: 12, borderRadius: 'var(--sp-r-md)',
                  background: 'var(--sp-surface)', boxShadow: `var(--sp-shadow-${n})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 13, color: 'var(--sp-text-secondary)',
                }}><span>Shadow {n}</span><code style={{ fontSize: 11, color: 'var(--sp-text-tertiary)' }}>Shadow.elev{n}</code></div>
              ))}
            </div>
          </div>
        </div>
      </DSPanel>

      <DSPanel title="Categorías (chips)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {Object.entries(CATEGORY_META).map(([k, m]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
              <CategoryIcon kind={k} size={56}/>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-text)' }}>{m.label}</div>
              <code style={{ fontSize: 10, color: 'var(--sp-text-tertiary)' }}>Cat.{k}</code>
            </div>
          ))}
        </div>
      </DSPanel>

      <DSPanel title="Escala de grises (cálidos)">
        <div style={{ display: 'flex', gap: 6 }}>
          {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map(n => (
            <div key={n} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{
                height: 64, background: `var(--sp-gray-${n})`,
                borderRadius: 'var(--sp-r-sm)',
                border: '1px solid var(--sp-border-hair)',
              }}/>
              <div style={{ fontSize: 11, color: 'var(--sp-text-secondary)', textAlign: 'center' }}>{n}</div>
            </div>
          ))}
        </div>
      </DSPanel>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   TYPOGRAPHY artboard
   ───────────────────────────────────────────────────────────── */
function DSType({ dark }) {
  const rows = [
    { name: 'Display', token: 'Typography.display', cls: 'sp-display', sample: 'Te deben $24.500', use: 'Hero balance, large title iOS' },
    { name: 'H1', token: 'Typography.h1', cls: 'sp-h1', sample: 'Asado del finde', use: 'Title de pantalla, sheet headers' },
    { name: 'H2', token: 'Typography.h2', cls: 'sp-h2', sample: 'Movimientos del grupo', use: 'Section headers' },
    { name: 'H3', token: 'Typography.h3', cls: 'sp-h3', sample: '¿Quién pagó?', use: 'Card titles, sub-section' },
    { name: 'Body-L', token: 'Typography.bodyL', cls: 'sp-bodyL', sample: 'Ana pagó la cena del jueves. Vos debés $1.250 a Ana.', use: 'Body default, list rows' },
    { name: 'Body-M', token: 'Typography.bodyM', cls: 'sp-bodyM', sample: 'Bob agregó un gasto en Mar del Plata · hace 2 horas', use: 'Secondary copy, supporting' },
    { name: 'Body-S', token: 'Typography.bodyS', cls: 'sp-bodyS', sample: 'Sincronizado · 09:41 · vía Bluetooth', use: 'Meta info, captions' },
    { name: 'Caption', token: 'Typography.caption', cls: 'sp-caption', sample: 'hace 2 horas', use: 'Timestamps, hints' },
    { name: 'Label', token: 'Typography.label', cls: 'sp-label', sample: 'BALANCE GLOBAL', use: 'Section labels (uppercase tracking)' },
  ];
  return (
    <div data-theme={dark ? 'dark' : 'light'} className="sp-screen" style={{
      width: 1240, padding: 40, background: 'var(--sp-bg)',
      fontFamily: 'var(--sp-font)', color: 'var(--sp-text)',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      <div>
        <div className="sp-h1">Tipografía</div>
        <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)', marginTop: 4 }}>
          Sistema (SF Pro / Roboto) · escala mobile · pesos 400 / 500 / 600 / 700. Montos con <code style={{ fontFamily: 'var(--sp-font-mono)' }}>font-variant-numeric: tabular-nums</code>.
        </div>
      </div>

      <DSPanel title="Escala">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {rows.map(r => (
            <div key={r.name} style={{
              display: 'grid', gridTemplateColumns: '120px 1fr 280px',
              alignItems: 'baseline', gap: 24,
              paddingBottom: 16, borderBottom: '1px solid var(--sp-border-hair)',
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sp-text)' }}>{r.name}</div>
                <code style={{ fontSize: 10, color: 'var(--sp-text-tertiary)', fontFamily: 'var(--sp-font-mono)' }}>{r.token}</code>
              </div>
              <div className={r.cls} style={{ color: 'var(--sp-text)' }}>{r.sample}</div>
              <div style={{ fontSize: 12, color: 'var(--sp-text-tertiary)' }}>{r.use}</div>
            </div>
          ))}
        </div>
      </DSPanel>

      <DSPanel title="Montos de dinero · tabular-nums + bold">
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          {[
            { name: 'Amount XL', token: 'Typography.amountXL', cls: 'sp-amount sp-amount-xl', use: 'Balance hero (dashboard, settle)' },
            { name: 'Amount L',  token: 'Typography.amountL',  cls: 'sp-amount sp-amount-l',  use: 'Group balance, expense detail' },
            { name: 'Amount M',  token: 'Typography.amountM',  cls: 'sp-amount sp-amount-m',  use: 'Card amounts, list rows' },
            { name: 'Amount S',  token: 'Typography.amountS',  cls: 'sp-amount sp-amount-s',  use: 'Split shares, inline pills' },
          ].map(r => (
            <div key={r.name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className={r.cls} style={{ color: 'var(--sp-text)' }}>${(123456).toLocaleString('es-AR')}</span>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-text)' }}>{r.name}</div>
              <code style={{ fontSize: 10, color: 'var(--sp-text-tertiary)', fontFamily: 'var(--sp-font-mono)' }}>{r.token}</code>
              <div style={{ fontSize: 11, color: 'var(--sp-text-tertiary)', maxWidth: 240 }}>{r.use}</div>
            </div>
          ))}
        </div>
      </DSPanel>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   SPACING / RADIUS / SHADOWS artboard
   ───────────────────────────────────────────────────────────── */
function DSSpacing({ dark }) {
  const space = [
    [1, 4, 'space.xs'], [2, 8, 'space.sm'], [3, 12, 'space.md'],
    [4, 16, 'space.lg'], [5, 20, 'space.screen'], [6, 24, 'space.xl'],
    [7, 32, 'space.2xl'], [8, 40, 'space.3xl'], [9, 48, 'space.4xl'],
  ];
  const radii = [
    ['xs', 6], ['sm', 10], ['md', 14], ['lg', 18], ['xl', 22], ['2xl', 28], ['full', 9999],
  ];
  return (
    <div data-theme={dark ? 'dark' : 'light'} className="sp-screen" style={{
      width: 1240, padding: 40, background: 'var(--sp-bg)',
      fontFamily: 'var(--sp-font)', color: 'var(--sp-text)',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      <div>
        <div className="sp-h1">Espaciado, radio & sombras</div>
        <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)', marginTop: 4 }}>
          Sistema base de 4px. Padding horizontal de pantalla = 20px. Cards = 16px padding interno.
        </div>
      </div>

      <DSPanel title="Spacing scale">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {space.map(([k, px, tk]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 60, fontSize: 13, fontWeight: 600, color: 'var(--sp-text)' }}>{px}px</div>
              <div style={{ height: 14, width: px * 8, background: 'var(--sp-brand-primary)', borderRadius: 3 }}/>
              <code style={{ fontSize: 11, color: 'var(--sp-text-tertiary)', fontFamily: 'var(--sp-font-mono)' }}>{tk}</code>
            </div>
          ))}
        </div>
      </DSPanel>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <DSPanel title="Radios">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {radii.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 72, height: 72, borderRadius: v, background: 'var(--sp-brand-primary-soft)',
                  border: '1px solid var(--sp-brand-primary)', color: 'var(--sp-brand-primary-onSoft)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600,
                }}>{k === 'full' ? '∞' : v + 'px'}</div>
                <code style={{ fontSize: 11, color: 'var(--sp-text-tertiary)', fontFamily: 'var(--sp-font-mono)' }}>Radius.{k}</code>
              </div>
            ))}
          </div>
        </DSPanel>

        <DSPanel title="Grid & layout">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ position: 'relative', height: 200, background: 'var(--sp-surface-warm)', borderRadius: 'var(--sp-r-md)', overflow: 'hidden' }}>
              {/* phone grid mock */}
              <div style={{ position: 'absolute', inset: 0, padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ height: 28, borderRadius: 6, background: 'rgba(10,110,143,0.18)' }}/>
                <div style={{ height: 40, borderRadius: 8, background: 'rgba(10,110,143,0.18)' }}/>
                <div style={{ height: 40, borderRadius: 8, background: 'rgba(10,110,143,0.18)' }}/>
                <div style={{ height: 40, borderRadius: 8, background: 'rgba(10,110,143,0.18)' }}/>
              </div>
              {/* gutter visualization */}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 20, background: 'rgba(143,188,148,0.35)' }}/>
              <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 20, background: 'rgba(143,188,148,0.35)' }}/>
            </div>
            <div style={{ fontSize: 13, color: 'var(--sp-text-secondary)' }}>
              <b>Screen padding:</b> 20px<br/>
              <b>Card padding:</b> 16px (compacto 12 · cómodo 18)<br/>
              <b>Card vertical gap:</b> 10px<br/>
              <b>Tap target:</b> mínimo 44×44 (iOS HIG)
            </div>
          </div>
        </DSPanel>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   COMPONENTS artboard — buttons, inputs, badges, cards
   ───────────────────────────────────────────────────────────── */
function DSComponents({ dark }) {
  return (
    <div data-theme={dark ? 'dark' : 'light'} className="sp-screen" style={{
      width: 1240, padding: 40, background: 'var(--sp-bg)',
      fontFamily: 'var(--sp-font)', color: 'var(--sp-text)',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      <div>
        <div className="sp-h1">Componentes base</div>
        <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)', marginTop: 4 }}>
          Atoms y molecules — todos los componentes mencionados en el spec, lights + dark.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <DSPanel title="Botones">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="primary">Agregar gasto</Button>
              <Button variant="secondary">Cancelar</Button>
              <Button variant="destructive">Eliminar</Button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button variant="ghost">Ver más</Button>
              <Button variant="soft" leftIcon="qr">Compartir QR</Button>
              <Button variant="primary" size="sm" leftIcon="plus">Nuevo</Button>
              <Button variant="primary" size="lg" block style={{ width: 220 }}>Continuar</Button>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <IconButton name="plus" variant="filled"/>
              <IconButton name="search" variant="soft"/>
              <IconButton name="moreHorizontal"/>
            </div>
          </div>
        </DSPanel>

        <DSPanel title="Inputs">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TextField label="Descripción" value="Asado del finde" placeholder="¿En qué gastaron?"/>
            <TextField label="Buscar" leftIcon="search" placeholder="Buscar miembro…"/>
            <TextField label="Tipo de cambio" value="1.250" rightAdorn={<span style={{ fontSize: 13, color: 'var(--sp-text-tertiary)' }}>ARS / USD</span>}/>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <SegmentedControl value="igual" options={[
                { value: 'igual', label: 'Igual' },
                { value: 'exacto', label: 'Exacto' },
                { value: 'porcentaje', label: '%' },
                { value: 'partes', label: 'Partes' },
              ]}/>
            </div>
          </div>
        </DSPanel>

        <DSPanel title="Badges & pills" span={2}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20, rowGap: 14 }}>
            <BalancePill amount={1500}/>
            <BalancePill amount={-2400}/>
            <BalancePill amount={0}/>
            <BalancePill amount={45200} size="lg"/>
            <ProBadge/>
            <Badge tone="brand">P2P</Badge>
            <Badge tone="warning">Borrado pendiente</Badge>
            <Badge tone="accent">Nuevo</Badge>
            <SyncStatusBadge state="synced"/>
            <SyncStatusBadge state="syncing"/>
            <SyncStatusBadge state="pending"/>
            <SyncStatusBadge state="offline"/>
          </div>
        </DSPanel>

        <DSPanel title="Avatars">
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <Avatar name="Ana" hue={0} size={56}/>
            <Avatar name="Bob" hue={1} size={48}/>
            <Avatar name="Carla" hue={2} size={40}/>
            <Avatar name="Diego" hue={3} size={32}/>
            <Avatar name="?" hue={5} size={28}/>
            <div style={{ marginLeft: 16 }}>
              <AvatarStack size={32} people={[
                { name: 'Ana', hue: 0 }, { name: 'Bob', hue: 1 },
                { name: 'Carla', hue: 2 }, { name: 'Diego', hue: 3 },
                { name: 'Eli', hue: 4 }, { name: 'Faby', hue: 5 },
              ]}/>
            </div>
          </div>
        </DSPanel>

        <DSPanel title="Cards" span={2}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <ExpenseCard category="food" title="Cena en La Cantina" payer="Ana" date="hoy" amount={12480} yourShare={-3120}/>
            <ExpenseCard category="accommodation" title="Airbnb Mar del Plata" payer="Vos" date="vie 14" amount={185000} yourShare={61666}/>
            <GroupCard name="Mar del Plata 2026" members={[
              { name: 'Ana', hue: 0 }, { name: 'Bob', hue: 1 }, { name: 'Carla', hue: 2 }, { name: 'Diego', hue: 3 },
            ]} balance={24500}/>
            <GroupCard name="Roomates" members={[
              { name: 'Sofi', hue: 4 }, { name: 'Tom', hue: 5 },
            ]} balance={-8200}/>
            <BalanceSummaryCard owedToYou={24500} youOwe={8200}/>
            <PaymentCard from="Bob" to="Vos" amount={4200} date="mar 11"/>
          </div>
        </DSPanel>
      </div>
    </div>
  );
}

Object.assign(window, { DSColors, DSType, DSSpacing, DSComponents });
