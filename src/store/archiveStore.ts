import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';

/**
 * Grupos archivados — una preferencia de VISTA local a la cuenta, que
 * además bloquea escritura (PO 2026-09-20 — antes sólo sacaba el grupo de
 * la lista principal, ver commit que agregó este comentario).
 *
 * Archivar NO es borrar: el grupo sigue entero, con sus gastos y sus
 * saldos, visibles. Lo que cambia es que deja de aceptar gastos, pagos y
 * comentarios nuevos mientras esté archivado (ver los guards en
 * `app/expense/new.tsx`, `app/expense/[id].tsx`, `app/settle/new.tsx`).
 *
 * `reason` distingue DOS caminos al archivado:
 * - `'manual'`: el usuario lo archivó a mano (ej. un viaje que terminó) —
 *   reversible, como siempre.
 * - `'limit'`: lo archivó el traspaso por límite de gastos (T-058,
 *   ver `src/services/groupTraspaso.ts`) — **irrevocable**: el punto entero
 *   de esto es que ese grupo no vuelva a crecer y a acercarse al techo de
 *   sync. `setArchived(id, false)` sobre uno de éstos no hace nada.
 */

const storage = createSecureStorage('groups');
const KEY = 'archived_v1';
const REASONS_KEY = 'archived_reasons_v1';

export type ArchiveReason = 'manual' | 'limit';

interface ArchiveState {
  archivedIds: string[];
  reasons: Record<string, ArchiveReason>;
  isArchived: (groupId: string) => boolean;
  archiveReason: (groupId: string) => ArchiveReason | null;
  canUnarchive: (groupId: string) => boolean;
  setArchived: (groupId: string, archived: boolean, reason?: ArchiveReason) => void;
  hydrate: () => void;
}

function persistIds(ids: string[]) {
  writeScoped(storage, KEY, JSON.stringify(ids));
}

function persistReasons(reasons: Record<string, ArchiveReason>) {
  writeScoped(storage, REASONS_KEY, JSON.stringify(reasons));
}

export const useArchiveStore = create<ArchiveState>((set, get) => ({
  archivedIds: [],
  reasons: {},

  isArchived: (groupId) => get().archivedIds.includes(groupId),

  archiveReason: (groupId) => get().reasons[groupId] ?? null,

  canUnarchive: (groupId) => get().reasons[groupId] !== 'limit',

  setArchived: (groupId, archived, reason = 'manual') => {
    const { archivedIds, reasons } = get();
    const yaArchivado = archivedIds.includes(groupId);

    if (!archived) {
      // Idempotente: no estaba archivado, no hay nada que hacer.
      if (!yaArchivado) return;
      // Irrevocable: un archivado por límite no se puede deshacer.
      if (reasons[groupId] === 'limit') return;

      const ids = archivedIds.filter(id => id !== groupId);
      const { [groupId]: _quitado, ...restoReasons } = reasons;
      persistIds(ids);
      persistReasons(restoReasons);
      set({ archivedIds: ids, reasons: restoReasons });
      return;
    }

    // Archivar: idempotente si ya estaba archivado con la MISMA razón.
    if (yaArchivado && reasons[groupId] === reason) return;

    const ids = yaArchivado ? archivedIds : [...archivedIds, groupId];
    const nuevasReasons = { ...reasons, [groupId]: reason };
    persistIds(ids);
    persistReasons(nuevasReasons);
    set({ archivedIds: ids, reasons: nuevasReasons });
  },

  hydrate: () => {
    const rawIds = readScoped(storage, KEY);
    let archivedIds: string[] = [];
    try {
      archivedIds = rawIds ? (JSON.parse(rawIds) as string[]) : [];
    } catch {
      archivedIds = [];
    }

    const rawReasons = readScoped(storage, REASONS_KEY);
    let reasons: Record<string, ArchiveReason> = {};
    try {
      reasons = rawReasons ? (JSON.parse(rawReasons) as Record<string, ArchiveReason>) : {};
    } catch {
      reasons = {};
    }

    // Aditivo: un grupo archivado ANTES de este cambio tiene id pero no
    // reason — cae a 'manual' (el comportamiento que ya tenía: reversible).
    for (const id of archivedIds) {
      if (!(id in reasons)) reasons[id] = 'manual';
    }

    set({ archivedIds, reasons });
  },
}));
