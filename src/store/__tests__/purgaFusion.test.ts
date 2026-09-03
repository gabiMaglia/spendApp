import { readFileSync } from 'fs';
import { join } from 'path';
import {
  mergeAccounts, purgeMergedScopes, MERGE_GRACE_DAYS, RANURAS_FUSION,
} from '../accountLink';
import { profileKey } from '../authKeys';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { createStorage } from '@/src/utils/createStorage';

/**
 * **T-057 — lo que la fusión copia es exactamente lo que la purga borra.**
 *
 * La limpieza y la fusión eran DOS listas escritas a mano y se desincronizaron:
 * la purga borraba `data_v1` de los seis stores mergeables más las dos claves de
 * `personal`, y dejaba para siempre en el scope absorbido las claves de grupo,
 * los archivados, la bandeja de avisos, el perfil, las preferencias y —desde
 * T-055— los contactos. No era una fuga entre cuentas (nadie lee ese scope),
 * pero contradecía la política de gracia de 30 días que el propio docblock
 * declara: el usuario cree que después del plazo no queda nada, y quedaba casi
 * todo.
 *
 * El arreglo no podía ser una TERCERA lista a mano. Ahora hay una sola fuente
 * —`RANURAS_FUSION`, que se llena sola porque `ranura()` se auto-registra— y
 * estos tests son el guard de que no vuelvan a divergir:
 *
 *  (a) el de comportamiento recorre la fuente única y exige que la purga borre
 *      TODAS sus ranuras. Sumar una ranura nueva lo cubre solo;
 *  (b) el estático exige que en `accountLink.ts` no se arme ninguna clave
 *      scopeada por fuera de `ranura()` — que es la única forma que le queda a
 *      alguien de agregar algo a la fusión sin que la purga se entere.
 */
const APPLE  = 'apple:000123.abc';
const GOOGLE = 'google:11887766';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 17);
const TARDE = NOW + (MERGE_GRACE_DAYS + 1) * DAY;

const BUCKETS_SEGUROS = [
  'auth', 'groups', 'expenses', 'payments', 'users', 'recurring',
  'comments', 'personal', 'groupkeys', 'notices',
] as const;

/** Marca cada ranura de la fuente única con un valor reconocible. */
function sembrarTodo(uid: string): void {
  for (const r of RANURAS_FUSION) r.storage().set(r.key(uid), `sembrado:${uid}`);
}

/** Ranuras que TODAVÍA tienen algo bajo ese scope, por su nombre legible. */
function loQueQueda(uid: string): string[] {
  return RANURAS_FUSION
    .filter(r => r.storage().contains(r.key(uid)))
    .map(r => `${r.bucket}/${r.base}`);
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  BUCKETS_SEGUROS.forEach(b => createSecureStorage(b).clearAll());
  createStorage('settings').clearAll();
});

afterEach(() => { jest.restoreAllMocks(); });

describe('(a) la purga borra TODO lo que la fusión copia', () => {
  it('no queda ni una ranura de la fuente única bajo el scope absorbido', () => {
    sembrarTodo(APPLE);
    mergeAccounts(APPLE, GOOGLE);

    purgeMergedScopes(TARDE);

    expect(loQueQueda(APPLE)).toEqual([]);
  });

  it('la fuente única cubre las cinco que quedaban huérfanas (T-057)', () => {
    // Enumeradas a propósito: son las que el ticket nombró. Si alguien saca una
    // de la fusión, este test dice CUÁL, en vez de un array vacío contra otro.
    const declaradas = RANURAS_FUSION.map(r => `${r.bucket}/${r.base}`);
    expect(declaradas).toEqual(expect.arrayContaining([
      'groupkeys/data_v1',
      'groups/archived_v1',
      'notices/inbox_v1',
      'auth/profile',
      'users/contact_peers_v1',
    ]));
  });

  it('no toca NADA del scope destino', () => {
    mergeAccounts(APPLE, GOOGLE);
    sembrarTodo(GOOGLE); // después de la fusión: es lo que el usuario se queda

    purgeMergedScopes(TARDE);

    expect(loQueQueda(GOOGLE).sort()).toEqual(
      RANURAS_FUSION.map(r => `${r.bucket}/${r.base}`).sort(),
    );
  });

  it('dentro del período de gracia no borra nada: hay que poder volver atrás', () => {
    sembrarTodo(APPLE);
    mergeAccounts(APPLE, GOOGLE);

    expect(purgeMergedScopes(NOW)).toEqual([]);
    expect(loQueQueda(APPLE).sort()).toEqual(
      RANURAS_FUSION.map(r => `${r.bucket}/${r.base}`).sort(),
    );
  });

  it('NO purga el scope en el que estamos parados', () => {
    // No debería poder pasar —al fusionar, el índice de identidad reapunta el
    // proveedor a la cuenta destino, así que la absorbida no vuelve a estar
    // activa— pero `confirmLink` puede dejar un `acct::e:` viejo apuntando al
    // scope absorbido, y ahí sí se entra. Como la purga es irreversible, el
    // caso raro se resuelve NO borrando: la entrada del log queda y se
    // reintenta en el próximo arranque.
    sembrarTodo(APPLE);
    mergeAccounts(APPLE, GOOGLE);
    createSecureStorage('auth').set('current_user', JSON.stringify({ id: APPLE }));

    expect(purgeMergedScopes(TARDE)).toEqual([]);
    expect(loQueQueda(APPLE).length).toBeGreaterThan(0);
  });
});

