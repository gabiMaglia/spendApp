import { useContext } from 'react';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';


/**
 * Cuánto tiene que dejar libre abajo una pestaña por la barra.
 *
 * Desde T-276 la barra es una píldora flotante (absoluta) en ambos skins, así
 * que el contenido y los FABs suman su alto. Fuera de las pestañas no hay
 * barra (el contexto es `undefined`): 0.
 */
export function useRellenoBarraPestanas(): number {
  return useContext(BottomTabBarHeightContext) ?? 0;
}
