import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * T-121 — fusión de Inicio en Personal: la pestaña `index` pasa a mostrar
 * Personal (mismo label que tenía la pestaña vieja `personal`), y el título
 * "Tus cuentas" (antes exclusivo de Inicio) migra al header de esa pantalla.
 */

const RAIZ = join(__dirname, '..', '..');
const leer = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

describe('T-121 — pestaña index fusionada (Personal)', () => {
  it('la pestaña index usa la clave i18n tabs.personal con ícono analytics-outline', () => {
    const src = leer('app/(tabs)/_layout.tsx');
    const lineaIndex = src.split('\n').find(l => l.includes("screen('index'"));
    expect(lineaIndex).toBeDefined();
    expect(lineaIndex).toMatch(/t\('tabs\.personal'\)/);
    expect(lineaIndex).toMatch(/'analytics-outline'/);
  });

  it('ya no hay una pestaña separada registrada como personal', () => {
    const src = leer('app/(tabs)/_layout.tsx');
    const lineaPersonal = src.split('\n').find(l => l.includes("screen('personal'"));
    expect(lineaPersonal).toBeUndefined();
  });
});
