import { mergeAccounts } from '../accountLink';
import { profileKey } from '../authKeys';
import { createSecureStorage } from '@/src/utils/secureStorage';
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

  it('fusiona todos los stores, no sólo grupos', () => {
    writeList('groups', APPLE, ['gA']);
    writeList('expenses', APPLE, ['eA']);

    mergeAccounts(APPLE, GOOGLE);

    expect(readIds('groups', GOOGLE)).toEqual(['gA']);
    expect(readIds('expenses', GOOGLE)).toEqual(['eA']);
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
