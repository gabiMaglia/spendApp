import { deletionRound, hasObjected, hasRequested } from '../deletionRound';
import { resolveDeletionVotes, DELETION_TIMEOUT_MS } from '@/src/sync/SyncEngine';
import type { DeletionVote, Expense } from '@/src/types/models';

/**
 * **Las cuatro acciones de un voto de borrado** (T-041 · S8, R-Q1/R-Q2 del PO).
 *
 * Hasta S7 había dos —`delete` y `cancel`— y las tres formas de frenar
 * (objetar, retirar mi pedido, restaurar un gasto ya borrado) terminaban
 * escribiendo exactamente el mismo voto. Consecuencias que el PO pidió
 * arreglar:
 *
 *  - retirar MI pedido frenaba también el de otra persona, y
 *  - restaurar aparecía como «objetado por X», una historia que no pasó.
 *
 * La regla nueva, que es lo que estos tests fijan: **un voto sólo habla por
 * quien lo firmó.** `withdraw` retira el pedido de su autor y nada más;
 * `object` y `restore` son enunciados sobre la RONDA y la frenan para todos.
 * Los `votedAt` de personas distintas nunca se comparan entre sí.
 */

const T0 = Date.UTC(2026, 8, 1, 12);
const HORA = 3_600_000;

const gasto = (votes: DeletionVote[], over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal', splits: [], memberIds: ['ana', 'beto', 'caro'],
  category: 'food', date: 0, createdAt: 0, createdById: 'ana',
  deletionVotes: votes, updatedAt: 0, isDeleted: false,
  ...over,
} as Expense);

const pide     = (u: string, at: number, r = 'r1'): DeletionVote => ({ userId: u, votedAt: at, action: 'delete', roundId: r });
const fuerza   = (u: string, at: number, r = 'r1'): DeletionVote => ({ userId: u, votedAt: at, action: 'delete', forced: true, roundId: r });
const objeta   = (u: string, at: number, r = 'r1'): DeletionVote => ({ userId: u, votedAt: at, action: 'cancel', roundId: r });
const retira   = (u: string, at: number, r = 'r1'): DeletionVote => ({ userId: u, votedAt: at, action: 'withdraw', roundId: r });
const restaura = (u: string, at: number, r = 'r1'): DeletionVote => ({ userId: u, votedAt: at, action: 'cancel', intent: 'restore', roundId: r });

describe('objetar frena la ronda de TODOS', () => {
  it('la ronda queda objetada y se sabe quién la frenó', () => {
    const r = deletionRound(gasto([pide('beto', T0), objeta('caro', T0 + HORA)]))!;

    expect(r.status).toBe('objected');
    expect(r.stoppedBy).toBe('caro');
  });

  it('y el gasto no se borra ni pasadas las 72hs', () => {
    const e = gasto([pide('beto', T0), objeta('caro', T0 + HORA)]);
    expect(resolveDeletionVotes(e, [], T0 + DELETION_TIMEOUT_MS * 2)).toBe(false);
  });
});

