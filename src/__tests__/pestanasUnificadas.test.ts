import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * **Todas las pestañas de la app tienen el mismo look** (PO, 2026-09-12: «dale el mismo
 * estilo a todos los tab navigators de la app»).
 *
 * Había dos selectores hechos a mano que copiaban la pastilla —Agregar contacto y Salir del
 * grupo— y por eso el estilo divergía pantalla por pantalla. Este guard fija que las
 * pantallas usen `Segmented` y que las que separan contenido lo hagan con `variant="tabs"`.
 */

const RAIZ = join(__dirname, '..', '..');
const leer = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

/** Pantallas cuyo selector cambia TODO el contenido: van en pestañas. */
const CON_PESTANAS = [
  'app/expense/new.tsx',
  'app/contact/add.tsx',
  'app/(tabs)/groups.tsx',
  'app/(tabs)/activity.tsx',
  'src/components/NoticeInboxSheet.tsx',
];

describe('pestañas unificadas', () => {
  it.each(CON_PESTANAS)('%s usa Segmented variant="tabs" con íconos', archivo => {
    const src = leer(archivo);
    expect(src).toMatch(/<Segmented[\s\S]*?variant="tabs"/);
    expect(src).toMatch(/icon:\s*'[a-z-]+-outline'/);
  });

  it('ninguna pantalla arma un selector a mano con Pressables y fondo de pastilla', () => {
    // La firma de la copia: un contenedor `segmented`/`tabs` con `padding: 4, gap: 4`.
    for (const archivo of ['app/contact/add.tsx', 'app/groups/leave.tsx']) {
      expect(leer(archivo)).not.toMatch(/padding:\s*4,\s*gap:\s*4/);
    }
  });

  it('Salir del grupo usa el componente común en su versión de formulario', () => {
    expect(leer('app/groups/leave.tsx')).toMatch(/<Segmented/);
  });
});
