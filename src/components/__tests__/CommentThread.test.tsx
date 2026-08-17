import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { CommentThread } from '../CommentThread';
import type { ExpenseComment } from '@/src/types/models';

const NAMES: Record<string, string> = { ua: 'Ana', ub: 'Bob' };
const authorName = (id: string) => NAMES[id] ?? id;

function comment(over: Partial<ExpenseComment> = {}): ExpenseComment {
  return {
    id: 'c1', expenseId: 'e1', authorId: 'ua', text: 'Esto lo pagué yo',
    createdAt: Date.UTC(2026, 7, 16), updatedAt: 0, isDeleted: false,
    ...over,
  };
}

function setup(props: Partial<React.ComponentProps<typeof CommentThread>> = {}) {
  const onAdd = jest.fn();
  const onDelete = jest.fn();
  const utils = render(
    <CommentThread
      comments={[]}
      currentUserId="ua"
      authorName={authorName}
      onAdd={onAdd}
      onDelete={onDelete}
      {...props}
    />,
  );
  return { ...utils, onAdd, onDelete };
}

describe('CommentThread', () => {
  it('muestra el estado vacío cuando no hay comentarios', () => {
    const { getByText } = setup();
    expect(getByText('comments.empty')).toBeTruthy();
  });

  it('lista los comentarios con su autor', () => {
    const { getByText, queryByText } = setup({ comments: [comment()] });
    expect(getByText('Esto lo pagué yo')).toBeTruthy();
    expect(getByText('Ana')).toBeTruthy();
    expect(queryByText('comments.empty')).toBeNull();
  });

  it('envía el texto escrito y limpia el campo', () => {
    const { getByPlaceholderText, getByLabelText, onAdd } = setup();

    fireEvent.changeText(getByPlaceholderText('comments.placeholder'), 'Buenísimo');
    fireEvent.press(getByLabelText('comments.send'));

    expect(onAdd).toHaveBeenCalledWith('Buenísimo');
    expect(getByPlaceholderText('comments.placeholder').props.value).toBe('');
  });

  it('recorta los espacios al enviar', () => {
    const { getByPlaceholderText, getByLabelText, onAdd } = setup();

    fireEvent.changeText(getByPlaceholderText('comments.placeholder'), '   hola   ');
    fireEvent.press(getByLabelText('comments.send'));

    expect(onAdd).toHaveBeenCalledWith('hola');
  });

  it('no deja enviar un comentario vacío ni de solo espacios', () => {
    const { getByPlaceholderText, getByLabelText, onAdd } = setup();

    fireEvent.press(getByLabelText('comments.send'));
    expect(onAdd).not.toHaveBeenCalled();

    fireEvent.changeText(getByPlaceholderText('comments.placeholder'), '    ');
    fireEvent.press(getByLabelText('comments.send'));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('el botón de enviar arranca deshabilitado y se habilita al escribir', () => {
    const { getByPlaceholderText, getByLabelText } = setup();

    expect(getByLabelText('comments.send').props.accessibilityState?.disabled).toBe(true);

    fireEvent.changeText(getByPlaceholderText('comments.placeholder'), 'algo');
    expect(getByLabelText('comments.send').props.accessibilityState?.disabled).toBe(false);
  });

  // Sólo se borra lo propio: un comentario ajeno es dato de otra persona.
  it('ofrece borrar SOLO los comentarios propios', () => {
    const { queryAllByLabelText } = setup({
      comments: [comment({ id: 'mio', authorId: 'ua' }), comment({ id: 'suyo', authorId: 'ub' })],
    });
    expect(queryAllByLabelText('comments.delete_title')).toHaveLength(1);
  });

  it('pide confirmación antes de borrar y avisa recién al confirmar', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByLabelText, onDelete } = setup({ comments: [comment()] });

    fireEvent.press(getByLabelText('comments.delete_title'));

    expect(spy).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled(); // todavía no confirmó

    // Se dispara la acción destructiva del Alert.
    const buttons = spy.mock.calls[0]![2] as Array<{ style?: string; onPress?: () => void }>;
    buttons.find(b => b.style === 'destructive')!.onPress!();

    expect(onDelete).toHaveBeenCalledWith('c1');
    spy.mockRestore();
  });
});
