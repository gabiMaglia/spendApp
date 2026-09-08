import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';
import { generateGroupKey, toHex, fromHex } from '@/src/sync/envelopeCrypto';

/**
 * Claves de cifrado de cada grupo (ADR-003).
 *
 * ESTO ES LO MÁS SENSIBLE QUE GUARDA LA APP. Quien tiene estas claves puede
 * leer todos los gastos del grupo, incluidos los que viajan por el relay. Por
 * eso viven en el storage CIFRADO (`createSecureStorage`) y scopeadas por
 * cuenta, igual que el resto de los datos.
 *
 * **Nunca salen por el relay.** Se distribuyen sólo por el pairing QR, que está
 * autenticado por presencia física. Si el relay pudiera entregar claves, podría
 * sustituirlas por las suyas y leer todo — es el punto exacto donde estas
 * arquitecturas se rompen (ADR-003 §1).
 */

import { marcarConTopic } from '@/src/sync/pendingDrain';
const storage = createSecureStorage('groupkeys');
const KEY = 'data_v1';

export type GroupKeyRecord = {
  groupId: string;
  /** Clave simétrica en hex. Se guarda como texto porque el storage es de strings. */
  key: string;
  /** Época actual. Al rotar cambia el topic y el que salió no puede derivarlo. */
  epoch: number;
};

interface GroupKeyState {
  keys: GroupKeyRecord[];
  getKey: (groupId: string) => GroupKeyRecord | undefined;
  /** Devuelve la existente o crea una nueva. Idempotente. */
  ensureKey: (groupId: string) => GroupKeyRecord;
  /** Adopta claves recibidas por un canal AUTENTICADO (pairing QR). */
  adoptKeys: (incoming: GroupKeyRecord[]) => void;
  /** Olvida la clave de un grupo. Sólo la usa la purga al salir (T-089). */
  forgetKey: (groupId: string) => void;
  hydrate: () => void;
}

function persist(keys: GroupKeyRecord[]) {
  writeScoped(storage, KEY, JSON.stringify(keys));
}

export const useGroupKeyStore = create<GroupKeyState>((set, get) => ({
  keys: [],

  getKey: (groupId) => get().keys.find(k => k.groupId === groupId),

  ensureKey: (groupId) => {
    const existing = get().keys.find(k => k.groupId === groupId);
    if (existing) return existing;

    const record: GroupKeyRecord = { groupId, key: toHex(generateGroupKey()), epoch: 1 };
    const keys = [...get().keys, record];
    persist(keys);
    set({ keys });
    return record;
  },

  /**
   * Regla de adopción: **nunca se pisa una clave que ya tenemos**.
   *
   * Si dos dispositivos generaron cada uno la suya para el mismo grupo antes de
   * conocerse, aceptar la ajena dejaría ilegibles todos los sobres propios ya
   * publicados. Ante conflicto gana la época mayor; con épocas iguales, gana la
   * local y el desempate real lo resuelve la rotación (fuera del alcance del
   * spike, ver T-033).
   */
  adoptKeys: (incoming) => {
    const keys = [...get().keys];
    let changed = false;

    for (const inc of incoming) {
      const i = keys.findIndex(k => k.groupId === inc.groupId);
      if (i === -1) { keys.push(inc); changed = true; }
      else if (inc.epoch > keys[i]!.epoch) { keys[i] = inc; changed = true; }
    }

    if (!changed) return;
    persist(keys);
    set({ keys });

    /**
     * **Adoptar la clave de un grupo es entrar a él — o volver** (T-089), y son
     * el mismo camino. Hasta haber drenado su buzón, este teléfono no puede
     * publicar: mandaría el estado que recuerda y resucitaría lo que el grupo
     * borró mientras no estaba.
     *
     * Se marca también en `leaveGroup`, y hacen falta las dos: si alguien
     * reingresa **sin** re-adoptar la clave —porque nunca la perdió— `adoptKeys`
     * sale temprano por `!changed` y esta línea no corre.
     */
    void marcarConTopic(incoming.map(k => k.groupId));
  },

  /**
   * Sin la clave, este teléfono ya no puede abrir los sobres de ese grupo.
   *
   * Existe como acción propia y no reusando `adoptKeys` porque **`adoptKeys`
   * marca pendiente de drenaje** (T-089): vaciar y readoptar para sacar una
   * clave marcaría TODOS los demás grupos como pendientes. Es el tipo de efecto
   * de borde que se paga tres semanas después.
   */
  forgetKey: (groupId) => {
    const keys = get().keys.filter(k => k.groupId !== groupId);
    if (keys.length === get().keys.length) return;
    persist(keys);
    set({ keys });
  },

  hydrate: () => {
    const raw = readScoped(storage, KEY);
    let keys: GroupKeyRecord[] = [];
    try {
      keys = raw ? (JSON.parse(raw) as GroupKeyRecord[]) : [];
    } catch {
      keys = []; // dato corrupto: sin claves se degrada a QR, no se rompe
    }
    set({ keys });
  },
}));

/** Bytes de la clave de un grupo, o `null` si no la tenemos. */
export function groupKeyBytes(groupId: string): Uint8Array | null {
  const record = useGroupKeyStore.getState().getKey(groupId);
  return record ? fromHex(record.key) : null;
}
