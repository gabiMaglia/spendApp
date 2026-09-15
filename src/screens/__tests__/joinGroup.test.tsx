import React from 'react';
import { render } from '@testing-library/react-native';
import JoinGroupScreen from '@/app/groups/join';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: jest.fn(),
}));

const ANA = { id: 'ana', name: 'Ana' } as User;

beforeEach(() => {
  const { useLocalSearchParams } = jest.requireMock('expo-router');
  useLocalSearchParams.mockReturnValue({
    g: '550e8400-e29b-41d4-a716-446655440000', // valid UUID
    n: 'TestGroup',
    t: 'aa11bb22cc33dd44ee55ff6600112233aa11bb22cc33dd44ee55ff6600112233', // 64 hex chars
    f: 'aa11bb22cc33dd44ee55ff6600112233', // 32 hex chars
    e: String(Date.now() + 48 * 60 * 60 * 1000),
  });
  useAuthStore.setState({ currentUser: ANA });
  useGroupStore.setState({ groups: [] });
});

describe('JoinGroupScreen - inviterFingerprint display', () => {
  it('muestra la huella del invitador antes de aceptar', () => {
    const { getByText } = render(<JoinGroupScreen />);
    // shortFingerprint corta a los primeros 16 chars en bloques de 4:
    // 'aa11 bb22 cc33 dd44'
    expect(getByText(/aa11 bb22 cc33 dd44/)).toBeTruthy();
  });

  it('no rompe cuando no hay huella (formato largo viejo sin ese parámetro)', () => {
    const { useLocalSearchParams } = jest.requireMock('expo-router');
    useLocalSearchParams.mockReturnValue({
      g: '550e8400-e29b-41d4-a716-446655440000', // valid UUID
      n: 'TestGroup',
      t: 'aa11bb22cc33dd44ee55ff6600112233aa11bb22cc33dd44ee55ff6600112233', // 64 hex chars
      f: '', // empty fingerprint
      e: String(Date.now() + 48 * 60 * 60 * 1000),
    });

    expect(() => render(<JoinGroupScreen />)).not.toThrow();
  });
});
