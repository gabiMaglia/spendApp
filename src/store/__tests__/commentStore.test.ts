import { useCommentStore } from '../commentStore';
import { useAuthStore } from '../authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { ExpenseComment, User } from '@/src/types/models';

const USER_A = { id: 'ua' } as User;
const USER_B = { id: 'ub' } as User;

function comment(over: Partial<ExpenseComment> = {}): ExpenseComment {
  return {
    id: 'c1', expenseId: 'e1', authorId: 'ua', text: 'Che, esto lo pagué yo',
    createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    ...over,
  };
}

function setActive(u: User | null) {
  useAuthStore.setState({ currentUser: u });
}

describe('commentStore', () => {
  beforeEach(() => {
    createSecureStorage('comments').clearAll();
    setActive(USER_A);
    useCommentStore.setState({ comments: [], isLoading: false });
  });

  it('agrega y devuelve el comentario del gasto', () => {
    useCommentStore.getState().addComment(comment());
    expect(useCommentStore.getState().forExpense('e1')).toHaveLength(1);
  });

  it('no mezcla comentarios de otros gastos', () => {
    useCommentStore.getState().addComment(comment());
    useCommentStore.getState().addComment(comment({ id: 'c2', expenseId: 'e2' }));
    expect(useCommentStore.getState().forExpense('e1').map(c => c.id)).toEqual(['c1']);
  });

  it('los devuelve en orden cronológico', () => {
    useCommentStore.getState().addComment(comment({ id: 'c2', createdAt: 2_000, text: 'segundo' }));
    useCommentStore.getState().addComment(comment({ id: 'c1', createdAt: 1_000, text: 'primero' }));
    expect(useCommentStore.getState().forExpense('e1').map(c => c.text)).toEqual(['primero', 'segundo']);
  });

  it('borrar es tombstone: desaparece de la lista pero el registro queda', () => {
    useCommentStore.getState().addComment(comment());
    useCommentStore.getState().removeComment('c1');

    expect(useCommentStore.getState().forExpense('e1')).toHaveLength(0);
    expect(useCommentStore.getState().comments).toHaveLength(1);
    expect(useCommentStore.getState().comments[0]!.isDeleted).toBe(true);
  });

  it('persiste y sobrevive a un store fresco', () => {
    useCommentStore.getState().addComment(comment());

    useCommentStore.setState({ comments: [] });
    useCommentStore.getState().hydrate();

    expect(useCommentStore.getState().forExpense('e1')).toHaveLength(1);
  });

  it('los comentarios son POR CUENTA: otra cuenta no los ve', () => {
    useCommentStore.getState().addComment(comment());

    setActive(USER_B);
    useCommentStore.getState().hydrate();

    expect(useCommentStore.getState().comments).toHaveLength(0);
  });

  describe('mergeComments (sync P2P)', () => {
    // EL MOTIVO DE QUE SEAN ENTIDAD PROPIA Y NO UN ARRAY DENTRO DEL GASTO
    it('dos personas comentando el mismo gasto sin sincronizar NO se pisan', () => {
      useCommentStore.getState().addComment(comment({ id: 'mio', authorId: 'ua', text: 'mío' }));

      useCommentStore.getState().mergeComments([
        comment({ id: 'suyo', authorId: 'ub', text: 'suyo' }),
      ]);

      const out = useCommentStore.getState().forExpense('e1');
      expect(out).toHaveLength(2);
      expect(out.map(c => c.text).sort()).toEqual(['mío', 'suyo']);
    });

    /**
     * Desde el merge por niveles (T-041 · S7) el texto es NÚCLEO y lo ordena
     * `rev`, no `updatedAt`: `updatedAt` lo escribe cualquiera y por eso ya no
     * decide quién escribió el contenido. Una edición de verdad la re-firma su
     * autor (`signOnEdit`) y sale con `rev` mayor, que es lo que se simula acá.
     */
    it('el mismo comentario editado gana', () => {
      useCommentStore.getState().addComment(comment({ text: 'viejo', updatedAt: 1_000 }));
      const revLocal = useCommentStore.getState().comments[0]!.rev!;

      useCommentStore.getState().mergeComments([
        comment({ text: 'nuevo', updatedAt: 2_000, rev: revLocal + 1 }),
      ]);

      expect(useCommentStore.getState().forExpense('e1')[0]!.text).toBe('nuevo');
    });

    it('una versión SIN `rev` no le pisa el texto a una firmada', () => {
      useCommentStore.getState().addComment(comment({ text: 'firmado', updatedAt: 1_000 }));
      useCommentStore.getState().mergeComments([comment({ text: 'reestampado', updatedAt: 9_000 })]);

      expect(useCommentStore.getState().forExpense('e1')[0]!.text).toBe('firmado');
    });

    it('no pisa con una versión más vieja', () => {
      useCommentStore.getState().addComment(comment({ text: 'nuevo', updatedAt: 2_000 }));
      useCommentStore.getState().mergeComments([comment({ text: 'viejo', updatedAt: 1_000 })]);

      expect(useCommentStore.getState().forExpense('e1')[0]!.text).toBe('nuevo');
    });

    it('un borrado se propaga por el sync', () => {
      useCommentStore.getState().addComment(comment({ updatedAt: 1_000 }));
      useCommentStore.getState().mergeComments([comment({ isDeleted: true, updatedAt: 2_000 })]);

      expect(useCommentStore.getState().forExpense('e1')).toHaveLength(0);
    });

    it('mergear lo mismo dos veces no duplica', () => {
      const c = comment();
      useCommentStore.getState().mergeComments([c]);
      useCommentStore.getState().mergeComments([c]);

      expect(useCommentStore.getState().comments).toHaveLength(1);
    });
  });

  it('un storage corrupto no rompe la app: arranca vacío', () => {
    createSecureStorage('comments').set(`${'data_v1'}::u:ua`, '{roto');
    expect(() => useCommentStore.getState().hydrate()).not.toThrow();
    expect(useCommentStore.getState().comments).toEqual([]);
  });
});

describe('removeForExpense — cascada al borrar el gasto', () => {
  beforeEach(() => {
    createSecureStorage('comments').clearAll();
    setActive(USER_A);
    useCommentStore.setState({ comments: [], isLoading: false });
  });

  it('tombstonea todos los comentarios del gasto', () => {
    useCommentStore.getState().addComment(comment({ id: 'c1' }));
    useCommentStore.getState().addComment(comment({ id: 'c2' }));

    useCommentStore.getState().removeForExpense('e1');

    expect(useCommentStore.getState().forExpense('e1')).toHaveLength(0);
  });

  it('NO toca los comentarios de otros gastos', () => {
    useCommentStore.getState().addComment(comment({ id: 'c1', expenseId: 'e1' }));
    useCommentStore.getState().addComment(comment({ id: 'c2', expenseId: 'e2' }));

    useCommentStore.getState().removeForExpense('e1');

    expect(useCommentStore.getState().forExpense('e2')).toHaveLength(1);
  });

  it('tombstonea, no borra físico: el borrado se propaga por sync', () => {
    useCommentStore.getState().addComment(comment({ id: 'c1' }));

    useCommentStore.getState().removeForExpense('e1');

    const raw = useCommentStore.getState().comments;
    expect(raw).toHaveLength(1);
    expect(raw[0]!.isDeleted).toBe(true);
  });

  it('sobre un gasto sin comentarios no rompe nada', () => {
    expect(() => useCommentStore.getState().removeForExpense('inexistente')).not.toThrow();
  });
});
