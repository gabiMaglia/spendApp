import { buildRelayPayload } from '../relaySync';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useGroupStore } from '@/src/store/groupStore';
import { buildDelta } from '../useSyncQR';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

const ME = 'ua';

describe('LA CLAVE DEL GRUPO NUNCA SALE POR EL RELAY', () => {
  beforeEach(() => {
    createSecureStorage('groupkeys').clearAll();
    useAuthStore.setState({ currentUser: { id: ME } as User });
    useGroupKeyStore.setState({ keys: [] });
    useGroupStore.setState({ groups: [] });
  });

  // Es LA invariante de seguridad del diseño: si el relay pudiera entregar
  // claves, podría sustituirlas por las suyas y leer todo (ADR-003 §1).
  it('el payload del relay no incluye el campo groupKeys', () => {
    useGroupKeyStore.getState().ensureKey('g1');

    const payload = buildRelayPayload(ME);

    expect('groupKeys' in payload).toBe(false);
  });

  it('el material de la clave no aparece NI SERIALIZADO en el payload', () => {
    const record = useGroupKeyStore.getState().ensureKey('g1');

    const serializado = JSON.stringify(buildRelayPayload(ME));

    expect(serializado).not.toContain(record.key);
  });

  it('el delta del pairing QR SÍ las lleva (ese canal está autenticado)', () => {
    useGroupKeyStore.getState().ensureKey('g1');

    expect(buildDelta(ME).groupKeys).toHaveLength(1);
  });

  it('el payload del relay conserva todo lo demás del delta', () => {
    const completo = buildDelta(ME);
    const relay = buildRelayPayload(ME) as unknown as Record<string, unknown>;

    const faltantes = Object.keys(completo)
      .filter(k => k !== 'groupKeys' && k !== 'timestamp')
      .filter(k => !(k in relay));

    expect(faltantes).toEqual([]);
  });
});

describe('groupKeyStore', () => {
  beforeEach(() => {
    createSecureStorage('groupkeys').clearAll();
    useAuthStore.setState({ currentUser: { id: ME } as User });
    useGroupKeyStore.setState({ keys: [] });
  });

  it('ensureKey es idempotente: no regenera la clave', () => {
    const a = useGroupKeyStore.getState().ensureKey('g1');
    const b = useGroupKeyStore.getState().ensureKey('g1');

    expect(b.key).toBe(a.key);
    expect(useGroupKeyStore.getState().keys).toHaveLength(1);
  });

  it('grupos distintos tienen claves distintas', () => {
    const a = useGroupKeyStore.getState().ensureKey('g1');
    const b = useGroupKeyStore.getState().ensureKey('g2');

    expect(b.key).not.toBe(a.key);
  });

  it('adopta claves de grupos que no conocía', () => {
    useGroupKeyStore.getState().adoptKeys([{ groupId: 'g9', key: 'ab'.repeat(32), epoch: 1 }]);

    expect(useGroupKeyStore.getState().getKey('g9')).toBeDefined();
  });

  // Si dos devices generaron cada uno la suya antes de conocerse, adoptar la
  // ajena dejaría ilegibles todos los sobres propios ya publicados.
  it('NO pisa una clave propia con otra de la misma época', () => {
    const mia = useGroupKeyStore.getState().ensureKey('g1');

    useGroupKeyStore.getState().adoptKeys([{ groupId: 'g1', key: 'cd'.repeat(32), epoch: 1 }]);

    expect(useGroupKeyStore.getState().getKey('g1')!.key).toBe(mia.key);
  });

  it('una época mayor SÍ reemplaza (rotación)', () => {
    useGroupKeyStore.getState().ensureKey('g1');

    useGroupKeyStore.getState().adoptKeys([{ groupId: 'g1', key: 'ef'.repeat(32), epoch: 2 }]);

    expect(useGroupKeyStore.getState().getKey('g1')!.epoch).toBe(2);
  });

  it('persiste y sobrevive a un store fresco', () => {
    const original = useGroupKeyStore.getState().ensureKey('g1');

    useGroupKeyStore.setState({ keys: [] });
    useGroupKeyStore.getState().hydrate();

    expect(useGroupKeyStore.getState().getKey('g1')!.key).toBe(original.key);
  });

  it('un storage corrupto degrada a "sin claves" en vez de romper la app', () => {
    createSecureStorage('groupkeys').set(`data_v1::u:${ME}`, '{roto');

    expect(() => useGroupKeyStore.getState().hydrate()).not.toThrow();
    expect(useGroupKeyStore.getState().keys).toEqual([]);
  });
});
