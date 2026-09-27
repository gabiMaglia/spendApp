/**
 * T-147 (SIMPLIFICACIÓN, 2026-09-27) · `createSerialQueue` es el FIFO
 * genérico que antes vivía sólo dentro de `relaySession.ts`
 * (`encolarOperacionDeSesion`), atado a la sesión del buzón. Con el buzón y
 * el directorio en clientes de Supabase SEPARADOS (cada uno con su propio
 * storage), ya no hace falta compartir una única cola entre los dos — cada
 * módulo abre la suya. Se extrae acá para no duplicar la lógica de
 * encadenado + "un rechazo no frena la cola" + contador de pendientes.
 */
import { createSerialQueue } from '../serialQueue';

describe('createSerialQueue', () => {
  it('corre las operaciones en el orden en que se encolaron, nunca en paralelo', async () => {
    const q = createSerialQueue();
    const orden: string[] = [];

    const a = q.run(async () => {
      await new Promise(r => setTimeout(r, 20));
      orden.push('a');
      return 'a';
    });
    const b = q.run(async () => {
      orden.push('b'); // corre instantáneo, pero tiene que esperar a "a"
      return 'b';
    });

    expect(await a).toBe('a');
    expect(await b).toBe('b');
    expect(orden).toEqual(['a', 'b']);
  });

  it('un rechazo no frena las operaciones siguientes', async () => {
    const q = createSerialQueue();
    const primera = q.run(async () => { throw new Error('boom'); });
    const segunda = q.run(async () => 'ok');

    await expect(primera).rejects.toThrow('boom');
    expect(await segunda).toBe('ok');
  });

  it('pendientes() cuenta las operaciones en vuelo', async () => {
    const q = createSerialQueue();
    expect(q.pendientes()).toBe(0);

    let liberar: (() => void) | null = null;
    const p = q.run(() => new Promise(resolve => { liberar = () => resolve(undefined); }));
    await Promise.resolve(); // deja correr el microtask que invoca `fn` y fija `liberar`
    expect(q.pendientes()).toBe(1);

    liberar!();
    await p;
    expect(q.pendientes()).toBe(0);
  });
});
