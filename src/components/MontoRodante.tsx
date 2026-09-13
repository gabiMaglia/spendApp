import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, StyleSheet, Text, View,
  type StyleProp, type TextStyle,
} from 'react-native';
import {
  Easing, runOnJS, useAnimatedReaction, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';

import {
  debeRodar, registroDeMontosDeLaApp, type MontoRegistry,
} from '@/src/utils/montoRodanteRegistry';

const DELAY_POR_COLUMNA_MS = 35;
const DURACION_MS = 600;

type MontoRodanteProps = {
  /**
   * Identidad ESTABLE de esta posición en pantalla (no el valor) — ej.
   * `'home.disponible'`, `'groupDetail.balance:g1'`. Define qué cuenta como
   * "el mismo monto" para decidir si animar. Ver `montoRodanteRegistry`.
   */
  id: string;
  /** Texto YA formateado (salida de `formatMoney`/`Intl.NumberFormat`). Nunca formatear acá. */
  value: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  /** Inyectable sólo para tests; en producción usa el registro único de la app. */
  registry?: MontoRegistry;
};

/**
 * **Números que "giran"** (T-106, estilo Binance — diseño y alcance aprobados
 * por el PO, corrección del 2026-09-13).
 *
 * Cada dígito 0-9 es una columna que rueda verticalmente hasta su valor;
 * signo, separadores y símbolo de moneda quedan fijos. Sólo se usa en los
 * montos GRANDES de bloque (nunca en filas de listas) — ver los call sites en
 * `app/(tabs)/*` y `app/groups/[id].tsx`.
 *
 * **Cuándo rueda** (regla del PO, reemplaza el diseño de "cada vez que se
 * enfoca la pestaña"): la PRIMERA vez que este `id` se muestra en la sesión de
 * la app, y cada vez que `value` CAMBIA de verdad (cambio de divisa, nuevo
 * movimiento, post-sync). Volver a una pantalla con el mismo valor no anima.
 * Esa decisión es pura y vive en `debeRodar` — acá sólo se consume.
 *
 * Con "reducir movimiento" (`AccessibilityInfo.isReduceMotionEnabled`) se
 * muestra el valor final directo, sin animar.
 */
export function MontoRodante({
  id, value, style, testID, registry = registroDeMontosDeLaApp,
}: MontoRodanteProps) {
  const [reducido, setReducido] = useState(false);
  const [ronda, setRonda] = useState(0);
  const animarRef = useRef(false);

  useEffect(() => {
    let vivo = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (vivo) setReducido(v); })
      .catch(() => { if (vivo) setReducido(false); });
    return () => { vivo = false; };
  }, []);

  // Un solo efecto por (id, value, reducido): decide UNA vez si corresponde
  // animar y actualiza el registro. `ronda` fuerza a las columnas a releer esa
  // decisión sin depender de que React vuelva a montar nada.
  useEffect(() => {
    const cambio = debeRodar(registry, id, value);
    animarRef.current = cambio && !reducido;
    setRonda(r => r + 1);
  }, [id, value, reducido, registry]);

  const caracteres = useMemo(() => value.split(''), [value]);
  const tabular = useMemo(() => [style, { fontVariant: ['tabular-nums'] as any }], [style]);

  return (
    <View
      style={styles.fila}
      accessible
      accessibilityLabel={value}
      testID={testID}
    >
      {caracteres.map((ch, i) => {
        const esDigito = ch >= '0' && ch <= '9';
        if (!esDigito) {
          return (
            <Text key={`fijo-${i}`} style={tabular}>{ch}</Text>
          );
        }
        return (
          <ColumnaDigito
            key={`digito-${i}`}
            digito={Number(ch)}
            indice={i}
            style={tabular}
            animar={animarRef.current}
            ronda={ronda}
          />
        );
      })}
    </View>
  );
}

/**
 * Una columna es UN SOLO `<Text>` con el dígito actualmente mostrado — nunca
 * una pila fija de los diez dígitos (0-9) superpuestos con `overflow:hidden`.
 *
 * Esa alternativa —más parecida a un cuentakilómetros de verdad— se probó y
 * se descartó: React Native Testing Library matchea por CONTENIDO de texto
 * sin mirar si un ancestro lo esconde (`overflow`, `accessibilityElementsHidden`
 * no lo filtran en `getByText`/`getAllByText`). Con los diez dígitos siempre
 * montados, CUALQUIER pantalla con un `MontoRodante` rompía cualquier test
 * ajeno que buscara ese dígito por texto en OTRO lugar de la pantalla — se
 * vio en `groupsScreen.test.tsx` y `campanaEnTodasLasTabs.test.tsx`.
 *
 * Acá en cambio hay UN dígito real en el árbol en todo momento. "Rueda" en el
 * sentido de que cuenta rápido a través de valores intermedios hasta asentarse
 * en el real (un `useAnimatedReaction` empuja el número mostrado a React en
 * cada frame de la animación) — el efecto visual sigue leyéndose como el
 * medidor de Binance sin el riesgo de contenido fantasma.
 */
function ColumnaDigito({
  digito, indice, style, animar, ronda,
}: {
  digito: number;
  indice: number;
  style: StyleProp<TextStyle>;
  animar: boolean;
  ronda: number;
}) {
  const [mostrado, setMostrado] = useState(digito);
  const progreso = useSharedValue(digito);

  useAnimatedReaction(
    () => Math.max(0, Math.min(9, Math.round(progreso.value))),
    (actual, previo) => {
      if (actual !== previo) runOnJS(setMostrado)(actual);
    },
  );

  useEffect(() => {
    if (!animar) {
      progreso.value = digito;
      setMostrado(digito);
      return;
    }
    // Arranca desde 0, como un cuentakilómetros, y sube hasta el dígito real
    // con un desfase chico por columna (izquierda a derecha).
    progreso.value = 0;
    progreso.value = withDelay(
      indice * DELAY_POR_COLUMNA_MS,
      withTiming(digito, { duration: DURACION_MS, easing: Easing.out(Easing.cubic) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ronda]);

  return <Text style={style}>{mostrado}</Text>;
}

const styles = StyleSheet.create({
  fila: { flexDirection: 'row' },
});
