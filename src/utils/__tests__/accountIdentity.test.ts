import {
  resolveAccount, confirmLink, normalizeEmail,
  type AccountIndex, type KnownAccount,
} from '../accountIdentity';

const APPLE = 'apple:000123.abc';
const GOOGLE = 'google:11887766';
const MAIL = 'gab.maglia@gmail.com';

function memoryIndex(known: KnownAccount[] = []) {
  const providers = new Map<string, string>();
  const emails = new Map<string, string>();
  const accounts: KnownAccount[] = [...known];
  const ix: AccountIndex = {
    getAccountByProvider: id => providers.get(id) ?? null,
    getAccountByEmail: e => emails.get(e) ?? null,
    listKnownAccounts: () => accounts,
    link: (providerId, accountId, email) => {
      providers.set(providerId, accountId);
      if (email) emails.set(email, accountId);
      const i = accounts.findIndex(a => a.accountId === accountId);
      if (i === -1) accounts.push({ accountId, label: accountId, email });
      else if (email && accounts[i]!.email === undefined) accounts[i] = { ...accounts[i]!, email };
    },
  };
  return ix;
}

describe('normalizeEmail', () => {
  it('ignora mayúsculas y espacios', () => {
    expect(normalizeEmail('  Gab.Maglia@Gmail.com ')).toBe('gab.maglia@gmail.com');
  });
  it('vacío y null son ausencia', () => {
    expect(normalizeEmail('')).toBeUndefined();
    expect(normalizeEmail(null)).toBeUndefined();
  });
});

describe('resolveAccount', () => {
  it('primer login: cuenta nueva con el propio providerId como id', () => {
    const ix = memoryIndex();
    expect(resolveAccount(ix, APPLE, MAIL)).toEqual({ kind: 'new', accountId: APPLE });
  });

  it('re-login del mismo proveedor: reusa la cuenta', () => {
    const ix = memoryIndex();
    resolveAccount(ix, APPLE, MAIL);
    expect(resolveAccount(ix, APPLE, null)).toEqual({ kind: 'existing', accountId: APPLE });
  });

  // EL CASO DEL PO, camino con email
  it('Google con el mismo mail se engancha solo a la cuenta de Apple', () => {
    const ix = memoryIndex();
    resolveAccount(ix, APPLE, MAIL);
    const r = resolveAccount(ix, GOOGLE, MAIL);
    expect(r).toMatchObject({ kind: 'linked', accountId: APPLE });
  });

  it('el enganche por mail ignora mayúsculas', () => {
    const ix = memoryIndex();
    resolveAccount(ix, APPLE, MAIL);
    const r = resolveAccount(ix, GOOGLE, ' GAB.MAGLIA@GMAIL.COM ');
    expect(r).toMatchObject({ kind: 'linked', accountId: APPLE });
  });

  // EL DEFECTO QUE HUNDIÓ v1: Apple ya no manda el mail
  it('proveedor nuevo SIN mail y con otras cuentas ⇒ pregunta, no adivina', () => {
    const ix = memoryIndex();
    resolveAccount(ix, GOOGLE, MAIL);           // ya existe la cuenta Google
    const r = resolveAccount(ix, APPLE, null);  // Apple ya no manda el mail

    expect(r.kind).toBe('confirm');
    if (r.kind === 'confirm') {
      expect(r.providerId).toBe(APPLE);
      expect(r.candidates.map(c => c.accountId)).toEqual([GOOGLE]);
    }
  });

  it('proveedor nuevo SIN mail y sin otras cuentas ⇒ cuenta nueva, sin molestar', () => {
    const ix = memoryIndex();
    expect(resolveAccount(ix, APPLE, null)).toEqual({ kind: 'new', accountId: APPLE });
  });

  it('mails distintos NO se mezclan', () => {
    const ix = memoryIndex();
    resolveAccount(ix, APPLE, MAIL);
    expect(resolveAccount(ix, GOOGLE, 'otra@persona.com'))
      .toEqual({ kind: 'new', accountId: GOOGLE });
  });

  // Misma regresión, por el camino automático (mail coincidente).
  it('el enganche por mail manda a fusionar aunque el índice no conozca la cuenta', () => {
    const ix = memoryIndex([]);
    ix.link(GOOGLE, GOOGLE, MAIL);
    const r = resolveAccount(ix, APPLE, MAIL);
    expect(r).toEqual({ kind: 'linked', accountId: GOOGLE, previousAccountId: APPLE });
  });

  it('avisa cuando el proveedor traía cuenta propia (hay que fusionar datos)', () => {
    const ix = memoryIndex();
    resolveAccount(ix, GOOGLE, MAIL);   // cuenta Google con sus datos
    resolveAccount(ix, APPLE, null);    // Apple entra sin mail -> confirm
    // Apple abre cuenta propia por su cuenta:
    const ix2 = memoryIndex([{ accountId: APPLE, label: 'a' }, { accountId: GOOGLE, label: 'g' }]);
    ix2.link(GOOGLE, GOOGLE, MAIL);
    const r = resolveAccount(ix2, APPLE, MAIL);
    expect(r).toEqual({ kind: 'linked', accountId: GOOGLE, previousAccountId: APPLE });
  });

  it('es estable: repetir el login no cambia la cuenta', () => {
    const ix = memoryIndex();
    const a = resolveAccount(ix, GOOGLE, MAIL);
    const b = resolveAccount(ix, GOOGLE, MAIL);
    expect(b).toEqual({ kind: 'existing', accountId: (a as any).accountId });
  });
});

