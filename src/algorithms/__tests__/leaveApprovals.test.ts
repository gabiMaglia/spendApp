import { ed25519 } from '@noble/curves/ed25519.js';
import { isApprovedByAll, approvalProgress, aprobadoresValidos, mergeApprovals, yaAprobo } from '../leaveRequest';
import { signLeaveApproval, verifyLeaveApproval } from '@/src/sync/leaveApprovalSign';
import { toHex } from '@/src/sync/hexBytes';
import type { Group, LeaveApproval, LeaveRequest } from '@/src/types/models';

const PRIV_BETO = 'b'.repeat(64);
const PUB_BETO  = toHex(ed25519.getPublicKey(Buffer.from(PRIV_BETO, 'hex')));
const PRIV_CARO = 'c'.repeat(64);
const PUB_CARO  = toHex(ed25519.getPublicKey(Buffer.from(PRIV_CARO, 'hex')));

const grupo = (): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto', 'caro'], currency: 'ARS',
  createdAt: 0, createdById: 'ana', deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group);

/** Ana pide irse. Los que tienen que aprobar son Beto y Caro. */
const pedido = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  userId: 'ana', requestedAt: 1_000, approvedBy: [], v: 2,
  plan: [{ fromUserId: 'beto', toUserId: 'caro', amount: 500_000, currency: 'ARS' }],
  ...over,
});

function aprobacionFirmada(userId: string, priv: string, req = pedido()): LeaveApproval {
  const a: LeaveApproval = { userId, approvedAt: 2_000 };
  return { ...a, ...signLeaveApproval('g1', req, a, priv) };
}

/** El verificador real, con las públicas que de verdad son de cada uno. */
const verificaDeVerdad = (req: LeaveRequest) => (a: LeaveApproval) =>
  verifyLeaveApproval('g1', req, a, a.userId === 'beto' ? [PUB_BETO] : [PUB_CARO]) === 'valida';

/**
 * **El agujero que cierra T-065, como test de regresión.**
 *
 * Antes de esto, `approvedBy` era una lista de ids pelados que el merge unía sin
 * preguntar quién escribió cada uno. Quien se iba escribía los de todos los
 * demás y `isApprovedByAll` daba `true` sin una sola aprobación real — y eso
 * dispara `applyApprovedLeaves` en el teléfono de TODOS, materializando los
 * pagos de absorción de deuda. Plata moviéndose con cero autorización.
 */
describe('el que se va no puede aprobarse solo', () => {
  it('ids forjados no alcanzan por más que ganen el merge', () => {
    const honesto = pedido();
    const forjado = pedido({ approvedBy: ['beto', 'caro'] });

    // La unión los toma: no es su trabajo juzgar quién los escribió.
    const enElDeBeto = mergeApprovals(honesto, forjado)!;
    expect(enElDeBeto.approvedBy).toHaveLength(2);

    // Pero no autorizan nada.
    expect(isApprovedByAll(grupo(), enElDeBeto, verificaDeVerdad(enElDeBeto))).toBe(false);
  });

  it('tampoco alcanza con inventar objetos que parecen aprobaciones', () => {
    const req = pedido({ approvedBy: [
      { userId: 'beto', approvedAt: 2_000 },
      { userId: 'caro', approvedAt: 2_000 },
    ] });
    expect(isApprovedByAll(grupo(), req, verificaDeVerdad(req))).toBe(false);
  });

  it('ni firmando las dos con la MISMA clave', () => {
    // Ana tiene una sola privada: puede firmar dos veces, no ser dos personas.
    const req = pedido();
    const conAmbas = pedido({ approvedBy: [
      aprobacionFirmada('beto', PRIV_BETO, req),
      aprobacionFirmada('caro', PRIV_BETO, req),   // ← firmada por Beto
    ] });
    expect(isApprovedByAll(grupo(), conAmbas, verificaDeVerdad(conAmbas))).toBe(false);
  });

  it('con las dos firmas legítimas, sí', () => {
    const req = pedido();
    const completo = pedido({ approvedBy: [
      aprobacionFirmada('beto', PRIV_BETO, req),
      aprobacionFirmada('caro', PRIV_CARO, req),
    ] });
    expect(isApprovedByAll(grupo(), completo, verificaDeVerdad(completo))).toBe(true);
  });
});

