import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScopedLazy, activeUserId } from './userScope';
import { siguienteUpdatedAt } from './relojDelMerge';
import { mergeExpensesPure } from './mergeExpensesPure';
import { signOnCreate, signOnEdit, coreChanged } from '@/src/sync/signOnWrite';
import { schedulePublish } from '@/src/sync/relayEngine';
import { migrateExpenseAmounts } from './moneyMigration';
import type { Expense } from '@/src/types/models';
import { syncedNow } from '@/src/utils/syncedClock';
import { recordError } from '@/src/services/errorLog';
import { enDisputa } from '@/src/sync/autoriaTrust';
import { mismaPersona } from './identityAlias';
import { useGroupStore } from './groupStore';
import { deletionModeOf } from '@/src/algorithms/deletionPolicy';

const storage = createSecureStorage('expenses');
const KEY = 'data_v1';
// Guard de idempotencia de la conversión float→entero de montos (ADR-002 §6).
// Correrla dos veces multiplicaría los montos otra vez por el factor.
const MONEY_MIGRATION_KEY = 'money_int_v1_done';

interface ExpenseStoreState {
  expenses: Expense[];
  isLoading: boolean;
  getByGroupId: (groupId: string) => Expense[];
  addExpense: (expense: Expense) => void;
  /**
   * `false` = la edición NO se guardó (T-152 · D2): un núcleo ya firmado cuya
   * re-firma propia falló. El store queda intacto — el llamador le avisa al
   * usuario, no asume que guardó.
   */
  updateExpense: (id: string, patch: Partial<Expense>) => boolean;
  mergeExpenses: (incoming: Expense[], now?: number) => void;
  hydrate: () => void;
}

function persist(expenses: Expense[]) {
  writeScopedLazy(storage, KEY, () => JSON.stringify(expenses));
}

