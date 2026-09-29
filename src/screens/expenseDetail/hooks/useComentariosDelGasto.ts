import { useMemo } from 'react';

import { useCommentStore } from '@/src/store/commentStore';
import { comentariosDelGasto } from '@/src/screens/expenseDetail/permisosDeGasto';

/**
 * Los comentarios del gasto, listos para `CommentThread`.
 * T-223: salió de `app/expense/[id].tsx`.
 */
export function useComentariosDelGasto(id: string | undefined) {
  // OJO: NO seleccionar `st.forExpense(id)` acá. Ese método arma un array
  // nuevo en cada llamada, y zustand compara por identidad: cada render produce
  // una referencia distinta, React la ve como "cambió" y vuelve a renderizar,
  // para siempre. Da "Maximum update depth exceeded" y la pantalla no abre.
  // Se selecciona el array crudo (referencia estable) y se filtra en un useMemo.
  const allComments = useCommentStore(st => st.comments);
  const comments = useMemo(
    () => comentariosDelGasto(allComments, id),
    [allComments, id],
  );
  const addComment = useCommentStore(st => st.addComment);
  const removeComment = useCommentStore(st => st.removeComment);
  const removeCommentsForExpense = useCommentStore(st => st.removeForExpense);
  return { comments, addComment, removeComment, removeCommentsForExpense };
}
