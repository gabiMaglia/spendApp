import { ed25519, ED25519_TORSION_SUBGROUP } from '@noble/curves/ed25519.js';
import { signCore, verifyCore } from '../recordSign';
import { canonicalCore } from '../recordCore';
import { toHex, fromHex, utf8Bytes } from '../hexBytes';
import { EXPENSE, PAYMENT } from '@/src/test-utils/recordFixtures';

/**
 * S2 de T-041: firmar y verificar el núcleo.
 *
 * `verifyCore` devuelve SIEMPRE uno de tres veredictos. Un contador que vale
 * cero por dos razones opuestas no es una métrica — está escrito en el código
 * del proyecto, en `authorHealth.ts:55-65`.
 */

function par(seed: number) {
  const priv = new Uint8Array(32).fill(seed);
  return { priv: toHex(priv), pub: toHex(ed25519.getPublicKey(priv)) };
}

const ANA = par(7);
const MALO = par(9);

function firmado<T extends object>(kind: 'expense' | 'payment', record: T, quien = ANA) {
  return { ...record, ...signCore(kind, record as never, quien.priv) };
}

describe('firmar y verificar', () => {
  it('lo que firma el autor verifica contra su clave', () => {
    const e = firmado('expense', EXPENSE);
    expect(verifyCore('expense', e as never, [ANA.pub])).toBe('valida');
  });

  it('la firma va inline: `k` es la pública del que firmó', () => {
    expect(firmado('expense', EXPENSE).k).toBe(ANA.pub);
  });

  it('firmar dos veces el mismo núcleo da la misma firma (Ed25519 es determinista)', () => {
    expect(signCore('expense', EXPENSE as never, ANA.priv).s)
      .toBe(signCore('expense', EXPENSE as never, ANA.priv).s);
  });
});

describe('los tres veredictos, siempre los tres', () => {
  it('sin firma: `no_verificable` — no es una sospecha, es falta de información', () => {
    const { k: _k, s: _s, ...sinFirma } = EXPENSE;
    expect(verifyCore('expense', sinFirma as never, [ANA.pub])).toBe('no_verificable');
  });

  it('con firma pero `k` vacía: `no_verificable`', () => {
    expect(verifyCore('expense', { ...EXPENSE, k: '', s: 'ab' } as never, [ANA.pub]))
      .toBe('no_verificable');
  });

  /**
   * El borde de ADR-004 (Apple manda `email` sólo la primera vez) deja gente
   * legítima sin clave resoluble. Gastarle 4 ms de curva a un registro que no
   * vamos a poder atribuir igual no informa nada, y devolver `valida` sin
   * atribución sería mentir: `valida` significa "la pública resuelve al
   * `createdById` declarado" (§C.8).
   */
  it('firma perfecta pero autor irresoluble: `no_verificable`, nunca `valida`', () => {
    const e = firmado('expense', EXPENSE);
    expect(verifyCore('expense', e as never, [])).toBe('no_verificable');
  });

  it('firma perfecta de OTRA clave que no es del autor: `invalida`', () => {
    const e = firmado('expense', EXPENSE, MALO);
    expect(verifyCore('expense', e as never, [ANA.pub])).toBe('invalida');
  });

  it('firma que no cierra: `invalida`', () => {
    const e = firmado('expense', EXPENSE);
    const otra = signCore('expense', { ...EXPENSE, amount: 1 } as never, ANA.priv).s;
    expect(verifyCore('expense', { ...e, s: otra } as never, [ANA.pub])).toBe('invalida');
  });

  it('hex basura en la firma: `invalida`, y no explota', () => {
    const e = firmado('expense', EXPENSE);
    expect(verifyCore('expense', { ...e, s: 'no-soy-hex' } as never, [ANA.pub])).toBe('invalida');
    expect(verifyCore('expense', { ...e, s: 'ff'.repeat(64) } as never, [ANA.pub])).toBe('invalida');
  });
});

describe('separación de dominios', () => {
  /**
   * Un núcleo firmado como gasto no puede valer como pago. Sin la entidad
   * adentro del payload, dos registros de tipos distintos con los mismos
   * valores compartirían mensaje firmado.
   */
  it('una firma de `expense` no vale para `payment`', () => {
    const comun = { id: 'x-1', groupId: 'g', amount: 1, currency: 'ARS', createdAt: 1, createdById: 'ana', rev: 1 };
    const firma = signCore('expense', comun as never, ANA.priv);
    expect(verifyCore('payment', { ...comun, ...firma } as never, [ANA.pub])).toBe('invalida');
  });

  it('una firma de la versión vieja del algoritmo no vale para la nueva', () => {
    const e = firmado('payment', PAYMENT);
    const mensajeViejo = canonicalCore('payment', PAYMENT as never).replace('"v":1', '"v":0');
    const s = toHex(ed25519.sign(utf8Bytes(mensajeViejo), fromHex(ANA.priv)));
    expect(verifyCore('payment', { ...e, s } as never, [ANA.pub])).toBe('invalida');
  });
});

/**
 * `zip215: false` — que la opción llegue no prueba que haga algo.
 *
 * Vector real, construido con el subgrupo de torsión que el paquete exporta:
 * una pública de orden chico y `s = 0`. La ecuación cofactorizada se cumple para
 * CUALQUIER mensaje, así que con el modo permisivo esa firma vale para todo. El
 * modo estricto rechaza la pública de orden chico (`edwards.js`: `if (!zip215 &&
 * A.isSmallOrder()) return false`), que es exactamente lo que el README del
 * paquete promete: "avoids signatures valid for multiple transactions".
 */
describe('zip215:false está aplicado de verdad, no sólo pasado', () => {
  const A = ED25519_TORSION_SUBGROUP[1]!;
  const sigTorsion = A + '00'.repeat(32);

  it('el vector de torsión SÍ pasa en modo permisivo (si no, el test no prueba nada)', () => {
    const msg = utf8Bytes(canonicalCore('expense', EXPENSE as never));
    expect(ed25519.verify(fromHex(sigTorsion), msg, fromHex(A), { zip215: true })).toBe(true);
  });

  it('la MISMA firma vale para dos mensajes distintos en modo permisivo', () => {
    const uno = utf8Bytes(canonicalCore('expense', EXPENSE as never));
    const otro = utf8Bytes(canonicalCore('expense', { ...EXPENSE, amount: 999 } as never));
    expect(ed25519.verify(fromHex(sigTorsion), uno, fromHex(A), { zip215: true })).toBe(true);
    expect(ed25519.verify(fromHex(sigTorsion), otro, fromHex(A), { zip215: true })).toBe(true);
  });

  it('`verifyCore` lo rechaza: `invalida`', () => {
    const e = { ...EXPENSE, k: A, s: sigTorsion };
    expect(verifyCore('expense', e as never, [A])).toBe('invalida');
    expect(verifyCore('expense', { ...e, amount: 999 } as never, [A])).toBe('invalida');
  });
});
