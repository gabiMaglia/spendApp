// screens-states.jsx — Empty / Loading / Error / Sync states / Multi-currency

/* ─────────────────────────────────────────────────────────────
   S1 — Empty: Grupos
   ───────────────────────────────────────────────────────────── */
function EmptyIllustration({ children, tint = 'var(--sp-brand-primary)' }) {
  return (
    <div style={{
      width: 140, height: 140, borderRadius: '50%',
      background: 'var(--sp-brand-primary-soft)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative',
    }}>
      {/* concentric softer ring */}
      <div style={{
        position: 'absolute', inset: -16, borderRadius: '50%',
        background: 'radial-gradient(circle, var(--sp-brand-primary-soft) 50%, transparent 70%)',
        opacity: 0.5, zIndex: -1,
      }}/>
      <div style={{ color: tint }}>{children}</div>
    </div>
  );
}

function ScreenEmptyGroups() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)', position: 'relative' }}>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 100 }}>
        <ScreenHeader title="Grupos" syncState="synced" rightSlot={<IconButton name="plus" variant="soft" size={36}/>}/>

        <div style={{
          flex: 1, padding: '60px 32px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, textAlign: 'center',
        }}>
          <EmptyIllustration>
            {/* Decorative: a group of avatars in a circle */}
            <div style={{ position: 'relative', width: 100, height: 100 }}>
              <div style={{ position: 'absolute', top: 4, left: 30, transform: 'rotate(-8deg)' }}>
                <Avatar name="Ana" hue={0} size={40} ring="var(--sp-brand-primary-soft)"/>
              </div>
              <div style={{ position: 'absolute', top: 30, right: -2 }}>
                <Avatar name="Bob" hue={1} size={36} ring="var(--sp-brand-primary-soft)"/>
              </div>
              <div style={{ position: 'absolute', bottom: 2, left: 8 }}>
                <Avatar name="?" hue={4} size={36} ring="var(--sp-brand-primary-soft)"/>
              </div>
              <div style={{
                position: 'absolute', top: 38, left: 28, width: 44, height: 44, borderRadius: '50%',
                background: 'var(--sp-surface)', boxShadow: 'var(--sp-shadow-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--sp-brand-primary)',
              }}><Icon name="plus" size={22} stroke={2.4}/></div>
            </div>
          </EmptyIllustration>

          <div>
            <div className="sp-h2" style={{ color: 'var(--sp-text)' }}>Aún no tenés grupos</div>
            <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)', marginTop: 8, maxWidth: 280 }}>
              Creá uno para empezar a dividir gastos con amigos, o unite a uno con un código QR.
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 280, marginTop: 6 }}>
            <Button variant="primary" size="lg" block leftIcon="plus">Crear grupo</Button>
            <Button variant="secondary" size="lg" block leftIcon="qr">Unirme con QR</Button>
          </div>
        </div>
      </div>
      <TabBar active="groups"/>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   S2 — Empty: Actividad
   ───────────────────────────────────────────────────────────── */
function ScreenEmptyActivity() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)', position: 'relative' }}>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 100 }}>
        <ScreenHeader title="Actividad" syncState="synced" rightSlot={<IconButton name="search" variant="soft" size={36}/>}/>

        <div style={{
          flex: 1, padding: '60px 32px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, textAlign: 'center',
        }}>
          <EmptyIllustration tint="var(--sp-brand-accent-strong)">
            <Icon name="activity" size={56} stroke={1.6}/>
          </EmptyIllustration>

          <div>
            <div className="sp-h2" style={{ color: 'var(--sp-text)' }}>Todo tranquilo por acá</div>
            <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)', marginTop: 8, maxWidth: 280 }}>
              Cuando vos o tus amigos agreguen gastos o paguen deudas, aparecen acá ordenados por fecha.
            </div>
          </div>

          <Button variant="primary" size="lg" leftIcon="plus" style={{ marginTop: 6 }}>Agregar primer gasto</Button>
        </div>
      </div>
      <TabBar active="activity"/>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   S3 — Loading skeletons (groups list)
   ───────────────────────────────────────────────────────────── */
