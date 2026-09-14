import {
  generateIdentity, generateWrapKeypair, fingerprint,
  createInvite, inviteToLink, parseInviteLink, inviteFromParams, isInviteExpired,
  deriveInviteTopic, sealClaim, openClaim, sealGrant, openGrant,
  wrapGroupKey, unwrapGroupKey, type InviteClaim, type UnsignedGrant,
} from '../groupInvite';
import { openEnvelope, sealEnvelope, fromHex } from '../envelopeCrypto';
import * as Crypto from 'expo-crypto';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** La misma derivación que usa el módulo, para poder alterar un sobre sellado. */
async function claveDelToken(token: string): Promise<Uint8Array> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `splitp2p/invite/v1:${token}`,
  );
  return fromHex(hex.slice(0, 64));
}

const AHORA = Date.UTC(2026, 7, 17, 12);

function claim(over: Partial<InviteClaim> = {}): InviteClaim {
  return {
    kind: 'claim', groupId: 'g1', userId: 'u-ana',
    wrapPublicKey: 'aa'.repeat(32), identityPublicKey: 'bb'.repeat(32),
    displayName: 'Ana', claimedAt: AHORA, ...over,
  };
}

describe('link de invitación', () => {
  it('ida y vuelta sin pérdida', () => {
    const inv = createInvite('g1', 'Viaje a Bariloche', generateIdentity().publicKey, AHORA);
    const leido = parseInviteLink(inviteToLink(inv));

    expect(leido).toEqual(inv);
  });

  it('el link es https: Gmail y los chats sólo enlazan http/https', () => {
    const link = inviteToLink(createInvite('g1', 'Viaje', generateIdentity().publicKey, AHORA));
    expect(link.startsWith('https://')).toBe(true);
    expect(link).toMatch(/#g[A-Za-z0-9_-]+$/);
  });

  // T-102 (PO, 2026-09-13): el Pages personal del PO se apaga — ve los
  // secretos del link. Un link viejo ya compartido con esa base deja de
  // leerse; el largo sobre la base nueva se sigue aceptando (test siguiente).
  it('un link largo del Pages personal viejo (gabimaglia) ya NO se lee (T-102)', () => {
    const inv = createInvite('g1', 'Viaje', generateIdentity().publicKey, AHORA);
    const params = new URLSearchParams({
      g: inv.groupId, n: inv.groupName, t: inv.token, f: inv.inviterFingerprint, e: String(inv.expiresAt),
    });
    const largo = `https://gabimaglia.github.io/spendApp/web/abrir.html#groups/join?${params}`;
    expect(parseInviteLink(largo)).toBeNull();
  });

  it('un link largo sobre la base nueva (spendapp.github.io) se sigue leyendo', () => {
    const inv = createInvite('g1', 'Viaje', generateIdentity().publicKey, AHORA);
    const params = new URLSearchParams({
      g: inv.groupId, n: inv.groupName, t: inv.token, f: inv.inviterFingerprint, e: String(inv.expiresAt),
    });
    const largo = `https://spendapp.github.io/#groups/join?${params}`;
    expect(parseInviteLink(largo)).toEqual(inv);
  });

  it('sobrevive nombres con acentos y espacios', () => {
    const inv = createInvite('g1', 'Año Nuevo en Córdoba', generateIdentity().publicKey, AHORA);
    expect(parseInviteLink(inviteToLink(inv))!.groupName).toBe('Año Nuevo en Córdoba');
  });

  it('un link roto devuelve null en vez de tirar', () => {
    expect(parseInviteLink('cualquier cosa')).toBeNull();
    // Un link de otra pantalla, aunque traiga los mismos parámetros, no es una invitación.
    expect(parseInviteLink('spendapp://contact/add?g=g1&t=x&e=1')).toBeNull();
    expect(parseInviteLink('spendapp://groups/join')).toBeNull();
    expect(parseInviteLink('spendapp://groups/join?g=g1')).toBeNull(); // sin token
  });

  it('vence a las 48h (regla de negocio #9)', () => {
    const inv = createInvite('g1', 'x', generateIdentity().publicKey, AHORA);

    expect(isInviteExpired(inv, AHORA + 47 * 3600_000)).toBe(false);
    expect(isInviteExpired(inv, AHORA + 49 * 3600_000)).toBe(true);
  });

  it('cada invitación tiene su propio token', () => {
    const a = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    const b = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    expect(b.token).not.toBe(a.token);
  });

  it('el link lleva la huella de quien invita', () => {
    const yo = generateIdentity();
    const inv = createInvite('g1', 'x', yo.publicKey, AHORA);
    expect(inv.inviterFingerprint).toBe(fingerprint(yo.publicKey));
    expect(inv.inviterFingerprint).toHaveLength(32); // 128 bits en hex
  });
});

describe('reclamo sellado — el relay NO puede sustituir la clave del invitado', () => {
  it('con el token correcto se abre', async () => {
    const inv = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    const sellado = await sealClaim(inv.token, claim());

    expect(await openClaim(inv.token, sellado)).toMatchObject({ groupId: 'g1' });
  });

  // ESTA es la garantía del diseño: el relay ve pasar el sobre pero NO conoce
  // el token (viajó en el link, por fuera). Sin él no puede fabricar un reclamo
  // válido, así que no puede hacerse pasar por el invitado ni envolverse la
  // clave del grupo a sí mismo.
  it('sin el token NO se puede abrir', async () => {
    const inv = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    const sellado = await sealClaim(inv.token, claim());

    const otro = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    expect(await openClaim(otro.token, sellado)).toBeNull();
  });

  it('un reclamo alterado no abre', async () => {
    const inv = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    const sellado = await sealClaim(inv.token, claim());
    const roto = sellado.slice(0, -4) + (sellado.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');

    expect(await openClaim(inv.token, roto)).toBeNull();
  });

  it('basura en el canal devuelve null, no rompe', async () => {
    const inv = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    expect(await openClaim(inv.token, 'no soy un reclamo')).toBeNull();
  });

  it('un reclamo sin la clave de envoltura se rechaza', async () => {
    const inv = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    const incompleto = await sealClaim(inv.token, { kind: 'claim', groupId: 'g1' } as InviteClaim);

    expect(await openClaim(inv.token, incompleto)).toBeNull();
  });
});

describe('envoltura de la clave del grupo', () => {
  it('sólo el destinatario puede abrirla', () => {
    const miembro = generateWrapKeypair();
    const invitado = generateWrapKeypair();
    const gk = 'cc'.repeat(32);

    const envuelta = wrapGroupKey(gk, invitado.publicKey, miembro.privateKey);

    expect(unwrapGroupKey(envuelta, miembro.publicKey, invitado.privateKey)).toBe(gk);
  });

  it('un tercero no puede abrirla ni conociendo las públicas', () => {
    const miembro = generateWrapKeypair();
    const invitado = generateWrapKeypair();
    const intruso = generateWrapKeypair();

    const envuelta = wrapGroupKey('cc'.repeat(32), invitado.publicKey, miembro.privateKey);

    expect(unwrapGroupKey(envuelta, miembro.publicKey, intruso.privateKey)).toBeNull();
  });

  it('la clave del grupo no aparece en claro en el blob', () => {
    const miembro = generateWrapKeypair();
    const invitado = generateWrapKeypair();
    const gk = 'dd'.repeat(32);

    expect(wrapGroupKey(gk, invitado.publicKey, miembro.privateKey)).not.toContain(gk);
  });

  // T-129: el secreto X25519 ya no se usa directo como clave AEAD (T-121 §1.3.4).
  describe('KDF con separación de dominio (T-129)', () => {
    it('la envoltura nueva se emite versionada (v2)', () => {
      const miembro = generateWrapKeypair();
      const invitado = generateWrapKeypair();

      const envuelta = wrapGroupKey('cc'.repeat(32), invitado.publicKey, miembro.privateKey);

      expect(envuelta.startsWith('v2:')).toBe(true);
    });

    it('la clave v2 es distinta del secreto compartido crudo', () => {
      const miembro = generateWrapKeypair();
      const invitado = generateWrapKeypair();
      const gk = 'cc'.repeat(32);

      const envuelta = wrapGroupKey(gk, invitado.publicKey, miembro.privateKey);
      const shared = x25519.getSharedSecret(fromHex(miembro.privateKey), fromHex(invitado.publicKey));

      // Un lector que sólo conoce el secreto crudo (pre-T-129) no puede abrir
      // el sobre nuevo: ni la clave ni el formato coinciden con lo que espera.
      expect(openEnvelope(shared.slice(0, 32), envuelta)).not.toBe(gk);
    });

    it('un mensaje v1 (secreto crudo, sin prefijo) emitido antes de este cambio se sigue abriendo', () => {
      const miembro = generateWrapKeypair();
      const invitado = generateWrapKeypair();
      const gk = 'ee'.repeat(32);

      // Fabricado como lo hacía el código viejo: sin KDF, sin prefijo de versión.
      const shared = x25519.getSharedSecret(fromHex(miembro.privateKey), fromHex(invitado.publicKey));
      const v1 = sealEnvelope(shared.slice(0, 32), gk);

      expect(unwrapGroupKey(v1, miembro.publicKey, invitado.privateKey)).toBe(gk);
    });

    it('un intento de abrir un sobre v2 como si fuera v1 falla', () => {
      const miembro = generateWrapKeypair();
      const invitado = generateWrapKeypair();
      const gk = 'ff'.repeat(32);

      const envuelta = wrapGroupKey(gk, invitado.publicKey, miembro.privateKey);
      // "Como v1": un unwrapGroupKey viejo no sabe de prefijos ni de HKDF, sólo
      // sabe abrir con el secreto crudo tal cual llega el string.
      const shared = x25519.getSharedSecret(fromHex(invitado.privateKey), fromHex(miembro.publicKey));
      expect(openEnvelope(shared.slice(0, 32), envuelta)).not.toBe(gk);
    });

    it('si se cambia la etiqueta de contexto del info, el descifrado falla', () => {
      const miembro = generateWrapKeypair();
      const invitado = generateWrapKeypair();
      const gk = '11'.repeat(32);

      const shared = x25519.getSharedSecret(fromHex(miembro.privateKey), fromHex(invitado.publicKey));
      const [a, b] = [miembro.publicKey, invitado.publicKey].sort();
      const infoConEtiquetaVieja = new TextEncoder().encode(`spendapp/grupo-clave/v1:${a}:${b}`);
      const key = hkdf(sha256, shared, undefined, infoConEtiquetaVieja, 32);
      const fabricado = 'v2:' + sealEnvelope(key, gk);

      expect(unwrapGroupKey(fabricado, miembro.publicKey, invitado.privateKey)).toBeNull();
    });

    it('si el info invierte el orden canónico de las públicas, el descifrado falla', () => {
      const miembro = generateWrapKeypair();
      const invitado = generateWrapKeypair();
      const gk = '22'.repeat(32);

      const shared = x25519.getSharedSecret(fromHex(miembro.privateKey), fromHex(invitado.publicKey));
      const [a, b] = [miembro.publicKey, invitado.publicKey].sort();
      // Orden invertido respecto del canónico (a < b): b primero, a segundo.
      const infoInvertido = new TextEncoder().encode(`spendapp/grupo-clave/v2:${b}:${a}`);
      const key = hkdf(sha256, shared, undefined, infoInvertido, 32);
      const fabricado = 'v2:' + sealEnvelope(key, gk);

      expect(unwrapGroupKey(fabricado, miembro.publicKey, invitado.privateKey)).toBeNull();
    });
  });
});

describe('identidades', () => {
  it('cada dispositivo genera la suya', () => {
    expect(generateIdentity().publicKey).not.toBe(generateIdentity().publicKey);
  });

  it('firma y envoltura usan pares distintos', () => {
    const id = generateIdentity();
    const wrap = generateWrapKeypair();
    expect(id.publicKey).not.toBe(wrap.publicKey);
  });
});

describe('el buzón de la invitación', () => {
  it('los dos lados derivan el mismo topic del token', async () => {
    const inv = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    expect(await deriveInviteTopic(inv.token)).toBe(await deriveInviteTopic(inv.token));
  });

  it('cada invitación tiene su propio buzón', async () => {
    const a = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    const b = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    expect(await deriveInviteTopic(a.token)).not.toBe(await deriveInviteTopic(b.token));
  });

  // El topic viaja en claro hasta el servidor. Si se derivara del mismo dominio
  // que la clave, el topic SERÍA la clave y el relay abriría todos los reclamos.
  it('EL TOPIC NO SIRVE COMO CLAVE PARA ABRIR LOS SOBRES', async () => {
    const inv = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    const sellado = await sealClaim(inv.token, claim());

    const topic = await deriveInviteTopic(inv.token);

    expect(openEnvelope(fromHex(topic.slice(0, 64)), sellado)).toBeNull();
  });
});

describe('entrega de la clave del grupo', () => {
  const datos = (over: Partial<UnsignedGrant> = {}): UnsignedGrant => ({
    groupId: 'g1', forUserId: 'u-beto',
    wrappedKey: 'envuelta', senderWrapPublicKey: 'cc'.repeat(32),
    grantedByIdentity: '', epoch: 1, grantedAt: AHORA, ...over,
  });

  it('quien invita la manda y el invitado la abre', async () => {
    const inv = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    const ana = generateIdentity();
    const invite = { ...inv, inviterFingerprint: fingerprint(ana.publicKey) };

    const sellada = await sealGrant(invite.token, datos({ grantedByIdentity: ana.publicKey }), ana.privateKey);

    expect(await openGrant(invite.token, sellada, invite.inviterFingerprint))
      .toMatchObject({ groupId: 'g1', forUserId: 'u-beto' });
  });

  it('una entrega de otra identidad se rechaza', async () => {
    const inv = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    const ana = generateIdentity();
    const otro = generateIdentity();

    const sellada = await sealGrant(inv.token, datos({ grantedByIdentity: otro.publicKey }), otro.privateKey);

    expect(await openGrant(inv.token, sellada, fingerprint(ana.publicKey))).toBeNull();
  });

  // La firma cubre la pública de envoltura: cambiarla sería redirigir la clave.
  it('cambiar un campo firmado invalida la entrega', async () => {
    const inv = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    const ana = generateIdentity();
    const huella = fingerprint(ana.publicKey);

    const grant = datos({ grantedByIdentity: ana.publicKey });
    const firma = JSON.parse(
      openEnvelope(await claveDelToken(inv.token), await sealGrant(inv.token, grant, ana.privateKey))!,
    ) as Record<string, unknown>;

    firma.senderWrapPublicKey = 'dd'.repeat(32);
    const alterada = sealEnvelope(await claveDelToken(inv.token), JSON.stringify(firma));

    expect(await openGrant(inv.token, alterada, huella)).toBeNull();
  });

  it('un reclamo no se puede leer como entrega, ni al revés', async () => {
    const inv = createInvite('g1', 'x', 'aa'.repeat(32), AHORA);
    const ana = generateIdentity();

    const reclamo = await sealClaim(inv.token, claim());
    const entrega = await sealGrant(inv.token, datos({ grantedByIdentity: ana.publicKey }), ana.privateKey);

    expect(await openGrant(inv.token, reclamo, fingerprint(ana.publicKey))).toBeNull();
    expect(await openClaim(inv.token, entrega)).toBeNull();
  });
});

describe('inviteFromParams', () => {
  it('lee los parámetros que entrega el router', () => {
    const inv = createInvite('g1', 'Viaje', 'aa'.repeat(32), AHORA);
    const leido = inviteFromParams({
      g: inv.groupId, n: inv.groupName, t: inv.token,
      f: inv.inviterFingerprint, e: String(inv.expiresAt),
    });

    expect(leido).toEqual(inv);
  });

  it('sin token no hay invitación', () => {
    expect(inviteFromParams({ g: 'g1', e: '123' })).toBeNull();
  });

  it('un vencimiento que no es número se rechaza', () => {
    expect(inviteFromParams({ g: 'g1', t: 'tok', e: 'mañana' })).toBeNull();
  });

  it('formato largo validado (T-098 · SEC L-2)', () => {
    const inv = createInvite('g1', 'Viaje', 'aa'.repeat(32), AHORA);
    const ok = { g: inv.groupId, n: inv.groupName, t: inv.token, f: inv.inviterFingerprint, e: String(inv.expiresAt) };
    expect(inviteFromParams(ok)).toEqual(inv);
    expect(inviteFromParams({ ...ok, t: 'tok' })).toBeNull();
    expect(inviteFromParams({ ...ok, f: 'zz' })).toBeNull();
    expect(inviteFromParams({ ...ok, e: '1e308' })).toBeNull();
    expect(inviteFromParams({ ...ok, e: String(2 ** 48) })).toBeNull();
    expect(inviteFromParams({ ...ok, n: 'a‮b' })).toBeNull();
    // Sin huella (links largos muy viejos) sigue valiendo, como hoy.
    expect(inviteFromParams({ ...ok, f: undefined })).not.toBeNull();
  });
});
