import { useThemeStore } from '../themeStore';
import { createStorage } from '@/src/utils/createStorage';

describe('themeStore', () => {
  beforeEach(() => {
    // the MMKV mock backs all instances with one shared in-memory Map, so it
    // persists across tests within this file — clear it, then reset in-memory state.
    createStorage('theme').clearAll();
    useThemeStore.setState({ themeChoice: 'auto' });
  });

  it('defaults to "auto" before hydrating', () => {
    expect(useThemeStore.getState().themeChoice).toBe('auto');
  });

  it('setThemeChoice updates in-memory state', () => {
    useThemeStore.getState().setThemeChoice('dark');
    expect(useThemeStore.getState().themeChoice).toBe('dark');

    useThemeStore.getState().setThemeChoice('light');
    expect(useThemeStore.getState().themeChoice).toBe('light');
  });

  it('persists the choice and hydrate() restores it', () => {
    useThemeStore.getState().setThemeChoice('dark');

    // simulate app restart: in-memory state resets, storage does not
    useThemeStore.setState({ themeChoice: 'auto' });
    expect(useThemeStore.getState().themeChoice).toBe('auto');

    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().themeChoice).toBe('dark');
  });

  it('hydrate() falls back to "auto" when nothing was persisted yet', () => {
    // no setThemeChoice call in this test → storage key never written
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().themeChoice).toBe('auto');
  });

  it('hydrate() ignores garbage values and falls back to "auto"', () => {
    // tamper with storage directly to simulate corrupted/unexpected persisted data
    const storage = createStorage('theme');
    storage.set('theme_choice', 'sepia');

    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().themeChoice).toBe('auto');
  });
});
