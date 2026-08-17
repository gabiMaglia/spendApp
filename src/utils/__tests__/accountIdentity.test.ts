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
      if (!accounts.some(a => a.accountId === accountId)) {
        accounts.push({ accountId, label: accountId });
      }
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

  it('reporta que hay datos que fusionar si el proveedor tenía cuenta propia', () => {
    const ix = memoryIndex([{ accountId: APPLE, label: 'a' }, { accountId: GOOGLE, label: 'g' }]);
    expect(confirmLink(ix, APPLE, GOOGLE)).toEqual({ previousAccountId: APPLE });
  });

  it('sin cuenta propia previa, no hay nada que fusionar', () => {
    const ix = memoryIndex([{ accountId: GOOGLE, label: 'g' }]);
    expect(confirmLink(ix, APPLE, GOOGLE)).toEqual({ previousAccountId: null });
  });
});
