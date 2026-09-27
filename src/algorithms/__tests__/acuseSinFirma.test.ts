import { ed25519 } from '@noble/curves/ed25519.js';
import { estadoDelSaldado, saldadosPendientes, pagosQueCuentan, type ContextoDeAcuse } from '../settlementStatus';
import { TOLERANCIA_RELOJ_MS } from '@/src/store/relojDelMerge';
import { signSettlement } from '@/src/sync/settlementSign';
import {
  rememberAuthorKey, forgetAuthorKeys, refreshPendingAuthors, __resetAuthorSources,
} from '@/src/sync/authorKeys';
import { __resetSettlementTrust } from '@/src/sync/settlementTrust';
import { toHex } from '@/src/sync/hexBytes';
import type { Group, Payment, SettlementConfirmation } from '@/src/types/models';

jest.mock('@/src/sync/contactChannel', () => ({ getPeer: () => undefined }));
jest.mock('@/src/sync/deviceKeys', () => ({ fetchAccountKeys: jest.fn(async () => []) }));

/**
 * SEC-04 (T-142b / T-145). `acuseVigente` elegía por `confirmedAt` sin mirar
 * la firma: el deudor publicaba su pago con
 * `confirmations: [{ userId: <acreedor>, confirmedAt: 9e15, action: 'confirm' }]`
 * y la deuda quedaba cerrada por decisión unilateral; el `reject` real nunca
 * era más nuevo. `verifySettlement` no tenía llamador de producción.
 */
const NOW = 1_790_000_000_000;

const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto', amount: 500_000, currency: 'ARS',
  date: 0, createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false, ...over,
} as Payment);