describe('retirar saca MI pedido y nada más (R-Q1)', () => {
  /**
   * El caso que el PO nombró: dos personas pidieron, una se arrepiente. Antes
   * de S8 el arrepentimiento frenaba a la otra sin decírselo a nadie.
   */
  it('con el pedido de otra persona vivo, la ronda SIGUE', () => {
    const e = gasto([pide('beto', T0), pide('caro', T0 + HORA), retira('beto', T0 + 2 * HORA)]);
    const r = deletionRound(e)!;

    expect(r.status).toBe('open');
    expect(r.requestedBy).toBe('caro');
  });

  /**
   * Y el plazo pasa a contarse desde el pedido que QUEDA. Nunca se acorta: el
   * que queda es igual o posterior al que se retiró, así que nadie pierde
   * ventana para objetar.
   */
  it('el vencimiento se recuenta desde el pedido que queda', () => {
    const r = deletionRound(gasto([pide('beto', T0), pide('caro', T0 + HORA), retira('beto', T0 + 2 * HORA)]))!;

    expect(r.requestedAt).toBe(T0 + HORA);
    expect(r.expiresAt).toBe(T0 + HORA + DELETION_TIMEOUT_MS);
  });

  it('el gasto sigue camino a borrarse: retirar no es objetar', () => {
    const e = gasto([pide('beto', T0), pide('caro', T0 + HORA), retira('beto', T0 + 2 * HORA)]);
    expect(resolveDeletionVotes(e, [], T0 + HORA + DELETION_TIMEOUT_MS + 1)).toBe(true);
  });

  it('si era el único pedido, la ronda queda como NUNCA PEDIDA, no como objetada', () => {
    const e = gasto([pide('beto', T0), retira('beto', T0 + HORA)]);

    expect(deletionRound(e)).toBeNull();
    expect(resolveDeletionVotes(e, [], T0 + DELETION_TIMEOUT_MS * 2)).toBe(false);
  });

  it('retirar no me deja marcado como objetor ni como solicitante', () => {
    const e = gasto([pide('beto', T0), retira('beto', T0 + HORA)]);

    expect(hasRequested(e, 'beto')).toBe(false);
    expect(hasObjected(e, 'beto')).toBe(false);
  });
});

describe('restaurar tiene su PROPIO estado (R-Q2)', () => {
  it('la ronda queda `restored`, no `objected`', () => {
    const r = deletionRound(gasto([fuerza('ana', T0), restaura('beto', T0 + HORA)], { isDeleted: false }))!;

    expect(r.status).toBe('restored');
    expect(r.stoppedBy).toBe('beto');
  });

  /**
   * El `forced` del creador se honra SIEMPRE (R3), pero restaurar es su
   * contraparte: sin esto `resolvePendingDeletions` re-borra el gasto solo en
   * el próximo arranque.
   */
  it('y deshace el borrado forzado del creador', () => {
    const e = gasto([fuerza('ana', T0), restaura('beto', T0 + HORA)]);
    expect(resolveDeletionVotes(e, [], T0 + 2 * HORA)).toBe(false);
  });

  it('quien restaura NO queda contado como objetor', () => {
    const e = gasto([fuerza('ana', T0), restaura('beto', T0 + HORA)]);
    expect(hasObjected(e, 'beto')).toBe(false);
  });
});

describe('el override del creador y sus contrapartes', () => {
  it('se honra siempre (R3): el gasto se borra ya', () => {
    expect(resolveDeletionVotes(gasto([fuerza('ana', T0)]), [], T0 + 1)).toBe(true);
  });

  it('el creador puede retirar SU forzado', () => {
    const e = gasto([fuerza('ana', T0), retira('ana', T0 + HORA)]);
    expect(resolveDeletionVotes(e, [], T0 + 2 * HORA)).toBe(false);
  });

  /**
   * Y un `withdraw` de otra persona NO lo toca: retirar habla sólo por su
   * autor. Frenar el borrado de otro es objetar, y objetar deja quién fue.
   */
  it('el `withdraw` de un tercero no deshace el forzado del creador', () => {
    const e = gasto([fuerza('ana', T0), retira('beto', T0 + HORA)]);
    expect(resolveDeletionVotes(e, [], T0 + 2 * HORA)).toBe(true);
  });
});

