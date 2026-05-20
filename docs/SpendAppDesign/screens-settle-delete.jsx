// screens-settle-delete.jsx — E1 settle up, E1b multi-currency,
//                              F1 request delete sheet, F2 object banner

/* ─────────────────────────────────────────────────────────────
   E1 · Registrar pago
   ───────────────────────────────────────────────────────────── */
function PersonPickerRow({ name, hue, sub, side = 'left', selected }) {
  return (
    <div style={{
      flex: 1, padding: 12, borderRadius: 'var(--sp-r-md)',
      background: selected ? 'var(--sp-brand-primary-soft)' : 'var(--sp-surface)',
      border: `1px solid ${selected ? 'var(--sp-brand-primary)' : 'var(--sp-border-hair)'}`,
      boxShadow: selected ? '0 0 0 3px rgba(10,110,143,0.10)' : 'none',
    }}>
      <div className="sp-label" style={{ fontSize: 10, marginBottom: 6 }}>{side === 'left' ? 'De' : 'A'}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Avatar name={name} hue={hue} size={28}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sp-bodyM" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>{name}</div>
          {sub && <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function ScreenSettleUp() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px' }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--sp-brand-primary)' }}>Cancelar</span>
        <div className="sp-h3" style={{ color: 'var(--sp-text)' }}>Registrar pago</div>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--sp-brand-primary)' }}>Confirmar</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 24px' }}>
        {/* Context */}
        <div style={{ padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sp-text-tertiary)' }}>
          <Icon name="users" size={14} stroke={2}/>
          <span className="sp-bodyS" style={{ fontWeight: 600 }}>Mar del Plata 2026</span>
        </div>

        {/* Amount */}
        <div style={{ padding: '14px 0 16px' }}>
          <AmountDisplay amount="6.200" currency="ARS"/>
        </div>

        {/* From → To */}
        <div className="sp-label" style={{ marginBottom: 8 }}>Quién pagó a quién</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <PersonPickerRow side="left" name="Diego" hue={3} sub="te debe $6.200" selected/>
          <div style={{ flexShrink: 0, color: 'var(--sp-text-tertiary)' }}>
            <Icon name="arrowRight" size={22} stroke={2.2}/>
          </div>
          <PersonPickerRow side="right" name="Vos" hue={6} sub="acreedor"/>
        </div>

        {/* Suggested settle chips */}
        <div className="sp-label" style={{ marginBottom: 8 }}>Sugerencias</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {[
            { label: 'Saldar todo · $6.200', active: true },
            { label: 'La mitad · $3.100' },
            { label: 'Otro monto' },
          ].map((c, i) => (
            <div key={i} style={{
              padding: '8px 14px', borderRadius: 'var(--sp-r-full)',
              fontSize: 13, fontWeight: 600,
              background: c.active ? 'var(--sp-brand-primary)' : 'var(--sp-surface)',
              color: c.active ? '#fff' : 'var(--sp-text-secondary)',
              border: c.active ? 'none' : '1px solid var(--sp-border)',
            }}>{c.label}</div>
          ))}
        </div>

        {/* Date + currency mini-card */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{
            flex: 1, padding: 12, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)',
          }}>
            <div className="sp-label" style={{ fontSize: 10, marginBottom: 4 }}>Fecha</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="calendar" size={16} color="var(--sp-text-tertiary)"/>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--sp-text)' }}>Hoy</span>
            </div>
          </div>
          <div style={{
            flex: 1, padding: 12, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)',
          }}>
            <div className="sp-label" style={{ fontSize: 10, marginBottom: 4 }}>Moneda</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', background: 'var(--sp-brand-primary-soft)',
                color: 'var(--sp-brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700,
              }}>$</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--sp-text)' }}>ARS</span>
            </div>
          </div>
        </div>

        {/* Note */}
        <TextField label="Nota (opcional)" placeholder="Transferencia Mercado Pago…"/>

        {/* Confirmation preview */}
        <div style={{
          marginTop: 16, padding: 14, borderRadius: 'var(--sp-r-md)',
          background: 'var(--sp-positive-soft)', color: 'var(--sp-positive-onSoft)',
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <Icon name="info" size={18} stroke={2}/>
          <div className="sp-bodyS">
            Al confirmar, <b>tu balance con Diego pasa a $0</b> en este grupo. Se registra al instante y se sincroniza con los demás miembros.
          </div>
        </div>
      </div>
    </div>
  );
}

