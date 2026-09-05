import { barrerScope } from '../accountLink';
import { purgeUser } from '../tierStore';
import { forgetAccount } from '../authStore';
import { createStorage, bucketsAbiertos } from '@/src/utils/createStorage';
import { createSecureStorage } from '@/src/utils/secureStorage';

/**
 * Las tres piezas del borrado local (T-074 §3.2), cada una con su forma de
 * clave. Están separadas porque **las claves de una cuenta no tienen todas la
 * misma forma**, y ésa es exactamente la trampa: el barrido por sufijo cubre
 * casi todo, pero no lo que lleva el id en el medio ni los índices sin scope.
 */
const tier = createStorage('tier');
const auth = createSecureStorage('auth');
const users = createSecureStorage('users');

beforeEach(() => {
  tier.clearAll();
  auth.clearAll();
  users.clearAll();
});

describe('barrerScope — el sufijo `::u:`', () => {
  it('borra lo de una cuenta y NO lo de la otra', () => {
    users.set('data_v1::u:u1', 'mio');
    users.set('data_v1::u:u2', 'ajeno');
    auth.set('profile::u:u1', 'perfil');

    barrerScope('u1');

    expect(users.getString('data_v1::u:u1')).toBeFalsy();
    expect(auth.getString('profile::u:u1')).toBeFalsy();
    expect(users.getString('data_v1::u:u2')).toBe('ajeno');
  });

  it('alcanza a TODOS los buckets abiertos, no a una lista declarada', () => {
    // Es la propiedad que T-060 pagó caro: una lista que alguien tenía que
    // acordarse de actualizar dejaba datos atrás cada vez que aparecía una
    // clave nueva.
    for (const bucket of bucketsAbiertos().values()) bucket.set('inventado_v9::u:u1', 'x');

    barrerScope('u1');

    for (const bucket of bucketsAbiertos().values()) {
      expect(bucket.getString('inventado_v9::u:u1')).toBeFalsy();
    }
  });

  it('no toca una clave que apenas CONTIENE el id sin ser su scope', () => {
    users.set('data_v1::u:u1x', 'otra cuenta cuyo id empieza igual');
    barrerScope('u1');
    expect(users.getString('data_v1::u:u1x')).toBe('otra cuenta cuyo id empieza igual');
  });
});

describe('purgeUser — el contador que lleva el id EN EL MEDIO', () => {
  it('borra los días de esa cuenta y ninguno de otra', () => {
    tier.set('expense_count_u1_2026-09-04', '2');
    tier.set('expense_count_u1_2026-09-05', '4');
    tier.set('expense_count_u2_2026-09-05', '9');

    purgeUser('u1');

    expect(tier.getString('expense_count_u1_2026-09-04')).toBeFalsy();
    expect(tier.getString('expense_count_u1_2026-09-05')).toBeFalsy();
    expect(tier.getString('expense_count_u2_2026-09-05')).toBe('9');
  });

  it('el barrido por sufijo NO lo alcanza — por eso existe esta función', () => {
    // Si algún día la clave pasa a llevar el sufijo, este test se cae y hay que
    // borrar `purgeUser`. Mientras tanto, documenta por qué hacen falta las dos.
    tier.set('expense_count_u1_2026-09-05', '4');
    barrerScope('u1');
    expect(tier.getString('expense_count_u1_2026-09-05')).toBe('4');
  });
});

describe('forgetAccount — el índice de identidad', () => {
  it('borra las entradas que apuntan a esa cuenta, por VALOR', () => {
    auth.set('acct::p:google:123', 'u1');
    auth.set('acct::e:g@x.com', 'u1');
    auth.set('acct::p:apple:999', 'u2');
    auth.set('acct::known', JSON.stringify([{ accountId: 'u1', label: 'u1' }, { accountId: 'u2', label: 'u2' }]));

    forgetAccount('u1');

    expect(auth.getString('acct::p:google:123')).toBeFalsy();
    expect(auth.getString('acct::e:g@x.com')).toBeFalsy();
    expect(auth.getString('acct::p:apple:999')).toBe('u2');
    expect(auth.getString('acct::known')).toContain('u2');
    expect(auth.getString('acct::known')).not.toContain('"accountId":"u1"');
  });

  it('sin esto la cuenta borrada REVIVE con el mismo id al volver a entrar', () => {
    // Es el criterio de aceptación 7: entrar con el mismo proveedor tiene que
    // abrir una cuenta nueva, no la que se borró.
    auth.set('acct::p:google:123', 'u1');
    forgetAccount('u1');
    expect(auth.getString('acct::p:google:123')).toBeFalsy();
  });

  it('no toca nada que no sea del índice', () => {
    auth.set('current_user', 'sesión');
    auth.set('profile::u:u1', 'perfil');
    forgetAccount('u1');
    expect(auth.getString('current_user')).toBe('sesión');
    expect(auth.getString('profile::u:u1')).toBe('perfil');
  });
});
