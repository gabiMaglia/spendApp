import { claveDeFalloDeSync } from '../useSyncFailure';
import type { BlockingReason } from '../publishHealth';
import { recordPublish, clearPublishFailures, blockingFailures } from '../publishHealth';

/**
 * T-058: un grupo que dejó de sincronizar no puede verse igual que uno sano.
 *
 * `publishHealth` existe desde hace tiempo y su docblock ya describía el
 * síntoma —«ese grupo deja de viajar para siempre, en silencio, mientras el
 * resto de la app se ve perfecta»— pero sólo se leía desde la pantalla de
 * diagnóstico, que un usuario normal no abre nunca.
 */
beforeEach(() => clearPublishFailures());

describe('qué fallos vale la pena mostrar', () => {
  it('`too_large` se muestra: no se arregla esperando', () => {
    recordPublish('g1', { ok: false, reason: 'too_large' });
    expect(blockingFailures().map(f => f.groupId)).toEqual(['g1']);
  });

  it('`no_key` se muestra: hace falta que alguien intervenga', () => {
    recordPublish('g1', { ok: false, reason: 'no_key' });
    expect(blockingFailures()).toHaveLength(1);
  });

  it('un corte de red NO se muestra', () => {
    // Se reintenta solo en la próxima publicación. Avisar de esto entrenaría
    // al usuario a ignorar el aviso, que es cómo un aviso se vuelve inútil.
    recordPublish('g1', { ok: false, reason: 'network' });
    expect(blockingFailures()).toEqual([]);
  });

  it('una publicación exitosa borra el fallo anterior', () => {
    recordPublish('g1', { ok: false, reason: 'too_large' });
    recordPublish('g1', { ok: true } as never);
    expect(blockingFailures()).toEqual([]);
  });

  it('el fallo es POR GRUPO: uno roto no ensucia a los sanos', () => {
    recordPublish('g1', { ok: false, reason: 'too_large' });
    recordPublish('g2', { ok: false, reason: 'network' });
    expect(blockingFailures().map(f => f.groupId)).toEqual(['g1']);
  });
});

describe('claveDeFalloDeSync', () => {
  it('cada razón bloqueante tiene su propio mensaje', () => {
    const razones: BlockingReason[] = ['too_large', 'no_key'];
    const claves = razones.map(claveDeFalloDeSync);
    expect(new Set(claves).size).toBe(razones.length);
    expect(claves.every(c => c.startsWith('sync.'))).toBe(true);
  });

  /**
   * No hay test de «razón desconocida» y es a propósito: **no se puede
   * construir**. El parámetro es la unión `BlockingReason`, no `string`, y no
   * hay `default`, así que una razón nueva rompe la COMPILACIÓN.
   *
   * La primera versión prometía esto en un comentario y no lo cumplía: con
   * `reason: string` y un `default`, una razón nueva caía a un mensaje genérico
   * en silencio y el comentario seguía diciendo que era imposible.
   */
  it('la exhaustividad la garantiza el tipo, no un test', () => {
    const todas: Record<BlockingReason, string> = {
      too_large: claveDeFalloDeSync('too_large'),
      no_key:    claveDeFalloDeSync('no_key'),
    };
    // Si se agrega una razón a `BlockingReason`, este objeto deja de compilar.
    expect(Object.keys(todas)).toHaveLength(2);
  });
});
