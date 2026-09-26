import { conAlfa } from '@/src/skins/color';

describe('conAlfa', () => {
  it('convierte #RRGGBB a rgba con la opacidad pedida', () => {
    expect(conAlfa('#3A4A5E', 0.35)).toBe('rgba(58,74,94,0.35)');
  });
  it('acepta #RGB', () => {
    expect(conAlfa('#fff', 0.5)).toBe('rgba(255,255,255,0.5)');
  });
  it('un color que no es hex vuelve tal cual', () => {
    expect(conAlfa('rgba(1,2,3,0.4)', 0.9)).toBe('rgba(1,2,3,0.4)');
    expect(conAlfa('transparent', 0.9)).toBe('transparent');
  });
});
