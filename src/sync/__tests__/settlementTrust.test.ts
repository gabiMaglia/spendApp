import { ed25519 } from '@noble/curves/ed25519.js';
import { checkSettlement, __resetSettlementTrust } from '../settlementTrust';
import { signSettlement } from '../settlementSign';
import {
  rememberAuthorKey, forgetAuthorKeys, refreshPendingAuthors, __resetAuthorSources,
} from '../authorKeys';
import { toHex } from '../hexBytes';
import type { SettlementConfirmation } from '@/src/types/models';

jest.mock('@noble/curves/ed25519.js', () => {
  const real = jest.requireActual('@noble/curves/ed25519.js');
  return { ...real, ed25519: { ...real.ed25519, verify: jest.fn((...a: unknown[]) => real.ed25519.verify(...a)) } };
});

const mockGetPeer = jest.fn();
jest.mock('../contactChannel', () => ({ getPeer: (userId: string) => mockGetPeer(userId) }));

const mockFetchAccountKeys = jest.fn();
jest.mock('../deviceKeys', () => ({
  fetchAccountKeys: (accountId: string) => mockFetchAccountKeys(accountId),
}));

function par(seed: number) {
  const priv = new Uint8Array(32).fill(seed);
  return { priv: toHex(priv), pub: toHex(ed25519.getPublicKey(priv)) };
}

const PRIV = toHex(new Uint8Array(32).fill(7));
const PUB  = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(7)));
const acuse: SettlementConfirmation = { userId: 'beto', confirmedAt: 1_000, action: 'confirm' };

beforeEach(() => {
  forgetAuthorKeys();
  __resetAuthorSources();
  __resetSettlementTrust();
  (ed25519.verify as jest.Mock).mockClear();
  mockGetPeer.mockReset().mockReturnValue(undefined);
  mockFetchAccountKeys.mockReset().mockResolvedValue([]);
});

it('sin firma: no_verificable', () => {
  expect(checkSettlement('p1', acuse)).toBe('no_verificable');
});

