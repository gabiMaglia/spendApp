import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NoticeBell } from '../NoticeBell';
import { NoticeInboxSheet } from '../NoticeInboxSheet';
import type { StoredNotice } from '@/src/store/noticeInboxStore';
import type { Notice } from '@/src/services/syncNotices';
import type { Group } from '@/src/types/models';
import { useGroupStore } from '@/src/store/groupStore';

const NOTICE_GASTOS: Notice = { kind: 'expenses', groupId: 'g1', groupName: 'Asado', count: 2 };

const item = (id: string, readAt: number | null, notice: Notice = NOTICE_GASTOS): StoredNotice => ({
  id, readAt, createdAt: 1_000, notice,
});

// Los dos kinds accionables (T-062, T-186: `settlement_pending`/`sync_down` —
// `deletion` se sacó con el modo «con acuerdo») y uno informativo, para armar
// los escenarios de las pestañas.
const pendiente: Notice = {
  kind: 'settlement_pending', groupId: 'g1', groupName: 'Asado',
  paymentId: 'p1', amount: 500, currency: 'ARS',
};
const caido: Notice = { kind: 'sync_down', groupId: 'g1', groupName: 'Asado', reason: 'too_large' };
const restaurado: Notice = { kind: 'restored', groupId: 'g1', groupName: 'Asado', description: 'Vino' };

