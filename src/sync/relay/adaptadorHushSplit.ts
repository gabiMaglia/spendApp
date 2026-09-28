import { applyDelta, type SyncDelta } from '../useSyncQR';
import { acotarDeltaAlGrupo, type Descartados, type DescartesPorDependencia } from '../acotarDeltaAlGrupo';
import { sinAvatarUrl, sinCamposLocales } from '../soloLocal';
import { publishAvatarIfOwn } from '../avatarTopic';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { useCommentStore } from '@/src/store/commentStore';
import { createStorage } from '@/src/utils/createStorage';
import { readScoped, writeScoped, deleteScoped } from '@/src/store/userScope';
import { digestOfJson } from '../manifest';

/**
 * Frontera núcleo / adaptador (T-191, spec §2.4).
 *
 * El núcleo de `src/sync/relay/` (cubos, ledger, rebanadas aplicadas,
 * relectura) trabaja sobre un documento genérico — sólo sabe que cada campo
 * es una lista de `{ id: string }` — y no conoce HushSplit. Lo específico
 * (los stores de Zustand, el modelo de `SyncDelta`, la elisión de fotos) vive
 * ACÁ, y es la ÚNICA excepción al guard de frontera P15
 * (`relayFrontera.guard.test.ts`): este archivo SÍ puede importar
 * `@/src/store/*`.
 *
 * Nada de esto cambia de comportamiento respecto de lo que hacía
 * `relaySync.ts` antes de T-191 — es el mismo código, con otro nombre y otro
 * lugar (Task 0 del plan: refactor de frontera, cero cambio de
 * comportamiento). `relaySync.ts` pasa a ser el que enchufa núcleo +
 * adaptador.
 */

/** Documento genérico que ve el núcleo: campo → lista de registros con `id`. */
export type Documento = Record<string, { id: string }[]>;

/**
 * Campos de `SyncDelta` que se rebanan, en orden de DEPENDENCIA (spec §8,
 * C2): `groups` antes que `users` (la pertenencia de un perfil se resuelve
 * contra la membresía del grupo), `expenses` antes que `comments` (un
 * comentario cuelga de un gasto). `payments` y `recurring` no dependen de
 * nada más que de `groups` y pueden ir en cualquier posición intermedia.
 *
 * Es un orden DISTINTO del que usaba `SLICED_FIELDS` en `relaySync.ts` antes
 * de T-191 (`groups, expenses, payments, users, recurring, comments`) — ver
 * el reporte de Task 0: el orden viejo garantizaba la dependencia por POSICIÓN
 * en un único envío ordenado; con rebanadas incrementales (Task 2/3) cada
 * campo se publica en su propio ritmo, así que la garantía pasa a vivir en
 * `drainGroup` (retener y reaplicar al final, C2), y este array queda como la
 * declaración explícita de qué depende de qué — la consume el receptor para
 * decidir qué rebanadas puede aplicar antes.
 */
export const campos = ['groups', 'users', 'expenses', 'payments', 'recurring', 'comments'] as const;

/**
 * Arma el documento del grupo: sólo lo que le pertenece a `groupId`, leído
 * directo de los stores. Es `buildGroupPayload` de antes de T-191, menos el
 * sobre (`version`/`featureVersion`/`fromUserId`/`timestamp`) — eso lo pone
 * quien envuelve cada rebanada (`envolver`) o el delta completo
 * (`relaySync.ts#buildGroupPayload`, que sigue existiendo para el QR/pairing
 * y para diagnóstico).
 *
 * El orden de las claves del objeto que devuelve es
 * `groups, expenses, payments, users, recurring, comments` — el orden
 * HISTÓRICO de `SyncDelta`, no el de `campos` (dependencia) — a propósito:
 * `relayScopeFiltraPrimero.test.ts` compara el JSON de `buildGroupPayload`
 * byte a byte contra una fixture con ese orden exacto, y cambiar el orden de
 * las claves cambiaría esos bytes sin cambiar nada real. `campos` es un
 * concepto aparte (para qué orden aplicar rebanadas), no el de serialización
 * del delta completo.
 */
export function armar(groupId: string, currentUserId: string): Documento {
  const delGrupo = useGroupStore.getState().groups.filter(g => g.id === groupId);
  const miembros = new Set(delGrupo[0]?.memberIds ?? []);

  const expenses = sinCamposLocales(
    useExpenseStore.getState().expenses.filter(e => e.groupId === groupId),
  );
  const idsDeGastos = new Set(expenses.map(e => e.id));

  return {
    groups: delGrupo,
    expenses,
    payments: usePaymentStore.getState().payments.filter(p => p.groupId === groupId),
    users: sinAvatarUrl(useUserStore.getState().users.filter(u => miembros.has(u.id)))
      .map(u => ({ ...u, email: '' })),
    recurring: useRecurringStore.getState().recurring.filter(r => r.groupId === groupId),
    comments: useCommentStore.getState().comments.filter(c => idsDeGastos.has(c.expenseId)),
  };
}

/**
 * Envuelve la porción de UN campo como el `SyncDelta` que `aplicar` (y, del
 * otro lado del relay, `applyDelta`) esperan — si no, `applyDelta` descarta
 * el sobre entero por no tener `version: 1` (spec §8, respuesta (6)).
 *
 * `fromUserId` no se puede derivar de `campo`/`registros`: lo provee quien
 * arma el cierre (`relaySync.ts`), que sí sabe qué dispositivo/usuario está
 * publicando. El resto de los campos rebanables va vacío — cada sobre trae
 * SÓLO su porción.
 *
 * `timestamp` es fijo en `0`, nunca `Date.now()` (spec §7 C1): el JSON tiene
 * que ser determinista entre dos armados sin cambios, para que el digest de
 * dos publicaciones idénticas coincida y `sliceLedger` no reenvíe nada. El
 * campo sigue siendo obligatorio en el tipo `SyncDelta` (nadie lo lee en el
 * merge — `applyDelta`/`acotarDeltaAlGrupo` no tocan `timestamp`), así que
 * "ausente" no es una opción sin tocar el tipo; "constante" alcanza.
 */