describe('(b) nadie puede armar una clave scopeada por fuera de la fuente única', () => {
  const FUENTE = readFileSync(join(__dirname, '..', 'accountLink.ts'), 'utf8');

  it('`::u:` se escribe en UN solo lugar de accountLink.ts', () => {
    // Es la forma que le queda a alguien de sumar algo a la fusión sin pasar por
    // `ranura()` — y por lo tanto sin que la purga se entere. Es exactamente el
    // bug de T-057: dos listas paralelas que se desincronizan.
    const apariciones = FUENTE.match(/::u:/g) ?? [];
    expect(apariciones).toHaveLength(1);
  });

  it('todo bucket que accountLink.ts abre está declarado en la fuente única', () => {
    const abiertos = [...FUENTE.matchAll(/create(?:Secure)?Storage\('([^']+)'\)/g)]
      .map(m => m[1]!);
    const declarados = new Set(RANURAS_FUSION.map(r => r.bucket));

    expect(abiertos.filter(b => !declarados.has(b))).toEqual([]);
  });

  it('la ranura del perfil usa la MISMA clave que authStore', () => {
    // Si divergen, la fusión escribe un perfil que el login no lee (o la purga
    // borra una clave que no es la que existe).
    const perfil = RANURAS_FUSION.find(r => r.bucket === 'auth' && r.base === 'profile');
    expect(perfil?.key(APPLE)).toBe(profileKey(APPLE));
  });
});

/**
 * **T-060: «excluido de fusionarse» no es «excluido de borrarse».**
 *
 * `EXCLUIDOS_FUSION` declara nueve módulos que guardan data scopeada por cuenta
 * y que la fusión NO hereda a propósito —cachés, mediciones, acuses locales—.
 * La purga tampoco los tocaba, porque recorría lo que la fusión copia. Quedaban
 * bajo el scope absorbido **para siempre**, contra la política de gracia de 30
 * días que `accountLink` declara.
 *
 * Es la TERCERA vez que aparece la misma clase: T-055 (un guard que sólo miraba
 * `src/store`), T-057 (fusión y purga como dos listas a mano) y ésta. Por eso
 * el arreglo no es otra lista: la purga **barre** el sufijo de la cuenta en
 * cada bucket abierto. Si una clave lleva el scope, se va — sin que nadie tenga
 * que acordarse de declararla.
 */
describe('(d) T-060 · la purga alcanza lo que la fusión NO copia', () => {
  /** Las dos que el backlog nombró, más una de cada bucket excluido. */
  const EXCLUIDAS: [string, string][] = [
    ['notices', 'sync_down_v1'],
    ['users',   'card_sent_v1'],
    ['users',   'author_keys_v1'],
    ['users',   'record_verdicts_v1'],
    ['users',   'ratchet_v1'],
  ];

  const claveDe = (base: string, uid: string) => `${base}::u:${uid}`;

  function sembrarExcluidas(uid: string): void {
    for (const [bucket, base] of EXCLUIDAS) {
      createSecureStorage(bucket as never).set(claveDe(base, uid), `sembrado:${uid}`);
    }
  }

  function excluidasQueQuedan(uid: string): string[] {
    return EXCLUIDAS
      .filter(([bucket, base]) => createSecureStorage(bucket as never).contains(claveDe(base, uid)))
      .map(([bucket, base]) => `${bucket}/${base}`);
  }

  it('las claves excluidas de la fusión SÍ se purgan', () => {
    sembrarTodo(APPLE);
    sembrarExcluidas(APPLE);
    mergeAccounts(APPLE, GOOGLE);

    expect(excluidasQueQuedan(APPLE)).toHaveLength(EXCLUIDAS.length);   // siguen ahí durante la gracia
    purgeMergedScopes(TARDE);

    expect(excluidasQueQuedan(APPLE)).toEqual([]);
  });

  it('y no se lleva puestas las del scope que se queda', () => {
    sembrarExcluidas(APPLE);
    sembrarExcluidas(GOOGLE);
    mergeAccounts(APPLE, GOOGLE);

    purgeMergedScopes(TARDE);

    expect(excluidasQueQuedan(GOOGLE)).toHaveLength(EXCLUIDAS.length);
  });

  /**
   * El barrido es por SUFIJO exacto. Dos cuentas cuyos ids comparten el final
   * —o una clave que casualmente termine parecido— no pueden confundirse.
   */
  it('no borra el scope de una cuenta cuyo id termina parecido', () => {
    const parecido = `x${APPLE}`;
    createSecureStorage('notices').set(claveDe('sync_down_v1', parecido), 'ajeno');
    sembrarExcluidas(APPLE);
    mergeAccounts(APPLE, GOOGLE);

    purgeMergedScopes(TARDE);

    expect(createSecureStorage('notices').contains(claveDe('sync_down_v1', parecido))).toBe(true);
  });

  // Una clave sin scope —de antes del aislamiento por cuenta— no le pertenece
  // a nadie y no se toca.
  it('no toca las claves sin scope', () => {
    createSecureStorage('notices').set('inbox_v1', 'legacy');
    sembrarTodo(APPLE);
    mergeAccounts(APPLE, GOOGLE);

    purgeMergedScopes(TARDE);

    expect(createSecureStorage('notices').contains('inbox_v1')).toBe(true);
  });
});