function Skel({ w = '100%', h = 16, r = 8, style }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r,
      background: 'linear-gradient(90deg, var(--sp-surface-sunken) 0%, var(--sp-bg-grouped) 50%, var(--sp-surface-sunken) 100%)',
      backgroundSize: '200% 100%',
      ...style,
    }}/>
  );
}

function SkelGroupCard() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: 'var(--sp-card-pad)',
      background: 'var(--sp-surface)', borderRadius: 'var(--sp-r-lg)',
      border: '1px solid var(--sp-border-hair)',
    }}>
      <Skel w={48} h={48} r={14}/>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skel w="55%" h={16}/>
        <Skel w="80%" h={12}/>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
        <Skel w={42} h={10}/>
        <Skel w={64} h={18}/>
      </div>
    </div>
  );
}

function ScreenLoadingSkeleton() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)', position: 'relative' }}>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 100 }}>
        <ScreenHeader title="Grupos" syncState="syncing"/>

        <div style={{ padding: '0 20px 12px' }}>
          <Skel w={180} h={32} r={10}/>
        </div>

        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-card-gap)' }}>
          {[0,1,2,3].map(i => <SkelGroupCard key={i}/>)}
        </div>

        {/* Footnote */}
        <div style={{ padding: '32px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--sp-text-tertiary)' }}>
          <Icon name="sync" size={14} stroke={2}/>
          <span className="sp-bodyS">Sincronizando con Ana, Bob, Carla…</span>
        </div>
      </div>
      <TabBar active="groups"/>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   S4 — Error / sin conexión banner
   ───────────────────────────────────────────────────────────── */
