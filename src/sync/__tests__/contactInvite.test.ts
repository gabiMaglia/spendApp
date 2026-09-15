import {
  createContactInvite, isContactInviteExpired, deriveContactInviteTopic,
  sealContactClaim, openContactClaim, sealContactGrant, openContactGrant,
  contactInviteToLink, parseContactInviteLink,
} from '../contactInvite';
import { generateIdentity, generateWrapKeypair, fingerprint, unwrapGroupKey } from '../groupInvite';
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
    const wrap = generateWrapKeypair();
    const invite = createContactInvite('Ana', id.publicKey, wrap.publicKey, now);
    expect(invite.fromName).toBe('Ana');
    expect(invite.token).toMatch(/^[0-9a-f]{64}$/);
    expect(invite.inviterFingerprint).toHaveLength(32);
    expect(invite.inviterWrapPublicKey).toBe(wrap.publicKey);
    expect(invite.expiresAt).toBe(now + 48 * 60 * 60 * 1000);
    expect(invite.claimedBy).toBeUndefined();
  });

  it('dos invitaciones seguidas tienen tokens distintos', () => {
    const id = generateIdentity();
    const wrap = generateWrapKeypair();
    const a = createContactInvite('Ana', id.publicKey, wrap.publicKey);
    const b = createContactInvite('Ana', id.publicKey, wrap.publicKey);
    expect(a.token).not.toBe(b.token);
  });
});

