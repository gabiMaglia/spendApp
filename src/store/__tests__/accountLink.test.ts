import { mergeAccounts, purgeMergedScopes, MERGE_GRACE_DAYS } from '../accountLink';
import { profileKey } from '../authKeys';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { createStorage } from '@/src/utils/createStorage';
import type { User } from '@/src/types/models';

const APPLE = 'apple:000123.abc';
const GOOGLE = 'google:11887766';

const auth = () => createSecureStorage('auth');

function writeProfile(uid: string, over: Partial<User> = {}) {
  auth().set(profileKey(uid), JSON.stringify({
    id: uid, name: 'Gabriel Maglia', email: 'gab.maglia@gmail.com',
    authProvider: 'apple', createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    ...over,
  }));
}

function readProfile(uid: string): User | null {
  const raw = auth().getString(profileKey(uid));
  return raw ? (JSON.parse(raw) as User) : null;
}

/**
 * Todos los stores scopeados que deben fusionarse, con la clave REAL de cada uno.
 * `personal` no usa `data_v1` como el resto — esa diferencia hizo que la fusión
 * lo leyera de una clave inexistente y perdiera todo en silencio.
 */
const SCOPED = [
  { bucket: 'groups',    key: 'data_v1' },
  { bucket: 'expenses',  key: 'data_v1' },
  { bucket: 'payments',  key: 'data_v1' },
  { bucket: 'users',     key: 'data_v1' },
  { bucket: 'recurring', key: 'data_v1' },
  { bucket: 'comments',  key: 'data_v1' },
  { bucket: 'personal',  key: 'entries_v1' },
] as const;

function writeAt(bucket: string, key: string, uid: string, ids: string[]) {
  createSecureStorage(bucket as any).set(
    `${key}::u:${uid}`,
    JSON.stringify(ids.map(id => ({ id, updatedAt: 1_000 }))),
  );
}

function readAt(bucket: string, key: string, uid: string): string[] {
  const raw = createSecureStorage(bucket as any).getString(`${key}::u:${uid}`);
  return raw ? (JSON.parse(raw) as Array<{ id: string }>).map(r => r.id).sort() : [];
}

function writeList(bucket: 'groups' | 'expenses', uid: string, ids: string[]) {
  createSecureStorage(bucket).set(
    `data_v1::u:${uid}`,
    JSON.stringify(ids.map(id => ({ id, updatedAt: 1_000 }))),
  );
}

function readIds(bucket: 'groups' | 'expenses', uid: string): string[] {
  const raw = createSecureStorage(bucket).getString(`data_v1::u:${uid}`);
  return raw ? (JSON.parse(raw) as Array<{ id: string }>).map(r => r.id).sort() : [];
}

