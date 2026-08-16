import { resolveAccountId, normalizeEmail, type AccountIndex } from '../accountIdentity';

const APPLE = 'apple:000123.abc';
const GOOGLE = 'google:11887766';
const MAIL = 'gab.maglia@gmail.com';

function memoryIndex(): AccountIndex & { providers: Map<string, string>; emails: Map<string, string> } {
  const providers = new Map<string, string>();
  const emails = new Map<string, string>();
  return {
    providers, emails,
    getAccountByProvider: id => providers.get(id) ?? null,
    getAccountByEmail: e => emails.get(e) ?? null,
    link: (providerId, accountId, email) => {
      providers.set(providerId, accountId);
      if (email) emails.set(email, accountId);
    },
  };
}

describe('normalizeEmail', () => {
  it('ignora mayúsculas y espacios', () => {
    expect(normalizeEmail('  Gab.Maglia@Gmail.com ')).toBe('gab.maglia@gmail.com');
  });
  it('trata vacío y null como ausente', () => {
    expect(normalizeEmail('')).toBeUndefined();
    expect(normalizeEmail(null)).toBeUndefined();
    expect(normalizeEmail('   ')).toBeUndefined();
  });
});

describe('resolveAccountId', () => {
  it('primer login: la cuenta toma como id el propio providerId', () => {
    const ix = memoryIndex();
    const r = resolveAccountId(ix, APPLE, MAIL);
    expect(r.accountId).toBe(APPLE);
    expect(r.linkedToExisting).toBe(false);
  });

  // EL CASO REPORTADO POR EL PO
  it('Google con el mismo mail cae en la MISMA cuenta que Apple', () => {
    const ix = memoryIndex();
    const first = resolveAccountId(ix, APPLE, MAIL);
    const second = resolveAccountId(ix, GOOGLE, MAIL);

    expect(second.accountId).toBe(first.accountId);
    expect(second.linkedToExisting).toBe(true);
  });

  it('el mail matchea sin distinguir mayúsculas', () => {
    const ix = memoryIndex();
    const first = resolveAccountId(ix, APPLE, MAIL);
    const second = resolveAccountId(ix, GOOGLE, '  GAB.MAGLIA@GMAIL.COM ');
    expect(second.accountId).toBe(first.accountId);
  });

  it('2º login de Apple SIN email resuelve igual, por el vínculo del proveedor', () => {
    const ix = memoryIndex();
    const first = resolveAccountId(ix, APPLE, MAIL);
    const again = resolveAccountId(ix, APPLE, null); // Apple ya no manda el mail
    expect(again.accountId).toBe(first.accountId);
  });

  it('mails distintos NO se mezclan', () => {
    const ix = memoryIndex();
    const a = resolveAccountId(ix, APPLE, MAIL);
    const b = resolveAccountId(ix, GOOGLE, 'otra@persona.com');
    expect(b.accountId).not.toBe(a.accountId);
    expect(b.accountId).toBe(GOOGLE);
  });

  it('proveedor nuevo sin email conocido abre cuenta propia (no adivina)', () => {
    const ix = memoryIndex();
    resolveAccountId(ix, APPLE, MAIL);
    const r = resolveAccountId(ix, GOOGLE, null);
    expect(r.accountId).toBe(GOOGLE);
    expect(r.linkedToExisting).toBe(false);
  });

  it('completa el índice por mail cuando el dato aparece recién después', () => {
    const ix = memoryIndex();
    resolveAccountId(ix, APPLE, null);          // 1er login sin mail
    resolveAccountId(ix, APPLE, MAIL);          // ahora sí lo sabemos
    const g = resolveAccountId(ix, GOOGLE, MAIL);
    expect(g.accountId).toBe(APPLE);            // engancha igual
  });

  it('es estable: repetir el mismo login no cambia la cuenta', () => {
    const ix = memoryIndex();
    const a = resolveAccountId(ix, GOOGLE, MAIL).accountId;
    const b = resolveAccountId(ix, GOOGLE, MAIL).accountId;
    const c = resolveAccountId(ix, GOOGLE, MAIL).accountId;
    expect([b, c]).toEqual([a, a]);
  });
});
