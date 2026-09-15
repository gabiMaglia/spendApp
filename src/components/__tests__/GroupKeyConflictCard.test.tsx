import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { GroupKeyConflictCard } from '../GroupKeyConflictCard';
import { elegirClaveDeGrupo } from '@/src/services/elegirClaveDeGrupo';
import { purgarGrupoLocalmente } from '@/src/services/salirDelGrupo';
import { conflictoForzado, idDeOfertaDeInvitacion } from '@/src/sync/groupKeyOffers';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import type { KeyConflictNotice } from '@/src/services/syncNotices';
import type { User } from '@/src/types/models';
import es from '@/src/i18n/locales/es.json';
import en from '@/src/i18n/locales/en.json';
import pt from '@/src/i18n/locales/pt.json';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', olvidarCursor: jest.fn(),
  publishNow: jest.fn(async () => {}), drainNow: jest.fn(async () => 0), startRelay: jest.fn(async () => {}),
}));
jest.mock('@/src/services/elegirClaveDeGrupo', () => ({ elegirClaveDeGrupo: jest.fn(async () => true) }));
jest.mock('@/src/services/salirDelGrupo', () => ({ purgarGrupoLocalmente: jest.fn() }));
jest.mock('@/src/sync/groupKeyOffers', () => {
  const real = jest.requireActual('@/src/sync/groupKeyOffers');
  return { ...real, conflictoForzado: jest.fn(() => false) };
});

const elegir = elegirClaveDeGrupo as jest.MockedFunction<typeof elegirClaveDeGrupo>;
const forzado = conflictoForzado as jest.MockedFunction<typeof conflictoForzado>;
const purgar = purgarGrupoLocalmente as jest.MockedFunction<typeof purgarGrupoLocalmente>;

const NOTICE: KeyConflictNotice = {
  kind: 'group_key_conflict', groupId: 'g1', groupName: 'Viaje',
  senderIds: ['u-beto', 'u-mallory'],
};

const props = {
  notice: NOTICE,
  senderIds: ['u-beto', 'u-mallory'],
  onResuelto: jest.fn(),
  onDespues: jest.fn(),
};

let alerta: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  elegir.mockResolvedValue(true);
  forzado.mockReturnValue(false);
  useAuthStore.setState({ currentUser: { id: 'u-ana', name: 'Ana' } as User });
  useUserStore.setState({ users: [
    { id: 'u-beto', name: 'Beto' } as User,
    { id: 'u-mallory', name: 'Mallory' } as User,
  ] });
  alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => alerta.mockRestore());

/** Los botones de la última confirmación mostrada. */
function botones(): AlertButton[] {
  return (alerta.mock.calls.at(-1)?.[2] ?? []) as AlertButton[];
}

describe('qué muestra', () => {
  it('un botón por remitente, con el nombre guardado del contacto', () => {
    const r = render(<GroupKeyConflictCard {...props} />);
    expect(r.getByTestId('key-conflict-sender-u-beto')).toBeTruthy();
    expect(r.getByTestId('key-conflict-sender-u-mallory')).toBeTruthy();
    expect(r.getAllByText(/Beto/).length).toBeGreaterThan(0);
    expect(r.getAllByText(/Mallory/).length).toBeGreaterThan(0);
  });

  it('tres remitentes, tres botones', () => {
    const r = render(<GroupKeyConflictCard {...props} senderIds={['u-beto', 'u-mallory', 'u-carla']} />);
    expect(r.getAllByTestId(/^key-conflict-sender-/)).toHaveLength(3);
  });

  it('un remitente sin nombre guardado no muestra su id', () => {
    const r = render(<GroupKeyConflictCard {...props} senderIds={['u-beto', 'u-desconocido']} />);
    expect(r.getAllByText(/sync\.key_conflict\.unknown_name/).length).toBeGreaterThan(0);
    expect(r.queryByText(/u-desconocido/)).toBeNull();
  });

  it('la oferta de una invitación se nombra como invitación', () => {
    const r = render(
      <GroupKeyConflictCard {...props} senderIds={['u-beto', idDeOfertaDeInvitacion('fp123')]} />,
    );
    expect(r.getAllByText(/sync\.key_conflict\.invite_sender/).length).toBeGreaterThan(0);
    expect(r.queryByText(/fp123/)).toBeNull();
  });
});

