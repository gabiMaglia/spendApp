import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * T-115 (PO 2026-09-13): se saca la pestaña "Yo" del tab bar — a esa pantalla
 * se llega tocando el avatar del header (T-114). La RUTA sigue existiendo
 * (deep links, `router.push('/(tabs)/user')` desde `TabHeader`): lo único que
 * cambia es que no aparece como botón en la barra.
 *
 * Expo Router v6 (`node_modules/expo-router/build/layouts/TabsClient.js:16-28`,
 * versión instalada 6.0.24, verificado): un `<Tabs.Screen>` con
 * `options={{ href: null }}` oculta el botón (`tabBarItemStyle:
 * {display:'none'}` + `tabBarButton` nulo) SIN afectar el router — la
 * alternativa (borrar el screen entero) sí rompería la ruta.
 */

const RAIZ = join(__dirname, '..', '..');
const LAYOUT = readFileSync(join(RAIZ, 'app/(tabs)/_layout.tsx'), 'utf8');

describe('la pestaña "Yo" ya no está en el tab bar (T-115)', () => {
  it('no arma un botón visible para "user" con el helper `screen(...)`', () => {
    expect(LAYOUT).not.toMatch(/screen\(\s*'user'/);
  });

  it('declara la ruta "user" oculta con `href: null` (no la borra)', () => {
    const bloque = LAYOUT.match(/<Tabs\.Screen[^>]*name=["']user["'][\s\S]*?\/>/);
    expect(bloque).not.toBeNull();
    expect(bloque![0]).toMatch(/href:\s*null/);
  });

  it('el archivo de la ruta sigue existiendo (deep links y TabHeader no rompen)', () => {
    expect(existsSync(join(RAIZ, 'app/(tabs)/user.tsx'))).toBe(true);
  });

  it('las otras cinco pestañas siguen usando el helper visible', () => {
    for (const name of ['index', 'personal', 'friends', 'groups', 'activity']) {
      expect(LAYOUT).toMatch(new RegExp(`screen\\(\\s*'${name}'`));
    }
  });
});
