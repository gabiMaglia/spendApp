import React, { useMemo, useRef } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { BottomSheet } from './Sheet';
import { ActionButton } from './ActionButton';
import { ButtonRack } from './ButtonRack';
import { recordError } from '@/src/services/errorLog';
import {
  acotar, escalaParaCubrir, limitesDePan, recorteDelVisor, type Recorte,
} from '@/src/algorithms/avatarCrop';

const ZOOM_MAX = 4;

/** Sólo el esquema del URI: `file`, `ph`, `content`, `https`… Nunca la ruta. */
function esquemaDe(uri: string): string {
  const i = uri.indexOf(':');
  return i > 0 ? uri.slice(0, i) : 'sin-esquema';
}

/** Sólo la extensión, que es lo que distingue un HEIC de un JPEG. */
function extensionDe(uri: string): string {
  const m = /\.([a-zA-Z0-9]{1,5})(?:\?|$)/.exec(uri);
  return m ? m[1]!.toLowerCase() : 'sin-extension';
}

/**
 * **Ajustar qué parte de la foto queda en el avatar** (T-067).
 *
 * Antes se elegía y se guardaba (decisión previa del PO), y como el
 * redimensionado forzaba ancho Y alto, una foto apaisada se **achataba**. Nadie
 * lo reportó como bug: una foto fea se le atribuye a la foto.
 *
 * El recuadro es cuadrado y fijo, como el avatar. Lo que se mueve es la
 * imagen, que es la convención de todas las apps que hacen esto: el usuario ve
 * el resultado, no un rectángulo que hay que colocar.
 *
 * **La matemática vive en `algorithms/avatarCrop`, no acá.** Un recorte corrido
 * dos píxeles no tira ninguna excepción y produce una cara descentrada que
 * nadie atribuye a un bug; los gestos, en cambio, o andan o se nota. Por eso lo
 * que puede fallar en silencio está aparte y testeado.
 */
