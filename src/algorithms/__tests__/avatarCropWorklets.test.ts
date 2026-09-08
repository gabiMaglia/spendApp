import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * **Las funciones que corren en el hilo de UI llevan `'worklet'`** — el crash
 * del recorte de avatar, 2026-09-08.
 *
 * `AvatarCropSheet` las llama desde el `onUpdate` de un gesto, que Reanimated
 * ejecuta en el hilo de UI. Una función importada de otro módulo **sin la
 * directiva no existe en ese runtime**, y el resultado es un crash duro con el
 * nombre puesto:
 *
 *     [Worklets] Tried to synchronously call a non-worklet function
 *     `limitesDePan` on the UI thread.
 *
 * Pasó en iOS **y** en Android, que es lo que descartó que fuera algo nativo de
 * una plataforma.
 *
 * ⚠️ **Ningún test de comportamiento puede atrapar esto**: en Jest son funciones
 * de Node normales y la directiva es un string suelto que no hace nada. Se rompe
 * únicamente en un aparato, moviendo el dedo. Por eso el guard mira el FUENTE.
 *
 * Y el síntoma vale recordarlo porque es contraintuitivo: **tocar y soltar no
 * rompía nada** —`onBegin` sólo toca shared values— y **arrastrar o pellizcar
 * sí**, porque ahí recién entra `onUpdate`.
 *
 * Este test lee UN archivo concreto, no barre el repo, así que no puede
 * detectarse a sí mismo. Si alguien lo convierte en un barrido de `src/`, tiene
 * que excluir `__tests__` — al proyecto ya le pasó tres veces
 * (`src/__tests__/noHardcodedCurrency.test.ts`).
 */
const FUENTE = readFileSync(
  join(__dirname, '..', 'avatarCrop.ts'), 'utf8',
);

/** Las que `AvatarCropSheet` llama desde `onUpdate`, directa o indirectamente. */
const DESDE_EL_HILO_DE_UI = ['acotar', 'limitesDePan', 'escalaParaCubrir'];

/**
 * El primer statement REAL del cuerpo de una función exportada.
 *
 * Se recorre por líneas y no buscando la primera `{`: la firma de `limitesDePan`
 * devuelve `{ x: number; y: number }`, así que la primera llave del texto es la
 * del **tipo de retorno** y no la del cuerpo. (Me comí ese bug escribiendo este
 * mismo guard.) Los comentarios se saltean porque no son statements — un
 * docblock antes de la directiva es legal.
 */
function primerStatement(nombre: string): string {
  const lineas = FUENTE.split('\n');
  let i = lineas.findIndex(l => l.startsWith(`export function ${nombre}(`));
  if (i === -1) return '(no existe)';

  // La firma puede ocupar varias líneas: se avanza hasta la que abre el cuerpo.
  while (i < lineas.length && !lineas[i]!.trimEnd().endsWith('{')) i++;

  let enBloque = false;
  for (let j = i + 1; j < lineas.length; j++) {
    const l = lineas[j]!.trim();
    if (enBloque) { if (l.endsWith('*/')) enBloque = false; continue; }
    if (l === '' || l.startsWith('//')) continue;
    if (l.startsWith('/*')) { if (!l.endsWith('*/')) enBloque = true; continue; }
    return l;
  }
  return '(cuerpo vacío)';
}

describe('la directiva `worklet`', () => {
  it.each(DESDE_EL_HILO_DE_UI)('`%s` la declara como PRIMER statement', (nombre) => {
    // Tiene que ser el primero: Reanimated lee la directiva del cuerpo, y una
    // línea de código antes la invalida. Los comentarios no son statements, así
    // que un docblock arriba está bien.
    expect(primerStatement(nombre).startsWith("'worklet';")).toBe(true);
  });

  it('`recorteDelVisor` NO es worklet, y es a propósito', () => {
    // Corre en el hilo de JS al confirmar. Marcarla arrastraría `medidasUtiles`
    // con su `filter` al runtime de UI sin ninguna necesidad.
    expect(primerStatement('recorteDelVisor').startsWith("'worklet';")).toBe(false);
  });

  it('la hoja no llama nada más desde el hilo de UI', () => {
    /**
     * El otro lado del guard: si alguien agrega una llamada nueva adentro de un
     * `onUpdate`/`onBegin`, este test lo obliga a decidir si esa función también
     * tiene que ser worklet — en vez de descubrirlo con la app cayéndose.
     */
    const hoja = readFileSync(
      join(__dirname, '..', '..', 'components', 'AvatarCropSheet.tsx'), 'utf8',
    );
    const dentroDeGestos = [...hoja.matchAll(/\.(onBegin|onUpdate)\(([\s\S]*?)\n {4}\}\)/g)]
      .map(m => m[2]!)
      .join('\n');

    const llamadas = new Set(
      [...dentroDeGestos.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map(m => m[1]!),
    );
    const permitidas = new Set([
      ...DESDE_EL_HILO_DE_UI,
      'runOnJS',        // el puente al hilo de JS, que es justamente lo correcto
      'if', 'for',      // palabras clave que el regex ve como llamadas
    ]);

    expect([...llamadas].filter(n => !permitidas.has(n))).toEqual([]);
  });
});
