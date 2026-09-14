import { readFileSync } from 'fs';
import { join } from 'path';
import { MARMOL_BLEED } from '@/src/components/CollapsibleHeader';

/**
 * **Lo que corre en el hilo de UI lleva `'worklet'`** (T-128, mismo crash que T-067).
 *
 * `useAnimatedScrollHandler` y `useAnimatedStyle` ejecutan en el runtime de UI; una función
 * importada SIN la directiva no existe ahí y la app se cae en el aparato. En Jest la directiva
 * es un string suelto: ningún test de comportamiento lo atrapa, por eso se mira el fuente.
 */
const FUENTE = readFileSync(join(__dirname, '..', 'useHeaderColapsable.ts'), 'utf8');

const DESDE_EL_HILO_DE_UI = [
  'progresoColapso', 'alturaHeaderColapsable', 'alturaBloqueTituloVisible',
  'opacidadTituloCompacto', 'opacidadTituloCompactoSinMovimiento',
];

function primerStatement(nombre: string): string {
  const lineas = FUENTE.split('\n');
  let i = lineas.findIndex(l => l.startsWith(`export function ${nombre}(`));
  if (i === -1) return '(no existe)';
  while (i < lineas.length && !lineas[i]!.trimEnd().endsWith('{')) i++;
  for (let j = i + 1; j < lineas.length; j++) {
    const l = lineas[j]!.trim();
    if (l === '' || l.startsWith('//')) continue;
    return l;
  }
  return '(cuerpo vacío)';
}

describe('header colapsable en el hilo de UI (T-128)', () => {
  it.each(DESDE_EL_HILO_DE_UI)('`%s` declara `worklet` como primer statement', (nombre) => {
    expect(primerStatement(nombre).startsWith("'worklet';")).toBe(true);
  });

  it('el hook no importa el componente del header (sin ciclo de require)', () => {
    expect(FUENTE).not.toMatch(/from '@\/src\/components\/CollapsibleHeader'/);
  });

  it('el mármol tiene colchón para el overscroll de iOS: nunca se ve un hueco', () => {
    expect(MARMOL_BLEED).toBeGreaterThanOrEqual(60);
  });
});
