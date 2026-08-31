import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Guard de la clase de bug que el PO encontró el 31/08: **la foto se ve en una
 * pantalla y en otra no.**
 *
 * `UserAvatar` existe justamente para resolver nombre, color y foto por id en
 * un solo lugar — su propio docblock dice que se creó para no tener que "tocar
 * los diez `<Avatar>` sueltos y acordarse de hacerlo en el próximo". Se
 * migraron algunos y quedaron seis sin migrar: contactos mostraba la foto nueva
 * y el detalle de grupo, los splits, saldar, los comentarios y la pila de la
 * tab Grupos seguían dibujando iniciales.
 *
 * El patrón NO es "faltaban seis". Es que dibujar la persona con el primitivo
 * en vez del componente que resuelve **no falla**: se ve bien, sólo que sin
 * foto. Nada lo detecta salvo un ojo humano comparando dos pantallas.
 *
 * La señal es `hueForUser(...)` al lado de un `<Avatar`: significa que quien
 * escribe TIENE el id de la persona en la mano y aun así está resolviendo el
 * color a mano en vez de delegar. Si tenés el id, va `UserAvatar`.
 */
const RAICES = ['app', 'src/components'];
const PERMITIDOS = new Set([
  // El primitivo y quien lo envuelve. Acá `<Avatar>` es el punto, no el defecto.
  'src/components/Avatar.tsx',
  'src/components/UserAvatar.tsx',
  // El propio perfil: la foto sale de `authStore` y se pasa explícita.
  'app/(tabs)/user.tsx',
]);

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    if (nombre === '__tests__' || nombre === 'node_modules') continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) out.push(...archivos(ruta));
    else if (/\.tsx$/.test(nombre)) out.push(ruta);
  }
  return out;
}

describe('la foto de perfil no se puede perder por pantalla', () => {
  it('nadie dibuja a una persona con `<Avatar>` teniendo su id a mano', () => {
    const culpables: string[] = [];

    for (const raiz of RAICES) {
      for (const ruta of archivos(raiz)) {
        if (PERMITIDOS.has(ruta)) continue;
        const src = readFileSync(ruta, 'utf8');
        src.split('\n').forEach((linea, i) => {
          // `<Avatar ` con el color resuelto a mano desde un id ⇒ el id estaba
          // disponible y se usó el primitivo igual.
          if (/<Avatar[\s]/.test(linea) && /hueForUser\(/.test(linea)) {
            culpables.push(`${ruta}:${i + 1}`);
          }
        });
      }
    }

    expect(culpables).toEqual([]);
  });
});