describe('un peer que no actualizó sigue entendiéndose con nosotros', () => {
  const sinNada = (u: string, at: number, action: 'delete' | 'cancel'): DeletionVote =>
    ({ userId: u, votedAt: at, action });

  it('su `cancel` sin `roundId` ni firma frena la ronda igual', () => {
    const r = deletionRound(gasto([pide('beto', T0), sinNada('caro', T0 + HORA, 'cancel')]))!;

    expect(r.status).toBe('objected');
    expect(r.stoppedBy).toBe('caro');
  });

  it('su `delete` sin `roundId` abre ronda igual', () => {
    const r = deletionRound(gasto([sinNada('beto', T0, 'delete')]))!;

    expect(r.status).toBe('open');
    expect(r.requestedBy).toBe('beto');
    expect(r.expiresAt).toBe(T0 + DELETION_TIMEOUT_MS);
  });

  /**
   * Y en la dirección que importa de verdad: lo que EMITIMOS al objetar y al
   * restaurar tiene que seguir frenando en un teléfono que sólo conoce
   * `delete` y `cancel`. Ésta es la razón de que restaurar viaje como un
   * `cancel` con `intent`, y no como una acción nueva: una acción que el otro
   * lado no conoce es un voto que no frena nada, y el gasto se borra solo allá.
   */
  const resolverViejo = (votos: DeletionVote[], creador: string, now: number): boolean => {
    const map = new Map<string, DeletionVote>();
    for (const v of votos) {
      const prev = map.get(v.userId);
      if (!prev || v.votedAt > prev.votedAt) map.set(v.userId, v);
    }
    const ultimos = [...map.values()];
    const delCreador = ultimos.find(v => v.userId === creador);
    if (delCreador?.action === 'delete' && delCreador.forced) {
      const deshecho = ultimos.some(v => v.action === 'cancel' && v.votedAt > delCreador.votedAt);
      if (!deshecho) return true;
    }
    if (ultimos.some(v => v.action === 'cancel')) return false;
    const pedidos = ultimos.filter(v => v.action === 'delete');
    if (pedidos.length === 0) return false;
    return now - Math.min(...pedidos.map(v => v.votedAt)) > DELETION_TIMEOUT_MS;
  };

  it('nuestra objeción frena en el peer viejo', () => {
    const votos = [pide('beto', T0), objeta('caro', T0 + HORA)];
    expect(resolverViejo(votos, 'ana', T0 + DELETION_TIMEOUT_MS * 2)).toBe(false);
  });

  it('nuestra restauración frena en el peer viejo', () => {
    const votos = [fuerza('ana', T0), restaura('beto', T0 + HORA)];
    expect(resolverViejo(votos, 'ana', T0 + 2 * HORA)).toBe(false);
  });

  /**
   * `withdraw` sí puede ser una acción nueva: para el peer viejo es un voto que
   * no dice nada, y "no dice nada" ES el resultado correcto — mi pedido
   * desaparece por el colapso por persona y el de los demás sigue en pie.
   */
  it('nuestro retiro deja la ronda del otro viva también en el peer viejo', () => {
    const votos = [pide('beto', T0), pide('caro', T0 + HORA), retira('beto', T0 + 2 * HORA)];

    expect(resolverViejo(votos, 'ana', T0 + 2 * HORA)).toBe(false);
    expect(resolverViejo(votos, 'ana', T0 + HORA + DELETION_TIMEOUT_MS + 1)).toBe(true);
  });

  it('y mi retiro no borra el gasto por su cuenta en el peer viejo', () => {
    const votos = [pide('beto', T0), retira('beto', T0 + HORA)];
    expect(resolverViejo(votos, 'ana', T0 + DELETION_TIMEOUT_MS * 2)).toBe(false);
  });
});

/**
 * **Nada deja de aplicarse por no verificar** (R1 del PO, invariante de S6 que
 * S7 mantuvo y S8 no puede romper). La firma del voto existe para MARCAR y
 * medir, nunca para descartar: un voto que no cierra sigue contando, y la
 * atribución de quién lo emitió es lo que se muestra.
 */
