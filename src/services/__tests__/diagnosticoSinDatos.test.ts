import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { recordError, serializeErrorLog, listErrors } from '../errorLog';
import { createSecureStorage } from '@/src/utils/secureStorage';

/**
 * **El diagnóstico no puede llevar plata, nombres ni mails** (T-078 · §7).
 *
 * Es la razón entera por la que se eligió el camino (b) sobre instalar un
 * servicio de crash reporting: esta app tiene importes, nombres y mails en
 * memoria, y un diagnóstico que los arrastre rompe la promesa de la política —
 * la misma que `promesasReales.test.ts` hace cumplir— sin que nadie lo note,
 * porque el archivo lo abre una persona, no un test.
 *
 * Son DOS invariantes distintas y hacen falta las dos:
 *   (a) el MÓDULO no adjunta nada por su cuenta: lo que sale es exactamente lo
 *       que el llamador le pasó, sin estado de la app pegado al costado;
 *   (b) ningún LLAMADOR le pasa un objeto de dominio.
 *
 * ⚠️ **El barrido (b) excluye `__tests__`** — este archivo nombra los tipos
 * prohibidos y sin la exclusión se detectaría a sí mismo. Al proyecto ya le pasó
 * TRES veces. El patrón es el de `src/__tests__/noHardcodedCurrency.test.ts`.
 */
const RAIZ = join(__dirname, '..', '..', '..');

/** Lo que nunca puede viajar adentro de un `recordError`. */
const TIPOS_DE_DOMINIO = ['Expense', 'Payment', 'Group', 'User', 'PersonalEntry', 'ExpenseComment'];

beforeEach(() => createSecureStorage('notices').clearAll());

describe('(a) el módulo no adjunta nada por su cuenta', () => {
  it('el archivo sale con lo que se le pasó, y nada más', () => {
    recordError({ message: 'boom', stack: 'at foo', fatal: true });

    const d = JSON.parse(serializeErrorLog()) as Record<string, unknown>;

    // Las claves del sobre: versión, app, plataforma, cuándo y los errores. Si
    // alguien agrega una clave nueva —un snapshot del store, la cuenta activa—
    // este test lo obliga a decidirlo a la vista en vez de que se cuele.
    expect(Object.keys(d).sort()).toEqual(['app', 'errors', 'exportedAt', 'platform', 'v']);

    const [e] = d.errors as Record<string, unknown>[];
    expect(Object.keys(e!).sort()).toEqual(['at', 'fatal', 'message', 'stack']);
  });

  it('no inventa un `screen` ni un id de usuario cuando el llamador no los dio', () => {
    recordError({ message: 'boom', fatal: false });

    const e = listErrors()[0]!;
    expect(e.screen).toBeUndefined();
    expect(JSON.stringify(e)).not.toMatch(/userId|accountId|email/i);
  });
});

describe('(b) ningún llamador le pasa un objeto de dominio', () => {
  it('las llamadas a recordError sólo pasan strings', () => {
    const ofensas: string[] = [];

    for (const archivo of fuentes(join(RAIZ, 'src')).concat(fuentes(join(RAIZ, 'app')))) {
      const src = readFileSync(archivo, 'utf8');
      if (!/\brecordError\s*\(/.test(src)) continue;

      for (const m of src.matchAll(/\brecordError\s*\(([\s\S]{0,400}?)\)\s*;/g)) {
        const args = m[1]!;
        const tipo = TIPOS_DE_DOMINIO.find(t => new RegExp(`\\b${t}\\b`).test(args));
        if (tipo) ofensas.push(`${relative(RAIZ, archivo)}: pasa un ${tipo}`);
        // Un store entero serializado es la otra forma de la misma fuga.
        if (/JSON\.stringify\s*\(\s*use[A-Z]/.test(args)) {
          ofensas.push(`${relative(RAIZ, archivo)}: serializa un store`);
        }
      }
    }

    expect(ofensas).toEqual([]);
  });

  it('el barrido encuentra las llamadas de verdad, no cero archivos', () => {
    // Un guard que no mira nada siempre está verde. Acá se exige que el barrido
    // haya llegado a los llamadores reales.
    const conLlamadas = fuentes(join(RAIZ, 'src'))
      .concat(fuentes(join(RAIZ, 'app')))
      .filter(a => /\brecordError\s*\(/.test(readFileSync(a, 'utf8')))
      .map(a => relative(RAIZ, a));

    expect(conLlamadas).toEqual(expect.arrayContaining([
      'src/components/ErrorBoundary.tsx',
      'src/services/globalErrorHandler.ts',
    ]));
  });
});

/** Fuentes de un directorio, recursivo. **Los tests no cuentan.** */
function fuentes(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    if (nombre === '__tests__' || nombre === 'node_modules') continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) out.push(...fuentes(ruta));
    else if (/\.tsx?$/.test(nombre)) out.push(ruta);
  }
  return out;
}
