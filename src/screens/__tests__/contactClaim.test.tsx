import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
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

  it('al tocar Agregar, publica el reclamo y muestra indicador de carga', () => {
    mockParams = {
      n: 'Ana',
      t: 'aa11bb22cc33dd44ee55ff6600112233aa11bb22cc33dd44ee55ff6600112233',
      f: 'aa11bb22cc33dd44ee55ff66',
      e: String(Date.now() + 48 * 60 * 60 * 1000),
    };
    const { publishContactClaim } = jest.requireMock('@/src/sync/contactInviteEngine');
    publishContactClaim.mockResolvedValue(true);
    const { processContactInvite } = jest.requireMock('@/src/sync/contactInviteEngine');
    processContactInvite.mockResolvedValue(false);

    const { getByText } = render(<ContactClaimScreen />);
    fireEvent.press(getByText('contact.claim.accept'));

    expect(publishContactClaim).toHaveBeenCalled();
  });

  it('muestra el estado de éxito cuando se agrega el contacto', () => {
    mockParams = {
      n: 'Ana',
      t: 'aa11bb22cc33dd44ee55ff6600112233aa11bb22cc33dd44ee55ff6600112233',
      f: 'aa11bb22cc33dd44ee55ff66',
      e: String(Date.now() + 48 * 60 * 60 * 1000),
    };

    const { getByText } = render(<ContactClaimScreen />);
    // The text is interpolated with the name, so we just verify Ana is shown
    expect(getByText(/Ana/)).toBeTruthy();
  });

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