describe('un voto que no verifica cuenta igual', () => {
  const conFirmaFalsa = (v: DeletionVote): DeletionVote => ({ ...v, k: 'ff'.repeat(32), s: '00'.repeat(64) });

  it('una objeción con firma que no cierra frena la ronda lo mismo', () => {
    const e = gasto([pide('beto', T0), conFirmaFalsa(objeta('caro', T0 + HORA))]);

    expect(deletionRound(e)!.status).toBe('objected');
    expect(resolveDeletionVotes(e, [], T0 + DELETION_TIMEOUT_MS * 2)).toBe(false);
  });

  it('y un pedido con firma que no cierra abre la ronda lo mismo', () => {
    const e = gasto([conFirmaFalsa(pide('beto', T0))]);

    expect(deletionRound(e)!.requestedBy).toBe('beto');
    expect(resolveDeletionVotes(e, [], T0 + DELETION_TIMEOUT_MS + 1)).toBe(true);
  });

  it('el override del creador se honra aunque su firma no cierre (R3)', () => {
    const e = gasto([conFirmaFalsa(fuerza('ana', T0))]);
    expect(resolveDeletionVotes(e, [], T0 + 1)).toBe(true);
  });
});

describe('los votos se colapsan por (ronda, persona)', () => {
  it('el último voto de cada persona DENTRO de su ronda es el que vale', () => {
    const e = gasto([pide('beto', T0), objeta('caro', T0 + HORA), pide('caro', T0 + 2 * HORA)]);
    expect(deletionRound(e)!.status).toBe('open');
  });

  /**
   * Un voto de una ronda anterior no puede frenar la ronda de ahora: cada
   * enunciado se firma CONTRA su `roundId` (§5), así que sacarlo de su ronda
   * es tan inválido como cambiarle el monto.
   */
  it('la objeción de una ronda vieja no frena la ronda nueva', () => {
    const e = gasto([objeta('caro', T0, 'r0'), pide('beto', T0 + HORA, 'r1')]);
    expect(deletionRound(e)!.status).toBe('open');
  });

  /**
   * Y tampoco le adelanta el vencimiento. El plazo se cuenta desde la apertura
   * de la ronda VIGENTE y no desde el voto más viejo del conjunto: si lo
   * segundo, un voto de una ronda anterior le comería horas de plazo a la de
   * ahora y el gasto se borraría antes de que a nadie se le venciera nada.
   */
  it('ni le adelanta el vencimiento', () => {
    const e = gasto([objeta('caro', T0, 'r0'), pide('beto', T0 + 2 * HORA, 'r1')]);

    expect(resolveDeletionVotes(e, [], T0 + DELETION_TIMEOUT_MS + HORA)).toBe(false);
    expect(resolveDeletionVotes(e, [], T0 + 2 * HORA + DELETION_TIMEOUT_MS + 1)).toBe(true);
  });

  /**
   * Colapsar por persona a secas —sin la ronda— deja que un voto de una ronda
   * vieja pise el de la de ahora cuando su `votedAt` es mayor. No es hipotético:
   * `votedAt` sale del `Date.now()` del que vota (deuda anterior a T-041,
   * anotada como Q4), así que un teléfono con el reloj adelantado produce
   * exactamente este conjunto. Con la clave `(ronda, persona)` los dos votos
   * sobreviven y cada uno cuenta en su ronda.
   */
  it('un voto de una ronda vieja no pisa el pedido nuevo de la misma persona', () => {
    const e = gasto([objeta('beto', T0 + 5 * HORA, 'r0'), pide('beto', T0, 'r1')]);
    const r = deletionRound(e);

    expect(r).not.toBeNull();
    expect(r!.status).toBe('open');
    expect(r!.requestedBy).toBe('beto');
  });

  /**
   * **Entre rondas gana la que abrió más tarde** (§5 del plan). Una ronda vieja
   * no puede revivir —con su objeción incluida— cuando alguien vuelve a pedir.
   */
  it('entre dos rondas manda la que abrió más tarde', () => {
    const e = gasto([
      pide('beto', T0, 'r0'), objeta('dana', T0 + HORA, 'r0'),
      pide('caro', T0 + 2 * HORA, 'r1'),
    ]);
    const r = deletionRound(e)!;

    expect(r.roundId).toBe('r1');
    expect(r.requestedBy).toBe('caro');
    expect(r.status).toBe('open');
  });
});
