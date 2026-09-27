import { useEntryGateStore, __resetEntryGate } from '../entryGateStore';

/**
 * T-147 (fila 9): el estado que usa `decidirNavegacionAuthGuard` para saber
 * si la app puede pasar a las tabs. Vive en un store aparte (no en
 * `authStore`) porque es un dato de ARRANQUE, no de la cuenta — se reinicia
 * en cada verificación, no se persiste.
 */
beforeEach(() => { __resetEntryGate(); });

it('arranca en "ninguna"', () => {
  expect(useEntryGateStore.getState().estado).toBe('ninguna');
});

it('chequear() → "chequeando"', () => {
  useEntryGateStore.getState().chequear();
  expect(useEntryGateStore.getState().estado).toBe('chequeando');
});

it('pedirVerificacion() → "pendiente"', () => {
  useEntryGateStore.getState().pedirVerificacion();
  expect(useEntryGateStore.getState().estado).toBe('pendiente');
});

it('marcarLista() → "lista"', () => {
  useEntryGateStore.getState().pedirVerificacion();
  useEntryGateStore.getState().marcarLista();
  expect(useEntryGateStore.getState().estado).toBe('lista');
});
