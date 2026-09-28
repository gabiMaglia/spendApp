import { createStorage, type SimpleStorage } from '@/src/utils/createStorage';

/**
 * T-215: contador de re-renders para chequeo manual del PO en el teléfono.
 *
 * DEV-ONLY de punta a punta. No es telemetría ni un store — vive fuera de
 * React (mismo espíritu que `useLiveValue`), en memoria de módulo, y sólo
 * corre si `__DEV__` es `true`. Cada función empieza con ese guard, así que
 * en un build de producción queda en no-op puro sin acumular estado ni
 * abrir el bucket de MMKV.
 *
 * El flag NO es por cuenta (`dev_render_log_v1` sin scope de usuario, mismo
 * patrón que `themeStore`/`langStore`): es una preferencia del DISPOSITIVO
 * para diagnosticar, no un dato de la cuenta.
 */

const FLAG_KEY = 'dev_render_log_v1';
const INTERVALO_MS = 2000;

type Entrada = { renders: number; ultimo: number; motivos: Map<string, number> };

const estado = new Map<string, Entrada>();

let bucket: SimpleStorage | null = null;
function storage(): SimpleStorage {
  if (!bucket) bucket = createStorage('dev-render-log');
  return bucket;
}

let intervalo: ReturnType<typeof setInterval> | null = null;

/** Flag efectivo: sólo en dev, y sólo si está persistido o forzado por env. */
export function activo(): boolean {
  if (!__DEV__) return false;
  if (process.env.EXPO_PUBLIC_RENDER_LOG === '1') return true;
  return storage().getBoolean(FLAG_KEY) === true;
}

/** Prende/apaga el flag persistido y, con él, el emisor de resúmenes. */
export function setActivo(valor: boolean): void {
  if (!__DEV__) return;
  storage().set(FLAG_KEY, valor);
  if (activo()) iniciarEmisor();
  else detenerEmisor();
}

/** Cuenta un render de `nombre`, opcionalmente con el motivo (qué dep cambió). */
export function registrarRender(nombre: string, motivo?: string): void {
  if (!__DEV__) return;
  let e = estado.get(nombre);
  if (!e) {
    e = { renders: 0, ultimo: 0, motivos: new Map() };
    estado.set(nombre, e);
  }
  e.renders += 1;
  e.ultimo = Date.now();
  if (motivo) e.motivos.set(motivo, (e.motivos.get(motivo) ?? 0) + 1);
}

/** Foto del estado acumulado, agregado por nombre. */
export function resumen(): Array<{ nombre: string; renders: number; motivos: Record<string, number> }> {
  return [...estado.entries()].map(([nombre, e]) => ({
    nombre,
    renders: e.renders,
    motivos: Object.fromEntries(e.motivos),
  }));
}

/** Olvida todo lo acumulado (no toca el flag ni el emisor). */
export function reset(): void {
  estado.clear();
}

function formatearMotivos(motivos: Map<string, number>): string {
  const partes = [...motivos.entries()].map(([m, n]) => `${m}×${n}`);
  return partes.length > 0 ? ` (${partes.join(', ')})` : '';
}

/**
 * Vuelca lo acumulado DESDE EL ÚLTIMO VOLCADO: una línea por componente con
 * renders desde entonces, y limpia el acumulado de esa ventana. Un componente
 * que no re-renderizó en los últimos 2s no imprime nada.
 */
function volcar(): void {
  for (const [nombre, e] of estado) {
    if (e.renders === 0) continue;
    // eslint-disable-next-line no-console
    console.info(`[renders] ${nombre}: ${e.renders}${formatearMotivos(e.motivos)}`);
    e.renders = 0;
    e.motivos.clear();
  }
}

function iniciarEmisor(): void {
  if (intervalo) return;
  intervalo = setInterval(volcar, INTERVALO_MS);
  // No existe en RN (el timer es un número, no un `Timeout`); opcional, para
  // que un test con fake timers no deje el proceso de Jest colgado.
  (intervalo as unknown as { unref?: () => void }).unref?.();
}

function detenerEmisor(): void {
  if (intervalo) {
    clearInterval(intervalo);
    intervalo = null;
  }
}

// Al importar: si el flag ya venía prendido (persistido de una sesión
// anterior, o forzado por env), el emisor arranca solo — no hace falta
// re-tocar el switch para que retome.
if (activo()) iniciarEmisor();
