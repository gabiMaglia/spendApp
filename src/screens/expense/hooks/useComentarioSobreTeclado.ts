import { useCallback, useEffect, useRef } from 'react';
import { Keyboard, type ScrollView } from 'react-native';

/**
 * Lleva el campo de comentario arriba del teclado (PO, 2026-10-12: el teclado
 * lo tapaba en iOS y en Android).
 *
 * El campo vive al final del scroll del detalle del gasto. Al enfocarlo se
 * baja hasta el final, y otra vez cuando el teclado termina de abrir: recién
 * ahí el `KeyboardAvoidingView` achicó la vista, y el primer scroll se quedaba
 * corto.
 */
export function useComentarioSobreTeclado() {
  const scrollRef = useRef<ScrollView>(null);
  const esperandoTeclado = useRef(false);

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      if (!esperandoTeclado.current) return;
      esperandoTeclado.current = false;
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  const alEnfocarComentario = useCallback(() => {
    esperandoTeclado.current = true;
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  return { scrollRef, alEnfocarComentario };
}
