import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Spacing } from '@/src/constants/spacing';
import { useAnimacionesReducidas } from '@/src/hooks/useAnimacionesReducidas';
import { useColors, useSkin } from '@/src/skins/useSkin';
import { conAlfa } from '@/src/skins/color';
import { styles } from '@/src/components/sheet/bottomSheetStyles';
import { useAlturaTeclado } from '@/src/components/sheet/useAlturaTeclado';

/**
 * Sheets y modales — vocabulario "flat bands".
 *
 * El sheet viejo era una tarjeta con opciones-pastilla apiladas y gap: cada
 * opción parecía un botón suelto. Acá el sheet es una hoja de papel con
 * secciones: título fijo arriba con hairline, opciones como filas de borde a
 * borde separadas por hairline, y las acciones abajo. Mismo lenguaje que las
 * bandas de las pantallas, así que abrir un sheet no cambia de idioma visual.
 *
 * El contenido scrollea si no entra; el título y el pie quedan fijos.
 */

const SCRIM = 'rgba(12, 16, 14, 0.5)';

/**
 * La animación es NUESTRA, no la del `Modal`.
 *
 * Con `animationType="slide"` el sistema desliza **todo el contenido del
 * modal**, y el velo oscuro vive ahí adentro: el fondo entraba deslizándose
 * desde abajo junto con la hoja, como una cortina que sube. Se veía mal y no es
 * lo que hace ningún sheet nativo — el velo **aparece**, no viaja.
 *
 * Acá van separados: el velo hace fade y la hoja sube apenas. El recorrido es
 * corto a propósito; un slide largo se lee como lento aunque dure lo mismo.
 */
const ENTRADA_MS = 180;
const SALIDA_MS = 140;
/** Cuánto sube la hoja al entrar. Es un acento, no un viaje. */
const ALZADA = 28;