/* E1b — pago en otra moneda (FX) */
function ScreenSettleUpFX() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px' }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--sp-brand-primary)' }}>Cancelar</span>
        <div className="sp-h3" style={{ color: 'var(--sp-text)' }}>Pago multi-moneda</div>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--sp-brand-primary)' }}>Confirmar</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 24px' }}>
        <div style={{ padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sp-text-tertiary)' }}>
          <Icon name="users" size={14} stroke={2}/>
          <span className="sp-bodyS" style={{ fontWeight: 600 }}>Tokyo en otoño</span>
        </div>

        {/* Pay amount in USD */}
        <div style={{ padding: '14px 0 8px' }}>
          <AmountDisplay amount="180" currency="USD · Pago" symbol="US$"/>
        </div>

        {/* People */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <PersonPickerRow side="left" name="Vos" hue={6} selected/>
          <Icon name="arrowRight" size={22} stroke={2.2} color="var(--sp-text-tertiary)"/>
          <PersonPickerRow side="right" name="Ana" hue={0}/>
        </div>

        {/* FX block — Pro */}
        <div style={{
          padding: 14, borderRadius: 'var(--sp-r-md)',
          background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div className="sp-label">Tipo de cambio</div>
            <ProBadge/>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="sp-amount" style={{ fontSize: 26, color: 'var(--sp-text)' }}>1.250</span>
            <span style={{ fontSize: 14, color: 'var(--sp-text-tertiary)' }}>ARS / USD</span>
          </div>
          <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', marginTop: 4 }}>
            Cotización dólar tarjeta · BNA · actualizado hace 12 min
          </div>
        </div>

        {/* Equivalent */}
        <div style={{
          marginTop: 12, padding: 14, borderRadius: 'var(--sp-r-md)',
          background: 'var(--sp-brand-accent-soft)', color: 'var(--sp-brand-accent-onSoft)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <Icon name="info" size={20} stroke={2}/>
          <div>
            <div className="sp-bodyS" style={{ fontWeight: 600 }}>Equivale a</div>
            <div className="sp-amount sp-amount-l" style={{ color: 'var(--sp-brand-accent-onSoft)' }}>$225.000 ARS</div>
          </div>
        </div>

        {/* Manual override toggle */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 'var(--sp-r-md)' }}>
          <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)' }}>Usar tipo de cambio manual</div>
          <div style={{
            width: 44, height: 26, borderRadius: 13, background: 'var(--sp-surface-sunken)',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute', top: 2, left: 2, width: 22, height: 22, borderRadius: '50%',
              background: 'var(--sp-surface)', boxShadow: 'var(--sp-shadow-1)',
            }}/>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   F1 · Solicitar borrado (bottom sheet)
   ───────────────────────────────────────────────────────────── */
function ScreenRequestDelete() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(31,26,20,0.55)', position: 'relative' }}>
      {/* Dimmed background (faux expense detail) */}
      <div style={{ flex: 1, padding: '60px 20px 0', opacity: 0.4, pointerEvents: 'none' }}>
        <CategoryIcon kind="food" size={56} style={{ margin: '0 auto 12px' }}/>
        <div className="sp-h2" style={{ color: 'var(--sp-text)', textAlign: 'center' }}>Bebidas extras</div>
        <div className="sp-amount" style={{ fontSize: 36, textAlign: 'center', color: 'var(--sp-text)', marginTop: 8 }}>$3.200</div>
      </div>

      <BottomSheet>
        <div style={{ padding: '6px 24px 0', textAlign: 'center' }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--sp-negative-soft)', color: 'var(--sp-negative)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 12px',
          }}><Icon name="trash" size={26} stroke={1.8}/></div>
          <div className="sp-h2" style={{ color: 'var(--sp-text)' }}>¿Eliminar este gasto?</div>
          <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)', marginTop: 6 }}>
            "Bebidas extras" · $3.200 · creado por Bob
          </div>
        </div>

        {/* Two options */}
        <div style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Request — primary */}
          <div style={{
            padding: 16, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-brand-primary-soft)',
            border: '1.5px solid var(--sp-brand-primary)',
            display: 'flex', gap: 12, alignItems: 'flex-start',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              background: 'var(--sp-brand-primary)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon name="users" size={18} stroke={2.2}/></div>
            <div style={{ flex: 1 }}>
              <div className="sp-bodyL" style={{ fontWeight: 700, color: 'var(--sp-brand-primary-onSoft)' }}>Solicitar eliminación</div>
              <div className="sp-bodyS" style={{ color: 'var(--sp-brand-primary-onSoft)', opacity: 0.85, marginTop: 2 }}>
                Los demás tienen <b>72 hs</b> para objetar. Si nadie objeta, el gasto se elimina automáticamente.
              </div>
              <Badge tone="brand" size="sm" style={{ marginTop: 8 }}>Recomendado</Badge>
            </div>
          </div>

          {/* Force — destructive */}
          <div style={{
            padding: 16, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-surface)', border: '1px solid var(--sp-border)',
            display: 'flex', gap: 12, alignItems: 'flex-start',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              background: 'var(--sp-negative-soft)', color: 'var(--sp-negative)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon name="trash" size={18} stroke={2}/></div>
            <div style={{ flex: 1 }}>
              <div className="sp-bodyL" style={{ fontWeight: 700, color: 'var(--sp-text)' }}>Eliminar ahora</div>
              <div className="sp-bodyS" style={{ color: 'var(--sp-text-secondary)', marginTop: 2 }}>
                Solo el creador (vos sos Bob) puede eliminar sin esperar. Quedará registrado en la actividad.
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 20px 0' }}>
          <Button variant="secondary" size="lg" block>Cancelar</Button>
        </div>
      </BottomSheet>
    </div>
  );
}

