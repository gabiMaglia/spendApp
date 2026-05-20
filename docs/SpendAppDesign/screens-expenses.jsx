// screens-expenses.jsx — D1 create, D1b exact split, D1c category picker,
//                         D2 detail, D3 scan ticket, D3b confirm OCR

/* ─────────────────────────────────────────────────────────────
   D1 · Crear gasto
   ───────────────────────────────────────────────────────────── */
function SplitMemberRow({ name, hue, amount, sub, badge, currency = '$' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px', borderRadius: 'var(--sp-r-md)',
      background: 'var(--sp-surface-warm)',
    }}>
      <Avatar name={name} hue={hue} size={32}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sp-bodyM" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>{name}</div>
        {sub && <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>{sub}</div>}
      </div>
      {badge && <Badge tone="brand" size="sm">{badge}</Badge>}
      <span className="sp-amount sp-amount-m" style={{ color: 'var(--sp-text)' }}>{currency}{amount.toLocaleString('es-AR')}</span>
    </div>
  );
}

function CreateExpenseShell({ children, splitMode = 'igual', focused = 'amount' }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)' }}>
      {/* Modal header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px' }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--sp-brand-primary)' }}>Cancelar</span>
        <div className="sp-h3" style={{ color: 'var(--sp-text)' }}>Nuevo gasto</div>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--sp-brand-primary)' }}>Guardar</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

function ScreenCreateExpense() {
  return (
    <CreateExpenseShell>
      {/* Group context */}
      <div style={{ padding: '4px 20px 0', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sp-text-tertiary)' }}>
        <Icon name="users" size={14} stroke={2}/>
        <span className="sp-bodyS" style={{ fontWeight: 600 }}>Mar del Plata 2026</span>
      </div>

      {/* Amount */}
      <div style={{ padding: '14px 20px 20px' }}>
        <AmountDisplay amount="12.480" currency="ARS"/>
      </div>

      {/* Description + category */}
      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '8px 14px', height: 56,
          borderRadius: 'var(--sp-r-md)',
          background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)',
        }}>
          <CategoryIcon kind="food" size={36}/>
          <div style={{ flex: 1 }}>
            <div className="sp-bodyL" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>Cena en La Cantina</div>
            <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>Comida</div>
          </div>
          <Icon name="chevronRight" size={18} color="var(--sp-text-tertiary)"/>
        </div>

        {/* Payer + date row */}
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{
            flex: 1, padding: 12, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)',
          }}>
            <div className="sp-label" style={{ fontSize: 10, marginBottom: 4 }}>Pagó</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Avatar name="Ana" hue={0} size={22}/>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--sp-text)' }}>Ana</span>
            </div>
          </div>
          <div style={{
            flex: 1, padding: 12, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)',
          }}>
            <div className="sp-label" style={{ fontSize: 10, marginBottom: 4 }}>Fecha</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="calendar" size={16} color="var(--sp-text-tertiary)"/>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--sp-text)' }}>Hoy · 20:14</span>
            </div>
          </div>
        </div>

        {/* Split mode */}
        <div style={{ marginTop: 6 }}>
          <div className="sp-label" style={{ marginBottom: 8 }}>Dividir</div>
          <SegmentedControl value="igual" options={[
            { value: 'igual', label: 'Igual' },
            { value: 'exacto', label: 'Exacto' },
            { value: 'porcentaje', label: '%' },
            { value: 'partes', label: 'Partes' },
          ]}/>
        </div>

        {/* Equal split preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {[
            { n: 'Ana', h: 0, amt: 3120, sub: 'pagadora · saldo +9.360' },
            { n: 'Vos', h: 6, amt: 3120 },
            { n: 'Bob', h: 1, amt: 3120 },
            { n: 'Carla', h: 2, amt: 3120 },
          ].map(p => <SplitMemberRow key={p.n} name={p.n} hue={p.h} amount={p.amt} sub={p.sub}/>)}
        </div>

        {/* Pro features */}
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 'var(--sp-r-md)', background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, background: 'var(--sp-surface-sunken)',
              color: 'var(--sp-text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon name="camera" size={18} stroke={2}/></div>
            <div>
              <div className="sp-bodyM" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>Escanear ticket</div>
              <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>OCR automático</div>
            </div>
          </div>
          <ProBadge/>
        </div>

        {/* Free-plan limit warning */}
        <div style={{
          marginTop: 4, padding: 12,
          background: 'var(--sp-warning-soft)', color: '#8A6420',
          borderRadius: 'var(--sp-r-md)',
          display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <Icon name="info" size={18} stroke={2}/>
          <div className="sp-bodyS" style={{ flex: 1 }}>
            <b>4 de 4 gratis hoy.</b> El próximo requiere ver un anuncio o Pro.
          </div>
        </div>

        <div style={{ height: 24 }}/>
      </div>
    </CreateExpenseShell>
  );
}

