import {
  buildBackup, serializeBackup, applyBackup, importBackup,
  BACKUP_FORMAT, BACKUP_VERSION, type BackupFile,
} from '../backup';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useSettingsStore } from '@/src/store/settingsStore';
import { useLangStore } from '@/src/store/langStore';
import { recargarAlias, misIdentidades, restaurarAlias } from '@/src/store/identityAlias';
import { ensureContactSecret, drainContacts } from '@/src/sync/contactChannel';
import { savePeer, marcarCardEnviada, listPeers, tarjetasEnviadas } from '@/src/sync/contactPeers';
import { formatMoney } from '@/src/constants/currencies';
import type { User, PersonalBudget } from '@/src/types/models';

jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(),
  anunciarMiTarjeta: jest.fn(),
}));

function user(id: string, updatedAt: number, over: Partial<User> = {}): User {
  return {
    id, updatedAt, isDeleted: false, name: `U-${id}`, email: `${id}@x.com`,
    authProvider: 'google', createdAt: 0, ...over,
  };
}
const emptyBudget: PersonalBudget = { currency: 'ARS', monthlyAmount: 0, includeOwedToMe: false };

function resetStores() {
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  useUserStore.setState({ users: [] });
  usePersonalStore.setState({ entries: [], budget: { ...emptyBudget } });
  useAuthStore.setState({ currentUser: null });
  useGroupKeyStore.setState({ keys: [] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
  useSettingsStore.getState().setDisplayCurrency('ARS');
  useSettingsStore.getState().setSkin('default');
  useSettingsStore.getState().setNotifExpenses(true);
  useSettingsStore.getState().setNotifDeletions(true);
  useSettingsStore.getState().setNotifInvites(true);
  useSettingsStore.getState().setNotifSettlements(true);
  useLangStore.getState().setLanguage('auto');
  recargarAlias();
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
});

function blank(): BackupFile {
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: 0,
    groups: [], expenses: [], payments: [], users: [], personalEntries: [],
    personalBudget: emptyBudget,
  };
}

describe('buildBackup v3 — nuevos campos', () => {
  it('el export lleva archived/settings/contacts/aliases', () => {
    useAuthStore.setState({ currentUser: user('u1', 10) });
    useArchiveStore.setState({ archivedIds: ['g1'], reasons: { g1: 'manual' } });
    useSettingsStore.getState().setDisplayCurrency('EUR');
    useSettingsStore.getState().setSkin('aero');
    useSettingsStore.getState().setNotifExpenses(false);
    useLangStore.getState().setLanguage('en');
    savePeer('u2', { secret: 'sec-u2', wrapPublicKey: 'a'.repeat(64), identityPublicKey: 'b'.repeat(64) });
    const secret = ensureContactSecret();

    const b = buildBackup();

    expect(b.version).toBe(3);
    expect(b.archived?.ids).toEqual(['g1']);
    expect(b.archived?.reasons).toEqual({ g1: 'manual' });
    expect(b.settings?.displayCurrency).toBe('EUR');
    expect(b.settings?.skin).toBe('aero');
    expect(b.settings?.notifExpenses).toBe(false);
    expect(b.settings?.language).toBe('en');
    expect(b.contacts?.secret).toBe(secret);
    expect(b.contacts?.peers.u2?.secret).toBe('sec-u2');
    expect(Array.isArray(b.aliases)).toBe(true);
  });
});

