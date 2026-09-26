import React, { useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSkin } from '@/src/skins/useSkin';
import { PanelContext } from './PanelContext';

/**
 * **Panel del skin**: superficie redondeada, suspendida sobre el fondo, con
 * sombra difusa, filo de luz arriba y —con `halo`— glow de marca.
 *
 * Con un skin que no es `soft` (el default) devuelve los hijos sin nada
 * alrededor: la pantalla queda exactamente como antes.
 *
 * Dos `View`: la de afuera lleva la sombra (una sombra se recorta si la misma
 * vista tiene `overflow: hidden`), la de adentro recorta el contenido al radio.
 */
export function Panel({
  children, nivel = 'e1', halo, style, testID = 'skin-panel',
}: {
  children: React.ReactNode;
  nivel?: 'e1' | 'e2';
  halo?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { skin, degradado } = useSkin();
  const contexto = useMemo(() => ({ sunkenBg: skin.colors.bgGrouped }), [skin]);

  if (!skin.flags.soft) return <>{children}</>;

  const c = skin.colors;
  const e = skin.elevation[nivel];
  const sombra: ViewStyle = degradado
    ? { elevation: e.elevationFallback, borderWidth: 1, borderColor: c.hair }
    : { boxShadow: halo ? `${e.boxShadow}, 0 0 28px ${c.glow}` : e.boxShadow };

  return (
    <View
      testID={testID}
      style={[
        {
          marginHorizontal: skin.space.inset,
          marginTop: skin.space.gapPanel,
          borderRadius: skin.radius.panel,
          backgroundColor: c.surface,
        },
        sombra,
        style,
      ]}
    >
      <View
        style={{
          flexGrow: 1,
          borderRadius: skin.radius.panel,
          overflow: 'hidden',
          borderTopWidth: degradado ? 0 : 1,
          borderTopColor: c.edgeLight,
        }}
      >
        <PanelContext.Provider value={contexto}>{children}</PanelContext.Provider>
      </View>
    </View>
  );
}
