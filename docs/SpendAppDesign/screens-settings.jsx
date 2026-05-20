// screens-settings.jsx — G1 Ajustes/Perfil, G2 Upgrade Pro, G3 Rewarded Ad Gate

/* ─────────────────────────────────────────────────────────────
   G1 · Ajustes / Perfil
   ───────────────────────────────────────────────────────────── */
function SettingsRow({ icon, iconColor, label, value, danger, isLast, badge, action }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
      borderBottom: isLast ? 'none' : '1px solid var(--sp-border-hair)',
    }}>
      {icon && (
        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: iconColor || 'var(--sp-brand-primary-soft)',
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon name={icon} size={17} stroke={2.2}/></div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sp-bodyL" style={{
          color: danger ? 'var(--sp-negative)' : 'var(--sp-text)',
          fontWeight: 500,
        }}>{label}</div>
      </div>
      {badge}
      {value && <span className="sp-bodyM" style={{ color: 'var(--sp-text-tertiary)' }}>{value}</span>}
      {action !== false && <Icon name="chevronRight" size={16} color="var(--sp-text-tertiary)" stroke={2}/>}
    </div>
  );
}

function ScreenSettings() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg-grouped)' }}>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 24 }}>

        {/* Top */}
        <div style={{ padding: '8px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--sp-brand-primary)' }}>Listo</span>
          <div className="sp-h3" style={{ color: 'var(--sp-text)' }}>Ajustes</div>
          <div style={{ width: 50 }}/>
        </div>

        {/* Profile card */}
        <div style={{ padding: '8px 16px 16px' }}>
          <div style={{
            padding: 16, borderRadius: 'var(--sp-r-lg)',
            background: 'var(--sp-surface)',
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <Avatar name="Lucas Rivera" hue={6} size={56}/>
            <div style={{ flex: 1 }}>
              <div className="sp-h3" style={{ color: 'var(--sp-text)' }}>Lucas Rivera</div>
              <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', marginTop: 2 }}>@lucasr · lucas@hey.com</div>
            </div>
            <IconButton name="edit" variant="soft" size={36}/>
          </div>
        </div>

        {/* Plan card */}
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{
            padding: 16, borderRadius: 'var(--sp-r-lg)',
            background: 'var(--sp-surface)',
            border: '1px solid var(--sp-border-hair)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>PLAN ACTUAL</div>
                <div className="sp-h2" style={{ color: 'var(--sp-text)', marginTop: 2 }}>Free</div>
              </div>
              <ProBadge style={{ fontSize: 11, padding: '4px 10px 4px 8px' }}/>
            </div>

            {/* Daily expense counter */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="sp-bodyS" style={{ color: 'var(--sp-text-secondary)', fontWeight: 600 }}>Gastos hoy</span>
                <span className="sp-bodyS" style={{ color: 'var(--sp-text-secondary)', fontWeight: 600 }}>3 / 4 gratis</span>
              </div>
              <div style={{ height: 8, background: 'var(--sp-surface-sunken)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '75%', background: 'var(--sp-brand-primary)', borderRadius: 4 }}/>
              </div>
              <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', marginTop: 6 }}>
                El 5to gasto del día requiere un anuncio o Pro. Se resetea cada día a las 00:00.
              </div>
            </div>

            <Button variant="primary" block style={{ marginTop: 14 }} rightIcon="arrowRight">
              Probar Pro · 7 días gratis
            </Button>
          </div>
        </div>

        {/* Settings groups */}
        <div className="sp-label" style={{ padding: '4px 28px 8px' }}>Sincronización & datos</div>
        <div style={{ background: 'var(--sp-surface)', margin: '0 16px', borderRadius: 'var(--sp-r-lg)' }}>
          <SettingsRow icon="sync" iconColor="var(--sp-brand-primary)" label="Sincronización P2P" value="WebRTC + BT"/>
          <SettingsRow icon="cloudOff" iconColor="var(--sp-text-secondary)" label="Modo solo offline" badge={
            <div style={{ width: 44, height: 26, borderRadius: 13, background: 'var(--sp-surface-sunken)', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 2, left: 2, width: 22, height: 22, borderRadius: '50%', background: 'var(--sp-surface)', boxShadow: 'var(--sp-shadow-1)' }}/>
            </div>
          } action={false}/>
          <SettingsRow icon="arrowUpRight" iconColor="var(--sp-brand-accent-strong)" label="Exportar datos" value=".splitp2p"/>
          <SettingsRow icon="receipt" iconColor="var(--sp-cat-shopping)" label="Restaurar backup" isLast/>
        </div>

        <div className="sp-label" style={{ padding: '20px 28px 8px' }}>Notificaciones</div>
        <div style={{ background: 'var(--sp-surface)', margin: '0 16px', borderRadius: 'var(--sp-r-lg)' }}>
          <SettingsRow icon="bell" iconColor="var(--sp-cat-utilities)" label="Avisarme de nuevos gastos" badge={
            <div style={{ width: 44, height: 26, borderRadius: 13, background: 'var(--sp-brand-primary)', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: 'var(--sp-shadow-1)' }}/>
            </div>
          } action={false}/>
          <SettingsRow icon="warning" iconColor="var(--sp-warning)" label="Solicitudes de borrado" badge={
            <div style={{ width: 44, height: 26, borderRadius: 13, background: 'var(--sp-brand-primary)', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: 'var(--sp-shadow-1)' }}/>
            </div>
          } action={false}/>
          <SettingsRow icon="users" iconColor="var(--sp-cat-accommodation)" label="Invitaciones" isLast badge={
            <div style={{ width: 44, height: 26, borderRadius: 13, background: 'var(--sp-surface-sunken)', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 2, left: 2, width: 22, height: 22, borderRadius: '50%', background: 'var(--sp-surface)', boxShadow: 'var(--sp-shadow-1)' }}/>
            </div>
          } action={false}/>
        </div>

        <div className="sp-label" style={{ padding: '20px 28px 8px' }}>Apariencia</div>
        <div style={{ background: 'var(--sp-surface)', margin: '0 16px', borderRadius: 'var(--sp-r-lg)' }}>
          <SettingsRow icon="eye" iconColor="var(--sp-cat-transport)" label="Tema" value="Automático"/>
          <SettingsRow icon="creditCard" iconColor="var(--sp-cat-other)" label="Moneda principal" value="ARS" isLast/>
        </div>

        <div style={{ padding: '20px 16px 0' }}>
          <Button variant="ghost" block style={{ color: 'var(--sp-negative)', fontWeight: 600 }}>Cerrar sesión</Button>
        </div>
        <div className="sp-bodyS" style={{ textAlign: 'center', color: 'var(--sp-text-tertiary)', padding: '8px 0' }}>
          SplitP2P v1.0.0 · build 142
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   G2 · Upgrade a Pro
   ───────────────────────────────────────────────────────────── */
function PlanFeatureRow({ feature, free, pro }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 56px 56px',
      alignItems: 'center', padding: '12px 0',
      borderBottom: '1px solid var(--sp-border-hair)',
    }}>
      <div className="sp-bodyM" style={{ color: 'var(--sp-text)' }}>{feature}</div>
      <div style={{ textAlign: 'center' }}>
        {free === true ? <Icon name="checkSmall" size={18} stroke={2.5} color="var(--sp-text-tertiary)"/>
         : free === false ? <Icon name="close" size={16} stroke={2} color="var(--sp-text-disabled)"/>
         : <span className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>{free}</span>}
      </div>
      <div style={{ textAlign: 'center' }}>
        {pro === true ? <Icon name="checkSmall" size={18} stroke={2.6} color="var(--sp-brand-accent-strong)"/>
         : <span className="sp-bodyS" style={{ fontWeight: 700, color: 'var(--sp-brand-accent-onSoft)' }}>{pro}</span>}
      </div>
    </div>
  );
}

function ScreenUpgrade() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 0 24px' }}>
        {/* Hero — petróleo + acento ámbar para Pro */}
        <div style={{
          padding: '16px 24px 32px',
          background: 'linear-gradient(180deg, rgba(212, 168, 72, 0.14), rgba(212, 168, 72, 0))',
        }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <IconButton name="close" variant="soft" size={36}/>
          </div>
          <div style={{ textAlign: 'center' }}>
            <ProBadge style={{ fontSize: 14, padding: '6px 14px 6px 10px', margin: '0 auto 16px' }}/>
            <div className="sp-display" style={{ color: 'var(--sp-text)', lineHeight: 1.1 }}>
              Sin límites.<br/>Sin ads. Sin fricción.
            </div>
            <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)', marginTop: 10, maxWidth: 280, margin: '10px auto 0' }}>
              7 días gratis · cancelás cuando quieras desde el App Store.
            </div>
          </div>
        </div>

        {/* Plan tiles */}
        <div style={{ padding: '0 20px 18px', display: 'flex', gap: 10 }}>
          <div style={{
            flex: 1, padding: 16, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-surface)', border: '1px solid var(--sp-border)',
          }}>
            <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', fontWeight: 600 }}>Mensual</div>
            <div className="sp-amount" style={{ fontSize: 26, lineHeight: '30px', color: 'var(--sp-text)', marginTop: 2 }}>$1.490</div>
            <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>por mes</div>
          </div>
          <div style={{
            flex: 1, padding: 16, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-brand-primary-soft)',
            border: '1.5px solid var(--sp-brand-primary)',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute', top: -10, right: 12,
              padding: '2px 8px', fontSize: 10, fontWeight: 700, color: '#fff',
              background: 'var(--sp-brand-primary)', borderRadius: 'var(--sp-r-full)',
              letterSpacing: '0.04em',
            }}>AHORRÁS 33%</div>
            <div className="sp-bodyS" style={{ color: 'var(--sp-brand-primary-onSoft)', fontWeight: 700 }}>Anual</div>
            <div className="sp-amount" style={{ fontSize: 26, lineHeight: '30px', color: 'var(--sp-brand-primary-onSoft)', marginTop: 2 }}>$11.990</div>
            <div className="sp-bodyS" style={{ color: 'var(--sp-brand-primary-onSoft)', opacity: 0.85 }}>$999/mes</div>
          </div>
        </div>

        {/* Comparison */}
        <div style={{ padding: '0 20px 16px' }}>
          <div style={{
            background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-lg)',
            border: '1px solid var(--sp-border-hair)', padding: '4px 18px 12px',
          }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 56px 56px',
              padding: '14px 0 10px',
              borderBottom: '1px solid var(--sp-border)',
            }}>
              <div className="sp-label">Función</div>
              <div className="sp-label" style={{ textAlign: 'center' }}>Free</div>
              <div className="sp-label" style={{ textAlign: 'center', color: 'var(--sp-brand-accent-onSoft)' }}>Pro</div>
            </div>
            <PlanFeatureRow feature="Gastos por día" free="4 + ads" pro="Ilimitados"/>
            <PlanFeatureRow feature="Grupos y miembros" free={true} pro={true}/>
            <PlanFeatureRow feature="Anuncios" free="Sí" pro="Ninguno"/>
            <PlanFeatureRow feature="Escanear ticket (OCR)" free={false} pro={true}/>
            <PlanFeatureRow feature="Estadísticas y gráficos" free={false} pro={true}/>
            <PlanFeatureRow feature="Exportar CSV / PDF" free=".splitp2p" pro="CSV + PDF"/>
            <PlanFeatureRow feature="Tipo de cambio automático" free={false} pro={true}/>
            <PlanFeatureRow feature="Soporte prioritario" free={false} pro={true}/>
          </div>
        </div>

        {/* Sticky bottom CTA section */}
        <div style={{ padding: '0 20px 0' }}>
          <Button variant="primary" size="lg" block>Probar 7 días gratis</Button>
          <div className="sp-bodyS" style={{ textAlign: 'center', color: 'var(--sp-text-tertiary)', marginTop: 8 }}>
            Renueva $11.990/año · cancelás en 1 toque
          </div>
          <Button variant="ghost" block style={{ marginTop: 8, color: 'var(--sp-text-secondary)' }}>Restaurar compra</Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   G3 · Rewarded Ad Gate (modal)
   ───────────────────────────────────────────────────────────── */
