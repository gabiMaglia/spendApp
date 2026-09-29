import { useContext } from 'react';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';

import { useSkinTokens } from '@/src/skins/useSkin';

/**
 * Cuánto tiene que dejar libre abajo una pestaña por la barra (T-227 punto 9).
 *
 * En Aero la barra flota sobre el contenido (`position: 'absolute'` en
 * `app/(tabs)/_layout.tsx`), así que el contenido y los FABs tienen que
 * sumar su alto. En Clásico la barra está en el flujo: React Navigation ya
 * corta el contenido arriba de ella y esto da 0. Fuera de las pestañas no
 * hay barra (el contexto es `undefined`): también 0.
 */
export function useRellenoBarraPestanas(): number {
  const soft = useSkinTokens().flags.soft;
  const alto = useContext(BottomTabBarHeightContext);
  return soft ? alto ?? 0 : 0;
}
