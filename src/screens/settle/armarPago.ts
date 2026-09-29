import { v4 as uuidv4 } from 'uuid';

import type { CurrencyCode } from '@/src/constants/currencies';
import { syncedNow } from '@/src/utils/syncedClock';
import type { Payment } from '@/src/types/models';

/**
 * Un Payment nuevo a partir de quién, a quién, cuánto y dónde. Los tres modos
 * de Saldar (de a uno, «todo» y desde Amigos) lo arman igual: id del cliente,
 * reloj sincronizado y sin tombstone.
 */
export function armarPago(
  base: { groupId: string; fromUserId: string; toUserId: string; amount: number; currency: CurrencyCode },
  date: Date,
  createdById: string,
): Payment {
  return {
    id:          uuidv4(),
    ...base,
    date:        date.getTime(),
    createdAt:   Date.now(),
    createdById,
    updatedAt:   syncedNow(),
    isDeleted:   false,
  };
}
