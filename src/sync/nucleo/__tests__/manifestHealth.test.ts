import { recordManifestCheck, manifestGapFor, clearManifestGaps } from '../manifestHealth';

describe('manifestHealth', () => {
  beforeEach(() => clearManifestGaps());

  it('sin ckeys faltantes, no hay gap', () => {
    recordManifestCheck('G', []);
    expect(manifestGapFor('G')).toBeNull();
  });

  it('con ckeys faltantes, registra el gap', () => {
    recordManifestCheck('G', ['ck1', 'ck2']);
    const gap = manifestGapFor('G');
    expect(gap?.groupId).toBe('G');
    expect(gap?.missingCkeys).toEqual(['ck1', 'ck2']);
  });

  it('un chequeo posterior sin faltantes borra el gap anterior', () => {
    recordManifestCheck('G', ['ck1']);
    recordManifestCheck('G', []);
    expect(manifestGapFor('G')).toBeNull();
  });

  it('grupos distintos no se pisan', () => {
    recordManifestCheck('G1', ['ck1']);
    recordManifestCheck('G2', []);
    expect(manifestGapFor('G1')?.groupId).toBe('G1');
    expect(manifestGapFor('G2')).toBeNull();
  });
});