describe('mergeAccounts', () => {
  beforeEach(() => {
    ['auth', 'groups', 'expenses', 'payments', 'personal', 'users', 'recurring', 'comments']
      .forEach(b => createSecureStorage(b as any).clearAll());
  });

  // EL CASO DEL PO
  it('trae los datos de la cuenta absorbida a la destino', () => {
    writeList('groups', APPLE, ['gA']);
    writeList('groups', GOOGLE, ['gG']);

    mergeAccounts(APPLE, GOOGLE);

    expect(readIds('groups', GOOGLE)).toEqual(['gA', 'gG']);
  });

  // Este test nació VACUO: sólo escribía en groups y expenses, así que sacar
  // cualquier otro store de MERGEABLE_STORES lo dejaba en verde. Ahora recorre
  // TODOS los stores scopeados con su clave real.
  it('fusiona TODOS los stores scopeados, cada uno con su clave real', () => {
    SCOPED.forEach(({ bucket, key }) => writeAt(bucket, key, APPLE, [`${bucket}-A`]));

    mergeAccounts(APPLE, GOOGLE);

    const perdidos = SCOPED
      .filter(({ bucket, key }) => readAt(bucket, key, GOOGLE).length === 0)
      .map(s => s.bucket);
    expect(perdidos).toEqual([]);
  });

  it('el presupuesto personal se adopta si el destino no tiene uno', () => {
    createSecureStorage('personal').set(`budget_v1::u:${APPLE}`, JSON.stringify({ amount: 50000 }));

    mergeAccounts(APPLE, GOOGLE);

    expect(createSecureStorage('personal').getString(`budget_v1::u:${GOOGLE}`)).toBeDefined();
  });

  it('un presupuesto ya configurado en el destino NO se pisa', () => {
    createSecureStorage('personal').set(`budget_v1::u:${APPLE}`, JSON.stringify({ amount: 50000 }));
    createSecureStorage('personal').set(`budget_v1::u:${GOOGLE}`, JSON.stringify({ amount: 99999 }));

    mergeAccounts(APPLE, GOOGLE);

    expect(createSecureStorage('personal').getString(`budget_v1::u:${GOOGLE}`)).toContain('99999');
  });

  it('no borra el origen: se puede volver atrás', () => {
    writeList('groups', APPLE, ['gA']);

    mergeAccounts(APPLE, GOOGLE);

    expect(readIds('groups', APPLE)).toEqual(['gA']);
  });

  describe('perfil de la cuenta (nombre y email)', () => {
    // QA rechazó T-019 v2 por esto: el perfil no es una lista bajo data_v1,
    // así que mergeAccountData no lo alcanzaba y el nombre editado se perdía.
    it('si el destino no tiene perfil, adopta el de la cuenta absorbida', () => {
      writeProfile(APPLE, { name: 'Gabi' });

      mergeAccounts(APPLE, GOOGLE);

      expect(readProfile(GOOGLE)?.name).toBe('Gabi');
    });

    it('el nombre editado del destino le gana al del origen', () => {
      writeProfile(APPLE, { name: 'Nombre viejo' });
      writeProfile(GOOGLE, { name: 'Gabi', id: GOOGLE });

      mergeAccounts(APPLE, GOOGLE);

      expect(readProfile(GOOGLE)?.name).toBe('Gabi');
    });

    it('el origen completa lo que al destino le falta', () => {
      writeProfile(APPLE, { email: 'real@mail.com' });
      writeProfile(GOOGLE, { id: GOOGLE, name: 'Gabi', email: '' });

      mergeAccounts(APPLE, GOOGLE);

      expect(readProfile(GOOGLE)?.email).toBe('real@mail.com');
    });

    it('el perfil resultante queda con el id de la cuenta destino', () => {
      writeProfile(APPLE, { name: 'Gabi' });

      mergeAccounts(APPLE, GOOGLE);

      expect(readProfile(GOOGLE)?.id).toBe(GOOGLE);
    });

    it('sin perfil de origen no toca el del destino', () => {
      writeProfile(GOOGLE, { id: GOOGLE, name: 'Gabi' });

      mergeAccounts(APPLE, GOOGLE);

      expect(readProfile(GOOGLE)?.name).toBe('Gabi');
    });
  });

  it('fusionar una cuenta consigo misma es un no-op', () => {
    writeList('groups', APPLE, ['gA']);
    writeProfile(APPLE, { name: 'Gabi' });

    mergeAccounts(APPLE, APPLE);

    expect(readIds('groups', APPLE)).toEqual(['gA']);
    expect(readProfile(APPLE)?.name).toBe('Gabi');
  });
});

describe('preferencias de la cuenta (T-027)', () => {
  const settings = () => createStorage('settings');

  beforeEach(() => settings().clearAll());

  it('las preferencias de la cuenta absorbida sobreviven al enlace', () => {
    settings().set(`notif_expenses::u:${APPLE}`, false);

    mergeAccounts(APPLE, GOOGLE);

    expect(settings().getBoolean(`notif_expenses::u:${GOOGLE}`)).toBe(false);
  });

  it('una preferencia ya elegida en el destino NO se pisa', () => {
    settings().set(`notif_expenses::u:${APPLE}`, false);
    settings().set(`notif_expenses::u:${GOOGLE}`, true);

    mergeAccounts(APPLE, GOOGLE);

    expect(settings().getBoolean(`notif_expenses::u:${GOOGLE}`)).toBe(true);
  });

  it('cubre los tres toggles, no sólo uno', () => {
    ['notif_expenses', 'notif_deletions', 'notif_invites']
      .forEach(k => settings().set(`${k}::u:${APPLE}`, false));

    mergeAccounts(APPLE, GOOGLE);

    const faltantes = ['notif_expenses', 'notif_deletions', 'notif_invites']
      .filter(k => settings().getBoolean(`${k}::u:${GOOGLE}`) === undefined);
    expect(faltantes).toEqual([]);
  });
});

