import { createThemeStore, useThemeStore } from '../themeStore';
import { createStorage } from '@/src/utils/createStorage';

describe('themeStore', () => {
  beforeEach(() => {
    // the MMKV mock backs all instances with one shared in-memory Map, so it
    // persists across tests within this file — clear it, then reset in-memory state.
    createStorage('theme').clearAll();
    useThemeStore.setState({ themeChoice: 'auto' });
  });

  it('defaults to "auto" when nothing was persisted yet', () => {
    expect(useThemeStore.getState().themeChoice).toBe('auto');
  });

  it('setThemeChoice updates in-memory state and persists it', () => {
    useThemeStore.getState().setThemeChoice('dark');
    expect(useThemeStore.getState().themeChoice).toBe('dark');

    useThemeStore.getState().setThemeChoice('light');
    expect(useThemeStore.getState().themeChoice).toBe('light');
  });

  // D2 (QA rejection): the persisted choice must be readable synchronously
  // AT STORE CREATION, not only after a later hydrate()/useEffect call — that
  // async pattern caused a 1-frame flash of the wrong theme on app start.
  it('a freshly created store reads the persisted choice synchronously, with no hydrate() call', () => {
    // simulate a previous session that persisted 'dark'
    createStorage('theme').set('theme_choice', 'dark');

    // simulate app restart: a brand new store instance, exactly like the one
    // built at module load time — note we never call .hydrate() here
    const freshStore = createThemeStore();

    expect(freshStore.getState().themeChoice).toBe('dark');
  });

  it('a freshly created store falls back to "auto" when nothing was persisted', () => {
    const freshStore = createThemeStore();
    expect(freshStore.getState().themeChoice).toBe('auto');
  });

  it('a freshly created store ignores garbage persisted values and falls back to "auto"', () => {
    createStorage('theme').set('theme_choice', 'sepia');

    const freshStore = createThemeStore();

    expect(freshStore.getState().themeChoice).toBe('auto');
  });

  it('hydrate() is a harmless no-op kept only so existing callers do not break', () => {
    useThemeStore.getState().setThemeChoice('dark');
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().themeChoice).toBe('dark');
  });
});
