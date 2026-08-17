import {
  generateIdentity, generateWrapKeypair, fingerprint,
  createInvite, inviteToLink, parseInviteLink, isInviteExpired,
  sealClaim, openClaim, wrapGroupKey, unwrapGroupKey, type InviteClaim,
} from '../groupInvite';

const AHORA = Date.UTC(2026, 7, 17, 12);

function claim(over: Partial<InviteClaim> = {}): InviteClaim {
  return {
    groupId: 'g1', wrapPublicKey: 'aa'.repeat(32), identityPublicKey: 'bb'.repeat(32),
    displayName: 'Ana', claimedAt: AHORA, ...over,
  };
}

describe('link de invitación', () => {
  it('ida y vuelta sin pérdida', () => {
    const inv = createInvite('g1', 'Viaje a Bariloche', generateIdentity().publicKey, AHORA);
    const leido = parseInviteLink(inviteToLink(inv));

    expect(leido).toEqual(inv);
  });

  it('sobrevive nombres con acentos y espacios', () => {
    const inv = createInvite('g1', 'Año Nuevo en Córdoba', generateIdentity().publicKey, AHORA);
    expect(parseInviteLink(inviteToLink(inv))!.groupName).toBe('Año Nuevo en Córdoba');
  });

  it('un link roto devuelve null en vez de tirar', () => {
    expect(parseInviteLink('cualquier cosa')).toBeNull();
    expect(parseInviteLink('spendapp://group/join')).toBeNull();
    expect(parseInviteLink('spendapp://group/join?g=g1')).toBeNull(); // sin token
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
    const incompleto = await sealClaim(inv.token, { groupId: 'g1' } as InviteClaim);

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
