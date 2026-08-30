import { readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { COBERTURA_FUSION } from '../accountLink';

/**
 * Guard de la clase de bug que mordio TRES veces: un store que persiste
 * scopeado por cuenta pero que nadie fusiona cuando dos cuentas se enlazan.
 *
 *  1. `personal` — leia una clave inexistente y reportaba la fusion como
 *     exitosa con cero registros; los movimientos desaparecian en silencio.
 *  2. `groupkeys` — sin la clave, el device no puede descifrar los sobres del
 *     grupo: los gastos llegan y no se pueden leer (T-047).
 *  3. `archived_v1` — mismo bucket que groups pero otra clave, fuera del merge.
 *
 * El patron no es "faltaba un store": es que la lista se escribe a mano y se
 * desincroniza. Este test no revisa los tres casos, revisa la CLASE — si
 * aparece un store scopeado sin declarar, falla y obliga a decidir.
 */
const DIR = join(__dirname, '..');

function storesScopeados(): string[] {
  return readdirSync(DIR)
    .filter(f => /\.ts$/.test(f) && f !== 'accountLink.ts')
    .filter(f => /writeScoped(Bool)?\s*\(/.test(readFileSync(join(DIR, f), 'utf8')))
    .map(f => basename(f, '.ts'))
    .sort();
}

describe('la fusion de cuentas cubre todo lo que se persiste por cuenta', () => {
  it('ningun store scopeado queda sin declarar', () => {
    const sinDeclarar = storesScopeados().filter(s => !(s in COBERTURA_FUSION));
    expect(sinDeclarar).toEqual([]);
  });

  it('no quedan declaraciones de stores que ya no existen', () => {
    const reales = new Set(storesScopeados());
    const fantasmas = Object.keys(COBERTURA_FUSION).filter(s => !reales.has(s));
    expect(fantasmas).toEqual([]);
  });

  it('cada declaracion dice QUE pasa, no solo que existe', () => {
    for (const [store, nota] of Object.entries(COBERTURA_FUSION)) {
      expect(nota.length).toBeGreaterThan(15);
      expect(`${store}: ${nota}`).toMatch(/fusionado|aparte|no es un store/);
    }
  });
});
