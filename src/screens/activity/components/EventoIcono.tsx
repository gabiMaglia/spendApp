import React from 'react';
import { StyleSheet, View } from 'react-native';

import { CuboIcono } from '@/src/components/CuboIcono';
import { IconoGlifo } from '@/src/components/IconoGlifo';
import type { IdGlifo } from '@/src/components/glifos';
import { tinteDeCategoria } from '@/src/screens/expense/components/GrillaCategorias';
import { useColors, useSkinTokens } from '@/src/skins/useSkin';

const LADO = 40;
const LADO_SELLO = 19;
const ES_INGRESO: ReadonlySet<string> = new Set(['income', 'salary', 'freelance']);

/** Ícono de una fila de Actividad (T-294): cubo de la categoría + sello de la acción. */
export function EventoIcono({ categoria, tinte, sello, apagado }: {
  /** Dibujo del cubo: categoría del gasto, `income` o `saldar`. Si no existe, cae a «other». */
  categoria: string;
  /** Color del cubo; si falta, el de la categoría (los ingresos, el verde semántico). */
  tinte?: string;
  sello?: { glifo: IdGlifo; color: string };
  /** Borrado: el cubo va gris y tenue para que no compita con los gastos vivos. */
  apagado?: boolean;
}) {
  const c = useColors();
  const { colors } = useSkinTokens();
  const color = apagado ? c.textTertiary
    : tinte ?? (ES_INGRESO.has(categoria) ? c.semantic.positive : tinteDeCategoria(c.category, categoria));
  return (
    <View testID="evento-icono" style={styles.caja}>
      <CuboIcono
        testID={apagado ? 'evento-icono-apagado' : undefined}
        categoria={ES_INGRESO.has(categoria) ? 'income' : categoria} tinte={color} tamano={LADO}
        style={apagado && styles.apagado}
      />
      {sello && (
        // El anillo del color de la superficie separa el sello del cubo.
        <View
          testID={`evento-sello-${sello.glifo}`}
          style={[styles.sello, { backgroundColor: sello.color, borderColor: c.surface }]}
        >
          <IconoGlifo glifo={sello.glifo} color={colors.sobreVelo} modo="trazo" tamano={11} grosor={2.6} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  caja: { width: LADO, height: LADO, flexShrink: 0 },
  apagado: { opacity: 0.6 },
  sello: {
    position: 'absolute', right: -5, bottom: -5, width: LADO_SELLO, height: LADO_SELLO,
    borderRadius: LADO_SELLO / 2, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center',
  },
});
