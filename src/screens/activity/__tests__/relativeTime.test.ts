import i18n from '@/src/i18n';
import { relativeTime } from '@/src/screens/activity/utils/activityFormat';

const AHORA = new Date(2026, 10, 24, 12, 0).getTime();
const MIN = 60_000;
const H = 60 * MIN;

/** T-307: el tiempo relativo de Actividad sale en el idioma activo (antes, castellano fijo). */
describe('relativeTime', () => {
  const previo = i18n.language;
  beforeAll(() => { jest.useFakeTimers(); jest.setSystemTime(AHORA); });
  afterAll(async () => { jest.useRealTimers(); await i18n.changeLanguage(previo); });

  it('en castellano: ahora, minutos, horas, ayer y días', async () => {
    await i18n.changeLanguage('es');
    expect(relativeTime(AHORA - 10_000)).toBe('ahora');
    expect(relativeTime(AHORA - 5 * MIN)).toBe('hace 5 min');
    expect(relativeTime(AHORA - 6 * H)).toBe('hace 6 h');
    expect(relativeTime(AHORA - 30 * H)).toBe('ayer');
    expect(relativeTime(AHORA - 3 * 24 * H)).toBe('hace 3 días');
  });

  it('en inglés no queda nada en castellano', async () => {
    await i18n.changeLanguage('en');
    expect(relativeTime(AHORA - 10_000)).toBe('now');
    expect(relativeTime(AHORA - 5 * MIN)).toBe('5 min ago');
    expect(relativeTime(AHORA - 6 * H)).toBe('6 h ago');
    expect(relativeTime(AHORA - 30 * H)).toBe('yesterday');
    expect(relativeTime(AHORA - 3 * 24 * H)).toBe('3 days ago');
  });

  it('en portugués', async () => {
    await i18n.changeLanguage('pt');
    expect(relativeTime(AHORA - 10_000)).toBe('agora');
    expect(relativeTime(AHORA - 5 * MIN)).toBe('há 5 min');
    expect(relativeTime(AHORA - 6 * H)).toBe('há 6 h');
    expect(relativeTime(AHORA - 30 * H)).toBe('ontem');
    expect(relativeTime(AHORA - 3 * 24 * H)).toBe('há 3 dias');
  });

  it('una fecha futura (reloj de otro teléfono adelantado) dice «ahora», no un negativo', async () => {
    await i18n.changeLanguage('es');
    expect(relativeTime(AHORA + 5 * MIN)).toBe('ahora');
  });
});
