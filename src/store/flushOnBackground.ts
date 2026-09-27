import { AppState, type AppStateStatus } from 'react-native';
import { flushScopedWrites } from './userScope';

/**
 * Vacía YA toda escritura diferida (T-156) cuando la app deja el primer
 * plano. Sin esto, una escritura programada hace menos de 300ms antes de
 * que el usuario minimice la app se perdería: no hay garantía de que el
 * timer llegue a correr con la app en background (fila U2 de la tabla).
 *
 * Se engancha una vez en el root layout, igual que `subscribeSessionRehydrate`.
 * Devuelve el unsubscribe.
 */
export function registrarVaciadoEnBackground(): () => void {
  const sub = AppState.addEventListener('change', (estado: AppStateStatus) => {
    if (estado === 'background' || estado === 'inactive') flushScopedWrites();
  });
  return () => sub.remove();
}
