import { execSync } from 'child_process';

/**
 * T-289: una sola puerta a la vibración. Si un archivo nombra `expo-haptics` por su
 * cuenta, esa vibración queda fuera del mapa de intenciones.
 *
 * Se busca el especificador entre comillas simples o dobles, sin atarlo a la sintaxis:
 * cubre `import … from`, `export … from`, `import 'x'`, `import('x')` y `require('x')`.
 * `--untracked` suma los archivos nuevos aún sin `git add`; lo ignorado por .gitignore
 * (p. ej. node_modules) queda afuera a propósito.
 */
describe('expo-haptics sólo se importa en src/utils/haptics.ts', () => {
  it('ningún otro archivo de la app lo nombra', () => {
    const salida = execSync(
      "git grep -l --untracked -E \"['\\\"]expo-haptics['\\\"]\" -- 'app' 'src' 'components' 'hooks' ':!*__tests__*' || true",
      { cwd: process.cwd(), encoding: 'utf8' },
    ).split('\n').filter(Boolean);
    expect(salida).toEqual(['src/utils/haptics.ts']);
  });
});
