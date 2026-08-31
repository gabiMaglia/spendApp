import { claveDeFalloDeSync } from '../useSyncFailure';
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
    const claves = ['too_large', 'no_key'].map(claveDeFalloDeSync);
    expect(new Set(claves).size).toBe(2);
    expect(claves.every(c => c.startsWith('sync.'))).toBe(true);
  });

  it('una razón desconocida NO deja el cartel vacío', () => {
    // Preferible un mensaje genérico a un cartel en blanco: el usuario tiene
    // que enterarse igual de que sus gastos no están saliendo del teléfono.
    expect(claveDeFalloDeSync('lo_que_sea')).toBe('sync.failure_unknown');
  });
});