describe('lo que la firma promete', () => {
  it('una aprobación no se muda a otro grupo', () => {
    const a = aprobacionFirmada('beto', PRIV_BETO);
    expect(verifyLeaveApproval('g2', pedido(), a, [PUB_BETO])).toBe('invalida');
  });

  it('aprobar que se vaya Ana no vale para que se vaya otro', () => {
    const a = aprobacionFirmada('beto', PRIV_BETO);
    const otro = pedido({ userId: 'dani' });
    expect(verifyLeaveApproval('g1', otro, a, [PUB_BETO])).toBe('invalida');
  });

  it('una aprobación vieja no revive un pedido nuevo', () => {
    const a = aprobacionFirmada('beto', PRIV_BETO);
    const nuevo = pedido({ requestedAt: 9_000 });
    expect(verifyLeaveApproval('g1', nuevo, a, [PUB_BETO])).toBe('invalida');
  });

  /**
   * **El plan va adentro de la firma, y por eso esto falla.** Sin él, quien se
   * va junta las aprobaciones de todos y DESPUÉS cambia quién absorbe cuánto,
   * con las firmas intactas.
   */
  it('cambiar quién absorbe la deuda invalida lo aprobado', () => {
    const a = aprobacionFirmada('beto', PRIV_BETO);
    const cambiado = pedido({
      plan: [{ fromUserId: 'caro', toUserId: 'beto', amount: 500_000, currency: 'ARS' }],
    });
    expect(verifyLeaveApproval('g1', cambiado, a, [PUB_BETO])).toBe('invalida');
  });
});

describe('compatibilidad con lo que ya estaba en vuelo', () => {
  // Exigir firma retroactivamente trabaría una salida ya empezada, y esos
  // pedidos se vencen solos. Mismo criterio que las rondas de T-041 S8.
  it('un pedido anterior a T-065 sigue contando ids pelados', () => {
    const viejo = pedido({ v: undefined, approvedBy: ['beto', 'caro'] });
    expect(isApprovedByAll(grupo(), viejo)).toBe(true);
  });

  it('pero uno nuevo NO, ni con el mismo contenido', () => {
    const nuevo = pedido({ approvedBy: ['beto', 'caro'] });
    expect(isApprovedByAll(grupo(), nuevo)).toBe(false);
  });

  /**
   * **Fail-closed.** Sin verificador, un pedido `v: 2` no cuenta ninguna
   * aprobación. El default seguro es «no alcanza», nunca «alcanza»: quien
   * necesite la respuesta de verdad tiene que traer con qué verificar.
   */
  it('sin verificador, un pedido nuevo no aprueba nada', () => {
    const req = pedido({ approvedBy: [
      aprobacionFirmada('beto', PRIV_BETO),
      aprobacionFirmada('caro', PRIV_CARO),
    ] });
    expect(aprobadoresValidos(req).size).toBe(0);
    expect(isApprovedByAll(grupo(), req)).toBe(false);
  });
});

describe('lo que ve la pantalla', () => {
  it('el «2 de 3» cuenta lo verificado, no lo crudo', () => {
    const req = pedido({ approvedBy: [
      aprobacionFirmada('beto', PRIV_BETO),
      'caro',                                  // forjado
    ] });
    expect(approvalProgress(grupo(), req, verificaDeVerdad(req))).toEqual({ got: 1, need: 2 });
  });

  // Idempotencia: si ya aprobé, la pantalla no me lo vuelve a ofrecer. Cuenta la
  // entrada aunque no esté firmada — no ofrecerle aprobar de nuevo a quien ya
  // tocó el botón no es una decisión de seguridad.
  it('quien ya aprobó no vuelve a ver el botón', () => {
    expect(yaAprobo(pedido({ approvedBy: [aprobacionFirmada('beto', PRIV_BETO)] }), 'beto')).toBe(true);
    expect(yaAprobo(pedido({ approvedBy: ['beto'] }), 'beto')).toBe(true);
    expect(yaAprobo(pedido(), 'beto')).toBe(false);
  });
});

describe('la unión no pierde aportes', () => {
  it('una aprobación firmada y un id pelado del mismo usuario conviven', () => {
    const firmada = aprobacionFirmada('beto', PRIV_BETO);
    const unido = mergeApprovals(pedido({ approvedBy: ['beto'] }), pedido({ approvedBy: [firmada] }))!;
    // Colapsarlas por `userId` podría quedarse con la que NO vale.
    expect(unido.approvedBy).toHaveLength(2);
    expect(isApprovedByAll(grupo(), { ...unido, approvedBy: [...unido.approvedBy, aprobacionFirmada('caro', PRIV_CARO)] },
      verificaDeVerdad(unido))).toBe(true);
  });

  it('la misma aprobación por dos caminos no se duplica', () => {
    const a = aprobacionFirmada('beto', PRIV_BETO);
    const unido = mergeApprovals(pedido({ approvedBy: [a] }), pedido({ approvedBy: [a] }))!;
    expect(unido.approvedBy).toHaveLength(1);
  });
});