describe('isContactInviteExpired', () => {
  it('vencida cuando "ahora" pasa expiresAt', () => {
    const invite = createContactInvite('Ana', 'aa', 'bb', 1000);
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
  it('ida y vuelta: la tarjeta viaja sin el secreto, y quien invita desenvuelve el real', async () => {
    const inviterWrap = generateWrapKeypair();
    const claimantWrap = generateWrapKeypair();
    const c = card({ wrapPublicKey: claimantWrap.publicKey });

    const sealed = await sealContactClaim('tok-1', c, inviterWrap.publicKey, claimantWrap.privateKey);
    const abierto = await openContactClaim('tok-1', sealed);

    expect(abierto).not.toBeNull();
    // La tarjeta que devuelve NO trae el secreto en claro (I1): viaja aparte, envuelto.
    expect(abierto!.card).not.toHaveProperty('contactSecret');
    expect(abierto!.card).toEqual({
      kind: c.kind, userId: c.userId, name: c.name,
      wrapPublicKey: c.wrapPublicKey, identityPublicKey: c.identityPublicKey, sentAt: c.sentAt,
    });

    // Sólo con la privada de envoltura de quien invita se recupera el secreto real.
    const destapado = unwrapGroupKey(abierto!.wrappedSecret, abierto!.card.wrapPublicKey, inviterWrap.privateKey);
    expect(destapado).toBe(c.contactSecret);
  });

  it('con el token equivocado no abre', async () => {
    const inviterWrap = generateWrapKeypair();
    const claimantWrap = generateWrapKeypair();
    const sealed = await sealContactClaim(
      'tok-1', card({ wrapPublicKey: claimantWrap.publicKey }), inviterWrap.publicKey, claimantWrap.privateKey,
    );
    expect(await openContactClaim('tok-2', sealed)).toBeNull();
  });

  it('basura no abre', async () => {
    expect(await openContactClaim('tok-1', 'no-es-un-sobre')).toBeNull();
  });

  it('un grant sellado con el mismo token no se confunde con un claim', async () => {
    const id = generateIdentity();
    const senderWrap = generateWrapKeypair();
    const claimantWrap = generateWrapKeypair();
    const sealedGrant = await sealContactGrant(
      'tok-1', card({ wrapPublicKey: senderWrap.publicKey }), 'u-beto',
      claimantWrap.publicKey, id.privateKey, senderWrap.privateKey,
    );
    expect(await openContactClaim('tok-1', sealedGrant)).toBeNull();
  });

  // I1 (cierre — revisión final de T-096 · ADR-015): mismo hallazgo que C2 pero
  // en la dirección del reclamo. Antes de este fix, el `contactSecret` del
  // RECLAMANTE viajaba en CLARO dentro del sobre sellado sólo con la clave
  // simétrica del token — la misma que cualquiera con el link reenviado puede
  // derivar, sin haber reclamado ni haber sido admitido nunca. Este test se
  // pone en el lugar de ESE bystander: sólo tiene el token y aun así puede
  // abrir el sobre exterior del claim igual que quien invitó. Lo que tiene que
  // fallarle es desenvolver el secreto real.
  it('un bystander con sólo el token (link reenviado) NO puede recuperar el contactSecret del reclamante', async () => {
    const inviterWrap = generateWrapKeypair();     // de quien comparte (Ana) — destinatario legítimo del claim
    const claimantWrap = generateWrapKeypair();    // del reclamante (Beto)
    const bystanderWrap = generateWrapKeypair();   // de un tercero que sólo tiene el link
    const c = card({ wrapPublicKey: claimantWrap.publicKey });

    const sealed = await sealContactClaim('tok-1', c, inviterWrap.publicKey, claimantWrap.privateKey);

    // El bystander tiene el token (por el link reenviado): abre el sobre
    // exterior exactamente igual que Ana, sin haber reclamado nada.
    const abierto = await openContactClaim('tok-1', sealed);
    expect(abierto).not.toBeNull(); // el sobre exterior SÍ abre — es público para el token

    // Pero intentar desenvolver el secreto con SU privada (no la de Ana) no da el real.
    const conBystander = unwrapGroupKey(abierto!.wrappedSecret, abierto!.card.wrapPublicKey, bystanderWrap.privateKey);
    expect(conBystander).not.toBe(c.contactSecret);

    // Confirmación de que el mecanismo funciona (no es sólo que unwrap siempre falle):
    // con la privada CORRECTA (la de Ana, la destinataria real del claim) sí se recupera.
    const conInvitadorReal = unwrapGroupKey(abierto!.wrappedSecret, abierto!.card.wrapPublicKey, inviterWrap.privateKey);
    expect(conInvitadorReal).toBe(c.contactSecret);
  });
});

describe('sealContactGrant / openContactGrant', () => {
  it('ida y vuelta, con la huella correcta, y el destinatario correcto desenvuelve el secreto real', async () => {
    const id = generateIdentity();
    const senderWrap = generateWrapKeypair();
    const claimantWrap = generateWrapKeypair();
    const c = card({ wrapPublicKey: senderWrap.publicKey });

    const sealed = await sealContactGrant('tok-1', c, 'u-beto', claimantWrap.publicKey, id.privateKey, senderWrap.privateKey);
    const abierto = await openContactGrant('tok-1', sealed, fingerprint(id.publicKey));

    expect(abierto).not.toBeNull();
    expect(abierto!.forUserId).toBe('u-beto');
    // La tarjeta que devuelve NO trae el secreto en claro (C2): viaja aparte, envuelto.
    expect(abierto!.card).not.toHaveProperty('contactSecret');
    expect(abierto!.card).toEqual({
      kind: c.kind, userId: c.userId, name: c.name,
      wrapPublicKey: c.wrapPublicKey, identityPublicKey: c.identityPublicKey, sentAt: c.sentAt,
    });

    // Sólo con la privada de envoltura del destinatario correcto se recupera el secreto real.
    const destapado = unwrapGroupKey(abierto!.wrappedSecret, abierto!.card.wrapPublicKey, claimantWrap.privateKey);
    expect(destapado).toBe(c.contactSecret);
  });

  it('rechaza con la huella equivocada', async () => {
    const id = generateIdentity();
    const senderWrap = generateWrapKeypair();
    const claimantWrap = generateWrapKeypair();
    const sealed = await sealContactGrant(
      'tok-1', card({ wrapPublicKey: senderWrap.publicKey }), 'u-beto',
      claimantWrap.publicKey, id.privateKey, senderWrap.privateKey,
    );
    expect(await openContactGrant('tok-1', sealed, '0'.repeat(32))).toBeNull();
  });

  it('rechaza una firma que no corresponde (identidad distinta a la que firmó)', async () => {
    const firmante = generateIdentity();
    const impostor = generateIdentity();
    const senderWrap = generateWrapKeypair();
    const claimantWrap = generateWrapKeypair();
    const sealed = await sealContactGrant(
      'tok-1', card({ wrapPublicKey: senderWrap.publicKey }), 'u-beto',
      claimantWrap.publicKey, firmante.privateKey, senderWrap.privateKey,
    );
    // Se manipula el sobre para decir que lo firmó "impostor" sin haber resellado:
    // alcanza con verificar que la huella esperada de un tercero no matchea.
    expect(await openContactGrant('tok-1', sealed, fingerprint(impostor.publicKey))).toBeNull();
  });

  it('un claim sellado con el mismo token no se confunde con un grant', async () => {
    const id = generateIdentity();
    const inviterWrap = generateWrapKeypair();
    const claimantWrap = generateWrapKeypair();
    const sealedClaim = await sealContactClaim(
      'tok-1', card({ wrapPublicKey: claimantWrap.publicKey }), inviterWrap.publicKey, claimantWrap.privateKey,
    );
    expect(await openContactGrant('tok-1', sealedClaim, fingerprint(id.publicKey))).toBeNull();
  });

  // T-096 · ADR-015: `forUserId` viaja DENTRO de lo firmado. Si viajara afuera,
  // cualquiera con el link (la misma clave simétrica del token) podría tomar un
  // grant real, cambiarle el destinatario y resellarlo con la MISMA firma —que
  // seguiría siendo válida porque no cubre ese campo— para hacerse pasar por el
  // destinatario legítimo. Éste es el test que un bug así rompe.
  it('cambiar el destinatario sin resellar rompe la firma (forUserId está adentro de lo firmado)', async () => {
    const id = generateIdentity();
    const senderWrap = generateWrapKeypair();
    const claimantWrap = generateWrapKeypair();
    const sealed = await sealContactGrant(
      'tok-1', card({ wrapPublicKey: senderWrap.publicKey }), 'u-beto',
      claimantWrap.publicKey, id.privateKey, senderWrap.privateKey,
    );
    const abierto = await open_sinVerificar(sealed);
    const alterado = { ...abierto, forUserId: 'u-mallory' };
    const reseallado = await reseal_sinFirmar('tok-1', alterado);
    expect(await openContactGrant('tok-1', reseallado, fingerprint(id.publicKey))).toBeNull();
  });

  // C2 (hallazgo de la revisión final de T-096 · ADR-015): antes de este fix, el
  // `contactSecret` viajaba en CLARO dentro del sobre sellado sólo con la clave
  // simétrica del token — la misma que cualquiera con el link reenviado puede
  // derivar, admitido o no. Este test se pone en el lugar de ESE bystander: sólo
  // tiene el token (nunca reclamó, nunca fue admitido) y sin embargo puede abrir
  // el sobre exterior igual que Ana o Beto, porque abrir el sobre sólo requiere
  // el token. Lo que tiene que fallarle es desenvolver el secreto real.
  it('un bystander con sólo el token (link reenviado, nunca admitido) NO puede recuperar el contactSecret real', async () => {
    const emisor = generateIdentity();
    const senderWrap = generateWrapKeypair();       // de quien comparte (Ana)
    const claimantWrap = generateWrapKeypair();      // del reclamante admitido (Beto)
    const bystanderWrap = generateWrapKeypair();     // de un tercero que sólo tiene el link
    const c = card({ wrapPublicKey: senderWrap.publicKey });

    const sealed = await sealContactGrant(
      'tok-1', c, 'u-beto', claimantWrap.publicKey, emisor.privateKey, senderWrap.privateKey,
    );

    // El bystander tiene el token (por el link reenviado) y por lo tanto la
    // huella pública de quien invita también viaja en el link: puede llamar a
    // openContactGrant exactamente igual que un cliente legítimo.
    const abierto = await openContactGrant('tok-1', sealed, fingerprint(emisor.publicKey));
    expect(abierto).not.toBeNull(); // el sobre exterior SÍ abre — es público para el token

    // Pero intentar desenvolver el secreto con SU privada (no la de Beto) no da el real.
    const conBystander = unwrapGroupKey(abierto!.wrappedSecret, abierto!.card.wrapPublicKey, bystanderWrap.privateKey);
    expect(conBystander).not.toBe(c.contactSecret);

    // Confirmación de que el mecanismo funciona (no es sólo que unwrap siempre falle):
    // con la privada CORRECTA (la de Beto, el destinatario real) sí se recupera.
    const conDestinatarioReal = unwrapGroupKey(abierto!.wrappedSecret, abierto!.card.wrapPublicKey, claimantWrap.privateKey);
    expect(conDestinatarioReal).toBe(c.contactSecret);
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

describe('contactInviteToLink / parseContactInviteLink', () => {
  it('ida y vuelta, formato compacto', () => {
    const invite = createContactInvite('Ana', generateIdentity().publicKey, generateWrapKeypair().publicKey, 1000);
    const link = contactInviteToLink(invite);
    expect(link).toContain('#i');
    const parsed = parseContactInviteLink(link);
    expect(parsed).toEqual(invite);
  });

  it('el link NUNCA contiene el secreto permanente de una cuenta (64 hex chars fuera del token)', () => {
    const invite = createContactInvite('Ana', generateIdentity().publicKey, generateWrapKeypair().publicKey, 1000);
    const link = contactInviteToLink(invite);
    // El único bloque hex de 64 chars que puede aparecer es el token mismo.
    const hex64 = link.match(/[0-9a-f]{64}/gi) ?? [];
    expect(hex64.filter(h => h.toLowerCase() !== invite.token.toLowerCase())).toEqual([]);
  });
});
