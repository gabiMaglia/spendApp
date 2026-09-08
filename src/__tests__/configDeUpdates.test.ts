import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * **T-079 · La config de las actualizaciones por aire.**
 *
 * Jest casi no puede tocar `expo-updates`: es nativo y el canal se resuelve en
 * el servidor de EAS. Lo que sí se puede fijar acá es la **configuración**, que
 * es exactamente donde vive el error caro.
 *
 * **El error caro, en una frase:** si el `runtimeVersion` no distingue un
 * binario nativo de otro, el servidor le entrega JS nuevo a un binario que no
 * lo soporta, la app crashea al abrir **en todos los teléfonos a la vez**, y no
 * hay forma de arreglarlo por el mismo canal — para recibir el arreglo hay que
 * poder abrir la app.
 *
 * Y no es hipotético en este proyecto: `eas update:configure` dejó la política
 * en `appVersion` por default cuando se corrió (2026-09-07), y este repo
 * **cambió nativos sin tocar `version`** (`207e4b0`: íconos, splash, permisos,
 * con `version` clavada en 1.0.0). O sea que con el default los dos binarios
 * compartían runtime y se cruzaban el JS. Este test es lo que impide que vuelva
 * a pasar por descuido.
 *
 * Lee JSON de configuración, **no barre código fuente**, así que no puede
 * detectarse a sí mismo. Si alguien lo convierte en un barrido de `src/`,
 * tiene que excluir `__tests__` — al proyecto ya le pasó tres veces
 * (`src/__tests__/noHardcodedCurrency.test.ts`).
 */
const RAIZ = join(__dirname, '..', '..');

type AppJson = {
  expo: {
    runtimeVersion?: { policy?: string } | string;
    updates?: Record<string, unknown>;
    extra?: { eas?: { projectId?: string } };
  };
};
type EasJson = { build: Record<string, { channel?: string }> };

const app  = () => JSON.parse(readFileSync(join(RAIZ, 'app.json'), 'utf8')) as AppJson;
const eas  = () => JSON.parse(readFileSync(join(RAIZ, 'eas.json'), 'utf8')) as EasJson;
const pkg  = () => JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')) as
  { dependencies: Record<string, string> };

describe('runtimeVersion', () => {
  it('usa la política `fingerprint`, NO `appVersion`', () => {
    const rv = app().expo.runtimeVersion;
    const policy = typeof rv === 'object' ? rv?.policy : rv;

    expect(
      policy === 'fingerprint'
        ? 'fingerprint'
        : `runtimeVersion es "${String(policy)}". Tiene que ser "fingerprint": ` +
          'este proyecto cambia nativos sin tocar `version` (207e4b0), así que con ' +
          '`appVersion` dos binarios distintos comparten runtime y el servidor le ' +
          'entrega JS a uno que no lo soporta. Eso crashea al abrir en todos los ' +
          'teléfonos a la vez, y no se arregla por el mismo canal.',
    ).toBe('fingerprint');
  });
});

describe('el bloque updates', () => {
  it('apunta al proyecto de EAS de esta app, no a otro', () => {
    const u = app().expo.updates ?? {};
    const projectId = app().expo.extra?.eas?.projectId;

    expect(typeof u.url).toBe('string');
    expect(String(u.url)).toMatch(/^https:\/\/u\.expo\.dev\//);
    // La `url` la generó `eas update:configure`; esto verifica que sigue siendo
    // la de ESTE proyecto y que nadie la reescribió a mano apuntando a otro.
    expect(String(u.url)).toContain(String(projectId));
  });

  it('no espera a la red para abrir la app', () => {
    // Esta app es offline-first por diseño: un arranque que depende de la red
    // lo contradice, y mete la latencia del CDN en el splash de cada apertura.
    expect(app().expo.updates?.fallbackToCacheTimeout).toBe(0);
  });

  it('NO apaga las medidas anti-brick', () => {
    // `disableAntiBrickingMeasures` hace lo que dice el nombre: deja la app
    // inservible si un update malo impide abrirla.
    expect(app().expo.updates).not.toHaveProperty('disableAntiBrickingMeasures');
  });
});

describe('los canales', () => {
  it('preview y production tienen canal, y son distintos', () => {
    const b = eas().build;
    expect(b.preview?.channel).toBe('preview');
    expect(b.production?.channel).toBe('production');
    expect(b.preview!.channel).not.toBe(b.production!.channel);
  });

  it('development NO tiene canal', () => {
    // Un dev client tomando updates publicados haría que lo que se prueba en
    // desarrollo no sea lo que hay en el disco.
    expect(eas().build.development?.channel).toBeUndefined();
  });
});

describe('la dependencia', () => {
  it('`expo-updates` está instalada', () => {
    // Sin el módulo nativo en el binario, la config de arriba no hace nada: un
    // build compilado sin él no puede recibir actualizaciones NUNCA.
    expect(Object.keys(pkg().dependencies)).toContain('expo-updates');
  });
});
