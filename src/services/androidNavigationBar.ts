import { Platform } from 'react-native';

/**
 * Único importador de `expo-navigation-bar` (T-137).
 *
 * Android, con `edgeToEdgeEnabled` (`app.json`), dibuja la barra de tres
 * botones como una franja del sistema que no hereda el tema de la app: sin
 * esto quedaba clara siempre, incluso en modo oscuro, y con un tono distinto
 * al `bg` real incluso en modo claro.
 *
 * **Best effort, como el resto de los módulos nativos opcionales del
 * proyecto**: en iOS no hace nada (el método ni existe ahí). En Android 15+
 * con edge-to-edge forzado por el sistema, `setBackgroundColorAsync` puede
 * ser un no-op silencioso — no hay forma de detectarlo desde acá, así que el
 * try/catch cubre tanto "el módulo no está" como "el pedido se ignoró".
 */
export async function syncAndroidNavigationBar(bg: string, scheme: 'light' | 'dark'): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NavigationBar = require('expo-navigation-bar');
    await NavigationBar.setBackgroundColorAsync(bg);
    // Íconos claros sobre fondo oscuro y viceversa — si no, el botón de
    // "atrás" del sistema queda invisible contra su propio fondo.
    await NavigationBar.setButtonStyleAsync(scheme === 'dark' ? 'light' : 'dark');
  } catch {
    // Ver docblock: no hay nada que hacer si el sistema no lo permite.
  }
}