/* D1b — split exacto: editable amounts */
function ExactSplitRow({ name, hue, value, sub, isFocused }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px', borderRadius: 'var(--sp-r-md)',
      background: 'var(--sp-surface)',
      border: `1px solid ${isFocused ? 'var(--sp-brand-primary)' : 'var(--sp-border-hair)'}`,
      boxShadow: isFocused ? '0 0 0 3px rgba(10,110,143,0.12)' : 'none',
    }}>
      <Avatar name={name} hue={hue} size={32}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sp-bodyM" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>{name}</div>
        {sub && <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>{sub}</div>}
      </div>
      <span style={{ fontSize: 17, color: 'var(--sp-text-tertiary)' }}>$</span>
      <input value={value.toLocaleString('es-AR')} readOnly style={{
        width: 80, textAlign: 'right',
        border: 'none', background: 'transparent', outline: 'none',
        fontFamily: 'var(--sp-font)', fontSize: 17, fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--sp-text)',
      }}/>
    </div>
  );
}

function ScreenCreateExpenseExact() {
  return (
    <CreateExpenseShell>
      <div style={{ padding: '4px 20px 0', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sp-text-tertiary)' }}>
        <Icon name="users" size={14} stroke={2}/>
        <span className="sp-bodyS" style={{ fontWeight: 600 }}>Mar del Plata 2026</span>
      </div>
      <div style={{ padding: '14px 20px 16px' }}>
        <AmountDisplay amount="12.480" currency="ARS"/>
      </div>
      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '8px 14px', height: 56,
          borderRadius: 'var(--sp-r-md)',
          background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)',
        }}>
          <CategoryIcon kind="food" size={36}/>
          <div style={{ flex: 1 }}>
            <div className="sp-bodyL" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>Cena en La Cantina</div>
          </div>
        </div>
        <SegmentedControl value="exacto" options={[
          { value: 'igual', label: 'Igual' },
          { value: 'exacto', label: 'Exacto' },
          { value: 'porcentaje', label: '%' },
          { value: 'partes', label: 'Partes' },
        ]}/>

        {/* Progress bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="sp-label">Asignado</span>
            <span className="sp-amount sp-amount-s" style={{ color: 'var(--sp-positive)' }}>$12.480 / $12.480</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--sp-surface-sunken)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '100%', background: 'var(--sp-positive)', borderRadius: 3 }}/>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ExactSplitRow name="Ana" hue={0} value={4000} sub="pagadora"/>
          <ExactSplitRow name="Vos" hue={6} value={3500} isFocused/>
          <ExactSplitRow name="Bob" hue={1} value={2480}/>
          <ExactSplitRow name="Carla" hue={2} value={2500}/>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--sp-text-tertiary)', textAlign: 'center' }}>
          Los montos pueden ser distintos. Deben sumar al total para guardar.
        </div>
      </div>
    </CreateExpenseShell>
  );
}

/* D1c — category picker grid (sheet) */
function ScreenCreateExpenseCategory() {
  const selected = 'food';
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(31,26,20,0.4)', position: 'relative' }}>
      {/* Dimmed bg + visible sheet */}
      <div style={{ flex: 1, padding: '60px 20px 0', opacity: 0.4 }}>
        <AmountDisplay amount="12.480" currency="ARS"/>
      </div>

      <BottomSheet>
        <div style={{ padding: '4px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="sp-h3" style={{ color: 'var(--sp-text)' }}>Elegí categoría</div>
          <IconButton name="close" variant="soft" size={32}/>
        </div>

        <div style={{ padding: '14px 20px 12px' }}>
          <TextField leftIcon="search" placeholder="Buscar categoría…"/>
        </div>

        <div style={{
          padding: '4px 16px 20px',
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12,
        }}>
          {Object.entries(CATEGORY_META).map(([k, m]) => {
            const active = k === selected;
            return (
              <div key={k} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '10px 6px', borderRadius: 'var(--sp-r-md)',
                background: active ? 'var(--sp-brand-primary-soft)' : 'transparent',
                border: '1px solid ' + (active ? 'var(--sp-brand-primary)' : 'transparent'),
              }}>
                <CategoryIcon kind={k} size={44}/>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-text)', textAlign: 'center', lineHeight: 1.2 }}>{m.label}</div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: '0 20px' }}>
          <Button variant="primary" size="lg" block>Usar Comida</Button>
        </div>
      </BottomSheet>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   D2 · Detalle de gasto
   ───────────────────────────────────────────────────────────── */
function ScreenExpenseDetail() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px' }}>
          <IconButton name="chevronLeft" variant="soft" size={36}/>
          <div style={{ display: 'flex', gap: 6 }}>
            <IconButton name="edit" variant="soft" size={36}/>
            <IconButton name="moreHorizontal" variant="soft" size={36}/>
          </div>
        </div>

        {/* Hero */}
        <div style={{ padding: '4px 20px 18px', textAlign: 'center' }}>
          <CategoryIcon kind="accommodation" size={64} style={{ margin: '0 auto 12px' }}/>
          <div className="sp-h2" style={{ color: 'var(--sp-text)' }}>Airbnb Mar del Plata</div>
          <div className="sp-amount" style={{
            fontSize: 44, lineHeight: '48px', letterSpacing: '-1px',
            color: 'var(--sp-text)', marginTop: 8,
          }}>$185.000</div>
          <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', marginTop: 4 }}>
            Vos pagaste · viernes 14, 11:08
          </div>
        </div>

        {/* Action chips row */}
        <div style={{ padding: '0 20px 8px', display: 'flex', gap: 8 }}>
          <Badge tone="positive" size="md" style={{ padding: '6px 12px' }}>
            <Icon name="check" size={12} stroke={2.5} style={{ marginRight: 2 }}/>
            Te deben $111.000
          </Badge>
          <Badge tone="neutral" size="md" style={{ padding: '6px 12px' }}>
            <Icon name="users" size={12} stroke={2}/>
            4 personas
          </Badge>
        </div>

        {/* Splits */}
        <div style={{ padding: '16px 20px 0' }}>
          <div className="sp-label" style={{ marginBottom: 10 }}>División · Igual</div>
          <div style={{
            background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-md)',
            border: '1px solid var(--sp-border-hair)', overflow: 'hidden',
          }}>
            {[
              { n: 'Vos', h: 6, amt: 46250, badge: 'Pagador' },
              { n: 'Ana López', h: 0, amt: 46250 },
              { n: 'Bob Pérez', h: 1, amt: 46250 },
              { n: 'Carla Suarez', h: 2, amt: 46250 },
            ].map((p, i, arr) => (
              <div key={p.n} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                borderBottom: i < arr.length - 1 ? '1px solid var(--sp-border-hair)' : 'none',
              }}>
                <Avatar name={p.n} hue={p.h} size={32}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="sp-bodyM" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>{p.n}</div>
                  {p.badge && <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>{p.badge}</div>}
                </div>
                <span className="sp-amount sp-amount-m" style={{ color: 'var(--sp-text)' }}>${p.amt.toLocaleString('es-AR')}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div style={{ padding: '20px 20px 0' }}>
          <div className="sp-label" style={{ marginBottom: 8 }}>Nota</div>
          <div className="sp-bodyM" style={{
            padding: 12, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-surface-warm)', color: 'var(--sp-text)',
          }}>
            3 noches · check-in vie 14 / check-out lun 17. Tarifa final con limpieza incluida.
          </div>
        </div>

        {/* History */}
        <div style={{ padding: '20px 20px 32px' }}>
          <div className="sp-label" style={{ marginBottom: 10 }}>Historial</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--sp-brand-primary)' }}/>
              <div className="sp-bodyS" style={{ color: 'var(--sp-text-secondary)' }}>
                <b style={{ color: 'var(--sp-text)' }}>Vos</b> editaste el monto · vie 14, 14:20
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--sp-text-tertiary)' }}/>
              <div className="sp-bodyS" style={{ color: 'var(--sp-text-secondary)' }}>
                <b style={{ color: 'var(--sp-text)' }}>Vos</b> creaste el gasto · vie 14, 11:08
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   D3 · Escanear ticket (Pro)
   ───────────────────────────────────────────────────────────── */
function ScreenScanTicket() {
  return (
    <div style={{ flex: 1, position: 'relative', background: '#0a0a0a' }}>
      {/* Mock camera feed — gradient + faux receipt */}
      <div style={{ position: 'absolute', inset: 0, background:
        'radial-gradient(ellipse at center, #2a261f, #0a0a0a 80%)',
      }}/>

      {/* faux receipt paper */}
      <div style={{
        position: 'absolute', left: '50%', top: '46%', transform: 'translate(-50%, -50%) rotate(-3deg)',
        width: 220, height: 320, background: '#f5f0e6', borderRadius: 4,
        boxShadow: '0 30px 60px rgba(0,0,0,0.5)', padding: '20px 18px',
        fontFamily: 'var(--sp-font-mono)', fontSize: 9, color: '#1F1A14',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 11 }}>LA CANTINA</div>
        <div style={{ textAlign: 'center', fontSize: 8, color: '#5C5246' }}>Av. Independencia 1240</div>
        <div style={{ borderTop: '1px dashed #999', margin: '6px 0' }}/>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Pizza muzzarella</span><span>2.800</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Empanadas x4</span><span>3.200</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Vino tinto</span><span>4.500</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Postre</span><span>1.980</span></div>
        <div style={{ borderTop: '1px solid #1F1A14', margin: '6px 0', paddingTop: 4, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>TOTAL</span><span>$12.480</span></div>
      </div>

      {/* Viewfinder corners */}
      <div style={{ position: 'absolute', inset: '15% 10%', pointerEvents: 'none' }}>
        {['tl','tr','bl','br'].map(c => {
          const s = { position: 'absolute', width: 28, height: 28, borderColor: '#fff', borderStyle: 'solid' };
          if (c === 'tl') Object.assign(s, { top: 0, left: 0, borderWidth: '3px 0 0 3px', borderTopLeftRadius: 8 });
          if (c === 'tr') Object.assign(s, { top: 0, right: 0, borderWidth: '3px 3px 0 0', borderTopRightRadius: 8 });
          if (c === 'bl') Object.assign(s, { bottom: 0, left: 0, borderWidth: '0 0 3px 3px', borderBottomLeftRadius: 8 });
          if (c === 'br') Object.assign(s, { bottom: 0, right: 0, borderWidth: '0 3px 3px 0', borderBottomRightRadius: 8 });
          return <div key={c} style={s}/>;
        })}
      </div>

      {/* Top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, padding: '8px 20px 0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <IconButton name="close" variant="ghost" size={40} style={{ background: 'rgba(0,0,0,0.4)', color: '#fff' }}/>
        <ProBadge style={{ padding: '4px 10px 4px 8px', fontSize: 11 }}/>
        <IconButton name="bolt" variant="ghost" size={40} style={{ background: 'rgba(0,0,0,0.4)', color: '#fff' }}/>
      </div>

      {/* Instruction */}
      <div style={{
        position: 'absolute', top: 100, left: 0, right: 0, textAlign: 'center', color: '#fff',
      }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Apuntá al ticket</div>
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>Buena luz · todo dentro del recuadro</div>
      </div>

      {/* Bottom controls */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, padding: '20px 20px 36px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 10,
          background: 'rgba(255,255,255,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="receipt" size={22} color="#fff"/>
        </div>

        <button style={{
          width: 72, height: 72, borderRadius: '50%',
          background: '#fff', border: '4px solid rgba(255,255,255,0.4)',
          boxShadow: '0 0 0 4px rgba(255,255,255,0.2)',
          cursor: 'pointer',
        }}/>

        <div style={{
          width: 48, height: 48, borderRadius: 10,
          background: 'rgba(255,255,255,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="info" size={22} color="#fff"/>
        </div>
      </div>
    </div>
  );
}

/* D3b — confirmation after OCR */
function ScreenScanTicketConfirm() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px' }}>
        <IconButton name="chevronLeft" variant="soft" size={36}/>
        <div className="sp-h3" style={{ color: 'var(--sp-text)' }}>Confirmar gasto</div>
        <IconButton name="camera" variant="soft" size={36}/>
      </div>

      {/* OCR badge */}
      <div style={{ padding: '4px 20px 12px' }}>
        <div style={{
          padding: 10, background: 'var(--sp-positive-soft)', color: 'var(--sp-positive-onSoft)',
          borderRadius: 'var(--sp-r-md)', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Icon name="sparkle" size={18}/>
          <div className="sp-bodyS" style={{ flex: 1 }}>
            <b>OCR detectó 5 campos.</b> Revisalos antes de guardar.
          </div>
          <ProBadge/>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Thumbnail */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{
            width: 60, height: 76, borderRadius: 'var(--sp-r-sm)',
            background: '#f5f0e6', boxShadow: 'var(--sp-shadow-1)',
            transform: 'rotate(-3deg)',
            padding: 6, fontSize: 5, color: '#1F1A14', fontFamily: 'var(--sp-font-mono)',
            overflow: 'hidden',
          }}>
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 6 }}>LA CANTINA</div>
            <div style={{ borderTop: '1px dashed #999', margin: '2px 0' }}/>
            <div>Pizza 2.800</div>
            <div>Empanadas 3.200</div>
            <div>Vino 4.500</div>
            <div>Postre 1.980</div>
            <div style={{ borderTop: '1px solid #1F1A14', marginTop: 2, paddingTop: 2, fontWeight: 700 }}>TOTAL $12.480</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>Comercio</div>
            <div className="sp-bodyL" style={{ fontWeight: 600 }}>La Cantina</div>
            <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', marginTop: 2 }}>Viernes 14, 21:30</div>
          </div>
        </div>

        {/* Editable amount + category */}
        <div style={{
          padding: 14, borderRadius: 'var(--sp-r-md)',
          background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)',
        }}>
          <div className="sp-label" style={{ marginBottom: 6 }}>Total detectado</div>
          <div className="sp-amount" style={{ fontSize: 32, color: 'var(--sp-text)' }}>$12.480</div>
        </div>

        {/* Items */}
        <div style={{
          background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-md)',
          border: '1px solid var(--sp-border-hair)',
        }}>
          <div style={{ padding: '12px 14px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="sp-label">Ítems detectados</div>
            <span className="sp-bodyS" style={{ color: 'var(--sp-brand-primary)', fontWeight: 600 }}>+ Agregar</span>
          </div>
          {[
            { n: 'Pizza muzzarella', a: 2800 },
            { n: 'Empanadas x4', a: 3200 },
            { n: 'Vino tinto', a: 4500 },
            { n: 'Postre', a: 1980 },
          ].map((it, i, arr) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px',
              borderTop: '1px solid var(--sp-border-hair)',
            }}>
              <div className="sp-bodyM" style={{ flex: 1, color: 'var(--sp-text)' }}>{it.n}</div>
              <span className="sp-amount sp-amount-s" style={{ color: 'var(--sp-text-secondary)' }}>${it.a.toLocaleString('es-AR')}</span>
            </div>
          ))}
        </div>

        <Button variant="primary" size="lg" block style={{ marginTop: 8 }}>Continuar a división</Button>
        <div style={{ height: 16 }}/>
      </div>
    </div>
  );
}

Object.assign(window, {
  ScreenCreateExpense, ScreenCreateExpenseExact, ScreenCreateExpenseCategory,
  ScreenExpenseDetail, ScreenScanTicket, ScreenScanTicketConfirm,
  SplitMemberRow, CreateExpenseShell,
});