export function BottomSheet({
  visible, onClose, children, title, footer, scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Título fijo + botón de cerrar. Sin él, el sheet arranca en el contenido. */
  title?: string;
  /** Acciones fijas al pie (usar `SheetButton`). */
  footer?: React.ReactNode;
  /** false para contenido que ya scrollea o mide poco (pickers de 3 filas). */
  scroll?: boolean;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const alturaTeclado = useAlturaTeclado(insets.bottom);
  // Aero (etapa 2): la hoja flota como tarjeta — margen, radio en las cuatro
  // esquinas, borde y sombra; manija en color de marca y divisores suaves.
  // Con el default todo esto es `null` y la hoja es la de siempre.
  const { skin, degradado } = useSkin();
  const soft = skin.flags.soft;
  const hojaAero = soft ? {
    marginHorizontal: Spacing[2], marginBottom: Spacing[2],
    borderRadius: 28, borderWidth: 1, borderColor: c.hair,
    ...(degradado ? { elevation: skin.elevation.e3.elevationFallback } : { boxShadow: skin.elevation.e3.boxShadow }),
  } : null;
  const divisor = soft ? c.edgeShade : c.hair;

  // Reducir animaciones (PO 2026-09-22): `null` (todavía no sabemos) se trata
  // como "sí animar" — un sheet puede abrirse antes de que la consulta de
  // accesibilidad resuelva, y ese primer fade de 180ms no vale la pena
  // bloquear. `duration: 0` en vez de saltear `Animated.timing` entero: así
  // el valor final (`toValue`) y el callback de salida (`setMontado(false)`)
  // siguen el mismo camino, sin duplicar la lógica de montado/desmontado.
  const sinAnimacion = useAnimacionesReducidas() === true;

  // El modal sigue montado durante la salida: si se desmontara al soltar
  // `visible`, la hoja desaparecería de golpe y el fade de salida no se vería.
  const [montado, setMontado] = useState(visible);
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      setMontado(true);
      Animated.timing(anim, {
        toValue: 1, duration: sinAnimacion ? 0 : ENTRADA_MS,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(anim, {
      toValue: 0, duration: sinAnimacion ? 0 : SALIDA_MS,
      easing: Easing.in(Easing.quad), useNativeDriver: true,
    }).start(({ finished }) => { if (finished) setMontado(false); });
  }, [visible, anim, sinAnimacion]);

  const Body: any = scroll ? ScrollView : View;
  const bodyProps = scroll
    // Sin paddingBottom propio: el del sheet ya lo pone. Antes había un 4 suelto
    // acá, así que un sheet con scroll y uno sin scroll no terminaban igual.
    ? { bounces: false, showsVerticalScrollIndicator: false }
    : {};

  return (
    <Modal
      visible={montado}
      transparent
      animationType="none"
      onRequestClose={onClose}
      /*
       * Android va edge-to-edge desde SDK 54, pero el `Modal` NO dibuja debajo
       * de las barras del sistema salvo que se le pida. Sin esto, la ventana del
       * modal termina ARRIBA de la barra de navegación y la hoja queda flotando:
       * se ve una franja de la pantalla de atrás debajo del sheet. En iOS los
       * dos props son inertes.
       */
      statusBarTranslucent
      navigationBarTranslucent
    >
      {/*
        ⚠️ **Un `GestureHandlerRootView` PROPIO, adentro del `Modal`.**

        Un `Modal` de React Native dibuja sus hijos en una jerarquía nativa
        SEPARADA. El contexto de React sí atraviesa —así que
        `GestureDetector` no se queja—, pero del lado nativo los gestos quedan
        colgados de la raíz de la app, que no es la ventana del modal: los
        toques adentro de la hoja no se enrutan, y en iOS con la New
        Architecture eso además **tumba la app** al tocar.

        Es exactamente lo que le pasó al recorte de avatar
        (`AvatarCropSheet`, el único lugar de la app con gestos): recuadro
        vacío y crash al tocarlo. Lo pide la documentación de
        `react-native-gesture-handler` para todo contenido dentro de un modal.

        Va acá, en el `BottomSheet`, y no en la hoja del avatar: así lo hereda
        cualquier sheet que mañana use un gesto, sin que nadie tenga que
        acordarse.
      */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View
          style={[StyleSheet.absoluteFillObject, { backgroundColor: SCRIM, opacity: anim }]}
        >
          <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        </Animated.View>

        {/*
          Reemplaza a `KeyboardAvoidingView` (ver `useAlturaTeclado`): acá el
          alto lo manda `Keyboard` directo, animado a mano, sin medir nada
          contra la ventana — es lo que arregla el salto en iOS y que Android
          no hiciera nada.
        */}
        <Animated.View style={[styles.kav, { paddingBottom: alturaTeclado }]}>
          {/*
            **Dos `Animated.View` separados, no uno** (PO 2026-09-22): `opacity`/
            `transform` van con `useNativeDriver:true` (el mount/unmount de arriba)
            y el `paddingBottom` de acá abajo va con `useNativeDriver:false` (el
            teclado). Mezclados en el MISMO nodo, React Native arma una sola config
            nativa para todo el estilo apenas detecta que algo ahí quiere driver
            nativo — y `paddingBottom` no es un estilo soportado por ese módulo:
            tira el warning rojo "Style property 'paddingBottom' is not supported
            by native animated module" y el achique por teclado no llegaba a
            aplicarse bien (la hoja quedaba tapada). Separados en dos nodos, cada
            uno pide sólo el driver que le corresponde.
          */}
          <Animated.View style={{
            opacity: anim,
            transform: [{
              translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [ALZADA, 0] }),
            }],
          }}>
            <Animated.View style={[styles.sheet, hojaAero, {
              backgroundColor: c.surface,
              // El inset despeja la barra de gestos; NO es espacio de diseño. Sumarlos
              // daba 46px abajo (34 de inset + 12) contra 24 arriba, y con el padding
              // de la última fila encima quedaban 60 de hueco. Se usa el mayor.
              //
              // **Con el teclado arriba, este padding se cae** (PO 2026-09-22): el
              // contenedor de arriba YA sumó el alto del teclado empujando toda la
              // hoja — sumarle ADEMÁS el inset de home indicator duplicaba el hueco,
              // y esa tira extra (antes invisible, recortada por el borde de la
              // pantalla) quedaba flotando arriba del teclado con las esquinas
              // cuadradas a la vista: el "final del bottom" que se veía raro.
              // `interpolate` en vez de un booleano: así el achique acompaña la
              // MISMA animación del teclado en vez de saltar en un solo frame.
              paddingBottom: alturaTeclado.interpolate({
                inputRange: [0, 1],
                outputRange: [Math.max(insets.bottom, Spacing[4]), Spacing[4]],
                extrapolate: 'clamp',
              }),
            }]}>
              <View
                style={[
                  styles.grabber,
                  { backgroundColor: soft ? conAlfa(c.brand.primary, 0.35) : c.hair },
                  soft && styles.grabberAero,
                ]}
              />

              {title ? (
                <View style={[styles.titleRow, { borderBottomColor: divisor }]}>
                  <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>{title}</Text>
                  <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
                    <Ionicons name="close" size={20} color={c.textTertiary} />
                  </Pressable>
                </View>
              ) : null}

              <Body
                style={styles.body}
                {...(scroll
                  ? { contentContainerStyle: styles.bodyPad }
                  : { }) as object}
                {...bodyProps}
              >
                {scroll ? children : <View style={styles.bodyPad}>{children}</View>}
              </Body>

              {footer ? (
                <View style={[styles.footer, { borderTopColor: divisor }]}>{footer}</View>
              ) : null}
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
