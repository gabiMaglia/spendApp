import { prendaDelAparato } from '../ownerPledge';

/**
 * T-088/T-173 · separado de `ownerPledge.test.ts` por la misma razón
 * documentada en `authorSourcesDegrade.test.ts`: un `jest.doMock` dinámico —
 * con o sin `jest.isolateModules` — NO pisa el `require`/import ya resuelto
 * en el archivo donde viven los demás tests de la prenda (el módulo bueno
 * queda cacheado desde el import estático de arriba de ese archivo, y el
 * mock dinámico llega tarde). Sólo un `jest.mock` hoisteado DESDE EL ARRANQUE
 * de un archivo dedicado garantiza que `prendaDelAparato()` vea el módulo
 * realmente roto.
 */
jest.mock('@/src/store/identityStore', () => {
  throw new Error('nativo ausente');
});

it('prendaDelAparato() devuelve null sin lanzar si el módulo de identidad no carga', () => {
  expect(prendaDelAparato()).toBeNull();
});
