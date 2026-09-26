import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ed25519 } from '@noble/curves/ed25519.js';
import ExpenseDetailScreen from '@/app/expense/[id]';
import { useAuthStore } from '@/src/store/authStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { hasRequested } from '@/src/algorithms/deletionRound';
import { toHex } from '@/src/sync/hexBytes';
import { signCore } from '@/src/sync/recordSign';
import { rememberAuthorKey, forgetAuthorKeys } from '@/src/sync/authorKeys';
import type { Expense, ExpenseComment, Group, User } from '@/src/types/models';

/**
 * La pantalla tiene que ABRIR. Suena obvio y sin embargo estuvo rota: un
 * selector de zustand que armaba un array nuevo en cada render la metía en un
 * loop infinito ("Maximum update depth exceeded") y no había forma de ver un
 * gasto. Ningún test lo agarraba porque nadie renderizaba la pantalla.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'e1' }),
}));

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Carne', amount: 20000, currency: 'ARS',
  paidById: 'ua', splitMode: 'equal',
  splits: [{ userId: 'ua', amount: 10000 }, { userId: 'ub', amount: 10000 }],
  memberIds: ['ua', 'ub'], category: 'food', date: 0, createdAt: 0,
  createdById: 'ua', deletionVotes: [], updatedAt: 0, isDeleted: false, ...over,
} as Expense);

const comentario = (over: Partial<ExpenseComment> = {}): ExpenseComment => ({
  id: 'c1', expenseId: 'e1', authorId: 'ub', text: 'Buenísimo',
  createdAt: 1, updatedAt: 1, isDeleted: false, ...over,
});

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'ua', name: 'Ana' } as User });
  useCommentStore.setState({ comments: [] });
  useGroupStore.setState({ groups: [] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
});

describe('detalle del gasto', () => {
  it('abre y muestra el gasto', () => {
    useExpenseStore.setState({ expenses: [gasto()] });
    expect(render(<ExpenseDetailScreen />).getByText('Carne')).toBeTruthy();
  });

  it('abre con comentarios cargados', () => {
    useExpenseStore.setState({ expenses: [gasto()] });
    useCommentStore.setState({ comments: [comentario()] });

    expect(render(<ExpenseDetailScreen />).getByText('Buenísimo')).toBeTruthy();
  });

  it('no muestra los comentarios de OTRO gasto', () => {
    useExpenseStore.setState({ expenses: [gasto()] });
    useCommentStore.setState({ comments: [comentario({ expenseId: 'otro', text: 'Ajeno' })] });

    expect(render(<ExpenseDetailScreen />).queryByText('Ajeno')).toBeNull();
  });

  it('no muestra comentarios borrados', () => {
    useExpenseStore.setState({ expenses: [gasto()] });
    useCommentStore.setState({ comments: [comentario({ text: 'Borrado', isDeleted: true })] });

    expect(render(<ExpenseDetailScreen />).queryByText('Borrado')).toBeNull();
  });

  // Un registro que llega por sync puede venir sin campos que acá se recorren.
  // Que falte un dato no puede impedir ABRIR el gasto: sin la pantalla no hay
  // manera de verlo ni de corregirlo.
  it('abre aunque el gasto llegue sin deletionVotes', () => {
    useExpenseStore.setState({ expenses: [gasto({ deletionVotes: undefined as any })] });
    expect(() => render(<ExpenseDetailScreen />)).not.toThrow();
  });

  it('abre aunque el gasto llegue sin splits', () => {
    useExpenseStore.setState({ expenses: [gasto({ splits: undefined as any })] });
    expect(() => render(<ExpenseDetailScreen />)).not.toThrow();
  });

  // Las categorías de ingreso son de movimientos personales y no están en el
  // mapa de íconos de gastos.
  it('abre con una categoría fuera del mapa de íconos', () => {
    useExpenseStore.setState({ expenses: [gasto({ category: 'salary' as any })] });
    expect(() => render(<ExpenseDetailScreen />)).not.toThrow();
  });

  it('un gasto inexistente muestra el vacío, no rompe', () => {
    useExpenseStore.setState({ expenses: [] });
    expect(render(<ExpenseDetailScreen />).getByText('expense.not_found')).toBeTruthy();
  });
});

describe('borrado consensuado', () => {
  const pedido = (userId: string, at = Date.now()) =>
    ({ userId, votedAt: at, action: 'delete' as const });

  beforeEach(() => {
    useUserStore.setState({ users: [
      { id: 'ua', name: 'Ana' } as User,
      { id: 'ub', name: 'Beto' } as User,
    ]});
    // El diálogo no se puede tocar en un test: se dispara la primera opción con
    // acción, que es "pedir eliminación" (la que abre la ronda).
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, botones) => {
      (botones as { onPress?: () => void }[] | undefined)?.find(b => b.onPress)?.onPress?.();
    });
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('sin solicitud, el creador ve "eliminar gasto"', () => {
    useExpenseStore.setState({ expenses: [gasto({ createdById: 'ua' })] });
    expect(render(<ExpenseDetailScreen />).getByText('expense.delete_expense')).toBeTruthy();
  });

  it('sin solicitud, quien no es creador ve "pedir eliminación"', () => {
    useExpenseStore.setState({ expenses: [gasto({ createdById: 'ub' })] });
    expect(render(<ExpenseDetailScreen />).getByText('expense.request_delete')).toBeTruthy();
  });

  // Un aviso que no dice quién ni cuándo no le sirve a nadie para decidir.
  it('el aviso dice quién pidió y cuánto falta', () => {
    useExpenseStore.setState({ expenses: [gasto({
      createdById: 'ua', deletionVotes: [pedido('ub')],
    })] });

    const { getByText } = render(<ExpenseDetailScreen />);
    const aviso = getByText(/delete_pending_body/);

    expect(aviso.props.children).toContain('Beto');
  });

  it('con solicitud ajena, puedo objetar', () => {
    useExpenseStore.setState({ expenses: [gasto({
      createdById: 'ua', deletionVotes: [pedido('ub')],
    })] });

    const { getByText } = render(<ExpenseDetailScreen />);
    fireEvent.press(getByText('expense.object_delete'));

    const votos = useExpenseStore.getState().expenses[0]!.deletionVotes;
    expect(votos.find(v => v.userId === 'ua')?.action).toBe('cancel');
  });

  // Objetar frena a todos; retirar sólo me saca a mí. No son lo mismo y no se
  // pueden ofrecer indistintamente.
  //
  // Lo que cambió con el merge por niveles (T-041 · S7): retirar ya no BORRA mi
  // voto del array —una ausencia vuelve del primer peer que sincronice, con su
  // `votedAt` original y el plazo vencido— sino que emite el mío. Lo que el
  // test exige sigue siendo lo mismo: después de retirar, mi pedido no está.
  it('si el pedido es MÍO, la acción es retirarlo, no objetar', () => {
    useExpenseStore.setState({ expenses: [gasto({
      createdById: 'ua', deletionVotes: [pedido('ua')],
    })] });

    const { getByText, queryByText } = render(<ExpenseDetailScreen />);

    expect(queryByText('expense.object_delete')).toBeNull();
    fireEvent.press(getByText('expense.withdraw_request'));

    const votos = useExpenseStore.getState().expenses[0]!.deletionVotes;
    expect(votos.filter(v => v.action === 'delete')).toHaveLength(0);
    expect(hasRequested(useExpenseStore.getState().expenses[0]!, 'ua', Date.now())).toBe(false);
  });

  it('ya objetado, se avisa y no se ofrece objetar de nuevo', () => {
    useExpenseStore.setState({ expenses: [gasto({
      createdById: 'ub',
      deletionVotes: [pedido('ub'), { userId: 'ua', votedAt: Date.now(), action: 'cancel' }],
    })] });

    const { getByText, queryByText } = render(<ExpenseDetailScreen />);

    expect(getByText(/delete_objected_title/)).toBeTruthy();
    expect(queryByText('expense.object_delete')).toBeNull();
  });

  // Con una objeción viva, volver a pedir tiene que abrir una ronda LIMPIA: si
  // se acumularan, el cancel viejo bloquearía el pedido nuevo para siempre.
  it('pedir de nuevo después de una objeción limpia los votos viejos', () => {
    useExpenseStore.setState({ expenses: [gasto({
      createdById: 'ua',
      deletionVotes: [pedido('ub'), { userId: 'ua', votedAt: Date.now(), action: 'cancel' }],
    })] });

    const { getByText } = render(<ExpenseDetailScreen />);
    fireEvent.press(getByText('expense.delete_expense'));

    // El Alert está mockeado: se dispara la opción de pedir directamente.
    const votos = useExpenseStore.getState().expenses[0]!.deletionVotes;
    expect(votos.every(v => v.action === 'delete')).toBe(true);
    expect(votos).toHaveLength(1);
  });
});

/**
 * T-170 · D-1: la opción de forzar el borrado tiene que desaparecer cuando la
 * autoría está en disputa DE VERDAD (firma que verifica, no un id inyectado —
 * `src/sync/autoriaTrust.ts`). Antes de este fix, `enDisputa` no tenía
 * consumidor en esta pantalla: Mallory forzaba igual (T-170-verifier.md, D1).
 */
