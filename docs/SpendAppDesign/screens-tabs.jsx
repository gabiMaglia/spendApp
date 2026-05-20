// screens-tabs.jsx — B1 Dashboard, B2 Grupos, B3 Actividad
//
// All three share: ScreenHeader (large title + sync badge), TabBar (bottom).
// Dashboard adds FAB. Each screen renders into PhoneFrame from <App>.

/* ─────────────────────────────────────────────────────────────
   B1 · Dashboard — "Inicio"
   ─────────────────────────────────────────────────────────────
   Components: ScreenHeader · BalanceSummaryCard · person rows
   (Avatar + BalancePill) · quick actions · FAB · TabBar */
function ScreenDashboard() {
  const people = [
    { name: 'Ana López', sub: '2 grupos · Mar del Plata + Roomates', balance: 12500, hue: 0 },
    { name: 'Bob Pérez', sub: 'Mar del Plata 2026', balance: 8200, hue: 1 },
    { name: 'Carla Suarez', sub: 'Roomates', balance: 3800, hue: 2 },
    { name: 'Diego Martín', sub: 'Mar del Plata 2026', balance: -4200, hue: 3 },
    { name: 'Eli Vega', sub: 'Cumple Sofi', balance: -4000, hue: 4 },
    { name: 'Sofi Romero', sub: 'Roomates · saldado', balance: 0, hue: 5 },
  ];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)', position: 'relative' }}>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 100 }}>
        {/* Header with greeting */}
        <div style={{ padding: '8px 20px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <SyncStatusBadge state="synced"/>
            <Avatar name="Vos" hue={6} size={36}/>
          </div>
          <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)' }}>Hola, Lucas</div>
          <div className="sp-display" style={{ color: 'var(--sp-text)' }}>Tus cuentas</div>
        </div>

        {/* Hero balance card */}
        <div style={{ padding: '0 20px 16px' }}>
          <BalanceSummaryCard owedToYou={24500} youOwe={8200}/>
        </div>

        {/* Quick actions */}
        <div style={{ padding: '0 20px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{
            padding: 14, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 'var(--sp-r-sm)',
              background: 'var(--sp-positive-soft)', color: 'var(--sp-positive)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon name="creditCard" size={18}/></div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sp-text)' }}>Registrar</div>
              <div style={{ fontSize: 11, color: 'var(--sp-text-tertiary)' }}>un pago</div>
            </div>
          </div>
          <div style={{
            padding: 14, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 'var(--sp-r-sm)',
              background: 'var(--sp-brand-primary-soft)', color: 'var(--sp-brand-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon name="qr" size={18}/></div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sp-text)' }}>Unirme a</div>
              <div style={{ fontSize: 11, color: 'var(--sp-text-tertiary)' }}>un grupo</div>
            </div>
          </div>
        </div>

        {/* People list (cross-group balance) */}
        <div style={{ padding: '0 20px 8px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div className="sp-label" style={{ color: 'var(--sp-text-tertiary)' }}>Por persona</div>
          <span className="sp-bodyS" style={{ color: 'var(--sp-brand-primary)', fontWeight: 600 }}>Ver todos</span>
        </div>
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-card-gap)' }}>
          {people.map(p => (
            <div key={p.name} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: 'var(--sp-card-pad)',
              background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-lg)',
              border: '1px solid var(--sp-border-hair)',
            }}>
              <Avatar name={p.name} hue={p.hue} size={40}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="sp-bodyL" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>{p.name}</div>
                <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.sub}</div>
              </div>
              {p.balance === 0 ? (
                <span className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', fontWeight: 500 }}>Saldado</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: p.balance > 0 ? 'var(--sp-positive)' : 'var(--sp-negative)',
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>{p.balance > 0 ? 'Te debe' : 'Le debés'}</div>
                  <div className="sp-amount sp-amount-m" style={{ color: p.balance > 0 ? 'var(--sp-positive)' : 'var(--sp-negative)' }}>
                    ${Math.abs(p.balance).toLocaleString('es-AR')}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <FAB icon="plus" label="Agregar gasto"/>
      <TabBar active="home"/>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   B2 · Grupos
   ───────────────────────────────────────────────────────────── */
function ScreenGroups() {
  const groups = [
    { name: 'Mar del Plata 2026', members: [{name:'Ana',hue:0},{name:'Bob',hue:1},{name:'Carla',hue:2},{name:'Diego',hue:3},{name:'Eli',hue:4}], balance: 18500, subtitle: '12 gastos' },
    { name: 'Roomates', members: [{name:'Sofi',hue:5},{name:'Tom',hue:0}], balance: -4400, subtitle: 'mensual · 8 gastos' },
    { name: 'Cumple Sofi', members: [{name:'Sofi',hue:5},{name:'Ana',hue:0},{name:'Eli',hue:4}], balance: -4000, subtitle: 'cerrado pronto' },
    { name: 'Asado mensual', members: [{name:'Ana',hue:0},{name:'Bob',hue:1},{name:'Carla',hue:2},{name:'Tom',hue:0},{name:'Sofi',hue:5},{name:'Eli',hue:4}], balance: 0, subtitle: 'todo saldado ✓' },
  ];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)', position: 'relative' }}>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 100 }}>
        <ScreenHeader title="Grupos" syncState="synced" rightSlot={
          <IconButton name="plus" variant="soft" size={36}/>
        }/>
        <div style={{ padding: '0 20px 12px' }}>
          <SegmentedControl value="activos" options={[
            { value: 'activos', label: 'Activos' },
            { value: 'archivados', label: 'Archivados' },
          ]}/>
        </div>
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-card-gap)' }}>
          {groups.map(g => <GroupCard key={g.name} {...g}/>)}
        </div>

        {/* Helpful tip — only show on this screen for "P2P" visibility */}
        <div style={{
          margin: '20px 20px 0', padding: 14,
          background: 'var(--sp-brand-accent-soft)',
          color: 'var(--sp-brand-accent-onSoft)',
          borderRadius: 'var(--sp-r-md)',
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: 'var(--sp-brand-accent)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icon name="sync" size={16} stroke={2.2}/></div>
          <div>
            <div className="sp-bodyM" style={{ fontWeight: 600, color: 'var(--sp-brand-accent-onSoft)' }}>P2P, sin servidor</div>
            <div className="sp-bodyS" style={{ color: 'var(--sp-brand-accent-onSoft)', opacity: 0.85, marginTop: 2 }}>
              Los miembros sincronizan entre sí. Si nadie tiene internet, alcanza con estar cerca: Bluetooth se encarga.
            </div>
          </div>
        </div>
      </div>

      <FAB icon="plus" label="Nuevo grupo"/>
      <TabBar active="groups"/>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   B3 · Actividad
   ───────────────────────────────────────────────────────────── */
function ActivityRow({ icon, iconBg, iconColor, who, action, detail, time, amount, isNew, indented }) {
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '12px 20px',
      background: isNew ? 'var(--sp-brand-primary-soft)' : 'transparent',
      borderRadius: isNew ? 'var(--sp-r-md)' : 0,
      margin: isNew ? '0 12px' : 0,
      paddingLeft: isNew ? 12 : 20,
      alignItems: 'flex-start',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: iconBg, color: iconColor || '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sp-bodyM" style={{ color: 'var(--sp-text)', lineHeight: 1.35 }}>
          <b>{who}</b> {action} {detail && <span style={{ color: 'var(--sp-text-secondary)' }}>{detail}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <span className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>{time}</span>
          {isNew && <span style={{
            width: 6, height: 6, borderRadius: '50%', background: 'var(--sp-brand-primary)',
          }}/>}
        </div>
      </div>
      {amount && <div className="sp-amount sp-amount-m" style={{ color: 'var(--sp-text)' }}>{amount}</div>}
    </div>
  );
}

function ScreenActivity() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)', position: 'relative' }}>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 100 }}>
        <ScreenHeader title="Actividad" syncState="synced" rightSlot={
          <IconButton name="search" variant="soft" size={36}/>
        }/>

        {/* Filter chips */}
        <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8, overflowX: 'auto' }}>
          {['Todos', 'Mar del Plata', 'Roomates', 'Cumple Sofi'].map((f, i) => (
            <div key={f} style={{
              padding: '6px 14px', borderRadius: 'var(--sp-r-full)', whiteSpace: 'nowrap',
              fontSize: 13, fontWeight: 600,
              background: i === 0 ? 'var(--sp-brand-primary)' : 'var(--sp-surface)',
              color: i === 0 ? '#fff' : 'var(--sp-text-secondary)',
              border: i === 0 ? 'none' : '1px solid var(--sp-border)',
            }}>{f}</div>
          ))}
        </div>

        {/* HOY · 2 sin ver */}
        <div style={{ padding: '8px 20px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="sp-label" style={{ color: 'var(--sp-text-tertiary)' }}>Hoy</div>
          <div style={{
            padding: '2px 8px', borderRadius: 'var(--sp-r-full)',
            background: 'var(--sp-brand-primary)', color: '#fff',
            fontSize: 11, fontWeight: 700,
          }}>2 sin ver</div>
        </div>
        <ActivityRow isNew
          icon={<Icon name="plus" size={18} stroke={2.3}/>} iconBg="var(--sp-brand-primary)"
          who="Ana" action="agregó un gasto" detail="Cena en La Cantina · Mar del Plata 2026"
          time="hace 18 min" amount="$12.480"/>
        <ActivityRow isNew
          icon={<Icon name="warning" size={18} stroke={2.2}/>} iconBg="var(--sp-warning)"
          who="Bob" action="solicitó eliminar" detail='"Bebidas extras" · Mar del Plata 2026'
          time="hace 2 h"/>

        <div className="sp-label" style={{ padding: '14px 20px 4px', color: 'var(--sp-text-tertiary)' }}>Ayer</div>
        <ActivityRow
          icon={<Icon name="arrowRight" size={18} stroke={2.3}/>} iconBg="var(--sp-positive)"
          who="Bob" action="te pagó" detail="$4.200 · Mar del Plata 2026"
          time="ayer 19:24" amount="$4.200"/>
        <ActivityRow
          icon={<Icon name="plus" size={18} stroke={2.3}/>} iconBg="var(--sp-brand-primary)"
          who="Vos" action="agregaste un gasto" detail="Airbnb Mar del Plata"
          time="ayer 11:08" amount="$185.000"/>
        <ActivityRow
          icon={<Icon name="users" size={18} stroke={2.2}/>} iconBg="var(--sp-brand-accent-strong)"
          who="Diego" action="se unió al grupo" detail="Mar del Plata 2026"
          time="ayer 09:50"/>

        <div className="sp-label" style={{ padding: '14px 20px 4px', color: 'var(--sp-text-tertiary)' }}>Esta semana</div>
        <ActivityRow
          icon={<Icon name="edit" size={16} stroke={2}/>} iconBg="var(--sp-surface-sunken)" iconColor="var(--sp-text-secondary)"
          who="Carla" action="editó" detail='"Supermercado" · Roomates'
          time="lun 09:14"/>
        <ActivityRow
          icon={<Icon name="check" size={18} stroke={2.5}/>} iconBg="var(--sp-positive)"
          who="Sofi" action="confirmó el borrado de" detail='"Pizza última" · Cumple Sofi'
          time="dom 22:30"/>
      </div>
      <TabBar active="activity" badges={{ activity: 2 }}/>
    </div>
  );
}

Object.assign(window, { ScreenDashboard, ScreenGroups, ScreenActivity, ActivityRow });
