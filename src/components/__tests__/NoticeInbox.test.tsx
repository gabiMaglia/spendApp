import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NoticeBell } from '../NoticeBell';
import { NoticeInboxSheet } from '../NoticeInboxSheet';
import type { StoredNotice } from '@/src/store/noticeInboxStore';

const item = (id: string, readAt: number | null): StoredNotice => ({
  id, readAt, createdAt: 1_000,
  notice: { kind: 'expenses', groupId: 'g1', groupName: 'Asado', count: 2 },
});

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
  const props = { visible: true, onClose: jest.fn(), onOpenNotice: jest.fn(), onMarkAll: jest.fn() };

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
});