function ScreenAdGate() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(31,26,20,0.55)', position: 'relative' }}>
      {/* Faux create expense screen dimmed */}
      <div style={{ flex: 1, padding: '60px 20px 0', opacity: 0.35, pointerEvents: 'none' }}>
        <AmountDisplay amount="2.480" currency="ARS"/>
      </div>

      <BottomSheet>
        <div style={{ padding: '6px 24px 0', textAlign: 'center' }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--sp-cat-utilities), var(--sp-cat-food))',
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
            boxShadow: '0 12px 30px rgba(212, 168, 72, 0.3)',
          }}>
            <Icon name="bolt" size={32} stroke={2.2}/>
          </div>
          <div className="sp-h2" style={{ color: 'var(--sp-text)' }}>
            Usaste tus 4 gastos<br/>gratis de hoy
          </div>
          <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)', marginTop: 8, maxWidth: 300, margin: '8px auto 0' }}>
            Mañana tenés 4 más. O elegí cómo seguir hoy:
          </div>
        </div>

        {/* Options */}
        <div style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Pro upsell — primary */}
          <div style={{
            padding: 16, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-brand-primary)', color: '#fff',
            display: 'flex', gap: 14, alignItems: 'center', cursor: 'pointer',
            boxShadow: '0 8px 20px rgba(10, 110, 143, 0.3)',
          }}>
            <div style={{
              width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(255,255,255,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon name="sparkle" size={20} stroke={2}/></div>
            <div style={{ flex: 1 }}>
              <div className="sp-bodyL" style={{ fontWeight: 700, color: '#fff' }}>Obtener Pro · 7 días gratis</div>
              <div className="sp-bodyS" style={{ color: 'rgba(255,255,255,0.85)' }}>Sin límites · sin ads · OCR + estadísticas</div>
            </div>
            <Icon name="chevronRight" size={20} color="rgba(255,255,255,0.7)"/>
          </div>

          {/* Watch ad */}
          <div style={{
            padding: 16, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-surface)', border: '1px solid var(--sp-border)',
            display: 'flex', gap: 14, alignItems: 'center', cursor: 'pointer',
          }}>
            <div style={{
              width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
              background: 'var(--sp-surface-sunken)', color: 'var(--sp-text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon name="bolt" size={20} stroke={2}/></div>
            <div style={{ flex: 1 }}>
              <div className="sp-bodyL" style={{ fontWeight: 700, color: 'var(--sp-text)' }}>Ver un anuncio · 30 s</div>
              <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>Desbloqueá este gasto sin pagar</div>
            </div>
            <Badge tone="accent" size="sm">+1 gasto</Badge>
          </div>

          {/* Wait */}
          <div style={{
            padding: 14, textAlign: 'center',
            color: 'var(--sp-text-tertiary)',
          }}>
            <span className="sp-bodyS">o <b style={{ color: 'var(--sp-text-secondary)' }}>esperar a mañana</b> · se renueva en <b style={{ color: 'var(--sp-text)' }}>4 h 12 m</b></span>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

Object.assign(window, {
  ScreenSettings, ScreenUpgrade, ScreenAdGate,
  SettingsRow, PlanFeatureRow,
});
