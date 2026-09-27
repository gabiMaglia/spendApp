import { canonical } from '@/src/store/lww';
import { envenenado } from '@/src/store/relojDelMerge';
import type { Group } from '@/src/types/models';

/**
 * **Roster por miembro, no por lista** (T-182, simplificado — PO 2026-09-27:
 * «olvidate de los miembros maliciosos, es una app de gastos», sin firma).
 *
 * `memberIds` era una lista ENTERA en el nivel «resto» del merge y ganaba el
 * `updatedAt` mayor (`mergeLevels.ts`, `restoWins`). Eso arma una carrera
 * honesta: si X sale en el teléfono A (t=10) y el teléfono B, sin ver esa
 * salida, renombra el grupo con `updatedAt` t=11, B publica su lista vieja
 * ENTERA —con X adentro— y le gana al merge por fecha. X vuelve a aparecer
 * en todos, o al revés, un alta concurrente se pierde.
 *
 * Acá cada miembro es su propia clave: `unirMiembros` compara `at` POR
 * PERSONA, así que un cambio de nombre nunca puede pisar una salida de
 * otro miembro — son campos distintos del mismo mapa, no una lista que se
 * reemplaza entera. `memberIds` pasa a ser DERIVADO (`rosterDe`); nadie más
 * lo escribe a mano (guard: `memberIdsWriters.guard.test.ts`).
 */

type Miembros = Group['miembros'];
type Entrada = Miembros[string];

/**
 * Une dos rosters por clave: gana el `at` mayor, por miembro. Un `at` que no
 * pudo haber pasado todavía (tope de reloj, T-144) se ignora — ni entra como
 * alta/baja nueva ni le gana a lo que ya había. Empate exacto de `at`: se
 * desempata por contenido canónico, igual que el resto del merge por
 * niveles, para que dos dispositivos que unen los mismos sobres en distinto
 * orden lleguen al mismo roster (R7).
 */
export function unirMiembros(a: Miembros | undefined, b: Miembros | undefined, now: number): Miembros {
  const out: Miembros = { ...(a ?? {}) };
  for (const [userId, entrante] of Object.entries(b ?? {})) {
    if (envenenado(entrante.at, now)) continue;
    const actual: Entrada | undefined = out[userId];
    const ganaEntrante = !actual
      || envenenado(actual.at, now)
      || entrante.at > actual.at
      || (entrante.at === actual.at && canonical(entrante) > canonical(actual));
    if (ganaEntrante) out[userId] = entrante;
  }
  return out;
}

/** Los `'in'` del roster, en orden estable por `at` y después por id. */
export function rosterDe(miembros: Miembros): string[] {
  return Object.entries(miembros)
    .filter(([, entrada]) => entrada.estado === 'in')
    .sort(([idA, entradaA], [idB, entradaB]) =>
      entradaA.at - entradaB.at || (idA < idB ? -1 : idA > idB ? 1 : 0))
    .map(([id]) => id);
}

function conEstado(g: Group, userId: string, estado: 'in' | 'out', at: number): Group {
  const miembros: Miembros = { ...g.miembros, [userId]: { estado, at } };
  return { ...g, miembros, memberIds: rosterDe(miembros) };
}

/** El grupo `g` con `userId` dado de alta a partir de `at`. */
export function conAlta(g: Group, userId: string, at: number): Group {
  return conEstado(g, userId, 'in', at);
}

/** El grupo `g` con `userId` dado de baja a partir de `at`. */
export function conBaja(g: Group, userId: string, at: number): Group {
  return conEstado(g, userId, 'out', at);
}
