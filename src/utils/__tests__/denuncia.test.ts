import { mailDeDenuncia } from '@/src/utils/denuncia';
import { MAIL_SOPORTE } from '@/src/constants/legal';

/** T-235: la denuncia va por mail (no hay backend que lea contenido). */
describe('mailDeDenuncia', () => {
  it('arma un mailto a soporte con autor, texto e id del gasto', () => {
    const url = mailDeDenuncia({ autor: 'Beto', texto: 'algo ofensivo & raro', gastoId: 'g-1', asunto: 'Denuncia', cuerpo: 'Contenido' });
    expect(url.startsWith(`mailto:${MAIL_SOPORTE}?`)).toBe(true);
    const cuerpo = decodeURIComponent(url.split('body=')[1]);
    expect(cuerpo).toContain('Beto');
    expect(cuerpo).toContain('algo ofensivo & raro');
    expect(cuerpo).toContain('g-1');
    expect(decodeURIComponent(url.split('subject=')[1].split('&')[0])).toBe('Denuncia');
  });

  it('codifica los caracteres especiales del texto', () => {
    const url = mailDeDenuncia({ autor: 'A', texto: 'a&b=c?d', gastoId: 'x', asunto: 'S', cuerpo: 'C' });
    expect(url).not.toContain('a&b=c?d');
  });
});