describe('T-170 · D-1: "Forzar" desaparece con autoría en disputa (verificada)', () => {
  const PRIV_UA = toHex(new Uint8Array(32).fill(1));
  const PUB_UA = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(1)));
  const PRIV_MALLORY = toHex(new Uint8Array(32).fill(2));
  const PUB_MALLORY = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(2)));

  const nucleoBase = {
    id: 'e1', groupId: 'g1', description: 'Carne', amount: 20000, currency: 'ARS', paidById: 'ua',
    splits: [{ userId: 'ua', amount: 10000 }, { userId: 'ub', amount: 10000 }],
    splitMode: 'equal', category: 'food', date: 0, createdAt: 0, createdById: 'ua', rev: 1,
  };

  beforeEach(() => {
    useUserStore.setState({ users: [{ id: 'ua', name: 'Ana' } as User, { id: 'ub', name: 'Beto' } as User] });
  });

  afterEach(() => { jest.restoreAllMocks(); forgetAuthorKeys(); });

  it('el creador NO ve "Forzar" cuando Mallory re-estampó el núcleo y su firma verifica', () => {
    rememberAuthorKey('ua', PUB_UA);
    rememberAuthorKey('mallory', PUB_MALLORY);

    const nucleoUa = { ...nucleoBase, ...signCore('expense', nucleoBase as never, PRIV_UA) };
    const nucleoMallory = { ...nucleoBase, createdById: 'mallory', rev: 2 };
    const firmadoPorMallory = { ...nucleoMallory, ...signCore('expense', nucleoMallory as never, PRIV_MALLORY) };

    useExpenseStore.setState({ expenses: [gasto({
      ...nucleoUa, createdById: 'ua', autoriaDisputada: [firmadoPorMallory as never],
    } as unknown as Partial<Expense>)] });

    const alertMock = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByText } = render(<ExpenseDetailScreen />);
    fireEvent.press(getByText('expense.delete_expense'));

    const opciones = alertMock.mock.calls[0]![2] as { text: string }[];
    expect(opciones.some(o => o.text === 'expense.delete_force')).toBe(false);
    expect(opciones.some(o => o.text === 'expense.delete_request')).toBe(true);
  });

  it('SIN disputa registrada, el creador sigue viendo "Forzar" (no regresiona)', () => {
    rememberAuthorKey('ua', PUB_UA);
    const nucleoUa = { ...nucleoBase, ...signCore('expense', nucleoBase as never, PRIV_UA) };
    useExpenseStore.setState({ expenses: [gasto({ ...nucleoUa, createdById: 'ua' } as unknown as Partial<Expense>)] });

    const alertMock = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByText } = render(<ExpenseDetailScreen />);
    fireEvent.press(getByText('expense.delete_expense'));

    const opciones = alertMock.mock.calls[0]![2] as { text: string }[];
    expect(opciones.some(o => o.text === 'expense.delete_force')).toBe(true);
  });
});

