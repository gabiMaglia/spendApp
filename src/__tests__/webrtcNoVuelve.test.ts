import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * **WebRTC no vuelve** (T-083).
 *
 * Se sacó `react-native-webrtc` con su config plugin porque **arrastraba ocho
 * permisos de Android** —incluidos micrófono y Bluetooth— y **dos cadenas del
 * `Info.plist` de iOS**, para una función a la que **no se llegaba desde ningún
 * lado de la app**: la única entrada era un botón dentro de una pantalla
 * huérfana.
 *
 * Un ticket de borrado sin guard se deshace solo: alguien reinstala el paquete
 * «para probar algo», los permisos vuelven, y lo que se nota es una fila nueva
 * en la ficha de la tienda seis meses después. Por eso esto es un test y no una
 * nota en un documento.
 *
 * ⚠️ **Si esto se reabre**, no alcanza con borrar el test: hay que leer
 * `engram/plans/T-083.md` §5 —las cinco cosas que se rompen— y volver a
 * decidirlas. Empezando por que **la política de privacidad dice que la app no
 * pide micrófono**, y ese plugin lo declara solo.
 *
 * Este guard lee `package.json` y `app.json` **como JSON**, no barre código
 * fuente, así que no puede detectarse a sí mismo. Si alguien lo convierte en un
 * barrido de `src/`, tiene que excluir `__tests__` — al proyecto ya le pasó tres
 * veces (`src/__tests__/noHardcodedCurrency.test.ts`).
 */
const RAIZ = join(__dirname, '..', '..');

const pkg = () => JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const app = () => JSON.parse(readFileSync(join(RAIZ, 'app.json'), 'utf8')) as {
  expo: { plugins: (string | [string, unknown])[] };
};

const POR_QUE =
  'ocho permisos de Android (micrófono y Bluetooth incluidos) y dos cadenas del Info.plist ' +
  'de iOS, para una pantalla a la que no se llega. Ver engram/plans/T-083.md antes de reabrirlo.';

describe('WebRTC no está instalado', () => {
  it('no aparece en las dependencias', () => {
    const todas = Object.keys({ ...pkg().dependencies, ...pkg().devDependencies });
    const vueltos = todas.filter(d => /react-native-webrtc/.test(d));

    expect(vueltos.length === 0 ? [] : [`volvió ${vueltos.join(', ')}: ${POR_QUE}`]).toEqual([]);
  });

  it('su config plugin no está declarado en app.json', () => {
    const nombres = app().expo.plugins.map(p => (Array.isArray(p) ? p[0] : p));
    const vuelto = nombres.filter(n => /react-native-webrtc/.test(n));

    expect(vuelto.length === 0 ? [] : [`volvió el plugin: ${POR_QUE}`]).toEqual([]);
  });
});
