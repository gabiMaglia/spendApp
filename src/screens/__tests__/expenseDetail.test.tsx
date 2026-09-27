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
import { toHex } from '@/src/sync/hexBytes';
import { signCore } from '@/src/sync/recordSign';
import { rememberAuthorKey, forgetAuthorKeys } from '@/src/sync/authorKeys';
import { mergeRecord } from '@/src/store/mergeLevels';
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
  createdById: 'ua', updatedAt: 0, isDeleted: false, ...over,
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

/**
 * T-186: se sacó el modo «con acuerdo» — cualquier miembro del grupo borra al
 * instante, sin ronda ni objeción, con un solo diálogo de confirmación. Queda
 * `deletedById` (campo del «resto», sin firma) para que Actividad muestre
 * quién borró.
 */
describe('borrado libre (T-186)', () => {
  function grupo(over: Partial<Group> = {}): Group {
    return {
      id: 'g1', name: 'Viaje', memberIds: ['ua', 'ub'], currency: 'ARS',
      miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
      createdAt: 1_000, updatedAt: 1_000, isDeleted: false, createdById: 'ua',
      ...over,
    };
  }

  beforeEach(() => {
    useUserStore.setState({ users: [
      { id: 'ua', name: 'Ana' } as User,
      { id: 'ub', name: 'Beto' } as User,
    ]});
    useGroupStore.setState({ groups: [grupo()] });
    // El diálogo no se puede tocar en un test: se dispara la opción con acción.
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, botones) => {
      (botones as { onPress?: () => void }[] | undefined)?.find(b => b.onPress)?.onPress?.();
    });
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('el creador ve "eliminar gasto" y borra al instante', () => {
    useExpenseStore.setState({ expenses: [gasto({ createdById: 'ua' })] });
    expect(render(<ExpenseDetailScreen />).getByText('expense.delete_expense')).toBeTruthy();
  });

  it('quien NO es creador —pero es miembro del grupo— también borra al instante, y queda deletedById', () => {
    useExpenseStore.setState({ expenses: [gasto({ createdById: 'ub' })] });
    const { getByText } = render(<ExpenseDetailScreen />);
    fireEvent.press(getByText('expense.delete_expense'));

    const g = useExpenseStore.getState().expenses[0]!;
    expect(g.isDeleted).toBe(true);
    expect(g.deletedById).toBe('ua');
  });

  it('quien NO es miembro del grupo no ve la acción de borrar', () => {
    useExpenseStore.setState({ expenses: [gasto({ createdById: 'ub' })] });
    useGroupStore.setState({ groups: [grupo({ memberIds: ['ub'] })] }); // 'ua' ya no está
    expect(render(<ExpenseDetailScreen />).queryByText('expense.delete_expense')).toBeNull();
  });
});

describe('grupo archivado: solo lectura (revisión final, Important #5b)', () => {
  function grupo(over: Partial<Group> = {}): Group {
    return {
      id: 'g1', name: 'Viaje', memberIds: ['ua', 'ub'], currency: 'ARS',
      miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
      createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
      createdById: 'ua',
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
    // No se borró nada.
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(false);
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

  it('se muestra con disputa verificada, con el nombre del otro autor', () => {
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
  });

  /**
   * T-170 · D-3, ronda 3 del verificador (defecto único): el banner filtraba
   * por `expense.createdById` VIGENTE. Como el núcleo sigue ganando por `rev`
   * (R4, aceptado por el PO), Mallory puede re-estampar con un `rev` mayor y
   * CONVERTIRSE en el creador vigente — y ahí el filtro la escondía a ELLA,
   * la atacante, dejando sólo a Ana (el autor genuino) en la lista. El test
   * anterior lo tapaba fijando `createdById:'ua'` A MANO en vez de mergear de
   * verdad. Acá se mergea de verdad: Mallory gana el núcleo por `rev`.
   */
  it('PoC ronda 3: tras un merge real donde Mallory gana el núcleo por `rev`, sigue apareciendo (no la esconde el filtro por creador vigente)', () => {
    rememberAuthorKey('ua', PUB_UA);
    rememberAuthorKey('mallory', PUB_MALLORY);

    const nucleoUa = { ...nucleoBase, ...signCore('expense', nucleoBase as never, PRIV_UA) };
    const nucleoMallory = { ...nucleoBase, createdById: 'mallory', rev: 2 };
    const firmadoPorMallory = { ...nucleoMallory, ...signCore('expense', nucleoMallory as never, PRIV_MALLORY) };

    // Merge DE VERDAD (no un `createdById` fijado a mano): Mallory gana por
    // `rev` y queda como creador VIGENTE del registro guardado.
    const NOW = 1_800_000_000_000;
    const merged = mergeRecord('expense', nucleoUa as unknown as Expense, firmadoPorMallory as unknown as Expense, NOW);
    expect(merged.createdById).toBe('mallory'); // confirma la premisa del PoC

    useExpenseStore.setState({ expenses: [gasto(merged as unknown as Partial<Expense>)] });

    const { getByText } = render(<ExpenseDetailScreen />);
    expect(getByText(/authorship_disputed_title/)).toBeTruthy();
    const cuerpo = getByText(/authorship_disputed_body/);
    expect(cuerpo.props.children).toContain('Mallory');
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
