import { ed25519 } from '@noble/curves/ed25519.js';
import {
  verifiedCore, cachedVerdict, rememberVerdict, verdictCacheSize,
  clearVerdictCache, reloadVerdictCache, VERDICT_CACHE_KEY, VERDICT_CACHE_MAX,
} from '../verdictCache';
import { signCore } from '../recordSign';
import { toHex } from '../hexBytes';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';
import { EXPENSE } from '@/src/test-utils/recordFixtures';

/**
 * S3 de T-041: la caché de veredictos.
 *
 * Riesgo 5 del §QUÉ: **la caché es estado de seguridad.** Si se envenena o se
 * corrompe, un registro inválido pasa. Tiene que reconstruirse sola y fallar
 * hacia `no_verificable`, NUNCA hacia `valida`.
 */

const storage = createSecureStorage('users');

const priv = new Uint8Array(32).fill(5);
const PRIV = toHex(priv);
const PUB = toHex(ed25519.getPublicKey(priv));
const OTRA = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(6)));

const firmado = { ...EXPENSE, ...signCore('expense', EXPENSE as never, PRIV) };

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'yo' } as User });
  clearVerdictCache();
});

describe('memoriza el veredicto en vez de repetir la curva', () => {
  it('el primer veredicto queda guardado', () => {
    expect(verifiedCore('expense', firmado as never, [PUB])).toBe('valida');
    expect(verdictCacheSize()).toBe(1);
    expect(cachedVerdict('expense', firmado as never)).toBe('valida');
  });

  /**
   * Prueba que la lectura de caché está VIVA sin espiar la curva: si el
   * resultado sigue al contenido de la caché y no al de la firma, es porque se
   * consultó.
   */
  it('lo cacheado es lo que se devuelve', () => {
    rememberVerdict('expense', firmado as never, 'invalida');
    expect(verifiedCore('expense', firmado as never, [PUB])).toBe('invalida');
  });

  it('`no_verificable` NO se cachea: es falta de información, y cambia sola', () => {
    expect(verifiedCore('expense', firmado as never, [])).toBe('no_verificable');
    expect(verdictCacheSize()).toBe(0);
  });
});

describe('la clave de caché', () => {
  /**
   * **El ataque que tumbó la clave que proponía el plan.**
   *
   * El §C.9 pedía `(id, rev, hash(sig))`. Con esa clave alcanza con tomar un
   * gasto firmado que este device YA validó, cambiarle el monto y dejar `id`,
   * `rev`, `k` y `s` como estaban: misma clave, hereda el `valida`, y la
   * falsificación entra sin que nadie toque la curva. El veredicto tiene que
   * seguir al CONTENIDO verificado, no al nombre del registro.
   */
  it('cubre el contenido: alterar el monto no hereda el `valida` del original', () => {
    expect(verifiedCore('expense', firmado as never, [PUB])).toBe('valida');

    const falsificado = { ...firmado, amount: 1 };
    expect(falsificado.id).toBe(firmado.id);
    expect(falsificado.rev).toBe(firmado.rev);
    expect(falsificado.s).toBe(firmado.s);

    expect(verifiedCore('expense', falsificado as never, [PUB])).toBe('invalida');
  });

  it.each(['splits', 'createdById', 'paidById', 'currency', 'date'])(
    'cubre `%s` igual que el monto', (campo) => {
      expect(verifiedCore('expense', firmado as never, [PUB])).toBe('valida');
      const falsificado = { ...firmado, [campo]: 'otra-cosa' };
      expect(verifiedCore('expense', falsificado as never, [PUB])).toBe('invalida');
    },
  );

  /**
   * Sin `rev` adentro de la clave, un atacante manda el MISMO `s` con un `rev`
   * mayor y hereda el `valida` de la revisión anterior: gana el merge por
   * niveles (S7) con una firma que no cubre ese `rev`.
   */
  it('lleva `rev`: subir `rev` con la misma firma no hereda el veredicto', () => {
    expect(verifiedCore('expense', firmado as never, [PUB])).toBe('valida');
    const reestampado = { ...firmado, rev: (firmado.rev ?? 0) + 1 };
    expect(verifiedCore('expense', reestampado as never, [PUB])).toBe('invalida');
  });

  it('lleva la entidad: el mismo id en dos entidades no comparte veredicto', () => {
    rememberVerdict('expense', firmado as never, 'valida');
    expect(cachedVerdict('payment', firmado as never)).toBeUndefined();
  });

  it('lleva la firma: cambiar `s` no hereda el veredicto', () => {
    rememberVerdict('expense', firmado as never, 'valida');
    expect(cachedVerdict('expense', { ...firmado, s: 'ff'.repeat(64) } as never)).toBeUndefined();
  });
});

