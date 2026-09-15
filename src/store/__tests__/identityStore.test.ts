import {
  ensureIdentity, ensureWrapKeypair, saveInvite, listInvites, findInviteToken, markInviteClaimed,
  saveContactInvite, findContactInviteToken, markContactInviteClaimed,
  listContactInvites, savePendingContactClaim, listPendingContactClaims,
  removePendingContactClaim,
} from '../identityStore';
import { createInvite } from '@/src/sync/groupInvite';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { useAuthStore } from '@/src/store/authStore';
import type { User } from '@/src/types/models';
import type { ContactInvite } from '@/src/sync/contactInvite';

const AHORA = Date.now();
// T-098 · SEC L-4: invitaciones y joins pendientes pasaron a ser de la CUENTA
// (`readScoped`/`writeScoped`), así que este describe necesita una sesión activa
// para que `saveInvite`/`listInvites` tengan dónde escribir y leer.
const YO = { id: 'yo', name: 'Yo', email: '', authProvider: 'google', createdAt: 0, updatedAt: 0, isDeleted: false } as User;

describe('identidad del dispositivo', () => {
  beforeEach(() => createSecureStorage('groupkeys').clearAll());

  // Si cambiara, los sobres dirigidos a la identidad anterior quedarían sin
  // poder abrirse.
  it('es estable entre llamadas', () => {
    expect(ensureIdentity().publicKey).toBe(ensureIdentity().publicKey);
  });

  it('firma y envoltura usan pares distintos', () => {
    expect(ensureIdentity().publicKey).not.toBe(ensureWrapKeypair().publicKey);
  });

  it('sobrevive al reinicio (está persistida)', () => {
    const antes = ensureIdentity().publicKey;
    expect(createSecureStorage('groupkeys').getString('identity_v1')).toContain(antes);
  });

  it('un storage corrupto regenera en vez de romper', () => {
    createSecureStorage('groupkeys').set('identity_v1', '{roto');
    expect(() => ensureIdentity()).not.toThrow();
    expect(ensureIdentity().publicKey).toBeTruthy();
  });
});

describe('invitaciones emitidas', () => {
  beforeEach(() => {
    createSecureStorage('groupkeys').clearAll();
    useAuthStore.setState({ currentUser: YO });
  });
  afterEach(() => useAuthStore.setState({ currentUser: null }));

  // El token es lo ÚNICO que permite abrir el reclamo del invitado: si se
  // pierde, llega un sobre que nadie puede leer.
  it('se guarda el token para poder abrir el reclamo después', () => {
    const inv = createInvite('g1', 'Viaje', 'aa'.repeat(32), AHORA);
    saveInvite(inv);

    expect(findInviteToken('g1', inv.token)).toMatchObject({ groupId: 'g1' });
  });

  it('un token que no emitimos no aparece', () => {
    saveInvite(createInvite('g1', 'Viaje', 'aa'.repeat(32), AHORA));
    expect(findInviteToken('g1', 'token-ajeno')).toBeUndefined();
  });

  it('convive con varias invitaciones abiertas', () => {
    const a = createInvite('g1', 'Viaje', 'aa'.repeat(32), AHORA);
    const b = createInvite('g2', 'Asado', 'aa'.repeat(32), AHORA);
    saveInvite(a); saveInvite(b);

    expect(listInvites()).toHaveLength(2);
    expect(findInviteToken('g2', b.token)).toBeDefined();
  });

  // Sin purga la lista crece para siempre.
  it('las vencidas se descartan', () => {
    const vieja = createInvite('g1', 'Viaje', 'aa'.repeat(32), AHORA - 72 * 3600_000);
    saveInvite(vieja);
    saveInvite(createInvite('g2', 'Asado', 'aa'.repeat(32), AHORA));

    expect(listInvites().map(i => i.groupId)).toEqual(['g2']);
  });

  it('reemitir la misma invitación no duplica', () => {
    const inv = createInvite('g1', 'Viaje', 'aa'.repeat(32), AHORA);
    saveInvite(inv); saveInvite(inv);
    expect(listInvites()).toHaveLength(1);
  });

  describe('markInviteClaimed', () => {
    it('persiste quién canjeó la invitación', () => {
      const inv = createInvite('g1', 'Viaje', 'aa'.repeat(32), AHORA);
      saveInvite(inv);
      markInviteClaimed('g1', inv.token, 'u-beto');
      expect(findInviteToken('g1', inv.token)?.claimedBy).toBe('u-beto');
    });

    it('no rompe si el token no existe', () => {
      expect(() => markInviteClaimed('g1', 'no-existe', 'u-beto')).not.toThrow();
    });

    it('preserva el resto de los campos al marcar', () => {
      const inv = createInvite('g1', 'Casa', 'aa'.repeat(32), AHORA);
      saveInvite(inv);
      markInviteClaimed('g1', inv.token, 'u-beto');
      const guardada = findInviteToken('g1', inv.token)!;
      expect(guardada.groupName).toBe('Casa');
      expect(guardada.token).toBe(inv.token);
    });

    it('listInvites sigue devolviendo la invitación marcada mientras no venza', () => {
      const inv = createInvite('g1', 'Viaje', 'aa'.repeat(32), AHORA);
      saveInvite(inv);
      markInviteClaimed('g1', inv.token, 'u-beto');
      expect(listInvites().find(i => i.token === inv.token)?.claimedBy).toBe('u-beto');
    });
  });
});

function contactInvite(overrides: Partial<ContactInvite> = {}): ContactInvite {
  return {
    fromName: 'Ana', token: 'tok-c1', inviterFingerprint: 'ff', inviterWrapPublicKey: 'ee',
    expiresAt: Date.now() + 1000, ...overrides,
  };
}

describe('contact invites', () => {
  beforeEach(() => {
    createSecureStorage('groupkeys').clearAll();
    useAuthStore.setState({ currentUser: YO });
  });
  afterEach(() => useAuthStore.setState({ currentUser: null }));

  it('markContactInviteClaimed persiste quién canjeó', () => {
    saveContactInvite(contactInvite());
    markContactInviteClaimed('tok-c1', 'u-beto');
    expect(findContactInviteToken('tok-c1')?.claimedBy).toBe('u-beto');
  });

  it('no rompe si el token no existe', () => {
    expect(() => markContactInviteClaimed('no-existe', 'u-beto')).not.toThrow();
  });

  it('listContactInvites filtra las vencidas', () => {
    saveContactInvite(contactInvite({ token: 'viva', expiresAt: Date.now() + 10_000 }));
    saveContactInvite(contactInvite({ token: 'vencida', expiresAt: Date.now() - 1 }));
    const tokens = listContactInvites().map(i => i.token);
    expect(tokens).toContain('viva');
    expect(tokens).not.toContain('vencida');
  });

  it('savePendingContactClaim / listPendingContactClaims / removePendingContactClaim', () => {
    savePendingContactClaim(contactInvite({ token: 'pend-1' }));
    expect(listPendingContactClaims().map(i => i.token)).toContain('pend-1');
    removePendingContactClaim('pend-1');
    expect(listPendingContactClaims().map(i => i.token)).not.toContain('pend-1');
  });
});
