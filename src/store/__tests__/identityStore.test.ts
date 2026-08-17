import { ensureIdentity, ensureWrapKeypair, saveInvite, listInvites, findInviteToken } from '../identityStore';
import { createInvite } from '@/src/sync/groupInvite';
import { createSecureStorage } from '@/src/utils/secureStorage';

const AHORA = Date.now();

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
  beforeEach(() => createSecureStorage('groupkeys').clearAll());

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
});
