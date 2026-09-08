import { useAuthStore, forgetAccount } from '@/src/store/authStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { barrerScope, olvidarFusionesDe } from '@/src/store/accountLink';
import { purgeUser } from '@/src/store/tierStore';
import { readJournal, writeJournal, clearJournal, type DeleteJournal } from '@/src/store/deleteJournal';
import { deleteMyEnvelopes } from '@/src/sync/relay';
import { olvidarCursor } from '@/src/sync/relayEngine';
import { destruirIdentidadDelAparato } from '@/src/store/identityStore';
import { clearErrors } from './errorLog';
import { anonymizeSelf } from './anonymizeSelf';
import { topicsDeLaCuenta } from './deleteTopics';

/**
 * Borrado de cuenta (T-074). Requisito duro de las dos tiendas.
 *
 * **Lo que hace que esto sea difícil no es qué borrar: es el ORDEN**, y que el
 * orden se pueda interrumpir. Dos restricciones lo gobiernan, y las dos vienen
 * de que la prenda del buzón vive en el aparato (ADR-009):
 *
 *  1. **Los topics se derivan ANTES de borrar**, porque salen de claves que el
 *     borrado destruye.
 *  2. **La prenda se destruye DESPUÉS de purgar el buzón, nunca antes.** Al
 *     revés no hay vuelta atrás: sin la prenda, esos sobres sólo los levanta el
 *     TTL de 30 días. Ya pasó una vez con `wipeAllAccounts()`.
 *
 * Y una regla de producto que las tiendas tampoco negocian: **el borrado local
 * procede aunque no haya red.** Un borrado que se cuelga esperando internet no
 * es un borrado. Lo que quede sin purgar queda anotado en el diario y se
 * reintenta al arrancar.
 */

/** Presupuesto de red de la fase 2. Se agota y se sigue borrando igual. */
export const TIMEOUT_PURGA_MS = 10_000;

export type DeleteProgress = { fase: 'preparando' | 'purgando' | 'borrando' };

export type DeleteOutcome = {
  ok: true;
  topicsPurgados: number;
  /** > 0 ⇒ quedó buzón sin purgar; se reintenta al arrancar. */
  topicsPendientes: number;
  prendaDestruida: boolean;
};

const SIN_CUENTA: DeleteOutcome = {
  ok: true, topicsPurgados: 0, topicsPendientes: 0, prendaDestruida: false,
};

type Opciones = {
  onProgress?: (p: DeleteProgress) => void;
  timeoutMs?: number;
  /** El nombre anónimo que ven los peers. Lo traduce quien llama. */
  nombreAnonimo?: string;
};

/**
 * Borra la cuenta activa.
 *
 * **No lanza nunca**: un borrado que tira a mitad de camino deja al usuario sin
 * app y sin cuenta, y sin forma de reintentar.
 */
export async function deleteAccount(opts: Opciones = {}): Promise<DeleteOutcome> {
  const aviso = (fase: DeleteProgress['fase']) => {
    try { opts.onProgress?.({ fase }); } catch { /* la UI no puede frenar esto */ }
  };

  // ── Fase 0 · Preparar (sin red) ───────────────────────────────────────────
  aviso('preparando');
  const yo = useAuthStore.getState().currentUser;
  if (!yo) return SIN_CUENTA;

  const accountId = yo.id;
  const gruposDelScope = useGroupKeyStore.getState().keys.map(k => k.groupId);

  let pendientes: string[] = [];
  try {
    pendientes = await topicsDeLaCuenta();
  } catch {
    // Sin topics derivados no se puede purgar, pero el borrado local SÍ tiene
    // que ocurrir: es lo que la tienda exige y lo que el usuario pidió.
    pendientes = [];
  }

  const diario: DeleteJournal = {
    accountId,
    pendientes,
    purgados: 0,
    ultimaCuenta: esLaUltimaCuenta(accountId),
    startedAt: Date.now(),
  };
  // A partir de acá el borrado es reanudable.
  try { writeJournal(diario); } catch { /* sin diario se borra igual, sin reintento */ }

  // ── Fase 1 · Anunciar ─────────────────────────────────────────────────────
  // Va ANTES de purgar: publicar después volvería a llenar el buzón recién
  // vaciado. Best-effort — si no hay red, el aviso no sale y el borrado sigue.
  try {
    anonymizeSelf(opts.nombreAnonimo ?? 'Cuenta borrada');
    await conTimeout(publicarGrupos(gruposDelScope), opts.timeoutMs ?? TIMEOUT_PURGA_MS);
  } catch { /* el aviso es best-effort, por definición */ }

  // ── Fase 2 · Purgar el buzón ──────────────────────────────────────────────
  aviso('purgando');
  await conTimeout(purgar(diario), opts.timeoutMs ?? TIMEOUT_PURGA_MS);

  // ── Fase 3 · Borrar lo local (siempre, aunque la 2 haya fallado) ─────────
  aviso('borrando');
  borrarLoLocal(accountId);

  // ── Fase 4 · Destruir la identidad del aparato (sólo si corresponde) ─────
  const puedeDestruir = diario.ultimaCuenta && diario.pendientes.length === 0;
  if (puedeDestruir) {
    try { destruirIdentidadDelAparato(); } catch { /* no bloquea el borrado */ }
    /**
     * El registro de errores es del APARATO, no de la cuenta: no lleva el
     * sufijo `::u:` y por eso `barrerScope` de la fase 3 no lo ve (T-078 §5.1).
     * Se va acá, con la identidad, que es el otro dato de este mismo nivel — un
     * stack trace guardado puede nombrar cualquier cosa que hubiera en memoria,
     * así que sobrevivir al borrado de la última cuenta no es aceptable.
     */
    try { clearErrors(); } catch { /* … */ }
  }

  if (diario.pendientes.length === 0) {
    try { clearJournal(); } catch { /* … */ }
  }

  return {
    ok: true,
    topicsPurgados: diario.purgados,
    topicsPendientes: diario.pendientes.length,
    prendaDestruida: puedeDestruir,
  };
}