function ScreenErrorOffline() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)', position: 'relative' }}>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 100 }}>
        {/* Offline header */}
        <div style={{ padding: '8px 20px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <SyncStatusBadge state="offline"/>
            <Avatar name="Vos" hue={6} size={36}/>
          </div>
          <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)' }}>Hola, Lucas</div>
          <div className="sp-display" style={{ color: 'var(--sp-text)' }}>Tus cuentas</div>
        </div>

        {/* Offline notice card */}
        <div style={{ padding: '0 20px 16px' }}>
          <div style={{
            padding: 14, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-surface-warm)',
            border: '1px solid var(--sp-border)',
            display: 'flex', gap: 12, alignItems: 'flex-start',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
              background: 'var(--sp-surface-sunken)', color: 'var(--sp-text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon name="cloudOff" size={20} stroke={2}/></div>
            <div style={{ flex: 1 }}>
              <div className="sp-bodyL" style={{ fontWeight: 700, color: 'var(--sp-text)' }}>Sin conexión</div>
              <div className="sp-bodyS" style={{ color: 'var(--sp-text-secondary)', marginTop: 2 }}>
                Podés seguir agregando gastos. Se sincronizan cuando vuelva la conexión o estés cerca de otro miembro.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                <Badge tone="warning" size="sm">3 cambios pendientes</Badge>
                <Button variant="ghost" size="sm" leftIcon="sync" style={{ height: 28, padding: '0 6px' }}>Reintentar</Button>
              </div>
            </div>
          </div>
        </div>

        {/* Balance hero — still usable from local data */}
        <div style={{ padding: '0 20px 16px' }}>
          <BalanceSummaryCard owedToYou={24500} youOwe={8200}/>
        </div>

        {/* Disabled section */}
        <div style={{ padding: '0 20px', opacity: 0.5 }}>
          <div className="sp-label" style={{ marginBottom: 10 }}>Sincronización por Bluetooth</div>
          <div style={{
            padding: 14, borderRadius: 'var(--sp-r-md)',
            background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)',
            display: 'flex', gap: 12, alignItems: 'center',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--sp-surface-sunken)', color: 'var(--sp-text-tertiary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon name="sync" size={20} stroke={2}/></div>
            <div style={{ flex: 1 }}>
              <div className="sp-bodyM" style={{ fontWeight: 600 }}>Buscando miembros cerca…</div>
              <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>0 encontrados</div>
            </div>
          </div>
        </div>
      </div>
      <FAB icon="plus" label="Gasto offline"/>
      <TabBar active="home"/>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   S5 — Sync states (visual gallery)
   ───────────────────────────────────────────────────────────── */
function SyncStateCard({ state, title, body, accent }) {
  return (
    <div style={{
      padding: 14, borderRadius: 'var(--sp-r-md)',
      background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)',
      display: 'flex', gap: 12, alignItems: 'center',
    }}>
      <SyncStatusBadge state={state}/>
      <div style={{ flex: 1 }}>
        <div className="sp-bodyM" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>{title}</div>
        <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>{body}</div>
      </div>
    </div>
  );
}

function ScreenSyncStates() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--sp-bg)' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 0 24px' }}>
        <div style={{ padding: '8px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton name="chevronLeft" variant="soft" size={36}/>
          <div className="sp-h3" style={{ color: 'var(--sp-text)' }}>Sincronización P2P</div>
          <IconButton name="info" variant="soft" size={36}/>
        </div>

        {/* Current state hero */}
        <div style={{ padding: '8px 20px 16px' }}>
          <div style={{
            padding: 18, borderRadius: 'var(--sp-r-lg)',
            background: 'var(--sp-surface)', border: '1px solid var(--sp-border-hair)',
            textAlign: 'center',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'var(--sp-positive-soft)', color: 'var(--sp-positive)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 12px',
            }}><Icon name="check" size={26} stroke={2.4}/></div>
            <div className="sp-h3" style={{ color: 'var(--sp-text)' }}>Todo al día</div>
            <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', marginTop: 4 }}>Sincronizado con 4 miembros · hace 12 segundos</div>

            <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <div className="sp-amount" style={{ fontSize: 22, color: 'var(--sp-text)' }}>4</div>
                <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>via WebRTC</div>
              </div>
              <div style={{ width: 1, background: 'var(--sp-border-hair)' }}/>
              <div style={{ textAlign: 'center' }}>
                <div className="sp-amount" style={{ fontSize: 22, color: 'var(--sp-text)' }}>1</div>
                <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>via Bluetooth</div>
              </div>
              <div style={{ width: 1, background: 'var(--sp-border-hair)' }}/>
              <div style={{ textAlign: 'center' }}>
                <div className="sp-amount" style={{ fontSize: 22, color: 'var(--sp-text-tertiary)' }}>0</div>
                <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>desconect.</div>
              </div>
            </div>
          </div>
        </div>

        {/* All states reference */}
        <div className="sp-label" style={{ padding: '4px 20px 8px' }}>Estados posibles del badge</div>
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SyncStateCard state="synced" title="Sincronizado" body="Tu copia está al día con todos los miembros."/>
          <SyncStateCard state="syncing" title="Sincronizando…" body="Intercambiando cambios con uno o más peers."/>
          <SyncStateCard state="pending" title="Cambios pendientes" body="Tenés cambios locales que aún no llegaron al resto."/>
          <SyncStateCard state="offline" title="Sin conexión" body="Sin internet ni Bluetooth. Todo sigue funcionando local."/>
        </div>

        {/* Members list */}
        <div className="sp-label" style={{ padding: '20px 20px 8px' }}>Miembros del grupo</div>
        <div style={{
          margin: '0 20px', background: 'var(--sp-surface)',
          borderRadius: 'var(--sp-r-md)', border: '1px solid var(--sp-border-hair)',
          overflow: 'hidden',
        }}>
          {[
            { n: 'Ana López', via: 'WebRTC', state: 'synced', t: 'al día' },
            { n: 'Bob Pérez', via: 'WebRTC', state: 'syncing', t: 'sincronizando…' },
            { n: 'Carla Suarez', via: 'Bluetooth', state: 'synced', t: 'cerca · BT' },
            { n: 'Diego Martín', via: '—', state: 'offline', t: 'visto hace 2h' },
          ].map((m, i, arr) => (
            <div key={m.n} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              borderBottom: i < arr.length - 1 ? '1px solid var(--sp-border-hair)' : 'none',
            }}>
              <Avatar name={m.n} hue={i} size={32}/>
              <div style={{ flex: 1 }}>
                <div className="sp-bodyM" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>{m.n}</div>
                <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>{m.t}</div>
              </div>
              <SyncStatusBadge state={m.state}/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  ScreenEmptyGroups, ScreenEmptyActivity, ScreenLoadingSkeleton,
  ScreenErrorOffline, ScreenSyncStates, EmptyIllustration, Skel,
});
