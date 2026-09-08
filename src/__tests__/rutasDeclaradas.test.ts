import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * **Ninguna ruta declarada sobrevive a su archivo** (T-083).
 *
 * `app/_layout.tsx` declara un `<Stack.Screen name="X">` por pantalla. Cuando se
 * borra una pantalla y la declaración queda, Expo Router **no rompe el
 * arranque**: hace `console.warn` —«No route named "X" exists in nested
 * children»— y descarta la entrada
 * (`node_modules/expo-router/build/useScreens.js:67-71`, verificado). O sea que
 * el modo de falla es el peor de los baratos: **en producción no se ve nada**, y
 * queda una configuración que miente sobre las rutas de la app.
 *
 * Pasó al sacar WebRTC: quedaban `sync/webrtc` y `debug/webrtc` apuntando a
 * archivos borrados, y no estaba en ningún criterio de aceptación. Este guard
 * existe para que la próxima vez no dependa de que alguien se acuerde.
 *
 * ⚠️ Barre el árbol de `app/`, así que **excluye `__tests__`** de su propio
 * barrido — el patrón de `src/__tests__/noHardcodedCurrency.test.ts`.
 */
const RAIZ = join(__dirname, '..', '..');
const APP = join(RAIZ, 'app');

/** Las rutas que `app/_layout.tsx` declara, en orden de aparición. */
function rutasDeclaradas(): string[] {
  const src = readFileSync(join(APP, '_layout.tsx'), 'utf8');
  return [...src.matchAll(/<Stack\.Screen\s+name=["']([^"']+)["']/g)].map(m => m[1]!);
}

/** Los archivos de ruta que existen de verdad, como los nombra Expo Router. */
function rutasReales(dir: string = APP, prefijo = ''): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    if (nombre === '__tests__' || nombre === 'node_modules') continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      // Un directorio con `_layout.tsx` ES una ruta: es como Expo Router nombra
      // a los grupos, p. ej. `(tabs)`. Sin esto el guard acusaría a la ruta más
      // importante de la app de no existir.
      if (existsSync(join(ruta, '_layout.tsx'))) out.push(`${prefijo}${nombre}`);
      out.push(...rutasReales(ruta, `${prefijo}${nombre}/`));
    } else if (/\.tsx?$/.test(nombre)) {
      out.push(`${prefijo}${nombre.replace(/\.tsx?$/, '')}`);
    }
  }
  return out;
}

describe('las rutas declaradas existen', () => {
  it('cada `<Stack.Screen name>` tiene su archivo en `app/`', () => {
    const reales = new Set(rutasReales());
    const fantasmas = rutasDeclaradas().filter(r => !reales.has(r));

    expect(
      fantasmas.length === 0
        ? []
        : fantasmas.map(r =>
            `<Stack.Screen name="${r}"> no tiene archivo. Expo Router lo descarta con un ` +
            'console.warn que en producción nadie ve: sacá la línea.',
          ),
    ).toEqual([]);
  });

  it('el barrido encuentra rutas de verdad, no cero', () => {
    // Un guard que no mira nada siempre está verde.
    expect(rutasDeclaradas().length).toBeGreaterThan(5);
    expect(existsSync(join(APP, '_layout.tsx'))).toBe(true);
  });
});