export function envolver(campo: string, registros: { id: string }[], fromUserId: string): SyncDelta {
  return {
    version: 1,
    featureVersion: 2,
    fromUserId,
    timestamp: 0,
    groups: [], expenses: [], payments: [], users: [],
    [campo]: registros,
  } as SyncDelta;
}

/**
 * Aplica un `SyncDelta` ya acotado a los stores — llama a `applyDelta`
 * (`useSyncQR.ts`) directo, sin envolver nada más: es el mismo gate de S6
 * (`mergeGate.test.ts`) que antes se invocaba desde `relaySync.ts`, sólo un
 * salto de indirección más lejos. `relaySync.ts` sigue siendo la única
 * "puerta" que este módulo alcanza, y `mergeGate.test.ts` verifica los dos
 * extremos: que `relaySync.ts` llama a `adaptador.aplicar(` y que ESTE
 * archivo llama a `applyDelta(` — no hay forma de mergear sin pasar por acá.
 */
export function aplicar(delta: SyncDelta, currentUserId: string): void {
  applyDelta(delta, currentUserId);
}

export type Descartes = { porTope: number; porDependencia: number; motivos: string[] };

/**
 * Acota un delta recibido a lo que `groupId` puede legítimamente traer —hoy
 * `acotarDeltaAlGrupo`— y separa los descartes en dos cuentas (spec §8, C2):
 *
 *  - `porTope`: registros descartados por `topes.ts` (tamaño). Permanentes:
 *    nunca se reintentan solos, el emisor tendría que mandar un registro más
 *    chico.
 *  - `porDependencia`: comentarios sin su gasto todavía local y perfiles de
 *    usuarios que todavía no son miembro local — exactamente los dos casos
 *    que `acotarDeltaAlGrupo.ts:154-164` tira HOY sin contarlos. Estos SÍ se
 *    reintentan: `drainGroup` retiene la rebanada y la reaplica al final del
 *    drenaje, una vez que `groups`/`expenses` de la misma publicación ya
 *    entraron.
 *
 * El resto de los descartes de `acotarDeltaAlGrupo` (robo de id entre grupos,
 * reasignación de comentario ajeno) son de seguridad, no de dependencia: no
 * se resuelven reaplicando más tarde, así que no entran en `porDependencia`.
 */
export function acotar(
  delta: SyncDelta,
  groupId: string,
): { delta: SyncDelta; descartes: Descartes } {
  const tope: Descartados = { count: 0, motivos: [] };
  const dependencia: DescartesPorDependencia = { count: 0 };
  const acotado = acotarDeltaAlGrupo(delta, groupId, undefined, tope, dependencia);

  return {
    delta: acotado,
    descartes: {
      porTope: tope.count,
      porDependencia: dependencia.count,
      motivos: tope.motivos,
    },
  };
}

/**
 * Efecto previo a publicar (spec §8, respuesta (6)): reemplaza el `avatar` de
 * cada usuario por su `avatarDigest` (la foto viaja por su propio topic,
 * `avatarTopic.ts`) y, si el usuario propio cambió de foto, la publica ahí.
 * Hoy vivía inline en `buildSlicedEnvelopes` (`relaySync.ts`).
 *
 * Devuelve un Documento nuevo — no muta el que recibe — con `users`
 * reemplazado; el resto de los campos vuelve tal cual.
 */
export async function antesDePublicar(
  doc: Documento,
  ctx: { groupId: string; deviceId: string; fromUserId: string },
): Promise<Documento> {
  const usuariosConDigest = await Promise.all(
    (doc.users ?? []).map(async (u) => {
      const usuario = u as { id: string; avatar?: string; avatarDigest?: string; [k: string]: unknown };
      if (usuario.id !== ctx.fromUserId) {
        if (!usuario.avatar) return usuario;
        const { avatar: _avatarAjeno, ...sinFotoAjena } = usuario;
        return sinFotoAjena;
      }
      if (!usuario.avatar) return usuario;
      const digest = await digestOfJson(usuario.avatar);
      await publishAvatarIfOwn(ctx.groupId, ctx.fromUserId, ctx.deviceId);
      const { avatar: _avatar, ...sinFoto } = usuario;
      return { ...sinFoto, avatarDigest: digest };
    }),
  );
  return { ...doc, users: usuariosConDigest as { id: string }[] };
}

/**
 * Puerto de almacenamiento para el núcleo (ledger de rebanadas publicadas,
 * rebanadas aplicadas): `get`/`set`/`delete` por clave arbitraria, scopeado
 * por cuenta (`userScope.ts`) — el núcleo no importa `userScope` directo
 * (rompería el guard P15), así que recibe esto ya resuelto.
 *
 * Namespace propio (`sync-relay-core`), distinto del bucket `slice-renewal`
 * que sigue usando `sliceRenewal.ts` para las fotos (spec §8: no se
 * reemplaza, queda un mecanismo aparte).
 */
const storageNucleo = createStorage('sync-relay-core');

export const almacen = {
  get(k: string): string | undefined {
    return readScoped(storageNucleo, k);
  },
  set(k: string, v: string): void {
    writeScoped(storageNucleo, k, v);
  },
  delete(k: string): void {
    deleteScoped(storageNucleo, k);
  },
};