describe('NoticeBell', () => {
  it('sin avisos sin leer no muestra badge', () => {
    const { queryByTestId } = render(<NoticeBell unread={0} onPress={() => {}} />);
    expect(queryByTestId('notice-badge')).toBeNull();
  });

  it('muestra el numero de no leidos', () => {
    const { getByText } = render(<NoticeBell unread={3} onPress={() => {}} />);
    expect(getByText('3')).toBeTruthy();
  });

  it('mas de 99 se corta: el numero se vuelve ilegible', () => {
    const { getByText } = render(<NoticeBell unread={150} onPress={() => {}} />);
    expect(getByText('99+')).toBeTruthy();
  });

  it('abre al tocarla', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<NoticeBell unread={1} onPress={onPress} />);
    fireEvent.press(getByTestId('notice-bell'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('NoticeInboxSheet', () => {
  const props = {
    visible: true, onClose: jest.fn(), onOpenNotice: jest.fn(), onMarkAll: jest.fn(),
  };

  it('sin avisos muestra el vacio explicado, no una lista en blanco', () => {
    const { getByTestId } = render(<NoticeInboxSheet {...props} items={[]} />);
    expect(getByTestId('inbox-empty')).toBeTruthy();
  });

  it('lista los avisos', () => {
    const { getByTestId } = render(
      <NoticeInboxSheet {...props} items={[item('a', null), item('b', 2_000)]} />,
    );
    expect(getByTestId('notice-a')).toBeTruthy();
    expect(getByTestId('notice-b')).toBeTruthy();
  });

  it('tocar un aviso lo entrega a quien navega', () => {
    const onOpenNotice = jest.fn();
    const { getByTestId } = render(
      <NoticeInboxSheet {...props} onOpenNotice={onOpenNotice} items={[item('a', null)]} />,
    );
    fireEvent.press(getByTestId('notice-a'));
    expect(onOpenNotice).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('«marcar todo» aparece solo si hay algo sin leer', () => {
    const todoLeido = render(<NoticeInboxSheet {...props} items={[item('a', 2_000)]} />);
    expect(todoLeido.queryByText('notifications.inbox_mark_all')).toBeNull();

    const conPendientes = render(<NoticeInboxSheet {...props} items={[item('b', null)]} />);
    expect(conPendientes.getByText('notifications.inbox_mark_all')).toBeTruthy();
  });

  it('un aviso leido NO desaparece de la lista', () => {
    // Borrarlo al leerlo haria que revisar la bandeja destruya lo que uno fue
    // a buscar.
    const { getByTestId } = render(<NoticeInboxSheet {...props} items={[item('a', 2_000)]} />);
    expect(getByTestId('notice-a')).toBeTruthy();
  });

  describe('pestañas Todo/Acción (T-062)', () => {
    it('con avisos aparecen las dos pestañas y Todo arranca con la lista de siempre, en orden', () => {
      // Los dos leídos: la pestaña Acción sale sin número, más fácil de matchear
      // por texto exacto — el número se cubre en su propio escenario.
      const items = [item('a', 1_000, NOTICE_GASTOS), item('b', 1_000, restaurado)];
      const { getByText, getAllByTestId } = render(<NoticeInboxSheet {...props} items={items} />);

      expect(getByText('notifications.tab_all')).toBeTruthy();
      expect(getByText('notifications.tab_action')).toBeTruthy();

      const filas = getAllByTestId(/^notice-/);
      expect(filas.map(f => f.props.testID)).toEqual(['notice-a', 'notice-b']);
    });

    it('la pestaña Acción cuenta los accionables SIN LEER, no los leídos', () => {
      const items = [
        item('a', null, pendiente),     // accionable, sin leer
        item('b', null, caido),         // accionable, sin leer
        item('c', 2_000, pendiente),    // accionable, YA leído: no cuenta
        item('d', null, NOTICE_GASTOS), // informativo sin leer: no cuenta
      ];
      const { getByText } = render(<NoticeInboxSheet {...props} items={items} />);
      expect(getByText('notifications.tab_action_count({"count":2})')).toBeTruthy();
    });

    it('sin accionables sin leer, la pestaña Acción no lleva número (ni cero)', () => {
      const items = [item('a', 2_000, pendiente), item('b', null, NOTICE_GASTOS)];
      const { getByText, queryByText } = render(<NoticeInboxSheet {...props} items={items} />);
      expect(getByText('notifications.tab_action')).toBeTruthy();
      expect(queryByText(/tab_action_count/)).toBeNull();
    });

    it('tocar Acción filtra a settlement_pending/sync_down y deja leídos y sin leer', () => {
      const items = [
        item('a', null, NOTICE_GASTOS), // informativo: afuera
        item('b', null, pendiente),
        item('c', 2_000, pendiente),
        item('d', null, caido),
      ];
      const { getByText, getByTestId, queryByTestId } = render(<NoticeInboxSheet {...props} items={items} />);
      // Regex: acá no importa si la pestaña lleva número, sólo que se pueda tocar.
      fireEvent.press(getByText(/^notifications\.tab_action/));

      expect(queryByTestId('notice-a')).toBeNull();
      expect(getByTestId('notice-b')).toBeTruthy();
      expect(getByTestId('notice-c')).toBeTruthy();
      expect(getByTestId('notice-d')).toBeTruthy();
    });

    it('leer uno de los accionables baja el contador de la pestaña', () => {
      const sinLeer = [item('a', null, pendiente), item('b', null, caido)];
      const { getByText, rerender } = render(<NoticeInboxSheet {...props} items={sinLeer} />);
      expect(getByText('notifications.tab_action_count({"count":2})')).toBeTruthy();

      // El sheet no marca leído por sí solo: refleja lo que el padre le pasa
      // por props, como pasa en `TabHeader` (markRead antes de reabrir).
      const unoLeido = [{ ...sinLeer[0], readAt: 5_000 }, sinLeer[1]];
      rerender(<NoticeInboxSheet {...props} items={unoLeido} />);
      expect(getByText('notifications.tab_action_count({"count":1})')).toBeTruthy();
    });

    it('«marcar todo como leído» deja la pestaña Acción sin número', () => {
      const sinLeer = [item('a', null, pendiente)];
      const { getByText, rerender, queryByText } = render(<NoticeInboxSheet {...props} items={sinLeer} />);
      expect(getByText('notifications.tab_action_count({"count":1})')).toBeTruthy();

      const todoLeido = sinLeer.map(i => ({ ...i, readAt: 6_000 }));
      rerender(<NoticeInboxSheet {...props} items={todoLeido} />);
      expect(getByText('notifications.tab_action')).toBeTruthy();
      expect(queryByText(/tab_action_count/)).toBeNull();
    });

    it('la pestaña Acción vacía tiene su propio vacío, no el general', () => {
      const items = [item('a', null, NOTICE_GASTOS)]; // hay avisos, ninguno accionable
      const { getByText, getByTestId, queryByTestId } = render(<NoticeInboxSheet {...props} items={items} />);
      fireEvent.press(getByText('notifications.tab_action'));

      expect(getByTestId('inbox-empty-action')).toBeTruthy();
      expect(queryByTestId('inbox-empty')).toBeNull();
    });

    it('bandeja completamente vacía: sin pestañas, el vacío general de siempre', () => {
      const { getByTestId, queryByText } = render(<NoticeInboxSheet {...props} items={[]} />);
      expect(getByTestId('inbox-empty')).toBeTruthy();
      expect(queryByText('notifications.tab_all')).toBeNull();
      expect(queryByText('notifications.tab_action')).toBeNull();
    });

    it('la pestaña elegida no sobrevive al cierre: reabrir vuelve a Todo', () => {
      const items = [item('a', null, NOTICE_GASTOS), item('b', null, pendiente)];
      const { getByText, getByTestId, queryByTestId, rerender } = render(
        <NoticeInboxSheet {...props} visible items={items} />,
      );

      fireEvent.press(getByText(/^notifications\.tab_action/));
      expect(queryByTestId('notice-a')).toBeNull(); // filtrado: sólo queda 'b'

      rerender(<NoticeInboxSheet {...props} visible={false} items={items} />);
      rerender(<NoticeInboxSheet {...props} visible items={items} />);

      expect(getByTestId('notice-a')).toBeTruthy(); // de vuelta en Todo
    });
  });

  // Minor de la revisión final, upgraded a fix-now: el nombre del grupo nuevo
  // se resuelve AHORA, contra el store en vivo — no el `newGroupName` congelado
  // del aviso, que puede llegar en blanco si el grupo nuevo todavía no
  // sincronizó localmente cuando se generó el aviso.
  describe('group_replaced: el nombre del grupo nuevo se resuelve en vivo', () => {
    const grupo = (over: Partial<Group> = {}): Group => ({
      id: 'g-nuevo', name: 'Viaje (2)', memberIds: ['ana', 'beto'], currency: 'ARS',
      miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
      createdAt: 0, updatedAt: 0, isDeleted: false, createdById: 'ana',
      ...over,
    });

    const traspaso: Notice = {
      kind: 'group_replaced', groupId: 'g-viejo', groupName: 'Viaje',
      newGroupId: 'g-nuevo', newGroupName: '',
    };

    beforeEach(() => { useGroupStore.setState({ groups: [] }); });

    it('con el newGroupName congelado en blanco, usa el nombre ACTUAL del grupo en el store', () => {
      useGroupStore.setState({ groups: [grupo()] });
      const { getByText } = render(
        <NoticeInboxSheet {...props} items={[item('a', null, traspaso)]} />,
      );
      expect(getByText('notifications.group_replaced_body({"newGroup":"Viaje (2)"})')).toBeTruthy();
    });

    it('si el grupo nuevo todavía no llegó por sync, cae al newGroupName congelado', () => {
      const conNombre: Notice = { ...traspaso, newGroupName: 'Viaje (2)' };
      const { getByText } = render(
        <NoticeInboxSheet {...props} items={[item('a', null, conNombre)]} />,
      );
      expect(getByText('notifications.group_replaced_body({"newGroup":"Viaje (2)"})')).toBeTruthy();
    });

    it('sin grupo en el store Y sin newGroupName congelado, cae a un genérico — nunca en blanco', () => {
      const { getByText } = render(
        <NoticeInboxSheet {...props} items={[item('a', null, traspaso)]} />,
      );
      expect(getByText('notifications.group_replaced_body({"newGroup":"groups.unnamed_group"})')).toBeTruthy();
    });
  });
});
