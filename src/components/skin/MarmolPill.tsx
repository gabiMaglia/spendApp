import React, { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { FondoMarmol } from '@/src/components/FondoMarmol';
import { useSkin } from '@/src/skins/useSkin';

/**
 * **Píldora de mármol**: el navegador de mes y el encabezado de Movimientos.
 *
 * Con el skin default dibuja lo de hoy: una vista con el mármol de fondo y
 * los hijos encima (`style` y `testID` son los de quien llama).
 *
 * Con un skin `soft`: la misma vista pasa a ser una píldora con margen
 * lateral, radio, mármol atenuado y un velo para que el texto se lea.
 * `sticky`: el mármol va opaco, sin sombra, y el margen alrededor se pinta
 * con el fondo — la lista que pasa por debajo nunca se transparenta
 * (invariante de `MovimientosHeader`).
 */
export function MarmolPill({
  children, patron, variante, sticky, style, testID,
}: {
  children: React.ReactNode;
  patron?: 'header' | 'distendida' | 'franja';
  variante?: boolean;
  sticky?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { skin, degradado } = useSkin();
  const c = skin.colors;
  // Memoizado: `FondoMarmol` es `React.memo` y un literal nuevo por render lo anularía.
  const marmolStyle = useMemo(
    () => ({ opacity: sticky ? 1 : c.marmolOpacity }),
    [sticky, c.marmolOpacity],
  );

  if (!skin.flags.soft) {
    return (
      <View testID={testID} style={style}>
        <FondoMarmol patron={patron} variante={variante} />
        {children}
      </View>
    );
  }

  const sombra = sticky || degradado ? null : { boxShadow: skin.elevation.e1.boxShadow };

  return (
    <View
      style={[
        { paddingHorizontal: skin.space.inset, paddingTop: skin.space.gapPanel },
        sticky && { backgroundColor: c.bg },
      ]}
    >
      <View style={[{ borderRadius: skin.radius.panel, backgroundColor: c.surface }, sombra]}>
        <View
          testID={testID}
          style={[
            { borderRadius: skin.radius.panel, overflow: 'hidden', borderTopWidth: 1, borderTopColor: c.edgeLight },
            style,
          ]}
        >
          <FondoMarmol patron={patron} variante={variante} style={marmolStyle} />
          <View
            testID="marmol-veil"
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: c.marmolVeil }]}
          />
          {children}
        </View>
      </View>
    </View>
  );
}
