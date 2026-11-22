import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { conAlfa } from '@/src/skins/color';
import { useSkinTokens } from '@/src/skins/useSkin';
import { IconoCategoria } from '@/src/components/IconoCategoria';

export const CUBO_TAMANO = 60;

/**
 * El cubo de Aero: tile tintado con su ícono (o un texto corto). Lo usan la tarjeta del
 * gasto y el abanico de categorías, que tienen que verse idénticos.
 */
export function CuboIcono({ icono, categoria, texto, fecha, tinte, resaltado, tamano = CUBO_TAMANO, style, testID }: {
  icono?: React.ComponentProps<typeof Ionicons>['name'];
  /** Ícono propio de una categoría (o `income`). Resaltado se dibuja en variante b (color pleno), sin borde. */
  categoria?: string;
  /** Contenido de texto en lugar del ícono (el símbolo de una moneda). */
  texto?: string;
  /** Un día: número grande y mes abreviado chico, ya en el idioma activo. */
  fecha?: { dia: string; mes: string };
  tinte: string;
  /** Marca el cubo elegido dentro del abanico. */
  resaltado?: boolean;
  /** Lado del cubo; el dibujo escala con él. */
  tamano?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors } = useSkinTokens();
  const propio = categoria !== undefined;
  const lleno = propio && resaltado;
  return (
    <View
      testID={testID}
      style={[
        styles.cubo,
        tamano !== CUBO_TAMANO && { width: tamano, height: tamano, borderRadius: tamano * 0.3 },
        { backgroundColor: lleno ? tinte : conAlfa(tinte, propio ? 0.14 : 0.16) },
        resaltado && !propio && { borderWidth: 2, borderColor: tinte },
        style,
      ]}
    >
      {propio ? (
        <IconoCategoria
          categoria={categoria} tinte={tinte} sobreColor={colors.sobreVelo}
          tamano={Math.round(tamano * 0.47)} variante={lleno ? 'b' : 'a'}
        />
      ) : fecha ? (
        <>
          <Text style={[styles.dia, { color: tinte }]} numberOfLines={1}>{fecha.dia}</Text>
          <Text style={[styles.mes, { color: tinte }]} numberOfLines={1}>{fecha.mes}</Text>
        </>
      ) : texto !== undefined
        ? <Text style={[styles.texto, { color: tinte }]} numberOfLines={1} adjustsFontSizeToFit>{texto}</Text>
        : icono && <Ionicons name={icono} size={28} color={tinte} />}
    </View>
  );
}

const styles = StyleSheet.create({
  texto: { fontSize: 22, fontWeight: '700', paddingHorizontal: 4 },
  dia: { fontSize: 22, fontWeight: '700', lineHeight: 24 },
  mes: { fontSize: 11, fontWeight: '600', lineHeight: 13 },
  cubo: {
    width: CUBO_TAMANO, height: CUBO_TAMANO, borderRadius: 18, borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center',
  },
});
