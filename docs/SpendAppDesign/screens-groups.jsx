// screens-groups.jsx — C1 detail, C1b multi-currency, C2 create, C3 invite (3 tabs)

/* ─────────────────────────────────────────────────────────────
   C1 · Detalle de grupo
   ───────────────────────────────────────────────────────────── */
function GroupHeader({ name, members, balance, currency = '$', secondaryAction }) {
  return (
    <div style={{
      padding: '8px 20px 18px',
      background: 'var(--sp-surface-warm)',
      borderBottomLeftRadius: 'var(--sp-r-2xl)',
      borderBottomRightRadius: 'var(--sp-r-2xl)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <IconButton name="chevronLeft" variant="soft" size={36}/>
        <SyncStatusBadge state="synced"/>
        <IconButton name="moreHorizontal" variant="soft" size={36}/>
      </div>

      <div className="sp-h1" style={{ color: 'var(--sp-text)' }}>{name}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <AvatarStack people={members} size={26} max={4} ring="var(--sp-surface-warm)"/>
        <div className="sp-bodyS" style={{ color: 'var(--sp-text-secondary)' }}>
          {members.length} miembros
        </div>
        <div style={{ flex: 1 }}/>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 12, fontWeight: 600, color: 'var(--sp-brand-primary)',
        }}>
          <Icon name="plus" size={14} stroke={2.3}/> Invitar
        </span>
      </div>

      {/* Balance hero inside the group */}
      <div style={{ marginTop: 16, padding: 14, background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-md)', boxShadow: 'var(--sp-shadow-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="sp-label">Tu balance acá</div>
            <div className="sp-amount" style={{
              fontSize: 30, lineHeight: '34px', marginTop: 2,
              color: balance >= 0 ? 'var(--sp-positive)' : 'var(--sp-negative)',
            }}>{balance >= 0 ? '+' : '−'}{currency}{Math.abs(balance).toLocaleString('es-AR')}</div>
            <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', marginTop: 2 }}>
              {balance >= 0 ? 'Te deben en total' : 'Debés en total'}
            </div>
          </div>
          <Button variant="primary" size="sm">Saldar deudas</Button>
        </div>
      </div>
    </div>
  );
}

function SimplifiedDebt({ from, fromHue, to, toHue, amount, currency = '$', isYou }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px', borderRadius: 'var(--sp-r-md)',
      background: isYou ? 'var(--sp-negative-soft)' : 'var(--sp-surface)',
      border: '1px solid ' + (isYou ? 'transparent' : 'var(--sp-border-hair)'),
    }}>
      <Avatar name={from} hue={fromHue} size={28}/>
      <span className="sp-bodyM" style={{ color: 'var(--sp-text)', fontWeight: 600 }}>{from === 'Vos' ? 'Vos' : from}</span>
      <Icon name="arrowRight" size={16} color="var(--sp-text-tertiary)" stroke={2}/>
      <Avatar name={to} hue={toHue} size={28}/>
      <span className="sp-bodyM" style={{ color: 'var(--sp-text)', fontWeight: 600 }}>{to === 'Vos' ? 'Vos' : to}</span>
      <div style={{ flex: 1 }}/>
      <span className="sp-amount sp-amount-m" style={{
        color: isYou ? 'var(--sp-negative)' : 'var(--sp-text)',
      }}>{currency}{amount.toLocaleString('es-AR')}</span>
    </div>
  );
}

function ScreenGroupDetail() {
  const members = [
    {name:'Ana',hue:0},{name:'Bob',hue:1},{name:'Carla',hue:2},{name:'Diego',hue:3},{name:'Eli',hue:4},
  ];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)', position: 'relative' }}>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 100 }}>
        <GroupHeader name="Mar del Plata 2026" members={members} balance={18500}/>

        {/* Simplified debts */}
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div className="sp-label">Deudas simplificadas</div>
            <span className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>3 movimientos</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SimplifiedDebt from="Diego" fromHue={3} to="Vos" toHue={6} amount={6200}/>
            <SimplifiedDebt from="Eli" fromHue={4} to="Vos" toHue={6} amount={12300}/>
            <SimplifiedDebt isYou from="Vos" fromHue={6} to="Ana" toHue={0} amount={3120}/>
          </div>
        </div>

        {/* Expenses list */}
        <div style={{ padding: '24px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div className="sp-label">Gastos · 12</div>
            <span className="sp-bodyS" style={{ color: 'var(--sp-brand-primary)', fontWeight: 600 }}>Ordenar</span>
          </div>
          <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', marginBottom: 8, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>Hoy</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-card-gap)' }}>
            <ExpenseCard category="food" title="Cena en La Cantina" payer="Ana" date="20:14" amount={12480} yourShare={-3120} currency="$"/>
            <ExpenseCard category="shopping" title="Supermercado Coto" payer="Vos" date="12:08" amount={9450} yourShare={5670}/>
          </div>
          <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', marginTop: 16, marginBottom: 8, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>Vie 14</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-card-gap)' }}>
            <ExpenseCard category="accommodation" title="Airbnb Mar del Plata" payer="Vos" date="11:08" amount={185000} yourShare={111000}/>
            <ExpenseCard category="transport" title="Combustible" payer="Diego" date="08:30" amount={28400} yourShare={-5680}/>
            <PaymentCard from="Bob" to="Vos" amount={4200} date="07:24"/>
          </div>
        </div>
      </div>

      <FAB icon="plus" label="Gasto"/>
    </div>
  );
}

