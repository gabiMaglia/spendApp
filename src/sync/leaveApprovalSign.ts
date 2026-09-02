import { ed25519 } from '@noble/curves/ed25519.js';
import { canonicalLeaveApproval } from './leaveApprovalCore';
import { toHex, fromHex, utf8Bytes } from './hexBytes';
import type { CoreVerdict } from './recordSign';
import type { LeaveApproval } from '@/src/types/models';

/**
 * **Firmar y verificar UNA aprobación de salida** (T-065).
 *
 * Esto no es una marca informativa como el resto de T-041: acá la firma
 * **autoriza**. Una aprobación que no verifica no cuenta, y por lo tanto la
 * salida no se aplica. Es la única parte del sistema donde la política del PO
 * (R1: marcar, nunca rechazar) no puede aplicarse, y por una razón concreta:
 * marcar sirve cuando el usuario puede juzgar lo que ve, y acá el efecto
 * —materializar pagos de absorción de deuda— ocurre solo, en el teléfono de
 * todos, sin que nadie mire.
 *
 * Sólo se exige en pedidos `v: 2`. Los anteriores a T-065 siguen contando sin
 * firma, para no trabar una salida ya en curso; se vencen solos.
 */

export function signLeaveApproval(
  groupId: string,
  request: { userId: string; requestedAt: number; plan: unknown },
  a: LeaveApproval,
  privateKeyHex: string,
): { k: string; s: string } {
  const priv = fromHex(privateKeyHex);
  return {
    k: toHex(ed25519.getPublicKey(priv)),
    s: toHex(ed25519.sign(utf8Bytes(canonicalLeaveApproval(groupId, request, a)), priv)),
  };
}

export function verifyLeaveApproval(
  groupId: string,
  request: { userId: string; requestedAt: number; plan: unknown },
  a: LeaveApproval,
  authorKeys: readonly string[],
): CoreVerdict {
  const { k, s } = a;

  if (!k || !s) return 'no_verificable';
  if (authorKeys.length === 0) return 'no_verificable';
  if (!authorKeys.includes(k)) return 'invalida';

  try {
    const ok = ed25519.verify(
      fromHex(s), utf8Bytes(canonicalLeaveApproval(groupId, request, a)), fromHex(k),
      // Ver `recordSign.ts`. Acá el modo permisivo dejaría que una sola firma de
      // torsión valiera como la aprobación de cualquier miembro.
      { zip215: false },
    );
    return ok ? 'valida' : 'invalida';
  } catch {
    return 'invalida';
  }
}
