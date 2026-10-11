import React from 'react';
import { Alert, Linking } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CommentThread } from '../CommentThread';
import { useBloqueoStore } from '@/src/store/bloqueoStore';
import { MAIL_SOPORTE } from '@/src/constants/legal';
import type { ExpenseComment } from '@/src/types/models';

/**
 * T-235 (Apple 1.2, rechazo 2.1): en un comentario AJENO se puede denunciar
 * (mail a soporte con autor, texto y gasto) y bloquear al autor (oculta sus
 * comentarios en este dispositivo). Lo propio no tiene ese menú.
 */

const NAMES: Record<string, string> = { ua: 'Ana', ub: 'Bob' };

function comment(over: Partial<ExpenseComment> = {}): ExpenseComment {
  return {
    id: 'c1', expenseId: 'e1', authorId: 'ub', text: 'texto de Bob',
    createdAt: Date.UTC(2026, 9, 11), updatedAt: 0, isDeleted: false,
    ...over,
  };
}

function setup(comments: ExpenseComment[]) {
  return render(
    <CommentThread
      comments={comments}
      currentUserId="ua"
      authorName={id => NAMES[id] ?? id}
      onAdd={jest.fn()}
      onDelete={jest.fn()}
    />,
  );
}

/** Toca el botón de un `Alert.alert` por su texto. */
function tocarEnAlert(spy: jest.SpyInstance, texto: string) {
  const botones = spy.mock.calls[spy.mock.calls.length - 1][2] as { text: string; onPress?: () => void }[];
  // El mock de i18n agrega la interpolación a la clave: `comments.block({"name":"Bob"})`.
  const b = botones.find(x => x.text === texto || x.text.startsWith(`${texto}(`));
  if (!b) throw new Error(`No hay botón «${texto}» en el último Alert: ${botones.map(x => x.text).join(', ')}`);
  act(() => { b.onPress?.(); });
}

describe('CommentThread — denunciar y bloquear (T-235)', () => {
  let alertSpy: jest.SpyInstance;
  beforeEach(() => {
    useBloqueoStore.setState({ bloqueados: [] });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('un comentario propio no tiene menú de moderación', () => {
    const r = setup([comment({ authorId: 'ua', text: 'mío' })]);
    expect(r.queryByLabelText('comments.more_options')).toBeNull();
  });

  it('denunciar abre un mail a soporte con autor, texto y gasto', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const r = setup([comment()]);
    fireEvent.press(r.getByLabelText('comments.more_options'));
    tocarEnAlert(alertSpy, 'comments.report');
    expect(open).toHaveBeenCalledTimes(1);
    const url = open.mock.calls[0][0] as string;
    expect(url.startsWith(`mailto:${MAIL_SOPORTE}`)).toBe(true);
    const cuerpo = decodeURIComponent(url);
    expect(cuerpo).toContain('Bob');
    expect(cuerpo).toContain('texto de Bob');
    expect(cuerpo).toContain('e1');
  });

  it('sin app de mail, muestra la dirección de soporte', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail'));
    const r = setup([comment()]);
    fireEvent.press(r.getByLabelText('comments.more_options'));
    tocarEnAlert(alertSpy, 'comments.report');
    await act(async () => { await Promise.resolve(); });
    const ultimo = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
    expect(String(ultimo[1])).toContain(MAIL_SOPORTE);
  });

  it('bloquear oculta los comentarios del autor y desbloquear los devuelve', () => {
    const r = setup([comment(), comment({ id: 'c2', text: 'otro de Bob' })]);
    fireEvent.press(r.getAllByLabelText('comments.more_options')[0]);
    tocarEnAlert(alertSpy, 'comments.block');
    tocarEnAlert(alertSpy, 'comments.block_confirm');

    expect(useBloqueoStore.getState().estaBloqueado('ub')).toBe(true);
    expect(r.queryByText('texto de Bob')).toBeNull();
    expect(r.queryByText('otro de Bob')).toBeNull();
    expect(r.getAllByText('comments.blocked_placeholder')).toHaveLength(2);

    fireEvent.press(r.getAllByText('comments.unblock')[0]);
    expect(useBloqueoStore.getState().estaBloqueado('ub')).toBe(false);
    expect(r.getByText('texto de Bob')).toBeTruthy();
  });
});
