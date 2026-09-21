import { recordSlicePublished, staleSliceCkeys, RENEWAL_WINDOW_MS } from '../sliceRenewal';

describe('sliceRenewal', () => {
  it('una ckey nunca publicada localmente se considera vieja', () => {
    expect(staleSliceCkeys(['nueva'], Date.now())).toEqual(['nueva']);
  });

  it('una ckey publicada hace poco no es vieja', () => {
    const ahora = Date.now();
    recordSlicePublished('ck1', ahora);
    expect(staleSliceCkeys(['ck1'], ahora + 1000)).toEqual([]);
  });

  it('una ckey publicada hace más de 20 días es vieja', () => {
    const ahora = Date.now();
    recordSlicePublished('ck1', ahora);
    expect(staleSliceCkeys(['ck1'], ahora + RENEWAL_WINDOW_MS + 1)).toEqual(['ck1']);
  });

  it('justo en el borde (exactamente 20 días) todavía no es vieja', () => {
    const ahora = Date.now();
    recordSlicePublished('ck1', ahora);
    expect(staleSliceCkeys(['ck1'], ahora + RENEWAL_WINDOW_MS)).toEqual([]);
  });
});
