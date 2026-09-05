import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * T-088 · Guard: el cliente no razona sobre la huella, y el secreto sale por un
 * solo lugar.
 *
 * Las dos propiedades que sostienen ADR-009 D-1/D-2 se pierden en silencio:
 *
 *  1. **La huella la deriva el servidor.** Si algún día el cliente la calcula,
 *     la lee o la manda, alguien entendió el mecanismo al revés: quien puede
 *     elegir la huella copia la ajena, y volvemos al defecto de T-086.
 *  2. **El preimagen viaja SÓLO en la llamada de borrado.** Si apareciera en un
 *     `insert`, el valor de alta frecuencia pasaría a ser el credencial de
 *     borrado — que es exactamente lo que el diseño evita.
 *
 * ⚠️ El barrido **saltea `__tests__`**, y no por prolijidad: este archivo nombra
 * la cadena prohibida en su propio docblock, así que sin la exclusión se
 * detectaría a sí mismo. Al proyecto ya le pasó tres veces con otros guards.
 */

const RAIZ = join(__dirname, '..', '..');
const CARPETAS = ['src', 'app'];

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === '__tests__' || nombre === 'node_modules') continue;
      out.push(...archivos(ruta));
    } else if (/\.tsx?$/.test(nombre)) {
      out.push(ruta);
    }
  }
  return out;
}

const FUENTES = CARPETAS.flatMap(c => archivos(join(RAIZ, c)));

describe('la prenda de escritura, del lado del cliente', () => {
  it('el código no menciona la huella en ningún lado', () => {
    const ofensas = FUENTES
      .filter(f => readFileSync(f, 'utf8').includes('owner' + '_tag'))
      .map(f => f.replace(RAIZ + '/', ''));

    expect(ofensas).toEqual([]);
  });

  it('el preimagen viaja únicamente en la llamada de borrado', () => {
    const ofensas: string[] = [];
    for (const f of FUENTES) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes('p_secret')) continue;
      // Donde aparezca, tiene que ser dentro de un `rpc(` y nunca de un
      // `insert(`: el secreto no se guarda en una fila.
      if (!/rpc\(/.test(src) || /insert\([^)]*p_secret/s.test(src)) {
        ofensas.push(f.replace(RAIZ + '/', ''));
      }
    }
    expect(ofensas).toEqual([]);
  });

  it('lo que se estampa en la fila es el proof, y sale de la prenda', () => {
    // Si alguien cableara un valor cualquiera acá, el borrado dejaría de
    // encontrar sus propios sobres sin que ningún test se caiga.
    const relay = readFileSync(join(RAIZ, 'src', 'sync', 'relay.ts'), 'utf8');
    expect(relay).toMatch(/prendaDelAparato\(\)\?\.proof/);
  });
});