it('firmado por una clave que sabemos de Beto: valida', () => {
  rememberAuthorKey('beto', PUB);
  expect(checkSettlement('p1', { ...acuse, ...signSettlement('p1', acuse, PRIV) })).toBe('valida');
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

it('una firma que no verifica contra la clave propia del autor sigue siendo `invalida`', () => {
  // La clave presentada SÍ es una de las conocidas: no hay nada viejo acá, la
  // firma simplemente no cierra (D2 no puede tapar esto).
  rememberAuthorKey('beto', PUB);
  const firmado = { ...acuse, ...signSettlement('p1', acuse, PRIV) };
  expect(checkSettlement('p1', { ...firmado, confirmedAt: 999 })).toBe('invalida');
});

/**
 * **D1 (ronda 2 del verificador): una clave STALE no puede producir `invalida`.**
 *
 * Beto reinstaló. `authorKeys` guarda su clave VIEJA (`rememberAuthorKey`
 * simula el registro local de peers, que nunca la reemplaza): la lista de
 * claves conocidas de Beto NO está vacía, tiene una, la equivocada. Antes de
 * este fix, `verifySettlement` marcaba esto `invalida` apenas la clave
 * presentada no estaba en esa lista — sin importar si el directorio alguna vez
 * contestó sobre ELLA. Mismo bug que D2 en `recordHealth.ts`, acá sin arreglar.
 */
describe('D2 (authorKeys) aplicado al acuse de saldado: una clave stale no es `invalida`', () => {
  const VIEJA = par(21);
  const NUEVA = par(22);

  it('clave vieja conocida + clave nueva presentada, directorio sin contestar todavía: `no_verificable`', () => {
    rememberAuthorKey('beto', VIEJA.pub);
    const c = { ...acuse, ...signSettlement('p1', acuse, NUEVA.priv) };
    expect(checkSettlement('p1', c)).toBe('no_verificable');
  });

  it('y dispara la consulta al directorio, que es lo que lo arregla', async () => {
    rememberAuthorKey('beto', VIEJA.pub);
    const c = { ...acuse, ...signSettlement('p1', acuse, NUEVA.priv) };
    checkSettlement('p1', c); // encola la consulta por la clave presentada

    mockFetchAccountKeys.mockResolvedValue([NUEVA.pub]);
    await refreshPendingAuthors();

    expect(checkSettlement('p1', c)).toBe('valida');
  });

  it('cuando el directorio ya contestó y la clave sigue afuera: recién ahí `invalida`', async () => {
    rememberAuthorKey('beto', VIEJA.pub);
    const c = { ...acuse, ...signSettlement('p1', acuse, NUEVA.priv) };
    checkSettlement('p1', c); // encola

    mockFetchAccountKeys.mockResolvedValue([]); // el directorio contesta: sigue sin cubrirla
    await refreshPendingAuthors();

    expect(checkSettlement('p1', c)).toBe('invalida');
  });

  it('un directorio caído nunca convierte un corte de red en una acusación', async () => {
    rememberAuthorKey('beto', VIEJA.pub);
    const c = { ...acuse, ...signSettlement('p1', acuse, NUEVA.priv) };
    checkSettlement('p1', c);

    mockFetchAccountKeys.mockRejectedValue(new Error('sin red'));
    await refreshPendingAuthors();

    expect(checkSettlement('p1', c)).toBe('no_verificable');
  });

  /**
   * El defecto exacto que reportó el verificador: `invalida` no puede quedar
   * pegado en la caché cuando lo único que cambió es que este teléfono APRENDIÓ
   * la clave nueva (sin pasar por el directorio simulado arriba). No hace falta
   * limpiar la caché a mano — `no_verificable` nunca se cachea (S3), así que la
   * próxima consulta se reevalúa sola.
   */
  it('aprender la clave nueva reevalúa solo, sin vaciar la caché a mano', () => {
    rememberAuthorKey('beto', VIEJA.pub);
    const c = { ...acuse, ...signSettlement('p1', acuse, NUEVA.priv) };
    expect(checkSettlement('p1', c)).toBe('no_verificable');

    rememberAuthorKey('beto', NUEVA.pub);
    expect(checkSettlement('p1', c)).toBe('valida');
  });
});

/**
 * **R1 (verificador, Re-review 1): el borde de ADR-004 — autor SIN NINGUNA
 * clave conocida, nunca — se rompió al arreglar D1.**
 *
 * Diferencia con el describe de arriba: ahí Beto tenía UNA clave (la vieja).
 * Acá no tiene NINGUNA — ni registro local de peers, ni caché — porque entró
 * por Apple sin `email` (ADR-004) y el directorio nunca va a resolverlo. El
 * fix de D1 sacó la guarda explícita `keys.length === 0` que existía en
 * `settlementSign.ts:50` (y sigue en `recordHealth.ts:278-281`): sin ella, un
 * autor irresoluble cae en la rama de D2, y en cuanto el directorio contesta
 * (aunque sea vacío) `authorKeyWasAsked` da `true` y el acuse queda `invalida`
 * PARA SIEMPRE — la caché lo fija y nunca hay una clave que aprender.
 */
describe('R1: autor sin ninguna clave conocida (borde de ADR-004)', () => {
  const NUEVA = par(23);

  it('sin ninguna clave conocida y el directorio TODAVÍA sin contestar: `no_verificable`', () => {
    const c = { ...acuse, ...signSettlement('p1', acuse, NUEVA.priv) };
    expect(checkSettlement('p1', c)).toBe('no_verificable');
  });

  /**
   * El PoC exacto del dictamen: antes del directorio, `rechazado`
   * (`no_verificable` se honra). Con el directorio contestando VACÍO —el
   * caso normal de ADR-004, no un corte de red— debe seguir `no_verificable`,
   * nunca `invalida`: un autor sin directorio nunca puede acusarse por eso.
   */
  it('y el directorio contesta VACÍO (ADR-004: nunca va a resolverlo): sigue `no_verificable`, no `invalida`', async () => {
    const c = { ...acuse, ...signSettlement('p1', acuse, NUEVA.priv) };
    checkSettlement('p1', c); // encola la consulta

    mockFetchAccountKeys.mockResolvedValue([]); // contesta, sin nada: el borde de ADR-004
    await refreshPendingAuthors();

    expect(checkSettlement('p1', c)).toBe('no_verificable');
  });

  it('no queda cacheado: si el directorio aprende la clave más tarde, pasa a `valida`', async () => {
    const c = { ...acuse, ...signSettlement('p1', acuse, NUEVA.priv) };
    checkSettlement('p1', c);
    mockFetchAccountKeys.mockResolvedValue([]);
    await refreshPendingAuthors();
    expect(checkSettlement('p1', c)).toBe('no_verificable'); // seguía sin cerrar

    rememberAuthorKey('beto', NUEVA.pub); // ahora sí se resuelve
    expect(checkSettlement('p1', c)).toBe('valida');
  });
});
