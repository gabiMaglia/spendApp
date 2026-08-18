import { acceptPublisher, knownPublisher, clearRoster } from '../groupRoster';
import { useAuthStore } from '@/src/store/authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

const ANA  = { id: 'ana' } as User;
const BETO = { id: 'beto' } as User;

const K1 = 'aa'.repeat(32);
const K2 = 'bb'.repeat(32);

beforeEach(() => {
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: ANA });
});

describe('quién puede publicar en un grupo', () => {
  it('la primera identidad que se ve queda pineada', () => {
    expect(acceptPublisher('g1', 'beto', K1)).toBe(true);
    expect(knownPublisher('g1', 'beto')).toBe(K1);
  });

  it('la misma identidad se sigue aceptando', () => {
    acceptPublisher('g1', 'beto', K1);
    expect(acceptPublisher('g1', 'beto', K1)).toBe(true);
  });

  /**
   * ESTA es la garantía: alguien que consiguió la clave del grupo no puede
   * publicar diciendo ser un miembro que ya existía — le cargaría gastos falsos
   * a nombre de otro.
   */
  it('OTRA identidad para la misma persona se RECHAZA', () => {
    acceptPublisher('g1', 'beto', K1);
    expect(acceptPublisher('g1', 'beto', K2)).toBe(false);
    expect(knownPublisher('g1', 'beto')).toBe(K1); // no se pisa
  });

  it('cada grupo lleva su propio registro', () => {
    acceptPublisher('g1', 'beto', K1);
    expect(acceptPublisher('g2', 'beto', K2)).toBe(true);
  });

  it('personas distintas del mismo grupo no se pisan', () => {
    acceptPublisher('g1', 'beto', K1);
    expect(acceptPublisher('g1', 'caro', K2)).toBe(true);
  });

  it('sobrevive al reinicio', () => {
    acceptPublisher('g1', 'beto', K1);
    expect(knownPublisher('g1', 'beto')).toBe(K1);
  });

  it('es por cuenta: dos usuarios en el mismo teléfono no comparten roster', () => {
    acceptPublisher('g1', 'beto', K1);

    useAuthStore.setState({ currentUser: BETO });

    expect(knownPublisher('g1', 'beto')).toBeUndefined();
  });

  it('datos incompletos no se aceptan ni se pinean', () => {
    expect(acceptPublisher('g1', 'beto', '')).toBe(false);
    expect(acceptPublisher('', 'beto', K1)).toBe(false);
    expect(acceptPublisher('g1', '', K1)).toBe(false);
    expect(knownPublisher('g1', 'beto')).toBeUndefined();
  });

  it('un roster corrupto se degrada en vez de romper', () => {
    createSecureStorage('groupkeys').set('roster_v1::u:ana', 'no es json');
    expect(acceptPublisher('g1', 'beto', K1)).toBe(true);
  });

  it('clearRoster deja todo en cero', () => {
    acceptPublisher('g1', 'beto', K1);
    clearRoster();
    expect(knownPublisher('g1', 'beto')).toBeUndefined();
  });
});
