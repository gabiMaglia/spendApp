import i18n from '@/src/i18n';
import { fechaCorta } from '@/src/utils/fechaCorta';

describe('fechaCorta', () => {
  it('hoy y ayer con nombre (i18n); el resto con fecha corta', async () => {
    await i18n.changeLanguage('es');
    const hoy = new Date();
    const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
    const antes = new Date(); antes.setDate(hoy.getDate() - 5);
    expect(fechaCorta(hoy)).toBe(i18n.t('common.today'));
    expect(fechaCorta(ayer)).toBe(i18n.t('common.yesterday'));
    expect(fechaCorta(antes)).toBe(antes.toLocaleDateString('es', { day: 'numeric', month: 'short' }));
  });

  it('usa el idioma activo: en inglés sale Today y la fecha en en', async () => {
    const previo = i18n.language;
    await i18n.changeLanguage('en');
    try {
      const d = new Date(2020, 2, 15);
      expect(fechaCorta(d)).toBe(d.toLocaleDateString('en', { day: 'numeric', month: 'short' }));
      expect(fechaCorta(new Date())).toBe('Today');
    } finally {
      await i18n.changeLanguage(previo);
    }
  });
});