/* F2 — banner de objeción en el detalle del gasto */
function ScreenObjectDelete() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px' }}>
          <IconButton name="chevronLeft" variant="soft" size={36}/>
          <IconButton name="moreHorizontal" variant="soft" size={36}/>
        </div>

        {/* Pending deletion banner */}
        <div style={{ padding: '0 20px 16px' }}>
          <div style={{
            padding: 14, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-warning-soft)',
            border: '1px solid rgba(212, 162, 74, 0.4)',
            display: 'flex', gap: 12, alignItems: 'flex-start',
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: 'var(--sp-warning)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon name="warning" size={16} stroke={2.2}/></div>
            <div style={{ flex: 1 }}>
              <div className="sp-bodyM" style={{ fontWeight: 700, color: '#8A6420' }}>Eliminación solicitada</div>
              <div className="sp-bodyS" style={{ color: '#8A6420', marginTop: 2 }}>
                <b>Bob Pérez</b> propuso eliminar este gasto hace 14 horas.
              </div>

              {/* Countdown */}
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(212, 162, 74, 0.25)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: '80%', background: 'var(--sp-warning)', borderRadius: 3 }}/>
                </div>
                <span className="sp-amount sp-amount-s" style={{ color: '#8A6420' }}>57 h 48 m</span>
              </div>
              <div className="sp-bodyS" style={{ color: '#8A6420', opacity: 0.8, marginTop: 4 }}>
                Si nadie objeta antes del lun 18 a las 14:00, se elimina solo.
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Button variant="destructive" size="sm">Objetar</Button>
                <Button variant="ghost" size="sm" style={{ color: '#8A6420' }}>Ver acuerdos</Button>
              </div>
            </div>
          </div>
        </div>

        {/* Expense itself, slightly muted */}
        <div style={{ padding: '0 20px', opacity: 0.65, pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center', padding: '8px 0 18px' }}>
            <CategoryIcon kind="food" size={56} style={{ margin: '0 auto 12px' }}/>
            <div className="sp-h2" style={{ color: 'var(--sp-text)' }}>Bebidas extras</div>
            <div className="sp-amount" style={{ fontSize: 36, color: 'var(--sp-text)', marginTop: 8 }}>$3.200</div>
            <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', marginTop: 4 }}>
              Bob pagó · viernes 14, 23:40
            </div>
          </div>

          <div className="sp-label" style={{ marginBottom: 10 }}>División · Igual</div>
          <div style={{ background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-md)', border: '1px solid var(--sp-border-hair)', overflow: 'hidden' }}>
            {[
              { n: 'Bob', h: 1 }, { n: 'Vos', h: 6 }, { n: 'Ana', h: 0 }, { n: 'Carla', h: 2 },
            ].map((p, i, arr) => (
              <div key={p.n} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                borderBottom: i < arr.length - 1 ? '1px solid var(--sp-border-hair)' : 'none',
              }}>
                <Avatar name={p.n} hue={p.h} size={28}/>
                <div style={{ flex: 1 }}>
                  <div className="sp-bodyM" style={{ fontWeight: 600 }}>{p.n}</div>
                </div>
                <span className="sp-amount sp-amount-s">$800</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  ScreenSettleUp, ScreenSettleUpFX, ScreenRequestDelete, ScreenObjectDelete,
  PersonPickerRow,
});
