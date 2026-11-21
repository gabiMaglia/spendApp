import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { baseInferior } from '@/src/components/skin/medidasBarraPestanas';

/** Base de la botonera del pie = `bottom` de la píldora de pestañas (T-281). */
export function useBaseInferior(): number {
  const { bottom } = useSafeAreaInsets();
  return baseInferior(bottom, Platform.OS === 'ios' ? 'ios' : 'android');
}
