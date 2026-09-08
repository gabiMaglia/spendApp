import { execFileSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * **T-080 · La config del primer build de producción.**
 *
 * Un build es un proceso del servidor de EAS y **casi nada de este ticket se
 * puede testear en Jest** — decirlo es más honesto que fabricar cobertura. Lo
 * que sí se puede fijar es la configuración, que es donde vive el error caro, y
 * los errores caros de acá tienen la misma forma: **no rompen nada, hasta que
 * es tarde.**
 *
 *  - subir un `.apk` a Play y enterarse en la consola;
 *  - publicar al mundo con un comando de rutina porque el `track` decía
 *    `production`;
 *  - commitear la clave de servicio de Google, que da acceso de publicación.
 *
 * ⚠️ **Ningún test de este archivo lee un VALOR de variable de entorno.**
 * Comprueban que los **nombres** estén donde tienen que estar. Un test que
 * imprima un valor al fallar lo filtra al log de CI para siempre.
 *
 * El punto 5 sí barre código fuente y nombra el prefijo que busca, así que
 * **excluye `__tests__` de su propio barrido**: sin eso se encontraría a sí
 * mismo, que es la trampa en la que este proyecto ya cayó tres veces. Patrón:
 * `src/__tests__/noHardcodedCurrency.test.ts`.
 */
const RAIZ = join(__dirname, '..', '..');

type Perfil = {
  channel?: string;
  android?: { buildType?: string };
};
type EasJson = {
  build: Record<string, Perfil>;
  submit: { production?: { android?: Record<string, unknown>; ios?: Record<string, unknown> } };
};

const eas = () => JSON.parse(readFileSync(join(RAIZ, 'eas.json'), 'utf8')) as EasJson;

/**
 * Las variables que el binario necesita. **Nombres, nunca valores.**
 *
 * Están acá para que agregar una quinta obligue a decidirla a la vista: todo lo
 * que lleva el prefijo `EXPO_PUBLIC_` **se compila DENTRO del binario y se puede
 * extraer**. La `anon key` de Supabase lo asume explícitamente
 * (`supabase/001_mailbox.sql`: lo único que separa esos datos del mundo es el
 * RLS). Una clave que sí sea secreta no puede llevar ese prefijo.
 */
const VARIABLES_DEL_BINARIO = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS',
  'EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB',
] as const;

describe('el formato del binario', () => {
  it('production compila un app-bundle y preview un apk', () => {
    // Play EXIGE `.aab` y no acepta `.apk`; pero un `.aab` no se instala a mano,
    // así que la beta cerrada necesita `.apk`. Sin la distinción, o no se puede
    // publicar o no se puede probar antes de publicar.
    expect(eas().build.production?.android?.buildType).toBe('app-bundle');
    expect(eas().build.preview?.android?.buildType).toBe('apk');
  });
});

describe('el track de publicación', () => {
  it('NO es `production` mientras dure la beta cerrada', () => {
    const track = eas().submit.production?.android?.track;

    expect(
      track === 'production'
        ? 'el track es "production": ese comando publica al MUNDO. La beta ' +
          'cerrada va a "internal". Cambiar esto es una decisión de lanzamiento, ' +
          'no un ajuste de configuración.'
        : track,
    ).toBe('internal');
  });

  it('`submit.production` dejó de estar vacío', () => {
    // Era `{}`: `eas submit` sin nada configurado pregunta todo de forma
    // interactiva, que es donde alguien tipea el track equivocado a las 2am.
    expect(Object.keys(eas().submit.production ?? {}).length).toBeGreaterThan(0);
  });
});

describe('la credencial de Google Play', () => {
  it('se referencia por RUTA, nunca embebida en el archivo', () => {
    const android = eas().submit.production?.android ?? {};
    const ruta = android.serviceAccountKeyPath;

    expect(typeof ruta).toBe('string');
    expect(String(ruta)).toMatch(/\.json$/);
    // Un JSON pegado adentro sería la credencial commiteada, con otro nombre.
    expect(JSON.stringify(android)).not.toMatch(/private_key|BEGIN [A-Z ]*PRIVATE KEY/);
  });

  it('el archivo al que apunta está IGNORADO por git', () => {
    // La regla va ANTES de bajar el archivo. Un secreto que entró al historial
    // no se saca con un `rm`: hay que reescribir el historial y rotar la clave
    // — lo que este proyecto ya pagó una vez con el `.env`.
    const ruta = String(eas().submit.production?.android?.serviceAccountKeyPath).replace(/^\.\//, '');

    const ignorado = (() => {
      try {
        execFileSync('git', ['check-ignore', '-q', ruta], { cwd: RAIZ });
        return true;
      } catch {
        return false;
      }
    })();

    expect(ignorado ? ruta : `${ruta} NO está en .gitignore`).toBe(ruta);
  });
});

describe('las variables que viajan dentro del binario', () => {
  it('el código no usa ninguna EXPO_PUBLIC_ que no esté declarada acá', () => {
    // Sin esto, una variable nueva entra al binario sin que nadie decida si
    // puede ser pública — y `EXPO_PUBLIC_` significa exactamente "cualquiera la
    // puede extraer del .apk".
    const usadas = new Set<string>();
    for (const archivo of fuentes(join(RAIZ, 'src')).concat(fuentes(join(RAIZ, 'app')))) {
      for (const m of readFileSync(archivo, 'utf8').matchAll(/EXPO_PUBLIC_[A-Z0-9_]+/g)) {
        usadas.add(m[0]);
      }
    }

    const sinDeclarar = [...usadas].filter(v => !VARIABLES_DEL_BINARIO.includes(v as never));
    expect(sinDeclarar).toEqual([]);
  });

  it('ninguna declarada quedó sin usar', () => {
    // El otro lado: una variable que nadie usa es ruido que alguien va a cargar
    // en EAS "por las dudas". El `.env` ya tiene dos de esos.
    const src = fuentes(join(RAIZ, 'src'))
      .concat(fuentes(join(RAIZ, 'app')))
      .map(a => readFileSync(a, 'utf8'))
      .join('\n');

    expect(VARIABLES_DEL_BINARIO.filter(v => !src.includes(v))).toEqual([]);
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