describe('purga de scopes fusionados (T-029)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.UTC(2026, 7, 17);

  // `mergeAccounts` fecha la fusión con el reloj real, así que sin fijarlo el
  // resultado depende de qué día se corra el test: si la fecha de hoy queda
  // cerca de NOW, el período de gracia no se cumple y la purga no ocurre.
  // Pasó de verdad — los tests se rompieron solos al cambiar el día.
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    ['auth', 'groups', 'expenses', 'payments', 'users', 'recurring', 'comments', 'personal']
      .forEach(b => createSecureStorage(b as any).clearAll());
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('recién fusionado NO se purga: hay que poder volver atrás', () => {
    writeList('groups', APPLE, ['gA']);
    mergeAccounts(APPLE, GOOGLE);

    const purgados = purgeMergedScopes(NOW);

    expect(purgados).toEqual([]);
    expect(readIds('groups', APPLE)).toEqual(['gA']); // origen intacto
  });

  it('pasado el período de gracia sí se purga', () => {
    writeList('groups', APPLE, ['gA']);
    mergeAccounts(APPLE, GOOGLE);

    const purgados = purgeMergedScopes(NOW + (MERGE_GRACE_DAYS + 1) * DAY);

    expect(purgados).toEqual([APPLE]);
    expect(readIds('groups', APPLE)).toEqual([]);
  });

  it('la purga NO toca los datos de la cuenta destino', () => {
    writeList('groups', APPLE, ['gA']);
    mergeAccounts(APPLE, GOOGLE);

    purgeMergedScopes(NOW + (MERGE_GRACE_DAYS + 1) * DAY);

    expect(readIds('groups', GOOGLE)).toEqual(['gA']);
  });

  it('purga también lo personal, que usa otra clave', () => {
    writeAt('personal', 'entries_v1', APPLE, ['pA']);
    mergeAccounts(APPLE, GOOGLE);

    purgeMergedScopes(NOW + (MERGE_GRACE_DAYS + 1) * DAY);

    expect(readAt('personal', 'entries_v1', APPLE)).toEqual([]);
    expect(readAt('personal', 'entries_v1', GOOGLE)).toEqual(['pA']);
  });

  it('purgar dos veces no rompe ni repite', () => {
    writeList('groups', APPLE, ['gA']);
    mergeAccounts(APPLE, GOOGLE);
    const late = NOW + (MERGE_GRACE_DAYS + 1) * DAY;

    expect(purgeMergedScopes(late)).toEqual([APPLE]);
    expect(purgeMergedScopes(late)).toEqual([]);
  });

  it('sin fusiones previas es un no-op', () => {
    expect(purgeMergedScopes(NOW)).toEqual([]);
  });
});

/**
 * T-047 — la fusión perdía en silencio dos cosas que NO tienen la forma
 * `{id, updatedAt}` que asume `mergeAccountData`, y por eso no podían estar en
 * `MERGEABLE_STORES`: las CLAVES DE GRUPO (`{groupId, key, epoch}`) y los
 * grupos ARCHIVADOS (`string[]` bajo otra clave del mismo bucket).
 *
 * Sin la clave del grupo el dispositivo no puede descifrar sus sobres: los
 * gastos siguen llegando y no se pueden leer. Es la tercera vez que el mismo
 * patrón muerde — `personal` ya había desaparecido igual (ver comentario en
 * accountLink.ts) — así que además hay un guard que vigila la clase.
 */
const gk = () => createSecureStorage('groupkeys');
const grp = () => createSecureStorage('groups');

function writeKeys(uid: string, recs: { groupId: string; key: string; epoch: number }[]) {
  gk().set(`data_v1::u:${uid}`, JSON.stringify(recs));
}
function readKeys(uid: string): { groupId: string; key: string; epoch: number }[] {
  const raw = gk().getString(`data_v1::u:${uid}`);
  return raw ? JSON.parse(raw) : [];
}

