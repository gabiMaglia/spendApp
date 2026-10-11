import { useBloqueoStore } from '@/src/store/bloqueoStore';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';

/**
 * T-235 (Apple 1.2): bloquear a una persona es una preferencia LOCAL de esta
 * cuenta — oculta su contenido en este dispositivo y nunca viaja por el sync.
 */
describe('bloqueoStore', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUser: { id: 'u1', name: 'Ana' } as User });
    useBloqueoStore.setState({ bloqueados: [] });
  });

  it('bloquea y desbloquea', () => {
    const s = useBloqueoStore.getState();
    s.bloquear('beto');
    expect(useBloqueoStore.getState().estaBloqueado('beto')).toBe(true);
    expect(useBloqueoStore.getState().estaBloqueado('ana')).toBe(false);
    useBloqueoStore.getState().desbloquear('beto');
    expect(useBloqueoStore.getState().estaBloqueado('beto')).toBe(false);
  });

  it('bloquear dos veces no duplica', () => {
    useBloqueoStore.getState().bloquear('beto');
    useBloqueoStore.getState().bloquear('beto');
    expect(useBloqueoStore.getState().bloqueados).toEqual(['beto']);
  });

  it('persiste: al rehidratar sigue bloqueado', () => {
    useBloqueoStore.getState().bloquear('beto');
    useBloqueoStore.setState({ bloqueados: [] });
    useBloqueoStore.getState().hydrate();
    expect(useBloqueoStore.getState().estaBloqueado('beto')).toBe(true);
  });

  it('es por cuenta: otra cuenta no hereda los bloqueos', () => {
    useBloqueoStore.getState().bloquear('beto');
    useAuthStore.setState({ currentUser: { id: 'u2', name: 'Otra' } as User });
    useBloqueoStore.getState().hydrate();
    expect(useBloqueoStore.getState().estaBloqueado('beto')).toBe(false);
  });

  it('un id vacío no se bloquea', () => {
    useBloqueoStore.getState().bloquear('');
    expect(useBloqueoStore.getState().bloqueados).toEqual([]);
  });
});
