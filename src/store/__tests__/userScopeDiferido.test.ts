import { MemoryStorage } from '@/src/utils/createStorage';
import { useAuthStore } from '../authStore';
import {
  readScoped, writeScopedLazy, flushScopedWrites, discardScopedWrites, SCOPED_WRITE_DELAY_MS,
} from '../userScope';
import type { User } from '@/src/types/models';

const A = { id: 'userA' } as User;
const B = { id: 'userB' } as User;
const setActive = (u: User | null) => useAuthStore.setState({ currentUser: u });

describe('userScope — escritor diferido (T-156)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setActive(null);
  });
  afterEach(() => {
    discardScopedWrites();
    jest.useRealTimers();
  });

  // U1: N escrituras seguidas → 1 storage.set con el ÚLTIMO valor, ~300ms después.
  it('U1: agrupa N escrituras seguidas en 1 storage.set con el último valor', () => {
    const st = new MemoryStorage();
    const setSpy = jest.spyOn(st, 'set');
    setActive(A);

    writeScopedLazy(st, 'data', () => JSON.stringify(['v1']));
    writeScopedLazy(st, 'data', () => JSON.stringify(['v2']));
    writeScopedLazy(st, 'data', () => JSON.stringify(['v3']));

    expect(setSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(SCOPED_WRITE_DELAY_MS);

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(readScoped(st, 'data')).toBe(JSON.stringify(['v3']));
  });

  // U2: la app pasa a background antes de los 300ms → se vacía YA (acá, simulando
  // lo que hace el listener de AppState llamando flushScopedWrites()).
  it('U2: flushScopedWrites() vacía antes de que venza el timer', () => {
    const st = new MemoryStorage();
    setActive(A);
    writeScopedLazy(st, 'data', () => JSON.stringify(['x']));

    flushScopedWrites();
    expect(readScoped(st, 'data')).toBe(JSON.stringify(['x']));

    // El timer que ya se vació no vuelve a escribir nada raro al vencer.
    const setSpy = jest.spyOn(st, 'set');
    jest.advanceTimersByTime(SCOPED_WRITE_DELAY_MS);
    expect(setSpy).not.toHaveBeenCalled();
  });

  // U3: A escribe y ANTES de que venza el timer se cambia la cuenta activa a B.
  // Lo pendiente se guarda bajo A (uid capturado al PROGRAMAR), nunca bajo B.
  it('U3: lo pendiente se guarda bajo el uid capturado al programar, no el activo al vaciar', () => {
    const st = new MemoryStorage();
    setActive(A);
    writeScopedLazy(st, 'data', () => JSON.stringify(['deA']));

    setActive(B);
    jest.advanceTimersByTime(SCOPED_WRITE_DELAY_MS);

    setActive(A);
    expect(readScoped(st, 'data')).toBe(JSON.stringify(['deA']));

    setActive(B);
    expect(readScoped(st, 'data')).toBeUndefined();
  });

  // U4: se lee la misma clave (readScoped) antes de que venza el timer → ve el
  // último valor programado, no lo viejo en disco.
  it('U4: readScoped vacía lo pendiente de ESA clave antes de leer', () => {
    const st = new MemoryStorage();
    setActive(A);
    st.set('data::u:userA', JSON.stringify(['viejo']));
    writeScopedLazy(st, 'data', () => JSON.stringify(['nuevo']));

    // Sin avanzar timers: readScoped debe ver el valor nuevo YA.
    expect(readScoped(st, 'data')).toBe(JSON.stringify(['nuevo']));
  });

  // U5: se programa una escritura y enseguida se descarta todo (borrado de
  // cuenta / wipe). Lo pendiente NO se escribe nunca, ni al vencer el timer.
  it('U5: discardScopedWrites() cancela sin escribir, ni al vencer el timer', () => {
    const st = new MemoryStorage();
    const setSpy = jest.spyOn(st, 'set');
    setActive(A);
    writeScopedLazy(st, 'data', () => JSON.stringify(['fantasma']));

    discardScopedWrites();
    jest.advanceTimersByTime(1000);

    expect(setSpy).not.toHaveBeenCalled();
    expect(readScoped(st, 'data')).toBeUndefined();
  });

  // U6: sin usuario activo, writeScopedLazy es no-op — igual que writeScoped hoy.
  it('U6: sin usuario activo, writeScopedLazy no programa nada', () => {
    const st = new MemoryStorage();
    const setSpy = jest.spyOn(st, 'set');
    setActive(null);
    writeScopedLazy(st, 'data', () => JSON.stringify(['nadie']));

    jest.advanceTimersByTime(SCOPED_WRITE_DELAY_MS);
    expect(setSpy).not.toHaveBeenCalled();
  });

  // U7: usuario que ACTUALIZA — datos legacy/escopeados ya en disco. La lectura
  // es igual que hoy y el formato en disco es idéntico (mismo JSON, misma clave).
  it('U7: datos ya escopeados en disco se leen igual que hoy, mismo formato/clave', () => {
    const st = new MemoryStorage();
    setActive(A);
    // Simula una instalación previa a T-156: ya había datos bajo la clave scopeada normal.
    st.set('data::u:userA', JSON.stringify(['preexistente']));

    expect(readScoped(st, 'data')).toBe(JSON.stringify(['preexistente']));

    writeScopedLazy(st, 'data', () => JSON.stringify(['actualizado']));
    flushScopedWrites();

    expect(st.getString('data::u:userA')).toBe(JSON.stringify(['actualizado']));
  });
});
