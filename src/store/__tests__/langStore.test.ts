import { createLangStore, useLangStore } from '../langStore';
import { createStorage } from '@/src/utils/createStorage';
import i18n, { LANG_STORAGE_KEY } from '@/src/i18n';

describe('langStore', () => {
  beforeEach(() => {
    // El mock de MMKV comparte un Map entre instancias: limpiamos + reset.
    createStorage('lang').clearAll();
    useLangStore.setState({ choice: 'auto', active: 'es' });
    jest.spyOn(i18n, 'changeLanguage').mockImplementation(() => Promise.resolve(undefined as any));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('por defecto es "auto" cuando no hay preferencia persistida', () => {
    expect(useLangStore.getState().choice).toBe('auto');
  });

  it('setLanguage a un idioma fijo persiste la preferencia y la aplica en i18next', () => {
    useLangStore.getState().setLanguage('en');

    expect(useLangStore.getState().choice).toBe('en');
    expect(useLangStore.getState().active).toBe('en');
    expect(createStorage('lang').getString(LANG_STORAGE_KEY)).toBe('en');
    expect(i18n.changeLanguage).toHaveBeenCalledWith('en');
  });

  it('setLanguage("auto") borra la preferencia persistida y vuelve al idioma del dispositivo', () => {
    useLangStore.getState().setLanguage('pt');
    expect(createStorage('lang').getString(LANG_STORAGE_KEY)).toBe('pt');

    useLangStore.getState().setLanguage('auto');

    expect(useLangStore.getState().choice).toBe('auto');
    expect(createStorage('lang').contains(LANG_STORAGE_KEY)).toBe(false);
    // 'auto' resuelve a un idioma soportado concreto para i18next (nunca 'auto').
    expect(['es', 'en', 'pt']).toContain(useLangStore.getState().active);
  });

  it('una instancia recién creada lee la preferencia persistida sincrónicamente (sin hydrate)', () => {
    createStorage('lang').set(LANG_STORAGE_KEY, 'pt');

    const fresh = createLangStore();

    expect(fresh.getState().choice).toBe('pt');
  });

  it('una instancia recién creada ignora valores basura y cae a "auto"', () => {
    createStorage('lang').set(LANG_STORAGE_KEY, 'klingon');

    const fresh = createLangStore();

    expect(fresh.getState().choice).toBe('auto');
  });
});
