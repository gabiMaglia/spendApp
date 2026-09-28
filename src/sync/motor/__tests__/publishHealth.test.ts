import {
  recordPublish, publishFailures, blockingFailures, clearPublishFailures,
} from '../publishHealth';

/**
 * `publishNow` se traga los errores — tiene que hacerlo, es offline-first. Pero
 * tragárselos SIN DEJAR RASTRO produjo dos veces el mismo síntoma: "no me llega
 * nada", sin error y sin nada que mirar. Esto es la memoria que faltaba.
 */

beforeEach(() => clearPublishFailures());

describe('memoria de publicaciones fallidas', () => {
  it('anota el fallo con su motivo', () => {
    recordPublish('g1', { ok: false, reason: 'too_large' });

    expect(publishFailures()).toMatchObject([{ groupId: 'g1', reason: 'too_large' }]);
  });

  // Si no se limpiara, un fallo viejo quedaría acusando a un grupo que ya anda.
  it('una publicación exitosa borra el fallo anterior', () => {
    recordPublish('g1', { ok: false, reason: 'network' });
    recordPublish('g1', { ok: true, seq: 5 });

    expect(publishFailures()).toEqual([]);
  });

  it('el último fallo reemplaza al anterior del mismo grupo', () => {
    recordPublish('g1', { ok: false, reason: 'network' });
    recordPublish('g1', { ok: false, reason: 'too_large' });

    expect(publishFailures()).toHaveLength(1);
    expect(publishFailures()[0]!.reason).toBe('too_large');
  });

  it('cada grupo lleva el suyo', () => {
    recordPublish('g1', { ok: false, reason: 'too_large' });
    recordPublish('g2', { ok: false, reason: 'no_key' });

    expect(publishFailures()).toHaveLength(2);
  });
});

describe('cuáles vale la pena mostrar', () => {
  /**
   * `network` se reintenta solo en la próxima publicación: mostrarlo sería
   * ruido y entrenaría al usuario a ignorar el aviso. `too_large` y `no_key` NO
   * se arreglan esperando.
   */
  it('un problema de red no se muestra: se arregla solo', () => {
    recordPublish('g1', { ok: false, reason: 'network' });

    expect(blockingFailures()).toEqual([]);
  });

  it('pasarse de 256KB sí: ese grupo dejó de viajar y no va a mejorar solo', () => {
    recordPublish('g1', { ok: false, reason: 'too_large' });

    expect(blockingFailures()).toHaveLength(1);
  });

  it('quedarse sin la clave del grupo también', () => {
    recordPublish('g1', { ok: false, reason: 'no_key' });

    expect(blockingFailures()).toHaveLength(1);
  });

  it('mezclados, sólo salen los que importan', () => {
    recordPublish('g1', { ok: false, reason: 'network' });
    recordPublish('g2', { ok: false, reason: 'too_large' });

    expect(blockingFailures().map(f => f.groupId)).toEqual(['g2']);
  });
});
