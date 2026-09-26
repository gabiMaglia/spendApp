import { mergeAccountData } from '../mergeAccountData';
import type { SimpleStorage } from '@/src/utils/createStorage';

const APPLE = 'apple:000123.abc';
const GOOGLE = 'google:11887766';
const NOW = 1_000_000; // mayor que todo updatedAt de los fixtures (5, 10, 20)

function fakeStorage(): SimpleStorage & { dump: () => Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getString: (k: string) => m.get(k),
    set: (k: string, v: unknown) => { m.set(k, String(v)); },
    getBoolean: () => undefined,
    delete: (k: string) => { m.delete(k); },
    clearAll: () => m.clear(),
    dump: () => Object.fromEntries(m),
  } as unknown as SimpleStorage & { dump: () => Record<string, string> };
}

const g = (id: string, updatedAt: number, name = id) => ({ id, updatedAt, name });

describe('mergeAccountData', () => {
  it('EL CASO DEL PO: fusiona dos cuentas con datos propios sin perder nada', () => {
    const st = fakeStorage();
    st.set(`groups::u:${APPLE}`, JSON.stringify([g('g1', 5), g('g2', 5)]));
    st.set(`groups::u:${GOOGLE}`, JSON.stringify([g('g3', 5)]));

    const rep = mergeAccountData([[st, 'groups', 'group']], GOOGLE, APPLE, NOW);

    const dest = JSON.parse(st.getString(`groups::u:${APPLE}`)!);
    expect(dest.map((x: any) => x.id).sort()).toEqual(['g1', 'g2', 'g3']);
    expect(rep.counts.groups).toBe(3);
    expect(rep.sourceWasEmpty).toBe(false);
  });

  it('NO borra el scope de origen (se puede volver atrás)', () => {
    const st = fakeStorage();
    st.set(`groups::u:${GOOGLE}`, JSON.stringify([g('g3', 5)]));

    mergeAccountData([[st, 'groups', 'group']], GOOGLE, APPLE, NOW);

    expect(st.getString(`groups::u:${GOOGLE}`)).toBeDefined();
  });

  it('el registro más nuevo gana aunque venga del origen', () => {
    const st = fakeStorage();
    st.set(`groups::u:${APPLE}`, JSON.stringify([g('g1', 1, 'viejo')]));
    st.set(`groups::u:${GOOGLE}`, JSON.stringify([g('g1', 99, 'nuevo')]));

    mergeAccountData([[st, 'groups', 'group']], GOOGLE, APPLE, NOW);

    expect(JSON.parse(st.getString(`groups::u:${APPLE}`)!)[0].name).toBe('nuevo');
  });

  it('destino vacío: se lleva todo el origen', () => {
    const st = fakeStorage();
    st.set(`expenses::u:${GOOGLE}`, JSON.stringify([g('e1', 5), g('e2', 5)]));

    mergeAccountData([[st, 'expenses', 'expense']], GOOGLE, APPLE, NOW);

    expect(JSON.parse(st.getString(`expenses::u:${APPLE}`)!)).toHaveLength(2);
  });

  it('origen vacío: no toca el destino y lo reporta', () => {
    const st = fakeStorage();
    st.set(`groups::u:${APPLE}`, JSON.stringify([g('g1', 5)]));

    const rep = mergeAccountData([[st, 'groups', 'group']], GOOGLE, APPLE, NOW);

    expect(JSON.parse(st.getString(`groups::u:${APPLE}`)!)).toHaveLength(1);
    expect(rep.sourceWasEmpty).toBe(true);
  });

  it('fusiona varios stores de una', () => {
    const st = fakeStorage();
    st.set(`groups::u:${GOOGLE}`, JSON.stringify([g('g1', 5)]));
    st.set(`expenses::u:${GOOGLE}`, JSON.stringify([g('e1', 5), g('e2', 5)]));

    const rep = mergeAccountData(
      [[st, 'groups', 'group'], [st, 'expenses', 'expense']], GOOGLE, APPLE, NOW,
    );

    expect(rep.counts).toEqual({ groups: 1, expenses: 2 });
  });

  it('un scope corrupto no tumba la fusión de los demás', () => {
    const st = fakeStorage();
    st.set(`groups::u:${GOOGLE}`, '{roto');
    st.set(`expenses::u:${GOOGLE}`, JSON.stringify([g('e1', 5)]));

    expect(() => mergeAccountData(
      [[st, 'groups', 'group'], [st, 'expenses', 'expense']], GOOGLE, APPLE, NOW,
    )).not.toThrow();
    expect(JSON.parse(st.getString(`expenses::u:${APPLE}`)!)).toHaveLength(1);
  });

  it('fusionar una cuenta consigo misma es un no-op', () => {
    const st = fakeStorage();
    st.set(`groups::u:${APPLE}`, JSON.stringify([g('g1', 5)]));

    mergeAccountData([[st, 'groups', 'group']], APPLE, APPLE, NOW);

    expect(JSON.parse(st.getString(`groups::u:${APPLE}`)!)).toHaveLength(1);
  });
});