describe('T-047 · la fusión no puede perder claves de grupo', () => {
  beforeEach(() => { gk().clearAll(); grp().clearAll(); });

  it('las claves del origen llegan al destino', () => {
    writeKeys(APPLE, [{ groupId: 'g1', key: 'aa', epoch: 1 }]);
    writeKeys(GOOGLE, []);
    mergeAccounts(APPLE, GOOGLE);
    expect(readKeys(GOOGLE)).toEqual([{ groupId: 'g1', key: 'aa', epoch: 1 }]);
  });

  it('no pisa una clave que el destino ya tenía', () => {
    writeKeys(APPLE, [{ groupId: 'g1', key: 'vieja', epoch: 1 }]);
    writeKeys(GOOGLE, [{ groupId: 'g2', key: 'propia', epoch: 1 }]);
    mergeAccounts(APPLE, GOOGLE);
    const ids = readKeys(GOOGLE).map(k => k.groupId).sort();
    expect(ids).toEqual(['g1', 'g2']);
  });

  it('ante el mismo grupo gana la época MAYOR: una clave rotada es la nueva', () => {
    writeKeys(APPLE, [{ groupId: 'g1', key: 'nueva', epoch: 5 }]);
    writeKeys(GOOGLE, [{ groupId: 'g1', key: 'vieja', epoch: 2 }]);
    mergeAccounts(APPLE, GOOGLE);
    expect(readKeys(GOOGLE)).toEqual([{ groupId: 'g1', key: 'nueva', epoch: 5 }]);
  });

  it('no degrada a una época anterior', () => {
    writeKeys(APPLE, [{ groupId: 'g1', key: 'vieja', epoch: 2 }]);
    writeKeys(GOOGLE, [{ groupId: 'g1', key: 'nueva', epoch: 5 }]);
    mergeAccounts(APPLE, GOOGLE);
    expect(readKeys(GOOGLE)).toEqual([{ groupId: 'g1', key: 'nueva', epoch: 5 }]);
  });
});

describe('T-047 · los grupos archivados tampoco se pierden', () => {
  beforeEach(() => { gk().clearAll(); grp().clearAll(); });

  it('se unen los archivados de las dos cuentas, sin duplicar', () => {
    grp().set(`archived_v1::u:${APPLE}`, JSON.stringify(['g1', 'g2']));
    grp().set(`archived_v1::u:${GOOGLE}`, JSON.stringify(['g2', 'g3']));
    mergeAccounts(APPLE, GOOGLE);
    const raw = grp().getString(`archived_v1::u:${GOOGLE}`);
    expect(JSON.parse(raw!).sort()).toEqual(['g1', 'g2', 'g3']);
  });

  it('sin archivados en el origen no rompe nada', () => {
    grp().set(`archived_v1::u:${GOOGLE}`, JSON.stringify(['g3']));
    mergeAccounts(APPLE, GOOGLE);
    expect(JSON.parse(grp().getString(`archived_v1::u:${GOOGLE}`)!)).toEqual(['g3']);
  });
});

/**
 * Decisión del PO (2026-08-30): **todo se fusiona al enlazar cuentas.** La
 * bandeja de avisos estaba declarada como "no se fusiona" — el PO lo revirtió.
 * Las dos cuentas son la misma persona: lo que pasó bajo una identidad le pasó
 * a ella, y perderlo al enlazar es perder historia sin ganar nada.
 */
const nt = () => createSecureStorage('notices');

function writeInbox(uid: string, items: { id: string; createdAt: number; readAt: number | null }[]) {
  nt().set(`inbox_v1::u:${uid}`, JSON.stringify(
    items.map(i => ({ ...i, notice: { kind: 'expenses', groupId: 'g1', groupName: 'A', count: 1 } })),
  ));
}
function readInbox(uid: string): { id: string; readAt: number | null }[] {
  const raw = nt().getString(`inbox_v1::u:${uid}`);
  return raw ? JSON.parse(raw) : [];
}

describe('la bandeja de avisos también se fusiona', () => {
  beforeEach(() => { nt().clearAll(); });

  it('los avisos del origen llegan al destino', () => {
    writeInbox(APPLE, [{ id: 'a', createdAt: 100, readAt: null }]);
    writeInbox(GOOGLE, [{ id: 'b', createdAt: 200, readAt: null }]);
    mergeAccounts(APPLE, GOOGLE);
    expect(readInbox(GOOGLE).map(i => i.id).sort()).toEqual(['a', 'b']);
  });

  it('quedan ordenados por fecha, el mas nuevo primero', () => {
    writeInbox(APPLE, [{ id: 'viejo', createdAt: 100, readAt: null }]);
    writeInbox(GOOGLE, [{ id: 'nuevo', createdAt: 900, readAt: null }]);
    mergeAccounts(APPLE, GOOGLE);
    expect(readInbox(GOOGLE)[0].id).toBe('nuevo');
  });

  it('el acuse de recibo de cada aviso se respeta', () => {
    // Un aviso ya leído en la cuenta absorbida no puede volver a aparecer sin
    // leer: haría subir el badge por algo que la persona ya miró.
    writeInbox(APPLE, [{ id: 'a', createdAt: 100, readAt: 150 }]);
    writeInbox(GOOGLE, []);
    mergeAccounts(APPLE, GOOGLE);
    expect(readInbox(GOOGLE)[0].readAt).toBe(150);
  });

  it('no duplica si el mismo id esta en las dos', () => {
    writeInbox(APPLE, [{ id: 'a', createdAt: 100, readAt: null }]);
    writeInbox(GOOGLE, [{ id: 'a', createdAt: 100, readAt: 500 }]);
    mergeAccounts(APPLE, GOOGLE);
    expect(readInbox(GOOGLE)).toHaveLength(1);
  });
});

