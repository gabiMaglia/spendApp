jest.mock('@/src/sync/trustCheck', () => ({ checkRecord: jest.fn(() => 'no_verificable') }));
import { checkRecord } from '@/src/sync/trustCheck';
import {
  estadoDelSaldado, requiereConfirmacion, type ContextoDeAcuse,
} from '@/src/algorithms/settlementStatus';
import type { RecordVerdict } from '@/src/sync/recordHealth';
import type { Group, Payment, SettlementConfirmation } from '@/src/types/models';

/**
 * T-170 criterio 3 (verifier T-145, residual 1). El deudor CREA el pago con
 * `createdById` = acreedor: hasta acá quedaba `efectivo` sin acuse y el `reject`
 * del acreedor se ignoraba. D-3: «lo declaró quien cobra» se prueba con firma.
 */
const pagoDelAcreedor = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto', amount: 500_000,
  currency: 'ARS', date: 0, createdAt: 0, createdById: 'beto', updatedAt: 0, isDeleted: false, ...over,
} as Payment);
const grupo = (mode: 'consensus' | 'open' = 'consensus'): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS', deletionMode: mode,
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group);
const ctx = (nucleo: RecordVerdict): ContextoDeAcuse =>
  ({ now: 10_000, veredicto: () => 'valida', nucleoDe: () => nucleo });
const rechazo: SettlementConfirmation = { userId: 'beto', confirmedAt: 1_000, action: 'reject' };

it('T-170.5: pago del acreedor con núcleo válido → efectivo sin acuse (D3 como hoy)', () => {
  expect(requiereConfirmacion(pagoDelAcreedor(), grupo(), ctx('valida'))).toBe(false);
  expect(estadoDelSaldado(pagoDelAcreedor(), grupo(), ctx('valida'))).toBe('efectivo');
});

it.each(['invalida', 'no_verificable', 'no_firmable'] as RecordVerdict[])(
  'T-170.4: núcleo %s → hace falta acuse y queda pendiente', (v) => {
    expect(requiereConfirmacion(pagoDelAcreedor(), grupo(), ctx(v))).toBe(true);
    expect(estadoDelSaldado(pagoDelAcreedor(), grupo(), ctx(v))).toBe('pendiente');
  });

it('T-170.4: y el reject del acreedor lo deja rechazado (la regla 3 vuelve a valer)', () => {
  const p = pagoDelAcreedor({ confirmations: [rechazo] });
  expect(estadoDelSaldado(p, grupo(), ctx('no_verificable'))).toBe('rechazado');
});

it('pago declarado por el deudor: hace falta acuse, sin gastar la verificación del núcleo', () => {
  const nucleoDe = jest.fn(() => 'valida' as RecordVerdict);
  const c = { ...ctx('valida'), nucleoDe };
  expect(requiereConfirmacion(pagoDelAcreedor({ createdById: 'ana' }), grupo(), c)).toBe(true);
  expect(nucleoDe).not.toHaveBeenCalled();
});

it('grupo abierto: nunca hace falta, con o sin firma', () => {
  expect(requiereConfirmacion(pagoDelAcreedor(), grupo('open'), ctx('invalida'))).toBe(false);
});

it('I-11: sin ctx usa el veredicto de producción (checkRecord del pago)', () => {
  expect(requiereConfirmacion(pagoDelAcreedor(), grupo())).toBe(true);
  expect(checkRecord).toHaveBeenCalledWith('payment', expect.objectContaining({ id: 'p1' }));
});

it('G11: un pago derivado de salida con el acreedor saliente (sin firma) queda pendiente — P-3 aceptado', () => {
  expect(estadoDelSaldado(pagoDelAcreedor({ id: 'leave_g1_x_0' }), grupo(), ctx('no_firmable'))).toBe('pendiente');
});