export function AvatarCropSheet({
  visible, uri, width, height, onCancel, onConfirm,
}: {
  visible: boolean;
  uri: string | null;
  width: number;
  height: number;
  onCancel: () => void;
  onConfirm: (recorte: Recorte) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const c = Colors[scheme];

  // El visor ocupa el ancho de la pantalla menos los márgenes de la hoja.
  const lado = useMemo(
    () => Math.min(Dimensions.get('window').width - Spacing.screenPad * 2, 320),
    [],
  );

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const zoom = useSharedValue(1);

  /**
   * ⚠️ **Espejo en un `ref`, NO en estado de React.**
   *
   * Antes era `useState`, y ahí estaba el crash de iOS: el `onEnd` del gesto
   * hacía `runOnJS(setAjuste)`, eso **re-renderizaba**, y en el render nuevo se
   * creaban objetos de gesto nuevos. `GestureDetector` memoiza los handlers por
   * **identidad del objeto** (`gesturesToAttach`, en
   * `react-native-gesture-handler/.../GestureDetector/index.js:62`), así que los
   * desenganchaba y volvía a enganchar **mientras el gesto todavía estaba
   * terminando**.
   *
   * Con un `ref` no hay re-render: el valor cruza igual del hilo de UI al de JS
   * por `runOnJS`, que es lo único que hacía falta. La pantalla no depende de
   * este valor para dibujarse — lo dibuja el `useAnimatedStyle`.
   */
  const ajuste = useRef({ tx: 0, ty: 0, zoom: 1 });

  const inicio = useSharedValue({ tx: 0, ty: 0, zoom: 1 });

  /**
   * El gesto corre en el hilo de UI y el recorte se calcula en el de JS. Sin
   * `runOnJS` el `setAjuste` no cruzaría — y al confirmar se recortaría con el
   * ajuste inicial, o sea el centro, sin importar lo que la persona movió.
   */
  const guardarAjuste = (x: number, y: number, z: number) => {
    ajuste.current = { tx: x, ty: y, zoom: z };
  };

  const escalaBase = escalaParaCubrir({ width, height }, lado);

  /**
   * **Los gestos se memoizan**, y no es una optimización: lo pide el propio
   * código de `GestureDetector` (*«Gesture config should be wrapped with useMemo
   * to prevent unnecessary re-renders»*). Un objeto nuevo por render hace que
   * RNGH reenganche los handlers nativos cada vez.
   *
   * Las dependencias son las medidas: los shared values son referencias
   * estables y `guardarAjuste` sólo escribe en un ref.
   */
  const gesto = useMemo(() => {
    const pan = Gesture.Pan()
      .onBegin(() => { inicio.value = { tx: tx.value, ty: ty.value, zoom: zoom.value }; })
      .onUpdate(e => {
        const lim = limitesDePan({ width, height }, lado, zoom.value);
        tx.value = acotar(inicio.value.tx + e.translationX, -lim.x, lim.x);
        ty.value = acotar(inicio.value.ty + e.translationY, -lim.y, lim.y);
      })
      .onEnd(() => { runOnJS(guardarAjuste)(tx.value, ty.value, zoom.value); });

    const pinch = Gesture.Pinch()
      .onBegin(() => { inicio.value = { tx: tx.value, ty: ty.value, zoom: zoom.value }; })
      .onUpdate(e => {
        zoom.value = acotar(inicio.value.zoom * e.scale, 1, ZOOM_MAX);
        // Al alejar, el pan vigente puede quedar fuera de los límites nuevos y
        // descubrir un borde: se reencuadra en el mismo gesto.
        const lim = limitesDePan({ width, height }, lado, zoom.value);
        tx.value = acotar(tx.value, -lim.x, lim.x);
        ty.value = acotar(ty.value, -lim.y, lim.y);
      })
      .onEnd(() => { runOnJS(guardarAjuste)(tx.value, ty.value, zoom.value); });

    return Gesture.Simultaneous(pan, pinch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, lado]);

  const estilo = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: zoom.value },
    ],
  }));

  function confirmar() {
    const a = ajuste.current;
    onConfirm(recorteDelVisor({ width, height }, lado, a.zoom, a.tx, a.ty));
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onCancel}
      /**
       * La botonera va al **pie fijo**, no adentro del cuerpo.
       *
       * El cuerpo scrollea, y el visor mide 320px: en una pantalla chica el
       * botón de confirmar quedaba abajo del pliegue y **no se veía**. El pie no
       * scrollea nunca, así que la acción está siempre a la vista — que es
       * exactamente para lo que el `BottomSheet` tiene `footer`.
       */
      footer={
        <ButtonRack placement="inline" direction="row">
          <ActionButton variant="ghost" label={t('common.cancel')} action={onCancel} />
          <ActionButton
            testID="avatar-crop-confirm"
            label={t('common.confirm')}
            full
            action={confirmar}
          />
        </ButtonRack>
      }
    >
      <Text style={[Typography.h3, { color: c.text, marginBottom: 6 }]}>
        {t('profile.crop_title')}
      </Text>
      <Text style={[Typography.bodyS, { color: c.textTertiary, marginBottom: Spacing[4] }]}>
        {t('profile.crop_hint')}
      </Text>

      <View
        testID="avatar-crop-viewport"
        style={[styles.visor, { width: lado, height: lado, backgroundColor: c.bgGrouped }]}
      >
        {uri && (
          <GestureDetector gesture={gesto}>
            <Animated.View style={StyleSheet.absoluteFill}>
              <Animated.Image
                source={{ uri }}
                /**
                 * Sin esto, una imagen que no carga es **un recuadro vacío y
                 * nada más**: ni un error, ni un aviso, ni una pista. Con el
                 * registro de T-078, la próxima vez que le pase a alguien queda
                 * algo para mirar.
                 *
                 * **Del URI sólo se anota el esquema y la extensión.** La ruta
                 * completa es un dato del teléfono de la persona y el
                 * diagnóstico se comparte por mensaje.
                 */
                onError={() => recordError({
                  message: `avatar: la imagen no cargó (${esquemaDe(uri)}, ${extensionDe(uri)}, ${width}×${height})`,
                  fatal: false,
                  screen: 'AvatarCropSheet',
                })}
                style={[
                  {
                    width: width * escalaBase,
                    height: height * escalaBase,
                    position: 'absolute',
                    left: (lado - width * escalaBase) / 2,
                    top: (lado - height * escalaBase) / 2,
                  },
                  estilo,
                ]}
              />
            </Animated.View>
          </GestureDetector>
        )}
      </View>

    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // `overflow: hidden` es lo que convierte el recuadro en un visor: sin él la
  // imagen se dibuja entera por fuera y no se entiende qué se está eligiendo.
  visor: { overflow: 'hidden', borderRadius: 12, alignSelf: 'center' },
});