/* C1b — multi-currency variant: tabs for ARS / USD balance */
function ScreenGroupDetailMulti() {
  const members = [
    {name:'Ana',hue:0},{name:'Bob',hue:1},{name:'Carla',hue:2},{name:'Diego',hue:3},
  ];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)', position: 'relative' }}>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 100 }}>
        <div style={{
          padding: '8px 20px 18px',
          background: 'var(--sp-surface-warm)',
          borderBottomLeftRadius: 'var(--sp-r-2xl)',
          borderBottomRightRadius: 'var(--sp-r-2xl)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <IconButton name="chevronLeft" variant="soft" size={36}/>
            <SyncStatusBadge state="syncing"/>
            <IconButton name="moreHorizontal" variant="soft" size={36}/>
          </div>

          <div className="sp-h1" style={{ color: 'var(--sp-text)' }}>Tokyo en otoño</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <AvatarStack people={members} size={26} max={4} ring="var(--sp-surface-warm)"/>
            <div className="sp-bodyS" style={{ color: 'var(--sp-text-secondary)' }}>{members.length} miembros · 3 monedas</div>
          </div>

          {/* Currency tabs */}
          <div style={{ marginTop: 14 }}>
            <SegmentedControl value="ars" options={[
              { value: 'ars', label: 'ARS' },
              { value: 'usd', label: 'USD' },
              { value: 'jpy', label: '¥ JPY' },
            ]}/>
          </div>

          <div style={{ marginTop: 12, padding: 14, background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-md)', boxShadow: 'var(--sp-shadow-1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="sp-label">Tu balance · ARS</div>
                <div className="sp-amount" style={{ fontSize: 28, lineHeight: '32px', marginTop: 2, color: 'var(--sp-positive)' }}>+$42.500</div>
                <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', marginTop: 2 }}>Te deben en pesos</div>
              </div>
              <Button variant="primary" size="sm">Saldar</Button>
            </div>
          </div>

          {/* Other currency mini cards */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <div style={{ flex: 1, padding: 10, background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-sm)' }}>
              <div className="sp-label" style={{ fontSize: 10 }}>USD</div>
              <div className="sp-amount sp-amount-m" style={{ color: 'var(--sp-negative)' }}>−US$180</div>
            </div>
            <div style={{ flex: 1, padding: 10, background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-sm)' }}>
              <div className="sp-label" style={{ fontSize: 10 }}>JPY</div>
              <div className="sp-amount sp-amount-m" style={{ color: 'var(--sp-positive)' }}>+¥12.500</div>
            </div>
          </div>
        </div>

        <div style={{ padding: '20px 20px 0' }}>
          <div className="sp-label" style={{ marginBottom: 10 }}>Gastos en ARS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-card-gap)' }}>
            <ExpenseCard category="food" title="Cena ramen Shibuya" payer="Ana" date="vie" amount={42500} yourShare={10625}/>
            <ExpenseCard category="transport" title="JR Pass" payer="Vos" date="jue" amount={185000} yourShare={46250}/>
          </div>
        </div>
      </div>
      <FAB icon="plus" label="Gasto"/>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   C2 · Crear grupo
   ───────────────────────────────────────────────────────────── */
function ScreenCreateGroup() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)' }}>
      {/* Modal-style sheet header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px' }}>
        <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--sp-brand-primary)' }}>Cancelar</span>
        <div className="sp-h3" style={{ color: 'var(--sp-text)' }}>Nuevo grupo</div>
        <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--sp-brand-primary)' }}>Crear</span>
      </div>

      <div style={{ flex: 1, padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Icon picker mock */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 'var(--sp-r-lg)',
            background: 'var(--sp-brand-primary-soft)', color: 'var(--sp-brand-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px dashed var(--sp-brand-primary)',
          }}><Icon name="users" size={28} stroke={2}/></div>
          <div style={{ flex: 1 }}>
            <div className="sp-bodyL" style={{ fontWeight: 600 }}>Ícono e color</div>
            <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>Opcional · podés cambiarlo después</div>
          </div>
          <IconButton name="edit" variant="soft" size={36}/>
        </div>

        <TextField label="Nombre del grupo" value="Mar del Plata 2026" autoFocus/>

        {/* Currency selector card */}
        <div>
          <div className="sp-label" style={{ marginBottom: 6 }}>Moneda base</div>
          <div style={{
            padding: 14, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-surface)', border: '1px solid var(--sp-border)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--sp-brand-primary-soft)', color: 'var(--sp-brand-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 13,
            }}>AR$</div>
            <div style={{ flex: 1 }}>
              <div className="sp-bodyL" style={{ fontWeight: 600 }}>Peso argentino</div>
              <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>ARS · podés agregar otras desde un gasto</div>
            </div>
            <Icon name="chevronRight" size={18} color="var(--sp-text-tertiary)"/>
          </div>
        </div>

        {/* Categories enabled toggle */}
        <div style={{
          padding: 14, borderRadius: 'var(--sp-r-md)',
          background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)',
        }}>
          <div className="sp-bodyL" style={{ fontWeight: 600, marginBottom: 8 }}>Categorías activas</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(CATEGORY_META).slice(0, 6).map(([k]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 4px', borderRadius: 'var(--sp-r-full)', background: 'var(--sp-surface-sunken)' }}>
                <CategoryIcon kind={k} size={22}/>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-text)' }}>{CATEGORY_META[k].label}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1 }}/>

        <div style={{
          padding: 12, background: 'var(--sp-brand-accent-soft)',
          color: 'var(--sp-brand-accent-onSoft)', borderRadius: 'var(--sp-r-md)',
          fontSize: 12, lineHeight: 1.4,
        }}>
          <b>Después de crear:</b> vas a poder invitar miembros con QR, link o por usuario conocido.
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   C3 · Invitar miembro — 3 tabs (QR / Link / Username)
   ───────────────────────────────────────────────────────────── */
function InviteShell({ tab, children }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px' }}>
        <IconButton name="close" variant="soft" size={36}/>
        <div className="sp-h3" style={{ color: 'var(--sp-text)' }}>Invitar al grupo</div>
        <div style={{ width: 36 }}/>
      </div>
      <div style={{ padding: '4px 20px 16px' }}>
        <SegmentedControl value={tab} options={[
          { value: 'qr', label: 'QR' },
          { value: 'link', label: 'Link' },
          { value: 'user', label: 'Usuario' },
        ]}/>
      </div>
      {children}
    </div>
  );
}

function QRMock({ size = 200 }) {
  // Simulated QR (deterministic noise pattern) so it reads as a QR without
  // requiring a real library.
  const cells = 21;
  const cellSize = size / cells;
  const grid = [];
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      // corner finder pattern
      const isCorner = (cx, cy) => (x >= cx && x < cx + 7 && y >= cy && y < cy + 7) &&
        (x === cx || x === cx + 6 || y === cy || y === cy + 6 || (x >= cx + 2 && x <= cx + 4 && y >= cy + 2 && y <= cy + 4));
      const fill = isCorner(0, 0) || isCorner(cells - 7, 0) || isCorner(0, cells - 7)
        ? true
        : ((x * 17 + y * 31 + x * y) % 3 === 0);
      if (fill) grid.push(<rect key={x + '-' + y} x={x * cellSize} y={y * cellSize} width={cellSize} height={cellSize}/>);
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ borderRadius: 8 }}>
      <rect width={size} height={size} fill="#fff"/>
      <g fill="#1F1A14">{grid}</g>
    </svg>
  );
}

