import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ContactClaimScreen from '@/app/contact/claim';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: jest.fn(() => mockParams),
}));

jest.mock('@/src/sync/contactInvite', () => ({
  contactInviteFromParams: jest.fn((params: Record<string, unknown>) => {
    if (!params.t) return null;
    return {
      fromName: params.n || 'Ana',
      token: params.t,
      inviterFingerprint: params.f || '',
      expiresAt: params.e ? Number(params.e) : Date.now() + 48 * 60 * 60 * 1000,
    };
  }),
  isContactInviteExpired: jest.fn((invite) => {
    return invite && Date.now() > invite.expiresAt;
  }),
}));

jest.mock('@/src/sync/contactInviteEngine', () => ({
  publishContactClaim: jest.fn(() => Promise.resolve(true)),
  processContactInvite: jest.fn(() => Promise.resolve(false)),
}));

jest.mock('@/src/sync/relayEngine', () => ({
  deviceId: jest.fn(() => 'dev-1'),
  startRelay: jest.fn(() => undefined),
}));

jest.mock('@/src/utils/keyFingerprint', () => ({
  shortFingerprint: jest.fn((fp: string) => {
    if (!fp) return '';
    // Take first 16 chars and format as 4 groups of 4
    const short = fp.slice(0, 16);
    return `${short.slice(0, 4)} ${short.slice(4, 8)} ${short.slice(8, 12)} ${short.slice(12, 16)}`;
  }),
}));

const ANA = { id: 'ana1', name: 'Ana' } as User;

beforeEach(() => {
  mockParams = {};
  jest.clearAllMocks();
  useAuthStore.setState({ currentUser: ANA });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ContactClaimScreen', () => {
  it('muestra el nombre de quien comparte y la huella antes de aceptar', () => {
    mockParams = {
      n: 'Ana',
      t: 'aa11bb22cc33dd44ee55ff6600112233aa11bb22cc33dd44ee55ff6600112233',
      f: 'aa11bb22cc33dd44ee55ff66',
      e: String(Date.now() + 48 * 60 * 60 * 1000),
    };

    const { getByText } = render(<ContactClaimScreen />);
    expect(getByText(/Ana/)).toBeTruthy();
    expect(getByText(/aa11 bb22 cc33 dd44/)).toBeTruthy();
  });

  it('al tocar Agregar, muestra estado entrando, y si no llega grant, alcanza esperando', async () => {
    mockParams = {
      n: 'Ana',
      t: 'aa11bb22cc33dd44ee55ff6600112233aa11bb22cc33dd44ee55ff6600112233',
      f: 'aa11bb22cc33dd44ee55ff66',
      e: String(Date.now() + 48 * 60 * 60 * 1000),
    };
    const { publishContactClaim } = jest.requireMock('@/src/sync/contactInviteEngine');
    publishContactClaim.mockResolvedValue(true);
    const { processContactInvite } = jest.requireMock('@/src/sync/contactInviteEngine');
    // Always return false: no grant arrives; polling will timeout after 25s
    processContactInvite.mockResolvedValue(false);

    const { getByText, queryByText } = render(<ContactClaimScreen />);

    // Initial state: listo
    expect(getByText(/Ana/)).toBeTruthy();

    // Press the button
    fireEvent.press(getByText('contact.claim.accept'));

    // State transitions to entrando: shows waiting_key text
    await waitFor(() => {
      expect(queryByText('contact.claim.waiting_key')).toBeTruthy();
    }, { timeout: 2000 });

    expect(publishContactClaim).toHaveBeenCalled();

    // After timeout, transitions to esperando: pending_title appears
    // ESPERA_MS = 25000, so this needs ~25 seconds
    await waitFor(() => {
      expect(queryByText('contact.claim.pending_title')).toBeTruthy();
    }, { timeout: 30000 });
  }, 35000); // Allow 35s timeout for this long-running test

  it('si grant llega durante polling, pantalla transiciona a entre (success)', async () => {
    mockParams = {
      n: 'Ana',
      t: 'aa11bb22cc33dd44ee55ff6600112233aa11bb22cc33dd44ee55ff6600112233',
      f: 'aa11bb22cc33dd44ee55ff66',
      e: String(Date.now() + 48 * 60 * 60 * 1000),
    };
    const { publishContactClaim } = jest.requireMock('@/src/sync/contactInviteEngine');
    publishContactClaim.mockResolvedValue(true);
    const { processContactInvite } = jest.requireMock('@/src/sync/contactInviteEngine');
    // Mock: processContactInvite returns false on first call, true on second call
    // This simulates: first poll attempt has no grant, second attempt (after 3s) has grant
    processContactInvite
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const { getByText, queryByText } = render(<ContactClaimScreen />);

    // Press the button to start handleAdd
    fireEvent.press(getByText('contact.claim.accept'));

    expect(publishContactClaim).toHaveBeenCalled();

    // After grant arrives (within first retry), state becomes entre
    // Should happen within ~6 seconds (3s for first retry + time for second attempt)
    await waitFor(() => {
      expect(queryByText('contact.claim.added_title')).toBeTruthy();
    }, { timeout: 10000 });

    expect(processContactInvite).toHaveBeenCalledTimes(2);
  }, 15000);

  it('link vencido muestra el estado de vencido, no el de aceptar', () => {
    mockParams = {
      n: 'Ana',
      t: 'aa11bb22cc33dd44ee55ff6600112233aa11bb22cc33dd44ee55ff6600112233',
      f: 'aa11bb22cc33dd44ee55ff66',
      e: String(Date.now() - 1000), // Expired
    };

    const { getByText, queryByText } = render(<ContactClaimScreen />);
    expect(getByText('contact.claim.expired_title')).toBeTruthy();
    expect(queryByText(/Agregar/i)).toBeFalsy();
  });

  it('link inválido (sin token) muestra el estado de inválido', () => {
    // No params provided
    const { getByText, queryByText } = render(<ContactClaimScreen />);
    expect(getByText('contact.claim.invalid_title')).toBeTruthy();
    expect(queryByText(/Agregar/i)).toBeFalsy();
  });

  // M3 (revisión final de T-096): `app/contact/claim.tsx` tiene el mismo guard
  // que `app/groups/join.tsx` para una huella vacía (formato largo viejo sin
  // `f`), pero no tenía ningún test que lo cubriera.
  it('no muestra la huella cuando viene vacía (formato largo viejo sin ese parámetro)', () => {
    mockParams = {
      n: 'Ana',
      t: 'aa11bb22cc33dd44ee55ff6600112233aa11bb22cc33dd44ee55ff6600112233',
      f: '', // empty fingerprint
      e: String(Date.now() + 48 * 60 * 60 * 1000),
    };

    const { getByText, queryByText } = render(<ContactClaimScreen />);
    expect(getByText(/Ana/)).toBeTruthy();
    expect(queryByText(/contact.claim.inviter_fingerprint/)).toBeNull();
  });

  it('sin login muestra el estado de necesita login', () => {
    mockParams = {
      n: 'Ana',
      t: 'aa11bb22cc33dd44ee55ff6600112233aa11bb22cc33dd44ee55ff6600112233',
      f: 'aa11bb22cc33dd44ee55ff66',
      e: String(Date.now() + 48 * 60 * 60 * 1000),
    };
    useAuthStore.setState({ currentUser: null });

    const { getByText, queryByText } = render(<ContactClaimScreen />);
    expect(getByText('contact.claim.need_login_title')).toBeTruthy();
    expect(queryByText(/Agregar/i)).toBeFalsy();
  });
});
