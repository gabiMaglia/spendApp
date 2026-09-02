import { useCallback, useMemo } from 'react';
import { useGroupStore } from '@/src/store/groupStore';
import { estadoDelSaldado, type EstadoSaldado } from '@/src/algorithms/settlementStatus';
import { acusarRecibo, puedeAcusar } from '@/src/services/settlementConfirm';
import type { Payment } from '@/src/types/models';

export interface AcuseDeSaldado {
  estado: EstadoSaldado;
  /** Soy quien cobra y todavía no acusé: me toca decidir. */
  meToca: boolean;
  confirmar: () => void;
  rechazar: () => void;
}

/**
 * **Qué mostrar y qué puedo hacer con un saldado** (T-064 · tramo C).
 *
 * La lógica vive acá y no en la fila porque son dos preguntas distintas —en qué
 * estado está, y si me toca a mí— y la segunda depende de quién soy. Una fila
 * que las resolviera adentro obligaría a repetirlas en cada pantalla que
 * dibuje un pago.
 */
export function useSaldadoAcuse(payment: Payment, currentUserId: string): AcuseDeSaldado {
  const group = useGroupStore(s => s.groups.find(g => g.id === payment.groupId));

  const estado = useMemo(() => estadoDelSaldado(payment, group), [payment, group]);

  // `meToca` exige que NO haya acuse todavía, no sólo que yo sea el que cobra:
  // después de confirmar, la fila tiene que dejar de pedir una decisión ya
  // tomada. Un rechazo también es una decisión tomada — cambiarla es volver a
  // entrar por el pago, no por un botón que quedó ahí.
  const meToca = puedeAcusar(payment, group, currentUserId) && estado === 'pendiente';

  const confirmar = useCallback(
    () => { acusarRecibo(payment.id, currentUserId, 'confirm'); },
    [payment.id, currentUserId],
  );
  const rechazar = useCallback(
    () => { acusarRecibo(payment.id, currentUserId, 'reject'); },
    [payment.id, currentUserId],
  );

  return { estado, meToca, confirmar, rechazar };
}