describe('la moneda maestra tampoco se pierde al fusionar', () => {
  const st = () => createStorage('settings');
  beforeEach(() => { st().clearAll(); });

  it('el destino adopta la moneda elegida en la cuenta absorbida', () => {
    // `mergeSettings` recorria SOLO claves booleanas (`getBoolean`), y
    // `display_currency` es un string: se perdia en silencio. Misma clase de
    // bug que T-047, introducida al agregar la clave.
    st().set(`display_currency::u:${APPLE}`, 'BRL');
    mergeAccounts(APPLE, GOOGLE);
    expect(st().getString(`display_currency::u:${GOOGLE}`)).toBe('BRL');
  });

  it('NO pisa una moneda que el destino ya habia elegido', () => {
    st().set(`display_currency::u:${APPLE}`, 'BRL');
    st().set(`display_currency::u:${GOOGLE}`, 'CLP');
    mergeAccounts(APPLE, GOOGLE);
    expect(st().getString(`display_currency::u:${GOOGLE}`)).toBe('CLP');
  });
});

describe('T-055 · los contactos tampoco se pierden al enlazar cuentas', () => {
  const usr = () => createSecureStorage('users');
  const PEERS = 'contact_peers_v1';

  type Peer = { secret: string; wrapPublicKey?: string; identityPublicKey?: string };
  const writePeers = (uid: string, peers: Record<string, Peer>) =>
    usr().set(`${PEERS}::u:${uid}`, JSON.stringify(peers));
  const readPeers = (uid: string): Record<string, Peer> => {
    const raw = usr().getString(`${PEERS}::u:${uid}`);
    return raw ? (JSON.parse(raw) as Record<string, Peer>) : {};
  };

  beforeEach(() => { usr().clearAll(); });

  // Sin el peer, la cuenta destino no le puede mandar la clave de ningún grupo
  // — y no se arregla solo: una tarjeta que llega por el relay sólo completa
  // huecos, así que hay que volver a escanear el QR en persona.
  it('los contactos del origen llegan al destino', () => {
    writePeers(APPLE, { ana: { secret: 's-ana', wrapPublicKey: 'w-ana' } });
    mergeAccounts(APPLE, GOOGLE);
    expect(readPeers(GOOGLE).ana).toEqual({
      secret: 's-ana', wrapPublicKey: 'w-ana', identityPublicKey: undefined,
    });
  });

  it('se unen los de las dos cuentas', () => {
    writePeers(APPLE,  { ana: { secret: 's-ana' } });
    writePeers(GOOGLE, { beto: { secret: 's-beto' } });
    mergeAccounts(APPLE, GOOGLE);
    expect(Object.keys(readPeers(GOOGLE)).sort()).toEqual(['ana', 'beto']);
  });

  // Pisar una clave verificada en persona con otra sería degradar la única
  // verificación fuerte del sistema — la misma regla que `savePeerFromCard`.
  it('NO pisa una clave que el destino ya tenía; sólo completa huecos', () => {
    writePeers(APPLE,  { ana: { secret: 's-origen',  identityPublicKey: 'i-origen' } });
    writePeers(GOOGLE, { ana: { secret: 's-destino', wrapPublicKey: 'w-destino' } });
    mergeAccounts(APPLE, GOOGLE);
    expect(readPeers(GOOGLE).ana).toEqual({
      secret: 's-destino', wrapPublicKey: 'w-destino', identityPublicKey: 'i-origen',
    });
  });

  it('un peer sin buzón no entra: no serviría para nada', () => {
    writePeers(APPLE, { ana: { secret: '' } });
    mergeAccounts(APPLE, GOOGLE);
    expect(readPeers(GOOGLE).ana).toBeUndefined();
  });

  it('un scope corrupto no tumba la fusión', () => {
    usr().set(`${PEERS}::u:${APPLE}`, 'no es json');
    writePeers(GOOGLE, { beto: { secret: 's-beto' } });
    expect(() => mergeAccounts(APPLE, GOOGLE)).not.toThrow();
    expect(readPeers(GOOGLE).beto.secret).toBe('s-beto');
  });
});
