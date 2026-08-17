import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import type { ExpenseComment } from '@/src/types/models';

const storage = createSecureStorage('comments');
const KEY = 'data_v1';

interface CommentStoreState {
  comments: ExpenseComment[];
  isLoading: boolean;
  /** Comentarios vivos de un gasto, del más viejo al más nuevo. */
  forExpense: (expenseId: string) => ExpenseComment[];
  addComment: (comment: ExpenseComment) => void;
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
    const merged = [...get().comments];
    for (const inc of incoming) {
      const i = merged.findIndex(c => c.id === inc.id);
      if (i === -1) merged.push(inc);
      else if (inc.updatedAt > merged[i]!.updatedAt) merged[i] = inc;
    }
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
