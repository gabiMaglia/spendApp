import { readFileSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..', '..', '..');
const leer = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

/** T-293: los íconos de categoría son propios; Ionicons no puede volver a dibujarlos. */
describe('consumidores de categoría sin Ionicons', () => {
  it.each([
    'src/components/CategoryIcon.tsx',
    'src/components/IconoCategoria.tsx',
    'src/screens/expense/components/CuboCategoria.tsx',
  ])('%s no importa Ionicons', archivo => {
    expect(leer(archivo)).not.toMatch(/Ionicons/);
  });

  it('CATEGORIES ya no lleva nombres de Ionicons', () => {
    expect(leer('src/screens/expense/repartoDeGasto.ts')).not.toMatch(/-outline|Ionicons/);
  });

  it('la tarjeta del gasto no pide íconos de categoría a Ionicons', () => {
    expect(leer('src/screens/expense/components/TarjetaDescripcionMonto.tsx')).not.toMatch(/trending-up-outline|ellipsis-horizontal-outline|\.icon\b/);
  });
});