describe('fail-closed: ante cualquier duda, nunca `valida`', () => {
  /**
   * El chequeo de atribución va ANTES de mirar la caché. Así una entrada
   * envenenada no puede saltearlo: sin autor resoluble el resultado es
   * `no_verificable` aunque la caché grite `valida`.
   */
  it('caché envenenada con `valida` + autor irresoluble ⇒ `no_verificable`', () => {
    rememberVerdict('expense', firmado as never, 'valida');
    expect(verifiedCore('expense', firmado as never, [])).toBe('no_verificable');
  });

  /**
   * El hueco que encontró la mutación M3 (2026-08-31): `verifiedCore` con un
   * registro SIN firma devolvía `no_verificable` porque el código estaba bien,
   * pero ningún test lo miraba — cambiar ese `return` a `'valida'` dejaba las
   * 519 pruebas en verde. Es el caso más común de todos: cada registro anterior
   * a T-041 y cada peer que no actualizó pasan por acá.
   */
  it('un registro SIN firma ⇒ `no_verificable`, jamás `valida`', () => {
    const { k: _k, s: _s, ...sinFirma } = firmado as Record<string, unknown>;
    expect(verifiedCore('expense', sinFirma as never, [PUB])).toBe('no_verificable');
  });

  it('sin firma NO se puede colar por la caché: el descarte va antes', () => {
    const { k: _k, s: _s, ...sinFirma } = firmado as Record<string, unknown>;
    rememberVerdict('expense', sinFirma as never, 'valida');
    expect(verifiedCore('expense', sinFirma as never, [PUB])).toBe('no_verificable');
  });

  it('con firma a medias (sólo `k`, sin `s`) tampoco ⇒ `no_verificable`', () => {
    const { s: _s, ...aMedias } = firmado as Record<string, unknown>;
    expect(verifiedCore('expense', aMedias as never, [PUB])).toBe('no_verificable');
  });

  it('caché envenenada con `valida` + clave que no es del autor ⇒ `invalida`', () => {
    rememberVerdict('expense', firmado as never, 'valida');
    expect(verifiedCore('expense', firmado as never, [OTRA])).toBe('invalida');
  });

  it('JSON corrupto en disco ⇒ caché vacía, y el veredicto se recalcula bien', () => {
    writeScoped(storage, VERDICT_CACHE_KEY, '{{{ esto no parsea');
    reloadVerdictCache();

    expect(verdictCacheSize()).toBe(0);
    expect(verifiedCore('expense', firmado as never, [PUB])).toBe('valida');
  });

  it.each([
    ['un veredicto que no existe', 'ok'],
    ['`no_verificable` metido a mano', 'no_verificable'],
    ['mayúsculas', 'VALIDA'],
    ['un objeto', { verdict: 'valida' }],
    ['null', null],
    ['un número', 1],
  ])('entrada con %s se descarta, no se lee como `valida`', (_caso, valor) => {
    rememberVerdict('expense', firmado as never, 'valida');
    const bruto = JSON.parse(readScoped(storage, VERDICT_CACHE_KEY)!) as { e: [string, unknown][] };
    bruto.e = bruto.e.map(([clave]) => [clave, valor]);
    writeScoped(storage, VERDICT_CACHE_KEY, JSON.stringify(bruto));
    reloadVerdictCache();

    expect(cachedVerdict('expense', firmado as never)).toBeUndefined();
  });

  it('estructura de disco de otro shape ⇒ vacía', () => {
    for (const basura of ['null', '[]', '"texto"', '{"e":"no-es-lista"}', '{"e":[1,2,3]}']) {
      writeScoped(storage, VERDICT_CACHE_KEY, basura);
      reloadVerdictCache();
      expect(verdictCacheSize()).toBe(0);
    }
  });
});

describe('persistencia y límites', () => {
  it('sobrevive al reinicio del proceso', () => {
    verifiedCore('expense', firmado as never, [PUB]);
    reloadVerdictCache();
    expect(cachedVerdict('expense', firmado as never)).toBe('valida');
  });

  it('no crece sin techo: se descartan las entradas más viejas', () => {
    for (let i = 0; i < VERDICT_CACHE_MAX + 10; i++) {
      rememberVerdict('expense', { ...firmado, id: `e-${i}` } as never, 'valida');
    }
    expect(verdictCacheSize()).toBe(VERDICT_CACHE_MAX);
    expect(cachedVerdict('expense', { ...firmado, id: 'e-0' } as never)).toBeUndefined();
    expect(cachedVerdict('expense', { ...firmado, id: 'e-100' } as never)).toBe('valida');
  });

  it('está scopeada por cuenta: lo de una no lo lee la otra', () => {
    verifiedCore('expense', firmado as never, [PUB]);

    useAuthStore.setState({ currentUser: { id: 'otra-cuenta' } as User });
    reloadVerdictCache();
    expect(cachedVerdict('expense', firmado as never)).toBeUndefined();

    useAuthStore.setState({ currentUser: { id: 'yo' } as User });
    reloadVerdictCache();
    expect(cachedVerdict('expense', firmado as never)).toBe('valida');
  });
});
