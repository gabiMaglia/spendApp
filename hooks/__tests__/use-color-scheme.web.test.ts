// D1 (QA rejection) — web counterpart. Same rationale as
// use-color-scheme.test.ts: exercises the REAL rewritten hook
// ('../use-color-scheme.web') against the REAL themeStore, only mocking
// react-native's OS-level useColorScheme. A regression that ignores the
// store (returns the OS scheme unconditionally) fails the override tests.

import * as RN from 'react-native';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { createStorage } from '@/src/utils/createStorage';
import { useThemeStore } from '@/src/store/themeStore';
import { useColorScheme } from '../use-color-scheme.web';

describe('useColorScheme (web)', () => {
  let mockRNColorScheme: jest.SpiedFunction<typeof RN.useColorScheme>;

  beforeEach(() => {
    createStorage('theme').clearAll();
    useThemeStore.setState({ themeChoice: 'auto' });
    mockRNColorScheme = jest.spyOn(RN, 'useColorScheme');
  });

  afterEach(() => {
    mockRNColorScheme.mockRestore();
  });

  it('returns the OS scheme when themeChoice is "auto" (post-hydration)', async () => {
    mockRNColorScheme.mockReturnValue('dark');

    const { result } = renderHook(() => useColorScheme());

    await waitFor(() => expect(result.current).toBe('dark'));
  });

  it('overrides the OS scheme when themeChoice is "light" (OS says dark)', async () => {
    mockRNColorScheme.mockReturnValue('dark');
    act(() => { useThemeStore.getState().setThemeChoice('light'); });

    const { result } = renderHook(() => useColorScheme());

    // if the hook regressed to ignore the store, this would settle on 'dark'
    await waitFor(() => expect(result.current).toBe('light'));
  });

  it('overrides the OS scheme when themeChoice is "dark" (OS says light)', async () => {
    mockRNColorScheme.mockReturnValue('light');
    act(() => { useThemeStore.getState().setThemeChoice('dark'); });

    const { result } = renderHook(() => useColorScheme());

    await waitFor(() => expect(result.current).toBe('dark'));
  });

  it('re-renders reactively when the store changes, without remounting', async () => {
    mockRNColorScheme.mockReturnValue('light');
    const { result } = renderHook(() => useColorScheme());
    await waitFor(() => expect(result.current).toBe('light'));

    act(() => { useThemeStore.getState().setThemeChoice('dark'); });
    expect(result.current).toBe('dark');

    act(() => { useThemeStore.getState().setThemeChoice('auto'); });
    expect(result.current).toBe('light');
  });
});
