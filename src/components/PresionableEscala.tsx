import React, { useState } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { usePresion } from '@/src/hooks/usePresion';

const PressableAnimado = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style'> & {
  /** Igual que en `Pressable`: un estilo, o una función del estado `pressed`. */
  style?: StyleProp<ViewStyle> | ((e: { pressed: boolean }) => StyleProp<ViewStyle>);
};

/**
 * `Pressable` con el feedback de presión de la marca (escala + resorte, T-289).
 * Es la base de ActionButton, Fab y las filas/tarjetas tocables: así la escala se
 * escribe una vez y respeta «reducir movimiento» en un solo lugar.
 */
export const PresionableEscala = React.forwardRef<React.ComponentRef<typeof Pressable>, Props>(
  function PresionableEscala({ style, onPressIn, onPressOut, ...resto }, ref) {
    const { alPresionar, alSoltar, estiloEscala } = usePresion();
    const [pressed, setPressed] = useState(false);
    const base = typeof style === 'function' ? style({ pressed }) : style;
    const sigueElEstado = typeof style === 'function';

    return (
      <PressableAnimado
        ref={ref}
        {...resto}
        onPressIn={e => { alPresionar(); if (sigueElEstado) setPressed(true); onPressIn?.(e); }}
        onPressOut={e => { alSoltar(); if (sigueElEstado) setPressed(false); onPressOut?.(e); }}
        style={[base, estiloEscala]}
      />
    );
  },
);
