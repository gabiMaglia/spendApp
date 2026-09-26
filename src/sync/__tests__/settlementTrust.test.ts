import { ed25519 } from '@noble/curves/ed25519.js';
import { checkSettlement, __resetSettlementTrust } from '../settlementTrust';
import { signSettlement } from '../settlementSign';
import { rememberAuthorKey, forgetAuthorKeys } from '../authorKeys';
import { toHex } from '../hexBytes';
import type { SettlementConfirmation } from '@/src/types/models';

jest.mock('@noble/curves/ed25519.js', () => {
  const real = jest.requireActual('@noble/curves/ed25519.js');
  return { ...real, ed25519: { ...real.ed25519, verify: jest.fn((...a: unknown[]) => real.ed25519.verify(...a)) } };
});

const PRIV = toHex(new Uint8Array(32).fill(7));
const PUB  = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(7)));
const acuse: SettlementConfirmation = { userId: 'beto', confirmedAt: 1_000, action: 'confirm' };

beforeEach(() => { forgetAuthorKeys(); __resetSettlementTrust(); (ed25519.verify as jest.Mock).mockClear(); });

it('sin firma: no_verificable', () => {
  expect(checkSettlement('p1', acuse)).toBe('no_verificable');
});

it('firmado por una clave que sabemos de Beto: valida', () => {
  rememberAuthorKey('beto', PUB);
  expect(checkSettlement('p1', { ...acuse, ...signSettlement('p1', acuse, PRIV) })).toBe('valida');
});

it('firmado por otra clave a nombre de Beto: invalida', () => {
  rememberAuthorKey('beto', 'cc'.repeat(32));
  expect(checkSettlement('p1', { ...acuse, ...signSettlement('p1', acuse, PRIV) })).toBe('invalida');
});

it('la misma firma no toca la curva dos veces (caché por mensaje+k+s)', () => {
  rememberAuthorKey('beto', PUB);
  const firmado = { ...acuse, ...signSettlement('p1', acuse, PRIV) };
  checkSettlement('p1', firmado);
  checkSettlement('p1', firmado);
  expect(ed25519.verify).toHaveBeenCalledTimes(1);
});

it('cambiar el paymentId invalida la caché: es otro mensaje', () => {
  rememberAuthorKey('beto', PUB);
  const firmado = { ...acuse, ...signSettlement('p1', acuse, PRIV) };
  expect(checkSettlement('p1', firmado)).toBe('valida');
  expect(checkSettlement('p2', firmado)).toBe('invalida');
  expect(ed25519.verify).toHaveBeenCalledTimes(2);
});
