import { create } from 'zustand';

/**
 * T-147 (fila 9, decisión del PO 2026-09-27): estado de la verificación
 * bloqueante de entrada. Vive en un store aparte (no en `authStore`) porque
 * es un dato de ESTE arranque, no de la cuenta — nunca se persiste, y se
 * reinicia en cada verificación.
 *
 * - `ninguna`: nunca se pidió (todavía no hay usuario, o no aplica).
 * - `chequeando`: hidratación inicial mirando si ya hay sesión del buzón
 *   (fila 9c vs 9e) — `AuthGuard` no navega mientras tanto, para no mostrar
 *   un flash de tabs ni de la pantalla de verificación.
 * - `pendiente`: hace falta verificar antes de pasar a tabs (`AuthGuard` va a
 *   `/auth/verify`).
 * - `lista`: verificación resuelta (ok) u omitida a propósito — `AuthGuard`
 *   deja pasar a tabs.
 */
export type EntryGateEstado = 'ninguna' | 'chequeando' | 'pendiente' | 'lista';

interface EntryGateState {
  estado: EntryGateEstado;
  chequear: () => void;
  pedirVerificacion: () => void;
  marcarLista: () => void;
}

export const useEntryGateStore = create<EntryGateState>((set) => ({
  estado: 'ninguna',
  chequear: () => set({ estado: 'chequeando' }),
  pedirVerificacion: () => set({ estado: 'pendiente' }),
  marcarLista: () => set({ estado: 'lista' }),
}));

/** Sólo tests. */
export function __resetEntryGate(): void {
  useEntryGateStore.setState({ estado: 'ninguna' });
}
