import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase del relay + tope de sobre (T-192: salió de `relay.ts`
 * para que `relaySend.ts` pueda importarlo sin crear un ciclo con `relay.ts`,
 * que a su vez re-exporta `sendEnvelope` de `relaySend.ts`).
 */

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Tope del sobre: **1 MB**, replicado como CHECK en la tabla y en la policy de
 * INSERT (`supabase/006_payload_limit.sql`, corrida por el PO el 2026-09-01).
 *
 * **Este número tiene que moverse junto con los dos del SQL, y el servidor
 * primero.** Al revés, la app cree que puede mandar 1 MB, choca contra un
 * servidor más chico y el publish falla.
 *
 * **OJO: el presupuesto real de datos NO es 1 MB, son ~786 KB.** Lo que se mide
 * acá es el payload que llega a `publish`, y ése ya viene en base64:
 * `sealEnvelope` devuelve base64 (`envelopeCrypto.ts:61`), así que el JSON se
 * infla ×4/3 ANTES de compararse contra este número. Costó descubrirlo dos
 * veces (T-056/T-058) y no estaba escrito en ningún lado.
 *
 * **De dónde salían los 256 KB viejos:** de una línea del engram marcada «no
 * verificados, verificar en el spike», heredada de los límites de Supabase
 * *Realtime* — y los sobres no viajan por Realtime, se leen por REST. Se probó
 * el proyecto real con sondas de 1 KB a 8 MB y ninguna dio 413. **El tope
 * siempre fue nuestro.**
 *
 * Medido con arné real —stores sembrados, sellado y firmado—, no estimado
 * (`__tests__/tamanoDelSobre.bench.test.ts`):
 *
 * | Grupo                          | En el cable | % del tope |
 * |--------------------------------|-------------|------------|
 * | 5 personas, 30 gastos          |    86 KB    |      8 %   |
 * | 5 personas, 200 gastos (6 m)   |   313 KB    |     31 %   |
 * | 5 personas, 700 gastos         |   982 KB    |     96 %   |
 * | 8 personas, 700 gastos         |  1190 KB    |    116 %   |
 *
 * O sea: **la pared se corrió de ~160 gastos a ~720, no desapareció.** El sobre
 * sigue creciendo O(gastos) y sigue habiendo un número a partir del cual el
 * grupo deja de sincronizar para siempre. El arreglo de fondo es ADR-007; la
 * solución NO es filtrar por fecha (el sobre lleva ESTADO a propósito, y tres
 * mecanismos dependen de eso).
 */
export const MAX_PAYLOAD_BYTES = 1_048_576;

export type Envelope = {
  seq: number;
  topic: string;
  payload: string;
  sender: string;
  created_at: string;
  // Ausente en un servidor sin la migración 010 (ADR-007): esas filas llegan
  // sin la columna, y el degradado es "no ckey" — igual que antes de que
  // existiera la compactación por ckey.
  ckey?: string;
};

let client: SupabaseClient | null = null;

/**
 * `null` si el relay no está configurado: la app tiene que seguir andando.
 *
 * **T-147 (D1):** la sesión se persiste — ya no es "la identidad la maneja la
 * app, no Supabase". Sin sesión persistida, cerrar el buzón a `authenticated`
 * (011b) cortaría el sync a todo el mundo en la segunda apertura de la app, no
 * sólo al invitado. El storage es el mismo cifrado at-rest que el resto de los
 * datos sensibles (`relaySession.supabaseAuthStorage`); el refresco automático
 * NO se deja en manos del SDK (`autoRefreshToken: false` acá) — lo maneja
 * `bindAuthRefreshToAppState`, atado a primer plano/fondo.
 */
export function getRelayClient(): SupabaseClient | null {
  if (!URL || !ANON) return null;
  if (!client) {
    // Import perezoso: `relaySession` importa `getRelayClient` de este mismo
    // archivo, y un `import` estático de arriba crearía un ciclo.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabaseAuthStorage } = require('./relaySession') as typeof import('./relaySession');
    client = createClient(URL, ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: supabaseAuthStorage(),
      },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

export function isRelayConfigured(): boolean {
  return Boolean(URL && ANON);
}
