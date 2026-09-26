import { estadoDelSaldado, saldadosPendientes, pagosQueCuentan, type ContextoDeAcuse } from '../settlementStatus';
import { TOLERANCIA_RELOJ_MS } from '@/src/sync/voteCore';
import type { Group, Payment, SettlementConfirmation } from '@/src/types/models';

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
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group;

const acuse = (o: Partial<SettlementConfirmation> = {}): SettlementConfirmation =>
  ({ userId: 'beto', confirmedAt: NOW - 1000, action: 'confirm', ...o });

/** Contexto donde lo firmado (k+s) verifica y lo no firmado no se puede atribuir. */
const ctx = (veredictoFirmado: 'valida' | 'invalida' = 'valida'): ContextoDeAcuse => ({
  now: NOW,
  veredicto: (_id, c) => (c.k && c.s ? veredictoFirmado : 'no_verificable'),
});
const firmado = (c: SettlementConfirmation) => ({ ...c, k: 'aa'.repeat(32), s: 'bb'.repeat(64) });

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

  it('el reject real del acreedor le gana al confirm forjado del deudor aunque sea más viejo', () => {
    const forjado = acuse({ confirmedAt: 9e15 });                       // sin firma, futuro
    const real = acuse({ action: 'reject', confirmedAt: NOW - 5000 });  // sin firma, plausible
    expect(estadoDelSaldado(pago({ confirmations: [forjado, real] }), grupo, ctx())).toBe('rechazado');
  });
});

describe('las listas derivadas heredan la regla', () => {
  it('un pago con confirm forjado sigue figurando como pendiente', () => {
    const p = pago({ confirmations: [acuse({ confirmedAt: 9e15 })] });
    expect(saldadosPendientes([p], grupo, ctx()).map(x => x.id)).toEqual(['p1']);
    expect(pagosQueCuentan([p], grupo, ctx()).map(x => x.id)).toEqual(['p1']); // D1: pendiente cuenta
  });
});
