/**
 * T-206-A (D10): `relectura.ts` pasó a armar cada sobre con `abrirSobre`
 * (`nucleo/abrirSobre.ts`) en vez de repetir a mano verificar/descifrar/
 * parsear/clasificar. La migración es mecánica salvo por UNA cosa: gana un
 * rastro nuevo. Antes, un sobre que "parecía" un manifiesto (`version`/
 * `entries` presentes) pero con una entrada inválida (`isManifest` lo
 * rechaza, `looksLikeManifest` lo acepta) se descartaba en silencio — igual
 * que cualquier rebanada de datos que no encajara. `abrirSobre` cuenta ese
 * caso puntual como `manifest_malformado` (`registrarFalloDeAplicacion`,
 * `nucleo/drainFailures.ts`), porque no es "esta ckey es de otra cosa": es
 * un manifiesto roto.
 *
 * Este test prueba `releerFaltantes` directo (sin pasar por `drainGroup`
 * entero): un manifiesto declaró una `ckey` como faltante, la relectura la
 * busca, y lo que encuentra bajo esa `ckey` es un manifiesto malformado.
 */
jest.mock('@/src/sync/adaptadores/supabase/relay', () => ({
  fetchSince: jest.fn(),
}));
jest.mock('@/src/services/errorLog', () => ({ recordError: jest.fn() }));

import { releerFaltantes } from '../relectura';
import { fetchSince } from '@/src/sync/adaptadores/supabase/relay';
import { recordError } from '@/src/services/errorLog';
import { generateGroupKey, sealEnvelope } from '@/src/sync/nucleo/envelopeCrypto';
import { toHex } from '@/src/sync/nucleo/hexBytes';
import { signEnvelope } from '@/src/sync/nucleo/envelopeSign';
import { digestOfJson } from '@/src/sync/nucleo/manifest';
import { ensureIdentity } from '@/src/store/identityStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage } from '@/src/utils/secureStorage';

const mockFetchSince = fetchSince as jest.Mock;
const mockRecordError = recordError as jest.Mock;

const GROUP_ID = 'g1';
const SENDER = 'otro-device';
const CKEY = 'ckey-faltante';
const TOPIC = 'topic-de-prueba';

beforeEach(() => {
  createSecureStorage('groupkeys').clearAll();
  mockFetchSince.mockReset();
  mockRecordError.mockReset();
  // `sigueSiendoLaClave` compara contra el `groupKeyStore` real — adoptar la
  // clave de A acá evita que la relectura corte antes de leer nada.
  useGroupKeyStore.setState({ keys: [] });
});

/** Sella y firma `json` como lo haría el emisor real, bajo `CKEY`. */
function sobreDe(key: Uint8Array, json: string) {
  const sealed = sealEnvelope(key, json);
  const payload = signEnvelope(sealed, ensureIdentity().privateKey);
  return { seq: 1, ckey: CKEY, sender: SENDER, payload };
}

describe('releerFaltantes — un manifiesto malformado bajo la ckey buscada', () => {
  it('se descarta (sigue faltante) Y deja rastro manifest_malformado', async () => {
    const key = generateGroupKey();
    useGroupKeyStore.getState().adoptKeys(
      [{ groupId: GROUP_ID, key: toHex(key), epoch: 1 }],
    );
    const keyRecord = useGroupKeyStore.getState().getKey(GROUP_ID)!;

    // "Parece" un manifiesto (version 2 + entries array) pero la entrada no
    // tiene `ckey`/`digest` de tipo string — isManifest lo rechaza,
    // looksLikeManifest lo acepta. Es exactamente el caso que abrirSobre
    // distingue de "esta ckey es de datos".
    const malformado = JSON.stringify({ version: 2, entries: [null] });
    const envelope = sobreDe(key, malformado);

    mockFetchSince.mockResolvedValue({ ok: true, envelopes: [envelope], cursor: 1, more: false });

    const digestDeclarado = await digestOfJson(malformado);
    const pendientes = await releerFaltantes(
      GROUP_ID, 'yo', 'mi-device', TOPIC, key,
      { key: keyRecord.key, epoch: keyRecord.epoch }, SENDER,
      [{ ckey: CKEY, digest: digestDeclarado }],
    );

    // Sigue faltante: un manifiesto roto nunca se acepta como "la rebanada
    // de datos que se estaba buscando" — mismo resultado que antes de D10.
    expect(pendientes).toEqual([CKEY]);

    // Lo que gana D10: el rastro. Antes de esta migración, `recordError`
    // nunca se llamaba para este caso.
    expect(mockRecordError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('manifest_malformado') }),
    );
  });

  it('una rebanada de datos normal bajo la misma ckey se sigue aplicando igual (D10 no cambia el caso feliz)', async () => {
    const key = generateGroupKey();
    useGroupKeyStore.getState().adoptKeys(
      [{ groupId: GROUP_ID, key: toHex(key), epoch: 1 }],
    );
    const keyRecord = useGroupKeyStore.getState().getKey(GROUP_ID)!;

    const delta = JSON.stringify({
      version: 1, featureVersion: 2, fromUserId: SENDER, timestamp: 0,
      groups: [], expenses: [], payments: [], users: [],
    });
    const envelope = sobreDe(key, delta);
    mockFetchSince.mockResolvedValue({ ok: true, envelopes: [envelope], cursor: 1, more: false });

    const digestDeclarado = await digestOfJson(delta);
    const pendientes = await releerFaltantes(
      GROUP_ID, 'yo', 'mi-device', TOPIC, key,
      { key: keyRecord.key, epoch: keyRecord.epoch }, SENDER,
      [{ ckey: CKEY, digest: digestDeclarado }],
    );

    expect(pendientes).toEqual([]); // se encontró y se aplicó: ya no falta
    expect(mockRecordError).not.toHaveBeenCalled();
  });
});
