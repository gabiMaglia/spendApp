import { MemoryStorage } from '@/src/utils/createStorage';
import { useAuthStore } from '../authStore';
import { readScoped, writeScoped, readScopedBool, writeScopedBool, activeUserId } from '../userScope';
import type { User } from '@/src/types/models';

const A = { id: 'userA' } as User;
const B = { id: 'userB' } as User;
const setActive = (u: User | null) => useAuthStore.setState({ currentUser: u });

describe('userScope — aislamiento de datos por cuenta', () => {
  beforeEach(() => setActive(null));

  it('activeUserId refleja la cuenta activa', () => {
    expect(activeUserId()).toBeNull();
    setActive(A);
    expect(activeUserId()).toBe('userA');
  });

  it('lo que escribe una cuenta NO lo lee otra', () => {
    const st = new MemoryStorage();
    setActive(A);
    writeScoped(st, 'data', '["A"]');
    expect(readScoped(st, 'data')).toBe('["A"]');

    setActive(B);
    expect(readScoped(st, 'data')).toBeUndefined();          // B no ve lo de A
    writeScoped(st, 'data', '["B"]');
    expect(readScoped(st, 'data')).toBe('["B"]');

    setActive(A);
    expect(readScoped(st, 'data')).toBe('["A"]');            // A conserva lo suyo
  });

  it('sin usuario activo: readScoped=undefined y writeScoped no persiste', () => {
    const st = new MemoryStorage();
    setActive(null);
    writeScoped(st, 'data', 'x');
    expect(readScoped(st, 'data')).toBeUndefined();
    // y no dejó basura que aparezca al loguearse
    setActive(A);
    expect(readScoped(st, 'data')).toBeUndefined();
  });

  it('migra datos legacy sin scope al PRIMER usuario y no los filtra al resto', () => {
    const st = new MemoryStorage();
    st.set('data', '["legacy"]'); // dato viejo compartido (pre-aislamiento)

    setActive(A);
    expect(readScoped(st, 'data')).toBe('["legacy"]');       // A hereda el legacy
    expect(st.contains('data')).toBe(false);                 // el compartido se borró

    setActive(B);
    expect(readScoped(st, 'data')).toBeUndefined();          // B arranca limpio
  });

  it('booleans scopeados: aislados por cuenta, con default', () => {
    const st = new MemoryStorage();
    setActive(A);
    expect(readScopedBool(st, 'flag', true)).toBe(true);     // default
    writeScopedBool(st, 'flag', false);
    expect(readScopedBool(st, 'flag', true)).toBe(false);

    setActive(B);
    expect(readScopedBool(st, 'flag', true)).toBe(true);     // B no ve el de A
  });
});