describe('elegir', () => {
  it('tocar un remitente pide confirmación y todavía no elige', () => {
    const r = render(<GroupKeyConflictCard {...props} />);
    fireEvent.press(r.getByTestId('key-conflict-sender-u-beto'));

    expect(alerta).toHaveBeenCalledTimes(1);
    expect(String(alerta.mock.calls[0]![0])).toContain('sync.key_conflict.confirm_title');
    expect(String(alerta.mock.calls[0]![0])).toContain('Beto');
    expect(elegir).not.toHaveBeenCalled();
  });

  it('confirmar llama a elegirClaveDeGrupo(groupId, userId) y avisa resuelto', async () => {
    const r = render(<GroupKeyConflictCard {...props} />);
    fireEvent.press(r.getByTestId('key-conflict-sender-u-beto'));
    botones().find(b => b.style === 'destructive')!.onPress!();

    await waitFor(() => expect(props.onResuelto).toHaveBeenCalledTimes(1));
    expect(elegir).toHaveBeenCalledWith('g1', 'u-beto');
  });

  it('cancelar no llama a elegir', () => {
    const r = render(<GroupKeyConflictCard {...props} />);
    fireEvent.press(r.getByTestId('key-conflict-sender-u-beto'));
    botones().find(b => b.style === 'cancel')!.onPress?.();

    expect(elegir).not.toHaveBeenCalled();
    expect(props.onResuelto).not.toHaveBeenCalled();
  });

  it('si elegir devuelve false, no se da por resuelto y se avisa', async () => {
    elegir.mockResolvedValue(false);
    const r = render(<GroupKeyConflictCard {...props} />);
    fireEvent.press(r.getByTestId('key-conflict-sender-u-beto'));
    botones().find(b => b.style === 'destructive')!.onPress!();

    await waitFor(() => expect(alerta).toHaveBeenCalledTimes(2));
    expect(String(alerta.mock.calls[1]![0])).toContain('sync.key_conflict.failed');
    expect(props.onResuelto).not.toHaveBeenCalled();
  });

  it('«Decidir después» cierra sin elegir ni resolver', () => {
    const r = render(<GroupKeyConflictCard {...props} />);
    fireEvent.press(r.getByTestId('key-conflict-later'));

    expect(props.onDespues).toHaveBeenCalledTimes(1);
    expect(elegir).not.toHaveBeenCalled();
    expect(props.onResuelto).not.toHaveBeenCalled();
  });
});

/**
 * Conflicto FORZADO (T-136 fix round 1): una clave distinta no entró a la
 * tabla porque un tope estaba lleno. La real puede no estar entre las ofertas
 * visibles, así que acá NO se puede elegir a ciegas. Esperar tampoco lo
 * destraba (revisión final, O-1): la salida es borrar el grupo de este
 * teléfono y pedir una invitación nueva.
 */
describe('conflicto forzado (tope lleno, T-136 fix round 1)', () => {
  it('forzado: muestra la advertencia y no los botones de elegir', () => {
    forzado.mockReturnValue(true);
    const r = render(<GroupKeyConflictCard {...props} />);

    expect(r.getByText('sync.key_conflict.dissent_dropped')).toBeTruthy();
    expect(r.queryByTestId('key-conflict-sender-u-beto')).toBeNull();
    expect(r.queryByTestId('key-conflict-sender-u-mallory')).toBeNull();
    expect(r.getByTestId('key-conflict-later')).toBeTruthy();
  });

  it('no forzado: muestra los botones y no la advertencia', () => {
    forzado.mockReturnValue(false);
    const r = render(<GroupKeyConflictCard {...props} />);

    expect(r.queryByText('sync.key_conflict.dissent_dropped')).toBeNull();
    expect(r.getByTestId('key-conflict-sender-u-beto')).toBeTruthy();
  });

  it('forzado: ofrece borrar el grupo de este teléfono', () => {
    forzado.mockReturnValue(true);
    const r = render(<GroupKeyConflictCard {...props} />);

    expect(r.getByTestId('key-conflict-forget-group')).toBeTruthy();
  });

  it('no forzado: no ofrece borrar el grupo', () => {
    forzado.mockReturnValue(false);
    const r = render(<GroupKeyConflictCard {...props} />);

    expect(r.queryByTestId('key-conflict-forget-group')).toBeNull();
  });

  it('borrar pide confirmación y todavía no purga', () => {
    forzado.mockReturnValue(true);
    const r = render(<GroupKeyConflictCard {...props} />);
    fireEvent.press(r.getByTestId('key-conflict-forget-group'));

    expect(alerta).toHaveBeenCalledTimes(1);
    expect(String(alerta.mock.calls[0]![0])).toContain('sync.key_conflict.forget_confirm_title');
    expect(purgar).not.toHaveBeenCalled();
    expect(props.onResuelto).not.toHaveBeenCalled();
  });

  it('confirmar el borrado purga el grupo localmente y da el aviso por resuelto', () => {
    forzado.mockReturnValue(true);
    const r = render(<GroupKeyConflictCard {...props} />);
    fireEvent.press(r.getByTestId('key-conflict-forget-group'));
    botones().find(b => b.style === 'destructive')!.onPress!();

    expect(purgar).toHaveBeenCalledWith('g1');
    expect(props.onResuelto).toHaveBeenCalledTimes(1);
    expect(elegir).not.toHaveBeenCalled();
  });

  it('cancelar el borrado no purga ni resuelve', () => {
    forzado.mockReturnValue(true);
    const r = render(<GroupKeyConflictCard {...props} />);
    fireEvent.press(r.getByTestId('key-conflict-forget-group'));
    botones().find(b => b.style === 'cancel')!.onPress?.();

    expect(purgar).not.toHaveBeenCalled();
    expect(props.onResuelto).not.toHaveBeenCalled();
  });
});

