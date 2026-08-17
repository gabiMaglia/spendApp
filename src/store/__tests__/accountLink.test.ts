import { mergeAccounts } from '../accountLink';
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
