import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import { mergeByIdLWW } from './lww';
import type { ExpenseComment } from '@/src/types/models';

const storage = createSecureStorage('comments');
const KEY = 'data_v1';

interface CommentStoreState {
  comments: ExpenseComment[];
  isLoading: boolean;
  /** Comentarios vivos de un gasto, del más viejo al más nuevo. */
  forExpense: (expenseId: string) => ExpenseComment[];
  addComment: (comment: ExpenseComment) => void;
  /** Tombstonea todos los comentarios de un gasto (cascada al borrarlo). */
  removeForExpense: (expenseId: string) => void;
  removeComment: (id: string) => void;
  mergeComments: (incoming: ExpenseComment[]) => void;
  hydrate: () => void;
}

function persist(comments: ExpenseComment[]) {
  writeScoped(storage, KEY, JSON.stringify(comments));
}

export const useCommentStore = create<CommentStoreState>((set, get) => ({
  comments: [],
  isLoading: true,

  // Orden cronológico: una conversación se lee de arriba hacia abajo.
  forExpense: (expenseId) =>
    get().comments
      .filter(c => c.expenseId === expenseId && !c.isDeleted)
      .sort((a, b) => a.createdAt - b.createdAt),

  addComment: (comment) => {
    const comments = [...get().comments, comment];
    persist(comments);
    set({ comments });
  },

  // Tombstone, nunca DELETE físico (regla de negocio #1).
  // Cascada: al borrar un gasto sus comentarios se tombstonean también. Sin
  // esto quedaban huérfanos para siempre, apuntando a un gasto que ya no existe,
  // y viajando en cada delta de sync. Se tombstonea (no se borra físico) para
  // que el borrado se propague a los otros devices, igual que el del gasto.
  removeForExpense: (expenseId) => {
    const now = Date.now();
    const comments = get().comments.map(c =>
      c.expenseId === expenseId && !c.isDeleted
        ? { ...c, isDeleted: true, updatedAt: now }
        : c,
    );
    persist(comments);
    set({ comments });
  },

  removeComment: (id) => {
    const comments = get().comments.map(c =>
      c.id === id ? { ...c, isDeleted: true, updatedAt: Date.now() } : c,
    );
    persist(comments);
    set({ comments });
  },

  // LWW por updatedAt. Como cada comentario es un registro con id propio, dos
  // personas comentando el mismo gasto sin haber sincronizado NO se pisan.
  mergeComments: (incoming) => {
    const merged = mergeByIdLWW(get().comments, incoming);
    persist(merged);
    set({ comments: merged });
  },

  hydrate: () => {
    const raw = readScoped(storage, KEY);
    let comments: ExpenseComment[] = [];
    try {
      comments = raw ? (JSON.parse(raw) as ExpenseComment[]) : [];
    } catch {
      comments = []; // dato corrupto: se arranca vacío en vez de tirar
    }
    set({ comments, isLoading: false });
  },
}));