/**
 * Retoma un borrado interrumpido. Se llama en el arranque, sin bloquearlo.
 *
 * Idempotente: sin diario no hace nada y **no toca la red**.
 */
export async function resumePendingDeletion(): Promise<DeleteOutcome | null> {
  const diario = readJournal();
  if (!diario) return null;

  if (diario.pendientes.length > 0) {
    await purgar(diario);
  }

  const puedeDestruir = diario.ultimaCuenta && diario.pendientes.length === 0;
  if (puedeDestruir) {
    try { destruirIdentidadDelAparato(); } catch { /* … */ }
  }
  if (diario.pendientes.length === 0) {
    try { clearJournal(); } catch { /* … */ }
  }

  return {
    ok: true,
    topicsPurgados: diario.purgados,
    topicsPendientes: diario.pendientes.length,
    prendaDestruida: puedeDestruir,
  };
}

/**
 * Purga los topics del diario, **anotando después de cada uno**: si la app muere
 * en el medio, lo hecho no se repite.
 */
async function purgar(diario: DeleteJournal): Promise<void> {
  for (const topic of [...diario.pendientes]) {
    let r;
    try {
      r = await deleteMyEnvelopes(topic);
    } catch {
      continue;   // se reintenta después
    }

    if (r.ok) {
      quitar(diario, topic);
      diario.purgados += 1;
    } else if (r.reason === 'no_pledge') {
      // Este aparato no tiene con qué probar que escribió eso — reinstalación,
      // o sobres anteriores a T-088. Reintentarlo NO lo va a arreglar nunca:
      // sale de la lista y lo levanta el TTL de 30 días.
      quitar(diario, topic);
    } else if (r.reason === 'not_configured') {
      // Sin relay configurado no hay nada que purgar y reintentar cada topic es
      // ruido: se corta la fase entera y todo queda pendiente.
      break;
    }
    // 'network' ⇒ queda pendiente y se reintenta al arrancar.

    guardar(diario);
  }
  guardar(diario);
}

function quitar(diario: DeleteJournal, topic: string): void {
  diario.pendientes = diario.pendientes.filter(t => t !== topic);
  // Es el único momento en que se tiene el topic derivado: el cursor de
  // relectura que quedaría apuntando a un grupo sin clave se va con él.
  try { olvidarCursor(topic); } catch { /* basura, no un defecto */ }
}

function guardar(diario: DeleteJournal): void {
  try { writeJournal(diario); } catch { /* … */ }
}

/** El barrido local. Todo lo que lleva el id de la cuenta, de todos los buckets. */
function borrarLoLocal(accountId: string): void {
  // 1 · lo que lleva el sufijo `::u:` — la misma función que usa la purga de
  //     fusiones, no una copia (T-057).
  intentar(() => barrerScope(accountId));
  // 2 · el contador del tier: lleva el id EN EL MEDIO de la clave y el barrido
  //     por sufijo no lo ve.
  intentar(() => purgeUser(accountId));
  // 3 · el índice de identidad, o la cuenta «borrada» revive con el mismo id.
  intentar(() => forgetAccount(accountId));
  // 4 · el log de fusiones, que es una lista sin scope.
  intentar(() => olvidarFusionesDe(accountId));
  // 5 · la sesión.
  intentar(() => useAuthStore.getState().signOut());
}

function intentar(fn: () => void): void {
  try { fn(); } catch { /* ningún paso puede impedir los siguientes */ }
}

function esLaUltimaCuenta(accountId: string): boolean {
  try {
    const { known } = useAuthStore.getState().identitySnapshot();
    return known.every(a => a.accountId === accountId);
  } catch {
    // Ante la duda, NO es la última: conservar la prenda de más es basura;
    // destruirla de menos es irreversible.
    return false;
  }
}

/** Publica el aviso en cada grupo. Perezoso: `relayEngine` arrastra el motor. */
async function publicarGrupos(groupIds: string[]): Promise<void> {
  if (groupIds.length === 0) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { publishNow } = require('@/src/sync/relayEngine') as typeof import('@/src/sync/relayEngine');
  for (const id of groupIds) {
    /**
     * **`forzar` a propósito** (T-089): un grupo que este teléfono no drenó
     * tiene la publicación bloqueada, y acá eso dejaría el nombre y la foto de
     * la persona en el aparato de todos **para siempre**. Se acepta el riesgo
     * —este envío puede republicar estado viejo de ese grupo— porque la
     * alternativa es incumplir lo que la pantalla de borrado promete.
     */
    try { await publishNow(id, { forzar: true }); } catch { /* best-effort */ }
  }
}

/** El presupuesto de red. Al vencer se sigue: el usuario no espera a internet. */
function conTimeout(p: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    const t = setTimeout(resolve, ms);
    void p.then(() => { clearTimeout(t); resolve(); })
          .catch(() => { clearTimeout(t); resolve(); });
  });
}
