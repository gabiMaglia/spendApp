import { resumirAvisos, UMBRAL_RESUMEN } from '@/src/services/resumirAvisos';
import type { Notice } from '@/src/services/syncNotices';

const g = (groupId: string, groupName: string): Notice =>
  ({ kind: 'joined', groupId, groupName });
const sinGrupo: Notice = { kind: 'clock_off', offsetMs: 1000 };

describe('resumirAvisos', () => {
  it('el umbral es 2: resume recién con 3', () => {
    expect(UMBRAL_RESUMEN).toBe(2);
  });

  it('cuenta los avisos', () => {
    expect(resumirAvisos([g('a', 'A'), g('a', 'A'), g('a', 'A')]).count).toBe(3);
  });

  it('un solo grupo: lo nombra', () => {
    const r = resumirAvisos([g('a', 'Mendoza'), g('a', 'Mendoza'), g('a', 'Mendoza')]);
    expect(r).toMatchObject({ groups: 1, groupName: 'Mendoza' });
  });

  it('varios grupos: los cuenta distintos, sin nombre', () => {
    const r = resumirAvisos([g('a', 'A'), g('b', 'B'), g('a', 'A'), g('c', 'C')]);
    expect(r).toMatchObject({ groups: 3, groupName: null });
  });

  it('un aviso sin grupo no cuenta como grupo', () => {
    const r = resumirAvisos([sinGrupo, sinGrupo, sinGrupo]);
    expect(r).toMatchObject({ count: 3, groups: 0, groupName: null });
    expect(resumirAvisos([sinGrupo, g('a', 'A'), g('a', 'A')]).groups).toBe(1);
  });
});
