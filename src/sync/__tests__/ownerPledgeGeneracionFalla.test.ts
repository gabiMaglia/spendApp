import { prendaDelAparato } from '../ownerPledge';

/**
 * T-088/T-173 · ver el docblock de `ownerPledgeModuloAusente.test.ts`: este
 * caso ("el módulo carga pero `ensureOwnerPledge` tira") necesita su PROPIO
 * mock hoisteado, incompatible con el de ese archivo (uno rompe el require
 * entero, el otro rompe sólo la función) — no pueden convivir en el mismo
 * archivo sin volver al `doMock` dinámico que no pisa el import estático.
 */
jest.mock('@/src/store/identityStore', () => ({
  ensureOwnerPledge: () => { throw new Error('storage cifrado que no abrió'); },
}));

it('prendaDelAparato() devuelve null sin lanzar si la generación de la prenda falla', () => {
  expect(prendaDelAparato()).toBeNull();
});
