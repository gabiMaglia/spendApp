import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming,
} from 'react-native-reanimated';

import type { CurrencyCode } from '@/src/constants/currencies';
import { RESORTE_MARCA } from '@/src/constants/movimiento';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { CheckDibujado } from '@/src/components/CheckDibujado';
import { MontoRodante } from '@/src/components/MontoRodante';
import { useAnimacionesReducidas } from '@/src/hooks/useAnimacionesReducidas';
import { useColors } from '@/src/skins/useSkin';

/** Lo que dura el momento completo antes de seguir. */
export const MOMENTO_MS = 900;
/** Con reducir movimiento: el estado final quieto, lo justo para leerse. */
export const MOMENTO_REDUCIDO_MS = 600;
const APARICION_TEXTO_MS = 180;
const RETRASO_TEXTO_MS = 200;

export type Momento = {
  /** Cambia en cada momento: da identidad propia a cada monto que rueda. */
  clave: number;
  /** Un monto por moneda — nunca se mezclan. */
  montos: { minor: number; code: CurrencyCode }[];
  /** Texto ya traducido por quien llama. */
  titulo: string;
  detalle: string;
};

type Props = {
  momento: Momento | null;
  /** Se llama UNA vez: al agotarse el tiempo o al tocar. */
  onTerminar: () => void;
};

/** `null` hasta que el sistema contesta si hay un lector de pantalla activo. */
function useLectorActivo(): boolean | null {
  const [activo, setActivo] = React.useState<boolean | null>(null);
  useEffect(() => {
    let vivo = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then(v => { if (vivo) setActivo(v); })
      .catch(() => { if (vivo) setActivo(false); });
    return () => { vivo = false; };
  }, []);
  return activo;
}

/**
 * Cierre de una acción lograda (T-290): cubre la pantalla con un check que se
 * dibuja, el monto girando a su valor final y una línea de texto. Dura
 * ~900 ms y se saltea tocando; con reducir movimiento aparece ya terminado.
 * Con lector de pantalla se anuncia y NO se cierra solo: queda hasta que se lo toca.
 */
export function MomentoExito({ momento, onTerminar }: Props) {
  if (!momento) return null;
  return <Cuerpo key={momento.clave} momento={momento} onTerminar={onTerminar} />;
}

function Cuerpo({ momento, onTerminar }: { momento: Momento; onTerminar: () => void }) {
  const c = useColors();
  const reducidas = useAnimacionesReducidas();
  const lector = useLectorActivo();
  const yaTermino = useRef(false);
  const alTerminar = useRef(onTerminar);
  alTerminar.current = onTerminar;

  const terminar = React.useCallback(() => {
    if (yaTermino.current) return;
    yaTermino.current = true;
    alTerminar.current();
  }, []);

  const quieto = reducidas === true;
  const aparece = useSharedValue(quieto ? 1 : 0);
  const sello = useSharedValue(quieto ? 1 : 0.6);
  const texto = useSharedValue(quieto ? 1 : 0);

  // Un solo anuncio por momento (el componente se remonta con cada `clave`).
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`${momento.titulo}. ${momento.detalle}`);
  }, [momento.titulo, momento.detalle]);

  useEffect(() => {
    // Sin saber todavía si hay que reducir, ni se anima ni corre el reloj.
    if (reducidas === null) return;
    if (!reducidas) {
      aparece.value = withTiming(1, { duration: 120 });
      sello.value = withSpring(1, RESORTE_MARCA);
      texto.value = withDelay(RETRASO_TEXTO_MS, withTiming(1, { duration: APARICION_TEXTO_MS }));
    } else {
      aparece.value = 1; sello.value = 1; texto.value = 1;
    }
  }, [reducidas, aparece, sello, texto]);

  useEffect(() => {
    // Sin saber lo de reducir o lo del lector no corre el reloj; con lector activo se cierra tocando.
    if (reducidas === null || lector !== false) return;
    const id = setTimeout(terminar, reducidas ? MOMENTO_REDUCIDO_MS : MOMENTO_MS);
    return () => clearTimeout(id);
  }, [reducidas, lector, terminar]);

  const estiloFondo = useAnimatedStyle(() => ({ opacity: aparece.value }));
  const estiloSello = useAnimatedStyle(() => ({ transform: [{ scale: sello.value }] }));
  const estiloTexto = useAnimatedStyle(() => ({ opacity: texto.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }, estiloFondo]}>
      <Pressable
        testID="momento-exito"
        style={styles.centro}
        onPress={terminar}
        accessibilityRole="button"
        accessibilityLabel={`${momento.titulo}. ${momento.detalle}`}
      >
        <Animated.View
          style={[
            styles.sello,
            { backgroundColor: c.semantic.positiveSoft },
            estiloSello,
          ]}
        >
          <CheckDibujado
            testID="momento-check"
            color={c.semantic.positive}
            quieto={quieto}
          />
        </Animated.View>

        <View style={styles.montos}>
          {momento.montos.map(m => (
            <MontoRodante
              key={m.code}
              id={`momento-exito:${momento.clave}:${m.code}`}
              minor={m.minor}
              code={m.code}
              style={[Typography.amountXL, { color: c.text }]}
            />
          ))}
        </View>

        <Animated.View style={[styles.textos, estiloTexto]}>
          <Text style={[Typography.h2, { color: c.text }]}>{momento.titulo}</Text>
          {momento.detalle !== '' && (
            <Text style={[Typography.bodyM, { color: c.textSecondary }]}>{momento.detalle}</Text>
          )}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing[4], padding: Spacing.screenPad },
  sello:  { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center' },
  montos: { alignItems: 'center', gap: Spacing[1] },
  textos: { alignItems: 'center', gap: Spacing[1] },
});
