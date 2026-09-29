import React, { useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSkin } from '@/src/skins/useSkin';
import { PanelContext } from './PanelContext';

export type PanelSegmento = 'unica' | 'primera' | 'media' | 'ultima';

/**
 * Espacio reservado abajo del segmento `ultima`/`unica` para que la sombra
 * del panel (recortada por el envoltorio `overflow: hidden` de cada
 * segmento) no se corte de golpe — aproximado al blur del `boxShadow` de
 * nivel `e1` (T-154, Actividad segmentada por fila).
 */
const SOMBRA_ESPACIO = 12;

/**
 * **Panel del skin**: superficie redondeada, suspendida sobre el fondo, con
 * sombra difusa, filo de luz arriba y —con `halo`— glow de marca.
 *
 * Con un skin que no es `soft` (el default) devuelve los hijos sin nada
 * alrededor: la pantalla queda exactamente como antes.
 *
 * Dos `View`: la de afuera lleva la sombra (una sombra se recorta si la misma
 * vista tiene `overflow: hidden`), la de adentro recorta el contenido al radio.
 *
 * **`segmento`** (T-154): para listas virtualizadas donde cada FILA es su
 * propio ítem de FlashList (no se puede envolver a todas en un solo `Panel`
 * porque cada celda se recicla por separado) pero visualmente tienen que
 * leerse como UNA sola tarjeta continua — sólo la fila `primera`/`unica`
 * lleva el margen superior y el radio de arriba, sólo `ultima`/`unica` el
 * radio de abajo, y `media`/`ultima` llevan un divisor arriba (mismo look
 * que `BandStack`). Sin `segmento`, el comportamiento es EXACTAMENTE el de
 * siempre (panel completo, sin cambios).
 */
export function Panel({
  children, nivel = 'e1', halo, style, testID = 'skin-panel', segmento,
}: {
  children: React.ReactNode;
  nivel?: 'e1' | 'e2';
  halo?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  segmento?: PanelSegmento;
}) {
  const { skin, degradado } = useSkin();
  const contexto = useMemo(() => ({ sunkenBg: skin.colors.surfaceSunken, colors: skin.colors }), [skin]);

  if (!skin.flags.soft) return <>{children}</>;

  const c = skin.colors;
  const e = skin.elevation[nivel];
  const sombra: ViewStyle = degradado
    ? { elevation: e.elevationFallback }
    : { boxShadow: halo ? `${e.boxShadow}, 0 0 28px ${c.glow}` : e.boxShadow };

  if (!segmento) {
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
          degradado && { borderWidth: 1, borderColor: c.hair },
          style,
        ]}
      >
        <View
          style={{
            flexGrow: 1,
            // Degradado, la de afuera lleva un borde de 1px: el recorte va 1px
            // más cerrado para que las esquinas del contenido no lo pisen.
            borderRadius: degradado ? Math.max(0, skin.radius.panel - 1) : skin.radius.panel,
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

  // --- Modo segmentado (T-154) ---
  const esPrimera = segmento === 'primera' || segmento === 'unica';
  const esUltima = segmento === 'ultima' || segmento === 'unica';
  const esMediaOUltima = segmento === 'media' || segmento === 'ultima';

  const radios: ViewStyle = {
    borderTopLeftRadius: esPrimera ? skin.radius.panel : 0,
    borderTopRightRadius: esPrimera ? skin.radius.panel : 0,
    borderBottomLeftRadius: esUltima ? skin.radius.panel : 0,
    borderBottomRightRadius: esUltima ? skin.radius.panel : 0,
  };

  const borde: ViewStyle = degradado
    ? {
        borderLeftWidth: 1, borderRightWidth: 1, borderColor: c.hair,
        borderTopWidth: esPrimera ? 1 : 0,
        borderBottomWidth: esUltima ? 1 : 0,
      }
    : {
        borderTopWidth: esPrimera ? 1 : 0,
        borderTopColor: c.edgeLight,
      };

  return (
    <View
      testID={`skin-panel-${segmento}`}
      style={{
        overflow: 'hidden',
        paddingTop: esPrimera ? skin.space.gapPanel : 0,
        paddingBottom: esUltima ? SOMBRA_ESPACIO : 0,
      }}
    >
      {esMediaOUltima && (
        <View
          testID="band-stack-divisor"
          style={{ height: 1, marginHorizontal: skin.space.inset, backgroundColor: c.edgeShade }}
        />
      )}
      <View
        style={[
          {
            marginHorizontal: skin.space.inset,
            marginTop: 0,
            backgroundColor: c.surface,
          },
          radios,
          sombra,
          borde,
          style,
        ]}
      >
        <PanelContext.Provider value={contexto}>{children}</PanelContext.Provider>
      </View>
    </View>
  );
}