describe('textos (spec §3.2, aprobados por el PO)', () => {
  type Dict = { sync: { key_conflict?: Record<string, string> } };
  const dicts = { es, en, pt } as unknown as Record<string, Dict>;
  const CLAVES = [
    'title_two', 'title_many', 'body', 'unverified_name', 'use_key_of', 'decide_later',
    'confirm_title', 'confirm_body', 'cancel', 'confirm_use', 'unknown_name', 'invite_sender', 'failed',
    'dissent_dropped', 'forget_group', 'forget_confirm_title', 'forget_confirm_body', 'forget_confirm',
  ];

  it.each(CLAVES)('sync.key_conflict.%s existe en es, en y pt', clave => {
    for (const [lang, d] of Object.entries(dicts)) {
      expect(`${lang}: ${d.sync.key_conflict?.[clave] ?? ''}`).not.toBe(`${lang}: `);
    }
  });

  it('el español es el del spec, verbatim', () => {
    const k = (es as unknown as Dict).sync.key_conflict!;
    expect(k.title_two).toBe('Dos personas te mandaron claves distintas para "{{group}}"');
    expect(k.title_many).toBe('Recibiste claves distintas para "{{group}}"');
    expect(k.body).toBe('Sólo una es la real. Elegí la de alguien que sepas que está en el grupo. El nombre es el que tenés guardado del contacto; la app no puede verificar quién es.');
    expect(k.unverified_name).toBe('{{group}} (nombre sin verificar)');
    expect(k.use_key_of).toBe('Usar la clave de {{name}}');
    expect(k.decide_later).toBe('Decidir después');
    expect(k.confirm_title).toBe('¿Usar la clave de {{name}}?');
    expect(k.confirm_body).toBe('Se borra lo que tenés de "{{group}}" en este teléfono y se vuelve a bajar con esa clave. Lo que hayas cargado desde que llegó la otra clave se pierde.');
    expect(k.cancel).toBe('Cancelar');
    expect(k.confirm_use).toBe('Usar esta clave');
    expect(k.dissent_dropped).toBe('Llegó otra clave para este grupo que no se pudo guardar, así que no es seguro elegir. Borrá el grupo de este teléfono y pedile a alguien del grupo que te invite de nuevo.');
    expect(k.forget_group).toBe('Borrar el grupo de este teléfono');
    expect(k.forget_confirm_title).toBe('¿Borrar "{{group}}" de este teléfono?');
    expect(k.forget_confirm_body).toBe('Se borran de este teléfono el grupo, sus gastos y las claves que llegaron. No se publica nada.');
    expect(k.forget_confirm).toBe('Borrar');
  });

  it('en y pt están traducidos, no copiados del español', () => {
    for (const clave of ['title_two', 'body', 'confirm_body', 'dissent_dropped', 'forget_group', 'forget_confirm_body', 'forget_confirm']) {
      const textos = Object.values(dicts).map(d => d.sync.key_conflict?.[clave]);
      expect(new Set(textos).size).toBe(3);
    }
  });
});