function ScreenInviteQR() {
  return (
    <InviteShell tab="qr">
      <div style={{ flex: 1, padding: '8px 24px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)', textAlign: 'center', maxWidth: 280 }}>
          Quien escanee este código se suma a <b style={{ color: 'var(--sp-text)' }}>Mar del Plata 2026</b>.
        </div>

        {/* QR card */}
        <div style={{
          padding: 20, background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-2xl)',
          boxShadow: 'var(--sp-shadow-2)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
        }}>
          <div style={{ position: 'relative' }}>
            <QRMock size={220}/>
            {/* center logo */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              width: 44, height: 44, borderRadius: 12, background: '#fff', padding: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><AppLogoMark size={32}/></div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="sp-bodyL" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>Mar del Plata 2026</div>
            <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', marginTop: 2 }}>5 miembros · expira en 47 h 12 m</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <Button variant="secondary" size="lg" leftIcon="share" block>Compartir</Button>
          <Button variant="primary" size="lg" leftIcon="sync" block>Renovar</Button>
        </div>

        <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', textAlign: 'center', maxWidth: 300 }}>
          El código contiene la clave para sincronizar P2P con vos. No lo compartas con quien no quieras en el grupo.
        </div>
      </div>
    </InviteShell>
  );
}

function ScreenInviteLink() {
  return (
    <InviteShell tab="link">
      <div style={{ flex: 1, padding: '8px 24px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)' }}>
          Compartilo por WhatsApp, mail o donde quieras. El link expira en 48 h.
        </div>

        {/* Link card */}
        <div style={{
          padding: 16, borderRadius: 'var(--sp-r-md)',
          background: 'var(--sp-surface)', border: '1px solid var(--sp-border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Icon name="link" size={20} color="var(--sp-brand-primary)"/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sp-bodyM" style={{
              fontFamily: 'var(--sp-font-mono)', color: 'var(--sp-text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>splitp2p.app/g/mdp26-x7K9</div>
            <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', marginTop: 2 }}>Expira en 47 h 12 m</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" leftIcon="link" block>Copiar link</Button>
          <Button variant="primary" leftIcon="share" block>Compartir</Button>
        </div>

        {/* Share targets row */}
        <div>
          <div className="sp-label" style={{ marginBottom: 10 }}>Compartir vía</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            {[
              { label: 'WhatsApp', color: '#25D366', icon: '💬' },
              { label: 'iMessage', color: '#34C759', icon: '💭' },
              { label: 'Mail', color: '#0A6E8F', icon: '✉︎' },
              { label: 'Telegram', color: '#229ED9', icon: 'T' },
              { label: 'Más', color: 'var(--sp-text-tertiary)', icon: '⋯' },
            ].map(t => (
              <div key={t.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 'var(--sp-r-md)',
                  background: t.color, color: '#fff', fontSize: 22, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{t.icon}</div>
                <div style={{ fontSize: 11, color: 'var(--sp-text-secondary)' }}>{t.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{
          padding: 12, background: 'var(--sp-warning-soft)',
          color: '#8A6420', borderRadius: 'var(--sp-r-md)',
          fontSize: 12, lineHeight: 1.4,
          display: 'flex', gap: 8, alignItems: 'flex-start',
        }}>
          <Icon name="warning" size={16} stroke={2}/>
          <div><b>Heads-up:</b> el link contiene la clave del grupo. Si se filtra, podés renovarlo y los miembros actuales no se ven afectados.</div>
        </div>
      </div>
    </InviteShell>
  );
}

function ScreenInviteUsername() {
  const recent = [
    { name: 'Ana López', sub: '@analopez · 2 grupos en común', hue: 0 },
    { name: 'Tomás Rivero', sub: '@trivero · Roomates', hue: 1 },
    { name: 'María Fernández', sub: '@mariaf · 1 grupo en común', hue: 2 },
  ];
  return (
    <InviteShell tab="user">
      <div style={{ flex: 1, padding: '8px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TextField leftIcon="search" placeholder="@usuario o nombre…" autoFocus/>
        <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>Usuarios que ya conocés. Funciona offline si ya intercambiaron clave.</div>

        <div className="sp-label" style={{ marginTop: 4 }}>Recientes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recent.map(u => (
            <div key={u.name} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: 'var(--sp-card-pad)',
              background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-md)',
              border: '1px solid var(--sp-border-hair)',
            }}>
              <Avatar name={u.name} hue={u.hue} size={40}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="sp-bodyL" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>{u.name}</div>
                <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>{u.sub}</div>
              </div>
              <Button variant="soft" size="sm" leftIcon="plus">Invitar</Button>
            </div>
          ))}
        </div>
      </div>
    </InviteShell>
  );
}

Object.assign(window, {
  ScreenGroupDetail, ScreenGroupDetailMulti, ScreenCreateGroup,
  ScreenInviteQR, ScreenInviteLink, ScreenInviteUsername,
  GroupHeader, SimplifiedDebt, QRMock,
});