describe('grupo archivado: solo lectura (revisión final, Important #5b)', () => {
  function grupo(over: Partial<Group> = {}): Group {
    return {
      id: 'g1', name: 'Viaje', memberIds: ['ua', 'ub'], currency: 'ARS',
      createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
      createdById: 'ua', deletionVotes: [],
      ...over,
    };
  }

  beforeEach(() => {
    useGroupStore.setState({ groups: [grupo()] });
    useArchiveStore.getState().setArchived('g1', true);
    useExpenseStore.setState({ expenses: [gasto({ createdById: 'ua' })] });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('pedir el borrado en un grupo archivado no abre el diálogo de borrado: avisa que está archivado', () => {
    const { getByText } = render(<ExpenseDetailScreen />);
    fireEvent.press(getByText('expense.delete_expense'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'groups.archived_readonly_title', 'groups.archived_readonly_hint',
    );
    // No se abrió ninguna ronda: el voto de borrado no se emitió.
    expect(useExpenseStore.getState().expenses[0]!.deletionVotes).toHaveLength(0);
  });

  it('comentar en un grupo archivado no agrega el comentario: avisa que está archivado', () => {
    const { getByPlaceholderText, getByLabelText } = render(<ExpenseDetailScreen />);

    fireEvent.changeText(getByPlaceholderText('comments.placeholder'), 'Che, esto ya cerró');
    fireEvent.press(getByLabelText('comments.send'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'groups.archived_readonly_title', 'groups.archived_readonly_hint',
    );
    expect(useCommentStore.getState().comments).toHaveLength(0);
  });
});

/**
 * T-170 · D-3 (decisión del PO): la UI tiene que decir QUIÉN abrió la
 * disputa, no sólo ocultar "Forzar" en silencio. Muestra los autores
 * ATRIBUIBLES (`autoresVerificados`, firma que verifica) distintos del
 * creador vigente — nunca una entrada sin verificar ni un id inyectado.
 */
describe('T-170 · D-3: la UI muestra quién abrió la disputa', () => {
  const PRIV_UA = toHex(new Uint8Array(32).fill(1));
  const PUB_UA = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(1)));
  const PRIV_MALLORY = toHex(new Uint8Array(32).fill(2));
  const PUB_MALLORY = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(2)));

  const nucleoBase = {
    id: 'e1', groupId: 'g1', description: 'Carne', amount: 20000, currency: 'ARS', paidById: 'ua',
    splits: [{ userId: 'ua', amount: 10000 }, { userId: 'ub', amount: 10000 }],
    splitMode: 'equal', category: 'food', date: 0, createdAt: 0, createdById: 'ua', rev: 1,
  };

  beforeEach(() => {
    useUserStore.setState({ users: [
      { id: 'ua', name: 'Ana' } as User, { id: 'mallory', name: 'Mallory' } as User,
    ]});
  });

  afterEach(() => forgetAuthorKeys());

  it('se muestra con disputa verificada, con el nombre del OTRO autor (no el creador vigente)', () => {
    rememberAuthorKey('ua', PUB_UA);
    rememberAuthorKey('mallory', PUB_MALLORY);

    const nucleoUa = { ...nucleoBase, ...signCore('expense', nucleoBase as never, PRIV_UA) };
    const nucleoMallory = { ...nucleoBase, createdById: 'mallory', rev: 2 };
    const firmadoPorMallory = { ...nucleoMallory, ...signCore('expense', nucleoMallory as never, PRIV_MALLORY) };

    useExpenseStore.setState({ expenses: [gasto({
      ...nucleoUa, createdById: 'ua', autoriaDisputada: [firmadoPorMallory as never],
    } as unknown as Partial<Expense>)] });

    const { getByText } = render(<ExpenseDetailScreen />);
    expect(getByText(/authorship_disputed_title/)).toBeTruthy();
    const cuerpo = getByText(/authorship_disputed_body/);
    expect(cuerpo.props.children).toContain('Mallory');
    expect(cuerpo.props.children).not.toContain('Ana');
  });

  it('NO se muestra sin ninguna disputa registrada', () => {
    rememberAuthorKey('ua', PUB_UA);
    const nucleoUa = { ...nucleoBase, ...signCore('expense', nucleoBase as never, PRIV_UA) };
    useExpenseStore.setState({ expenses: [gasto(
      { ...nucleoUa, createdById: 'ua' } as unknown as Partial<Expense>,
    )] });

    const { queryByText } = render(<ExpenseDetailScreen />);
    expect(queryByText(/authorship_disputed_title/)).toBeNull();
  });

  it('NO se muestra con una entrada inválida (sin forma de núcleo firmado)', () => {
    rememberAuthorKey('ua', PUB_UA);
    const nucleoUa = { ...nucleoBase, ...signCore('expense', nucleoBase as never, PRIV_UA) };
    useExpenseStore.setState({ expenses: [gasto({
      ...nucleoUa, createdById: 'ua', autoriaDisputada: [{ createdById: 'mallory' } as never],
    } as unknown as Partial<Expense>)] });

    const { queryByText } = render(<ExpenseDetailScreen />);
    expect(queryByText(/authorship_disputed_title/)).toBeNull();
  });
});
