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
  // T-118 (PO 2026-09-13): el selector de repetición del alta de gasto pasa
  // al mismo estilo "T invertida" en fila deslizable.
  'src/components/RecurrencePicker.tsx',
];

/** Todos los bloques `<Segmented ... />` (self-closing) de un archivo, completos. */
function bloquesSegmented(src: string): string[] {
  return src.match(/<Segmented[\s\S]*?\/>/g) ?? [];
}

describe('pestañas unificadas', () => {
  it.each(CON_PESTANAS)('%s usa Segmented variant="tabs" con íconos', archivo => {
    const src = leer(archivo);
    expect(src).toMatch(/<Segmented[\s\S]*?variant="tabs"/);
    expect(src).toMatch(/icon:\s*'[a-z-]+-outline'/);
  });

  /**
   * El regex de arriba es "hay AL MENOS UN Segmented con variant=tabs en el
   * archivo" — no greedy, se conforma con el primero que encuentra. Una
   * pantalla con VARIOS selectores (T-103.D: `app/expense/new.tsx` tiene
   * Gasto/Ingreso + modo de reparto + sub-modo de porcentaje) podía migrar
   * uno solo y dejar los demás en el estilo viejo sin que este guard lo
   * notara. Este test recorre CADA bloque `<Segmented>` del archivo, uno
   * por uno, así ninguno se cuela.
   */
  it.each(CON_PESTANAS)('%s: NINGÚN <Segmented> del archivo quedó en el estilo viejo', archivo => {
    const bloques = bloquesSegmented(leer(archivo));
    expect(bloques.length).toBeGreaterThan(0);
    for (const bloque of bloques) {
      expect(bloque).toMatch(/variant="tabs"/);
    }
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
