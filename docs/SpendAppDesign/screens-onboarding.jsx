// screens-onboarding.jsx — A1 Welcome / Splash
//
// Uses: PhoneFrame, Button, Icon, BalancePill (for hero motif)

function AppLogoMark({ size = 72 }) {
  // Two overlapping rounded shapes — "split" mark in petróleo + salvia
  return (
    <div style={{
      width: size, height: size, position: 'relative',
      filter: 'drop-shadow(0 8px 24px rgba(10,110,143,0.25))',
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0,
        width: size * 0.72, height: size * 0.72,
        borderRadius: '34%',
        background: 'var(--sp-brand-primary)',
      }}/>
      <div style={{
        position: 'absolute', right: 0, bottom: 0,
        width: size * 0.62, height: size * 0.62,
        borderRadius: '34%',
        background: 'var(--sp-brand-accent)',
        mixBlendMode: 'multiply',
      }}/>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: size * 0.38, fontWeight: 800, letterSpacing: '-0.04em',
      }}>S</div>
    </div>
  );
}

function ScreenWelcome() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: 'var(--sp-bg)',
      padding: '40px 28px 40px',
    }}>
      {/* Visual hero: balance "split" demonstration */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
        <AppLogoMark size={84}/>

        <div style={{ textAlign: 'center' }}>
          <div className="sp-display" style={{ color: 'var(--sp-text)', marginBottom: 8, lineHeight: 1.1 }}>
            Dividí gastos<br/>entre amigos.
          </div>
          <div className="sp-bodyL" style={{ color: 'var(--sp-text-secondary)', maxWidth: 280, margin: '0 auto' }}>
            Sin servidor. Sin nube. Sincronización P2P solo entre los miembros del grupo.
          </div>
        </div>

        {/* Mini balance demo card — visual "calmness" of the app */}
        <div style={{
          width: '100%', maxWidth: 320,
          padding: 16, borderRadius: 'var(--sp-r-lg)',
          background: 'var(--sp-surface)',
          border: '1px solid var(--sp-border-hair)',
          boxShadow: 'var(--sp-shadow-2)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name="Ana" hue={0} size={32}/>
            <div style={{ flex: 1 }}>
              <div className="sp-bodyM" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>Ana</div>
              <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>Mar del Plata 2026</div>
            </div>
            <BalancePill amount={4500} size="sm"/>
          </div>
          <div style={{ height: 1, background: 'var(--sp-border-hair)' }}/>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name="Bob" hue={1} size={32}/>
            <div style={{ flex: 1 }}>
              <div className="sp-bodyM" style={{ fontWeight: 600, color: 'var(--sp-text)' }}>Bob</div>
              <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)' }}>Roomates</div>
            </div>
            <BalancePill amount={-2100} size="sm"/>
          </div>
        </div>
      </div>

      {/* CTAs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Button variant="primary" size="lg" block leftIcon="apple">Continuar con Apple</Button>
        <Button variant="secondary" size="lg" block leftIcon="google">Continuar con Google</Button>
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <div className="sp-bodyS" style={{ color: 'var(--sp-text-tertiary)', maxWidth: 280, margin: '0 auto' }}>
            Al continuar aceptás los <span style={{ color: 'var(--sp-brand-primary)', fontWeight: 600 }}>Términos</span> y la <span style={{ color: 'var(--sp-brand-primary)', fontWeight: 600 }}>Política de privacidad</span>. Tus datos viven solo en tu dispositivo.
          </div>
        </div>
      </div>
    </div>
  );
}

/* A1b — privacy/info expanded variant */
function ScreenWelcomeDetail() {
  const points = [
    { icon: 'cloudOff', title: 'Sin servidor central', body: 'Tus gastos no pasan por la nube. Cada dispositivo guarda su copia.' },
    { icon: 'sync', title: 'Sincronización P2P', body: 'WebRTC cuando hay internet, Bluetooth cuando están cerca.' },
    { icon: 'users', title: 'Solo los miembros del grupo', body: 'Cada grupo cifra sus datos con una clave compartida al invitar.' },
    { icon: 'eye', title: 'Cero tracking', body: 'Sin analytics de terceros. Sin venta de datos. Open source.' },
  ];
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: 'var(--sp-bg)', padding: '24px 24px 32px',
    }}>
      {/* close icon */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <IconButton name="close" variant="soft" size={36}/>
      </div>

      <div style={{ marginBottom: 24 }}>
        <AppLogoMark size={56}/>
        <div className="sp-h1" style={{ color: 'var(--sp-text)', marginTop: 18 }}>Cómo funciona<br/>nuestra privacidad.</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, flex: 1 }}>
        {points.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 'var(--sp-r-md)',
              background: 'var(--sp-brand-primary-soft)',
              color: 'var(--sp-brand-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}><Icon name={p.icon} size={20} stroke={1.9}/></div>
            <div style={{ flex: 1 }}>
              <div className="sp-h3" style={{ color: 'var(--sp-text)' }}>{p.title}</div>
              <div className="sp-bodyM" style={{ color: 'var(--sp-text-secondary)', marginTop: 2 }}>{p.body}</div>
            </div>
          </div>
        ))}
      </div>

      <Button variant="primary" size="lg" block>Entendido</Button>
    </div>
  );
}

Object.assign(window, { AppLogoMark, ScreenWelcome, ScreenWelcomeDetail });
