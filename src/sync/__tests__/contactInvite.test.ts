import {
  createContactInvite, isContactInviteExpired, deriveContactInviteTopic,
  sealContactClaim, openContactClaim, sealContactGrant, openContactGrant,
} from '../contactInvite';
import { generateIdentity, fingerprint } from '../groupInvite';
import { sealEnvelope, openEnvelope, fromHex } from '../envelopeCrypto';
import * as Crypto from 'expo-crypto';
import type { ContactCard } from '../contactChannel';

function card(overrides: Partial<ContactCard> = {}): ContactCard {
  return {
    kind: 'contact', userId: 'u-ana', name: 'Ana',
    contactSecret: 'a'.repeat(64), wrapPublicKey: 'b'.repeat(64), identityPublicKey: 'c'.repeat(64),
    sentAt: 1000,
    ...overrides,
  };
}

describe('createContactInvite', () => {
  it('arma un token al azar, la huella de la identidad y el vencimiento a 48hs', () => {
    const id = generateIdentity();
    const now = 1_000_000;
    const invite = createContactInvite('Ana', id.publicKey, now);
    expect(invite.fromName).toBe('Ana');
    expect(invite.token).toMatch(/^[0-9a-f]{64}$/);
    expect(invite.inviterFingerprint).toHaveLength(32);
    expect(invite.expiresAt).toBe(now + 48 * 60 * 60 * 1000);
    expect(invite.claimedBy).toBeUndefined();
  });

  it('dos invitaciones seguidas tienen tokens distintos', () => {
    const id = generateIdentity();
    const a = createContactInvite('Ana', id.publicKey);
    const b = createContactInvite('Ana', id.publicKey);
    expect(a.token).not.toBe(b.token);
  });
});

describe('isContactInviteExpired', () => {
  it('vencida cuando "ahora" pasa expiresAt', () => {
    const invite = createContactInvite('Ana', 'aa', 1000);
    expect(isContactInviteExpired(invite, 1000 + 48 * 60 * 60 * 1000 + 1)).toBe(true);
    expect(isContactInviteExpired(invite, 1000)).toBe(false);
  });
});

describe('deriveContactInviteTopic', () => {
  it('el mismo token siempre da el mismo topic', async () => {
    const a = await deriveContactInviteTopic('tok-1');
    const b = await deriveContactInviteTopic('tok-1');
    expect(a).toBe(b);
  });

  it('tokens distintos dan topics distintos', async () => {
    const a = await deriveContactInviteTopic('tok-1');
    const b = await deriveContactInviteTopic('tok-2');
    expect(a).not.toBe(b);
  });
});

describe('sealContactClaim / openContactClaim', () => {
  it('ida y vuelta', async () => {
    const sealed = await sealContactClaim('tok-1', card());
    const abierto = await openContactClaim('tok-1', sealed);
    expect(abierto).toEqual(card());
  });

  it('con el token equivocado no abre', async () => {
    const sealed = await sealContactClaim('tok-1', card());
    expect(await openContactClaim('tok-2', sealed)).toBeNull();
  });

  it('basura no abre', async () => {
    expect(await openContactClaim('tok-1', 'no-es-un-sobre')).toBeNull();
  });

  it('un grant sellado con el mismo token no se confunde con un claim', async () => {
    const id = generateIdentity();
    const sealedGrant = await sealContactGrant('tok-1', card(), 'u-beto', id.privateKey);
    expect(await openContactClaim('tok-1', sealedGrant)).toBeNull();
  });
});

describe('sealContactGrant / openContactGrant', () => {
  it('ida y vuelta, con la huella correcta', async () => {
    const id = generateIdentity();
    const sealed = await sealContactGrant('tok-1', card(), 'u-beto', id.privateKey);
    const abierto = await openContactGrant('tok-1', sealed, fingerprint(id.publicKey));
    expect(abierto).toEqual({ card: card(), forUserId: 'u-beto' });
  });

  it('rechaza con la huella equivocada', async () => {
    const id = generateIdentity();
    const sealed = await sealContactGrant('tok-1', card(), 'u-beto', id.privateKey);
    expect(await openContactGrant('tok-1', sealed, '0'.repeat(32))).toBeNull();
  });

  it('rechaza una firma que no corresponde (identidad distinta a la que firmó)', async () => {
    const firmante = generateIdentity();
    const impostor = generateIdentity();
    const sealed = await sealContactGrant('tok-1', card(), 'u-beto', firmante.privateKey);
    // Se manipula el sobre para decir que lo firmó "impostor" sin haber resellado:
    // alcanza con verificar que la huella esperada de un tercero no matchea.
    expect(await openContactGrant('tok-1', sealed, fingerprint(impostor.publicKey))).toBeNull();
  });

  it('un claim sellado con el mismo token no se confunde con un grant', async () => {
    const id = generateIdentity();
    const sealedClaim = await sealContactClaim('tok-1', card());
    expect(await openContactGrant('tok-1', sealedClaim, fingerprint(id.publicKey))).toBeNull();
  });

  // T-096 · ADR-015: `forUserId` viaja DENTRO de lo firmado. Si viajara afuera,
  // cualquiera con el link (la misma clave simétrica del token) podría tomar un
  // grant real, cambiarle el destinatario y resellarlo con la MISMA firma —que
  // seguiría siendo válida porque no cubre ese campo— para hacerse pasar por el
  // destinatario legítimo. Éste es el test que un bug así rompe.
  it('cambiar el destinatario sin resellar rompe la firma (forUserId está adentro de lo firmado)', async () => {
    const id = generateIdentity();
    const sealed = await sealContactGrant('tok-1', card(), 'u-beto', id.privateKey);
    const abierto = await open_sinVerificar(sealed);
    const alterado = { ...abierto, forUserId: 'u-mallory' };
    const reseallado = await reseal_sinFirmar('tok-1', alterado);
    expect(await openContactGrant('tok-1', reseallado, fingerprint(id.publicKey))).toBeNull();
  });
});

// Helpers de bajo nivel para el test de arriba: abren/resellan el sobre SIN
// pasar por sealContactGrant, simulando a un atacante que ya tiene el token
// (y por lo tanto la clave simétrica del buzón) pero no la privada de quien
// invita.
async function inviteKeyDeTest(token: string): Promise<Uint8Array> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `splitp2p/contact-invite/v1:${token}`,
  );
  return fromHex(hex.slice(0, 64));
}

async function open_sinVerificar(sealed: string): Promise<Record<string, unknown>> {
  const plain = openEnvelope(await inviteKeyDeTest('tok-1'), sealed);
  return JSON.parse(plain!) as Record<string, unknown>;
}

async function reseal_sinFirmar(token: string, msg: Record<string, unknown>): Promise<string> {
  return sealEnvelope(await inviteKeyDeTest(token), JSON.stringify(msg));
}