describe('confirmLink', () => {
  it('vincula el proveedor a la cuenta elegida', () => {
    const ix = memoryIndex([{ accountId: GOOGLE, label: 'g' }]);
    ix.link(GOOGLE, GOOGLE, MAIL);

    confirmLink(ix, APPLE, GOOGLE);

    expect(resolveAccount(ix, APPLE, null)).toEqual({ kind: 'existing', accountId: GOOGLE });
  });

  it('siempre devuelve el scope del proveedor para fusionar', () => {
    const ix = memoryIndex([{ accountId: APPLE, label: 'a' }, { accountId: GOOGLE, label: 'g' }]);
    expect(confirmLink(ix, APPLE, GOOGLE)).toEqual({ previousAccountId: APPLE });
  });

  // REGRESIÓN (QA rechazó T-019 v2 por esto): el índice de cuentas conocidas
  // nace VACÍO en toda instalación previa a esta feature y se llena recién
  // dentro de setUser, o sea DESPUÉS de esta decisión. Si el enlace preguntara
  // al índice "¿esta cuenta existía?", en el caso que importa —una cuenta vieja
  // CON datos— respondería que no y la fusión no correría, dejando los datos
  // invisibles. Quién decide si hay algo que traer es mergeAccountData.
  it('con el índice vacío (1er login tras actualizar) IGUAL manda a fusionar', () => {
    const ix = memoryIndex([]);
    expect(confirmLink(ix, APPLE, GOOGLE)).toEqual({ previousAccountId: APPLE });
  });
});

describe('candidatas para preguntar — sin molestar a personas distintas', () => {
  const OTRO_MAIL = 'otra@persona.com';

  it('mails conocidos y DISTINTOS ⇒ no pregunta, son dos personas', () => {
    const ix = memoryIndex([{ accountId: GOOGLE, label: 'g', email: MAIL }]);
    ix.link(GOOGLE, GOOGLE, MAIL);

    const r = resolveAccount(ix, 'apple:otro', OTRO_MAIL);

    expect(r.kind).toBe('new');
  });

  // EL BUG QUE VEÍA EL PO: Apple entró primero sin mail, así que su cuenta no
  // tiene mail conocido. Traer un mail que no matchea NO prueba que sea otra
  // persona cuando del otro lado no sabemos nada.
  it('mail propio conocido pero el de la cuenta existente DESCONOCIDO ⇒ pregunta', () => {
    const ix = memoryIndex([{ accountId: APPLE, label: 'a' }]); // sin email
    ix.link(APPLE, APPLE);

    const r = resolveAccount(ix, GOOGLE, MAIL);

    expect(r.kind).toBe('confirm');
    if (r.kind === 'confirm') expect(r.candidates.map(c => c.accountId)).toEqual([APPLE]);
  });

  it('sin mail propio ⇒ pregunta aunque la existente tenga mail conocido', () => {
    const ix = memoryIndex([{ accountId: GOOGLE, label: 'g', email: MAIL }]);
    ix.link(GOOGLE, GOOGLE, MAIL);

    const r = resolveAccount(ix, APPLE, null);

    expect(r.kind).toBe('confirm');
  });

  it('con varias cuentas, ofrece sólo las que no se pueden descartar', () => {
    const ix = memoryIndex([
      { accountId: 'sinmail',  label: 's' },
      { accountId: 'otromail', label: 'o', email: OTRO_MAIL },
    ]);
    ix.link('sinmail', 'sinmail');
    ix.link('otromail', 'otromail', OTRO_MAIL);

    const r = resolveAccount(ix, GOOGLE, MAIL);

    expect(r.kind).toBe('confirm');
    if (r.kind === 'confirm') expect(r.candidates.map(c => c.accountId)).toEqual(['sinmail']);
  });

  it('device limpio ⇒ cuenta nueva sin molestar', () => {
    expect(resolveAccount(memoryIndex([]), GOOGLE, MAIL).kind).toBe('new');
  });
});
