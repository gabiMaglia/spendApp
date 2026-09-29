import { StyleSheet } from 'react-native';

import { Radius } from '@/src/constants/spacing';

/** La caja de las dos bandas de Saldar (transferencia; grupo y fecha). */
export const estilos = StyleSheet.create({
  card: { borderRadius: Radius.xl, borderCurve: 'continuous', borderWidth: 1, overflow: 'hidden' },
});
