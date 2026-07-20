// D1 (QA rejection): themeStore.test.ts alone doesn't protect the real bug —
// it never exercises the rewritten hook. These tests render the ACTUAL
// `useColorScheme()` from '../use-color-scheme' against the REAL themeStore
// (only react-native's OS-level useColorScheme is mocked), so a regression to
// `return useRNColorScheme();` (ignoring the store) fails the override tests
// below. Verified manually with that exact mutation before closing the ticket.

import * as RN from 'react-native';
import { renderHook, act } from '@testing-library/react-native';
import { createStorage } from '@/src/utils/createStorage';
import { useThemeStore } from '@/src/store/themeStore';
import { useColorScheme } from '../use-color-scheme';

describe('useColorScheme (native)', () => {
  let mockRNColorScheme: jest.SpiedFunction<typeof RN.useColorScheme>;

  beforeEach(() => {
    createStorage('theme').clearAll();
    useThemeStore.setState({ themeChoice: 'auto' });
    mockRNColorScheme = jest.spyOn(RN, 'useColorScheme');
  });

  afterEach(() => {
    mockRNColorScheme.mockRestore();
  });

  it('returns the OS scheme when themeChoice is "auto"', () => {
    mockRNColorScheme.mockReturnValue('dark');

    const { result } = renderHook(() => useColorScheme());

    expect(result.current).toBe('dark');
  });

  it('overrides the OS scheme when themeChoice is "light" (OS says dark)', () => {
    mockRNColorScheme.mockReturnValue('dark');
    act(() => { useThemeStore.getState().setThemeChoice('light'); });

    const { result } = renderHook(() => useColorScheme());

    // if the hook regressed to `return useRNColorScheme();` this would be 'dark'
    expect(result.current).toBe('light');
  });

  it('overrides the OS scheme when themeChoice is "dark" (OS says light)', () => {
    mockRNColorScheme.mockReturnValue('light');
    act(() => { useThemeStore.getState().setThemeChoice('dark'); });

    const { result } = renderHook(() => useColorScheme());

    expect(result.current).toBe('dark');
  });

  it('re-renders reactively when the store changes, without remounting', () => {
    mockRNColorScheme.mockReturnValue('light');
    const { result } = renderHook(() => useColorScheme());
    expect(result.current).toBe('light'); // auto -> OS

    act(() => { useThemeStore.getState().setThemeChoice('dark'); });
    expect(result.current).toBe('dark'); // same hook instance flips live

    act(() => { useThemeStore.getState().setThemeChoice('auto'); });
    expect(result.current).toBe('light'); // back to following the OS
  });

  it('follows the OS scheme when it changes while themeChoice is "auto"', () => {
    mockRNColorScheme.mockReturnValue('light');
    const { result, rerender } = renderHook(() => useColorScheme());
    expect(result.current).toBe('light');

    mockRNColorScheme.mockReturnValue('dark');
    rerender({});
    expect(result.current).toBe('dark');
  });
});
