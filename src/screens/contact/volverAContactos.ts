import { router } from 'expo-router';

/**
 * Vuelve a Contactos. Si la pantalla se abrió por deep link no hay a dónde volver, y
 * `router.back()` no haría nada: se reemplaza por la pestaña.
 */
export function volverAContactos() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)/friends');
}
