import { withTimeout } from '../withTimeout';

describe('withTimeout', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('devuelve el valor real si resuelve antes del límite', async () => {
    const p = withTimeout(Promise.resolve('real'), 5000, 'fallback');
    await Promise.resolve(); // deja correr el microtask del resolve real
    jest.advanceTimersByTime(1);
    await expect(p).resolves.toBe('real');
  });

  it('devuelve el fallback si la promesa nunca resuelve', async () => {
    const nuncaResuelve = new Promise<string>(() => {});
    const p = withTimeout(nuncaResuelve, 5000, 'fallback');
    jest.advanceTimersByTime(5000);
    await expect(p).resolves.toBe('fallback');
  });

  it('devuelve el fallback si la promesa rechaza', async () => {
    const p = withTimeout(Promise.reject(new Error('fail')), 5000, 'fallback');
    await expect(p).resolves.toBe('fallback');
  });

  it('si la promesa real resuelve DESPUÉS del timeout, no pisa el fallback ya devuelto', async () => {
    let resolverTarde: (v: string) => void;
    const tarde = new Promise<string>(r => { resolverTarde = r; });
    const p = withTimeout(tarde, 1000, 'fallback');

    jest.advanceTimersByTime(1000);
    await expect(p).resolves.toBe('fallback');

    // Resuelve después: no debe romper nada ni cambiar lo ya devuelto.
    resolverTarde!('llegó tarde');
    await Promise.resolve();
  });
});