describe('applyBackup v3 — restore por campo', () => {
  it('backup PROPIO restaura archived y settings (además de contactos/alias)', () => {
    useAuthStore.setState({ currentUser: user('yo', 10) });
    applyBackup({
      ...blank(),
      ownerId: 'yo',
      archived: { ids: ['gX'], reasons: { gX: 'limit' } },
      settings: {
        displayCurrency: 'BRL', language: 'pt', skin: 'aero',
        notifExpenses: false, notifDeletions: false, notifInvites: false, notifSettlements: false,
      },
    });

    expect(useArchiveStore.getState().archivedIds).toEqual(['gX']);
    expect(useArchiveStore.getState().reasons).toEqual({ gX: 'limit' });
    expect(useSettingsStore.getState().displayCurrency).toBe('BRL');
    expect(useSettingsStore.getState().skin).toBe('aero');
    expect(useSettingsStore.getState().notifExpenses).toBe(false);
    expect(useLangStore.getState().choice).toBe('pt');
  });

  it('backup AJENO NO toca archivados ni ajustes locales — son preferencias del dueño, no datos del grupo (decisión orquestador, QA T-213 defecto 3)', () => {
    useAuthStore.setState({ currentUser: user('yo', 10) });
    useArchiveStore.setState({ archivedIds: ['propio'], reasons: { propio: 'manual' } });
    useSettingsStore.getState().setDisplayCurrency('PEN');
    useSettingsStore.getState().setSkin('default');

    applyBackup({
      ...blank(),
      ownerId: 'otra-persona',
      archived: { ids: ['gX'], reasons: { gX: 'limit' } },
      settings: {
        displayCurrency: 'BRL', language: 'pt', skin: 'aero',
        notifExpenses: false, notifDeletions: false, notifInvites: false, notifSettlements: false,
      },
    });

    // Los ajustes/archivados locales sobreviven intactos: el backup ajeno
    // trajo SUS datos de grupo, no impuso sus preferencias de cuenta.
    expect(useArchiveStore.getState().archivedIds).toEqual(['propio']);
    expect(useSettingsStore.getState().displayCurrency).toBe('PEN');
    expect(useSettingsStore.getState().skin).toBe('default');
  });

  it('un skin inválido en el backup cae al default (esSkinId)', () => {
    useAuthStore.setState({ currentUser: user('yo', 10) });
    applyBackup({
      ...blank(),
      ownerId: 'yo',
      settings: {
        displayCurrency: 'ARS', language: 'auto', skin: 'inexistente' as never,
        notifExpenses: true, notifDeletions: true, notifInvites: true, notifSettlements: true,
      },
    });
    expect(useSettingsStore.getState().skin).toBe('default');
  });

  it('BLOQUEANTE QA T-213 · una displayCurrency inválida cae al default y no crashea formatMoney', () => {
    useAuthStore.setState({ currentUser: user('yo', 10) });
    useSettingsStore.getState().setDisplayCurrency('EUR');

    applyBackup({
      ...blank(),
      ownerId: 'yo',
      settings: {
        displayCurrency: 'XXX' as never, language: 'auto', skin: 'default',
        notifExpenses: true, notifDeletions: true, notifInvites: true, notifSettlements: true,
      },
    });

    // No queda un código inexistente en memoria (mismo criterio que `skin`).
    expect(useSettingsStore.getState().displayCurrency).not.toBe('XXX');
    expect(() => formatMoney(1000, useSettingsStore.getState().displayCurrency)).not.toThrow();
  });

  it('backup PROPIO adopta contactos y alias', () => {
    useAuthStore.setState({ currentUser: user('yo', 10) });
    applyBackup({
      ...blank(),
      ownerId: 'yo',
      contacts: {
        secret: 'sec-propio',
        peers: { p1: { secret: 's1', wrapPublicKey: 'a'.repeat(64), identityPublicKey: 'b'.repeat(64) } },
        cardSent: { p1: 'huella-1' },
      },
      aliases: ['id-vieja'],
    });

    expect(listPeers().p1?.secret).toBe('s1');
    expect(misIdentidades()).toEqual(expect.arrayContaining(['yo', 'id-vieja']));
  });

  it('backup AJENO restaura datos pero NO adopta contactos ni alias', () => {
    useAuthStore.setState({ currentUser: user('yo', 10) });
    savePeer('previo', { secret: 'existente' });

    applyBackup({
      ...blank(),
      ownerId: 'otra-persona',
      contacts: {
        secret: 'sec-ajeno',
        peers: { pAjeno: { secret: 'sAjeno' } },
        cardSent: {},
      },
      aliases: ['alias-ajeno'],
    });

    // No se pisó el peer propio con el del backup ajeno.
    expect(listPeers().pAjeno).toBeUndefined();
    expect(listPeers().previo?.secret).toBe('existente');
    expect(misIdentidades()).not.toContain('alias-ajeno');
  });

  it('un backup v1/v2 sin los campos nuevos no rompe', () => {
    useAuthStore.setState({ currentUser: user('yo', 10) });
    expect(() => applyBackup({ ...blank(), version: 1 })).not.toThrow();
    expect(() => applyBackup({ ...blank(), version: 2, ownerId: 'yo' })).not.toThrow();
  });
});

describe('round-trip v3 completo', () => {
  it('exportar y reimportar en stores vacíos reproduce archivados (incl. `limit` pegajoso), los 4 toggles, contactos + cardSent y alias (backup propio)', () => {
    useAuthStore.setState({ currentUser: user('yo', 10) });
    useArchiveStore.setState({
      archivedIds: ['gManual', 'gLimit'],
      reasons: { gManual: 'manual', gLimit: 'limit' },
    });
    useSettingsStore.getState().setDisplayCurrency('CLP');
    useSettingsStore.getState().setSkin('aero');
    useSettingsStore.getState().setNotifExpenses(false);
    useSettingsStore.getState().setNotifDeletions(false);
    useSettingsStore.getState().setNotifInvites(false);
    useSettingsStore.getState().setNotifSettlements(false);
    useLangStore.getState().setLanguage('pt');
    savePeer('contactoX', { secret: 'sX', wrapPublicKey: 'c'.repeat(64), identityPublicKey: 'd'.repeat(64) });
    marcarCardEnviada('contactoX', 'huella-real');
    restaurarAlias(['alias-vieja']);

    const raw = serializeBackup(buildBackup());
    resetStores();
    useAuthStore.setState({ currentUser: user('yo', 10) });
    importBackup(raw);

    expect(useArchiveStore.getState().archivedIds.sort()).toEqual(['gLimit', 'gManual']);
    expect(useArchiveStore.getState().reasons).toEqual({ gManual: 'manual', gLimit: 'limit' });
    // La pegajosidad de 'limit' sobrevive al restore: sigue irrevocable.
    expect(useArchiveStore.getState().canUnarchive('gLimit')).toBe(false);
    expect(useSettingsStore.getState().displayCurrency).toBe('CLP');
    expect(useSettingsStore.getState().skin).toBe('aero');
    expect(useSettingsStore.getState().notifExpenses).toBe(false);
    expect(useSettingsStore.getState().notifDeletions).toBe(false);
    expect(useSettingsStore.getState().notifInvites).toBe(false);
    expect(useSettingsStore.getState().notifSettlements).toBe(false);
    expect(useLangStore.getState().choice).toBe('pt');
    expect(listPeers().contactoX?.secret).toBe('sX');
    expect(tarjetasEnviadas().contactoX).toBe('huella-real');
    expect(misIdentidades()).toEqual(expect.arrayContaining(['yo', 'alias-vieja']));
  });
});

// Referencia únicamente para que TS no marque `drainContacts` como import
// muerto si algún test futuro lo necesita; no se ejercita acá.
void drainContacts;