const grupo: Group = {
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS', deletionMode: 'consensus',
  miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group;

const acuse = (o: Partial<SettlementConfirmation> = {}): SettlementConfirmation =>
  ({ userId: 'beto', confirmedAt: NOW - 1000, action: 'confirm', ...o });

/** Contexto donde lo firmado (k+s) verifica y lo no firmado no se puede atribuir. */
const ctx = (veredictoFirmado: 'valida' | 'invalida' = 'valida'): ContextoDeAcuse => ({
  now: NOW,
  veredicto: (_id, c) => (c.k && c.s ? veredictoFirmado : 'no_verificable'),
  // D-3 (T-170) no es lo que este archivo prueba (createdById !== toUserId en
  // todos los `pago()` de acá): confía siempre para no interferir.
  nucleoDe: () => 'valida',
});
const firmado = (c: SettlementConfirmation) => ({ ...c, k: 'aa'.repeat(32), s: 'bb'.repeat(64) });

function par(seed: number) {
  const priv = new Uint8Array(32).fill(seed);
  return { priv: toHex(priv), pub: toHex(ed25519.getPublicKey(priv)) };
}

describe('confirmar exige firma que cierre', () => {
  it('un confirm sin firma a nombre de quien cobra NO cierra la deuda (PoC SEC-04)', () => {
    const p = pago({ confirmations: [acuse({ confirmedAt: 9e15 })] });
    expect(estadoDelSaldado(p, grupo, ctx())).toBe('pendiente');
  });

  it('un confirm firmado y válido sí', () => {
    expect(estadoDelSaldado(pago({ confirmations: [firmado(acuse())] }), grupo, ctx())).toBe('efectivo');
  });

  it('un confirm con firma que no cierra, no', () => {
    expect(estadoDelSaldado(pago({ confirmations: [firmado(acuse())] }), grupo, ctx('invalida'))).toBe('pendiente');
  });

  it('un confirm con confirmedAt del futuro se ignora aunque esté firmado', () => {
    const p = pago({ confirmations: [firmado(acuse({ confirmedAt: NOW + TOLERANCIA_RELOJ_MS + 1 }))] });
    expect(estadoDelSaldado(p, grupo, ctx())).toBe('pendiente');
  });
});

describe('rechazar se honra salvo firma falsa', () => {
  it('un reject sin firma devuelve la deuda a la vida', () => {
    const p = pago({ confirmations: [acuse({ action: 'reject' })] });
    expect(estadoDelSaldado(p, grupo, ctx())).toBe('rechazado');
  });

  it('un reject con firma que no cierra se ignora', () => {
    const p = pago({ confirmations: [firmado(acuse({ action: 'reject' }))] });
    expect(estadoDelSaldado(p, grupo, ctx('invalida'))).toBe('pendiente');
  });

  it('el reject real del acreedor le gana al confirm forjado y SIN FIRMA del deudor aunque sea más viejo', () => {
    // Este caso ya lo frena la regla de firma sola (un confirm sin firma nunca
    // es `valida`): no depende de `envenenado`. El caso que SÍ depende de
    // `envenenado` está abajo, con el forjado FIRMADO.
    const forjado = acuse({ confirmedAt: 9e15 });                       // sin firma, futuro
    const real = acuse({ action: 'reject', confirmedAt: NOW - 5000 });  // sin firma, plausible
    expect(estadoDelSaldado(pago({ confirmations: [forjado, real] }), grupo, ctx())).toBe('rechazado');
  });

  /**
   * El caso que de verdad prueba `envenenado`, no la regla de firma (P-2, ronda
   * 1 del verificador: el test de arriba sigue verde aunque se borre el filtro
   * de fecha futura, porque el forjado ya no tiene firma). Acá el forjado SÍ
   * firma y SÍ verifica (`ctx()` da `valida` a cualquier `k`+`s`): lo único que
   * puede sacarlo de competencia es la fecha del futuro. Si se saca
   * `envenenado()` de `acuseVigente`, este `confirmedAt: 9e15` gana la
   * comparación por fecha y el resultado pasa a `efectivo`.
   */
  it('el reject real le gana a un confirm FIRMADO y VÁLIDO con fecha del futuro', () => {
    const forjado = firmado(acuse({ confirmedAt: 9e15 }));               // firmado, pero del futuro
    const real = acuse({ action: 'reject', confirmedAt: NOW - 5000 });   // sin firma, plausible
    expect(estadoDelSaldado(pago({ confirmations: [forjado, real] }), grupo, ctx())).toBe('rechazado');
  });
});

describe('compatibilidad: pagos anteriores a T-064 (criterio 3 del ticket)', () => {
  // `engram/03_backlog.md` T-145, criterio 3: «un pago anterior a T-064 sin
  // firma, entonces se acepta como hoy». Antes de T-064 no existía el campo
  // `confirmations`, así que «como hoy» es: sin acuse, `pendiente`, y por D1
  // cuenta igual que uno `efectivo`. Se prueba con el contexto REAL
  // (`contextoReal()`, sin inyectar nada) para que sea el camino de producción
  // el que se ejercita, no una simulación de `ctx()`.
  it('un pago sin `confirmations` (anterior a T-064) sigue pendiente y cuenta igual', () => {
    const p = pago();
    expect(estadoDelSaldado(p, grupo)).toBe('pendiente');
    expect(pagosQueCuentan([p], grupo).map(x => x.id)).toEqual(['p1']);
  });

  // Un peer que no actualizó puede mandar un `confirm` SIN firmar (T-064 nunca
  // exigió firma). No cierra la deuda —eso es justo SEC-04— pero tampoco rompe
  // nada: es el mismo `pendiente` que un pago sin acuse.
  it('un `confirm` sin firma de un peer viejo no cierra, pero tampoco rompe el balance', () => {
    const p = pago({ confirmations: [acuse()] });
    expect(estadoDelSaldado(p, grupo)).toBe('pendiente');
    expect(pagosQueCuentan([p], grupo).map(x => x.id)).toEqual(['p1']);
  });
});

/**
 * **D1, ronda 2 del verificador: el rechazo de un acreedor reinstalado no puede
 * quedar `invalida` para siempre.**
 *
 * Reproduce el PoC del dictamen con las piezas REALES —`checkSettlement`,
 * `authorKeys`, `contextoReal()`— y no con el `ctx()` abstracto de arriba: ese
 * `ctx()` no podía distinguir «clave stale» de «firma falsa», que es
 * exactamente el bug. Beto reinstaló: `authorKeys` tiene su clave VIEJA
 * (`rememberAuthorKey` simula el registro local de peers, que nunca la
 * reemplaza) y firma su `reject` con la NUEVA.
 */
describe('D1 (ronda 2): el reject de un acreedor reinstalado se sigue honrando', () => {
  const VIEJA = par(41);
  const NUEVA = par(42);
  /** Un acreedor sin ninguna clave conocida (borde de ADR-004). */
  const TERCERA = par(43);

  beforeEach(() => {
    forgetAuthorKeys();
    __resetAuthorSources();
    __resetSettlementTrust();
  });

  it('reject firmado con la clave NUEVA de Beto (vieja conocida, directorio sin contestar): la deuda vuelve a la vida', () => {
    rememberAuthorKey('beto', VIEJA.pub);
    const rechazo = acuse({ action: 'reject', confirmedAt: NOW - 1000 });
    const firmadoDeVerdad = { ...rechazo, ...signSettlement('p1', rechazo, NUEVA.priv) };

    const p = pago({ confirmations: [firmadoDeVerdad] });
    // Contexto REAL: sin inyectar nada, es `contextoReal()` con `checkSettlement`.
    expect(estadoDelSaldado(p, grupo)).toBe('rechazado');
  });

  /**
   * **R1 (Re-review 1 del verificador): borde de ADR-004, sin ninguna clave.**
   *
   * Distinto del caso de arriba: Beto no tiene NINGUNA clave conocida —ni
   * vieja ni nueva—, porque entró por Apple sin `email` y el directorio nunca
   * lo va a resolver (`authorKeys.ts`, borde de ADR-004). El PoC exacto del
   * dictamen: antes del directorio, `rechazado`; el fix de D1 rompió esto
   * porque sacó la guarda `keys.length === 0` y, apenas el directorio
   * contesta (vacío, como corresponde a este borde), el acuse quedaba
   * `invalida` para siempre.
   */
  it('reject de un acreedor SIN ninguna clave conocida (ADR-004): sigue vivo, con o sin respuesta del directorio', async () => {
    const rechazo = acuse({ action: 'reject', confirmedAt: NOW - 1000 });
    const firmadoDeVerdad = { ...rechazo, ...signSettlement('p1', rechazo, TERCERA.priv) };
    const p = pago({ confirmations: [firmadoDeVerdad] });

    // Antes de que el directorio conteste.
    expect(estadoDelSaldado(p, grupo)).toBe('rechazado');

    // El directorio contesta VACÍO — el caso normal de este borde, no un corte
    // de red. Sigue `rechazado`: nunca puede ser `invalida` sin una clave con
    // la que comparar.
    await refreshPendingAuthors();
    expect(estadoDelSaldado(p, grupo)).toBe('rechazado');
  });
});

describe('las listas derivadas heredan la regla', () => {
  it('un pago con confirm forjado sigue figurando como pendiente', () => {
    const p = pago({ confirmations: [acuse({ confirmedAt: 9e15 })] });
    expect(saldadosPendientes([p], grupo, ctx()).map(x => x.id)).toEqual(['p1']);
    expect(pagosQueCuentan([p], grupo, ctx()).map(x => x.id)).toEqual(['p1']); // D1: pendiente cuenta
  });
});