export const useExpenseStore = create<ExpenseStoreState>((set, get) => ({
  expenses: [],
  isLoading: true,

  getByGroupId: (groupId) =>
    get().expenses.filter(e => e.groupId === groupId && !e.isDeleted),

  addExpense: (expense) => {
    // Se firma acá y no en la pantalla: un gasto entra por `new.tsx`, por el
    // escaneo de recibo y por las recurrentes, y los tres pasan por este punto.
    const expenses = [...get().expenses, signOnCreate('expense', expense)];
    persist(expenses);
    set({ expenses });
    // Se avisa al motor de sync. Va con debounce: cargar un gasto dispara
    // varios cambios seguidos y no tiene sentido un sobre por cada uno.
    if (expense.groupId) schedulePublish(expense.groupId);
  },

  updateExpense: (id, patch) => {
    const actual = get().expenses.find(e => e.id === id);
    if (!actual) return true;

    const ahora = syncedNow();
    const conPatch = { ...actual, ...patch, updatedAt: siguienteUpdatedAt(actual.updatedAt, ahora) };

    const yo = activeUserId();
    const soyAutor = yo !== null && mismaPersona(actual.createdById, yo);
    // ¿El patch toca el NÚCLEO (plata, descripción…) o es puramente
    // colaborativo (un voto, un tombstone, sólo `updatedAt`)? Lo colaborativo
    // sigue siendo libre para cualquier miembro en los DOS modos — es la razón
    // de ser del split `core`/`fuera` (`recordCore.ts`) y de cómo ya funciona
    // el borrado consensuado. `conPatch` todavía no lleva `editedById`: si se
    // calculara con él ya puesto, decidir `editedById` se volvería un cambio
    // de núcleo espurio (es un campo `'core'`) y esto nunca daría `false`.
    const tocaElNucleo = coreChanged('expense', actual, conPatch);

    // T-185: en `consensus` sólo el autor edita el NÚCLEO — regla #2, no falla
    // técnica. Sin sesión activa (`yo === null`) no hay de dónde sacar "quién
    // edita", y eso NO es "alguien ajeno": es la misma falta de información
    // que `esMio`/`signOnEdit` ya tratan como "no es mío" sin bloquear la
    // escritura (queda sin firmar). El bloqueo sólo dispara cuando SÍ sabemos
    // que quien edita el núcleo no es el autor.
    const grupo = useGroupStore.getState().getById(actual.groupId);
    if (
      tocaElNucleo && yo !== null && !soyAutor
      && deletionModeOf({ deletionMode: grupo?.deletionMode }) === 'consensus'
    ) {
      return false;
    }

    // Autor edita (o el patch no tocó el núcleo): no queda rastro nuevo de
    // "editado por". Otro miembro edita el núcleo (sólo posible en `open`, por
    // el guard de arriba): el núcleo lo firma ÉL, y `editedById` lo declara.
    const siguiente = tocaElNucleo
      ? { ...conPatch, editedById: soyAutor ? undefined : (yo ?? undefined) }
      : conPatch;
    const firmado = signOnEdit('expense', actual, siguiente);
    if (firmado === null) {
      // T-152 · D2: el núcleo ya estaba firmado y la re-firma propia falló. No
      // se guarda sin firma (perdería en silencio contra la versión vieja);
      // el store queda como estaba.
      recordError({
        message: 'signOnEdit bloqueado: no se pudo re-firmar una edición propia de un gasto ya firmado',
        fatal: false,
      });
      return false;
    }

    const expenses = get().expenses.map(e => (e.id === id ? firmado : e));
    persist(expenses);
    set({ expenses });

    if (firmado.groupId) schedulePublish(firmado.groupId);
    return true;
  },

  /**
   * Merge por niveles (T-041 · S7) con tope de reloj (T-144). `now` se inyecta
   * con default `syncedNow()` ACÁ, no dentro de `mergeLevels`: esa función es
   * pura. `applyDelta` (relay y QR) y `backup.ts` no pasan `now` y heredan
   * este default.
   */
  mergeExpenses: (incoming, now = syncedNow()) => {
    const previos = get().expenses;
    const merged = mergeExpensesPure(previos, incoming, now);

    // Rastro P-1 (T-170 · D-2): sólo cuando el merge ABRE una disputa
    // ATRIBUIBLE (con firma que verifica, `src/sync/autoriaTrust.ts`) que no
    // estaba antes — no en cada re-merge del mismo par en disputa, ni al
    // recibir un tercer autor que ya estaba disputado, ni por una entrada
    // basura sin firma que ni siquiera abre una disputa de verdad.
    const porId = new Map(previos.map(e => [e.id, e]));
    for (const m of merged) {
      const previo = porId.get(m.id);
      const habiaDisputa = previo ? enDisputa(previo) : false;
      if (m.autoriaDisputada !== previo?.autoriaDisputada && enDisputa(m) && !habiaDisputa) {
        recordError({
          message: `sync.autoria_disputada id=${m.id.slice(0, 8)}`,
          fatal: false,
          screen: 'sync.merge',
        });
      }
    }

    persist(merged);
    set({ expenses: merged });
  },

  hydrate: () => {
    const raw = readScoped(storage, KEY);
    // Un dato corrupto NO puede tirar acá: hydrate corre en el arranque de la app
    // (app/_layout.tsx) y una excepción deja isLoading en true para siempre,
    // trabando la pantalla de carga sin salida. Ya pasó con la sesión (T-020);
    // estos stores habían quedado sin la misma protección.
    let expenses: Expense[] = [];
    try {
      expenses = raw ? (JSON.parse(raw) as Expense[]) : [];
    } catch {
      expenses = [];
    }

    // Conversión one-shot de datos existentes (float → entero, ADR-002 §6).
    // Debe correr ANTES de la migración WatermelonDB (T-003).
    if (!storage.getBoolean(MONEY_MIGRATION_KEY)) {
      expenses = migrateExpenseAmounts(expenses);
      persist(expenses);
      storage.set(MONEY_MIGRATION_KEY, true);
    }

    set({ expenses, isLoading: false });
  },
}));
