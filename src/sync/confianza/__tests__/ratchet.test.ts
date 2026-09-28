import {
  authorRatchet, markAuthorSigns, signingAuthors,
  clearRatchet, reloadRatchet, RATCHET_KEY,
} from '../ratchet';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped } from '@/src/store/userScope';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';

/**
 * El trinquete por autor (T-041 · S6, decisión D1 del Orquestador).
 *
 * Dos posiciones y una sola dirección. La tercera del §QUÉ (`exigido`) murió con
 * la decisión R1 del PO: acá no se rechaza nada, así que el trinquete no es un
 * gatillo — es la **dimensión que hace legible la medición**: separa "de este
 * autor nunca vimos una firma" de "este autor firma, y este registro puntual no
 * trae ninguna".
 */

const storage = createSecureStorage('users');

const sesion = (id: string) => useAuthStore.setState({ currentUser: { id } as User });

beforeEach(() => {
  sesion('cuenta-a');
  clearRatchet();
});

describe('las dos posiciones', () => {
  it('un autor que nunca vimos firmar está en `desconocido`', () => {
    expect(authorRatchet('ana')).toBe('desconocido');
  });

  it('una firma válida lo traba en `firma`', () => {
    markAuthorSigns('ana');
    expect(authorRatchet('ana')).toBe('firma');
  });

  it('trabar a uno no traba a los demás', () => {
    markAuthorSigns('ana');
    expect(authorRatchet('beto')).toBe('desconocido');
  });

  it('un autor vacío no entra: no es una afirmación sobre nadie', () => {
    markAuthorSigns('');
    expect(signingAuthors()).toEqual([]);
  });
});

describe('es monótono — la única propiedad que lo hace un trinquete', () => {
  /**
   * Mutación M11 del plan. Sin esto el trinquete sería un flag cualquiera: un
   * miembro malicioso mandaría UN registro sin firma para volver a su autor a
   * `desconocido` y así "apagar" la única señal que dice que él sabe firmar.
   */
  it('una firma válida y después una inválida NO lo hacen retroceder', () => {
    markAuthorSigns('ana');
    // Lo que ocurre cuando llega algo que no verifica: nada. No hay API para
    // volver atrás, y que no la haya es la garantía.
    expect(authorRatchet('ana')).toBe('firma');
    markAuthorSigns('ana');
    expect(authorRatchet('ana')).toBe('firma');
    expect(signingAuthors()).toEqual(['ana']);
  });

  it('marcar dos veces no duplica al autor', () => {
    markAuthorSigns('ana');
    markAuthorSigns('ana');
    expect(signingAuthors()).toEqual(['ana']);
  });

  /**
   * El trinquete es de TODOS los autores, no del último. Sin esto, marcar a uno
   * podía llevarse por delante a los demás y el denominador de la medición
   * valdría siempre 1 — que es peor que no tenerlo, porque parece un número.
   */
  it('trabar a un autor nuevo no destraba a los que ya estaban', () => {
    markAuthorSigns('ana');
    markAuthorSigns('beto');
    expect(authorRatchet('ana')).toBe('firma');
    expect(authorRatchet('beto')).toBe('firma');
    expect([...signingAuthors()].sort()).toEqual(['ana', 'beto']);
  });
});

describe('sobrevive al reinicio y no cruza cuentas', () => {
  it('lo trabado sigue trabado después de recargar de disco', () => {
    markAuthorSigns('ana');
    reloadRatchet();                       // como un arranque nuevo de la app
    expect(authorRatchet('ana')).toBe('firma');
  });

  it('dos cuentas del mismo teléfono no comparten trinquete', () => {
    markAuthorSigns('ana');

    sesion('cuenta-b');
    reloadRatchet();
    expect(authorRatchet('ana')).toBe('desconocido');

    sesion('cuenta-a');
    reloadRatchet();
    expect(authorRatchet('ana')).toBe('firma');
  });

  it('un dato corrupto no rompe nada: se arranca en `desconocido`', () => {
    markAuthorSigns('ana');
    // El scope lo resuelve `writeScoped`; acá se escribe basura por el mismo
    // camino para no depender de cómo se arma la clave.
    const crudo = readScoped(storage, RATCHET_KEY);
    expect(crudo).toBeDefined();
    storage.set(`${RATCHET_KEY}::u:cuenta-a`, '{{{ esto no es JSON');

    reloadRatchet();
    expect(authorRatchet('ana')).toBe('desconocido');
  });

  it('una entrada que no es un id de autor se descarta sola', () => {
    storage.set(`${RATCHET_KEY}::u:cuenta-a`, JSON.stringify({ a: [1, 'ana', null, ''] }));
    reloadRatchet();
    expect(signingAuthors()).toEqual(['ana']);
  });
});
