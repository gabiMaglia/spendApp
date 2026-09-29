import { useEffect, useRef } from 'react';
import { Animated, Easing, Keyboard, Platform } from 'react-native';

/**
 * **El alto del teclado, animado a mano — no `KeyboardAvoidingView`.**
 *
 * `KeyboardAvoidingView` calcula cuánto empujar MIDIENDO su propia posición
 * contra la ventana (`measureInWindow`). Adentro de un `Modal` esa medición
 * sale mal: en iOS el resultado era un salto brusco de golpe (nada de
 * animación propia — la hoja "caía" sobre el teclado en vez de deslizarse) y
 * en Android, sin ventana propia que resolver, no hacía NADA — el teclado
 * tapaba la hoja entera. Los dos síntomas son la misma causa: la medición
 * relativa no sirve adentro de la ventana nativa separada del `Modal`.
 *
 * Acá no se mide nada: `Keyboard` manda el alto directo (`endCoordinates.height`)
 * y la duración real de la animación del sistema (iOS la manda; Android no, se
 * usa un valor prolijo). Se anima como `paddingBottom` del contenedor — la hoja
 * se ve crecer/deslizarse, no saltar.
 */
/**
 * `barraAndroid`: alto de la barra de navegación de Android (inset inferior).
 * React Native en Android informa el alto del teclado SIN esa barra
 * (`ReactRootView.java`: `imeInsets.bottom - barInsets.bottom`), pero la hoja
 * vive en un `Modal` con `navigationBarTranslucent`, o sea que se dibuja DEBAJO
 * de la barra: sin sumarla, la hoja quedaba justo esa altura por debajo del
 * teclado y los botones del final se tapaban (PO 2026-09-29, Moto E40). En iOS
 * el alto ya incluye la zona inferior: no se suma nada.
 */
export function useAlturaTeclado(barraAndroid = 0): Animated.Value {
  const altura = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const mostrar = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const ocultar = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const alMostrar = (e: { endCoordinates?: { height?: number }; duration?: number }) => {
      Animated.timing(altura, {
        toValue: (e.endCoordinates?.height ?? 0) + (Platform.OS === 'android' ? barraAndroid : 0),
        duration: e.duration && e.duration > 0 ? e.duration : 250,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    };
    const alOcultar = (e: { duration?: number }) => {
      Animated.timing(altura, {
        toValue: 0,
        duration: e.duration && e.duration > 0 ? e.duration : 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    };

    const subMostrar = Keyboard.addListener(mostrar, alMostrar);
    const subOcultar = Keyboard.addListener(ocultar, alOcultar);
    return () => { subMostrar.remove(); subOcultar.remove(); };
  }, [altura, barraAndroid]);

  return altura;
}
