import path from 'path';

import en from '../locales/en.json';
import es from '../locales/es.json';
import pt from '../locales/pt.json';
import { findMissingKeys, findOrphanKeys, flattenKeys } from '../deadKeysScanner';
import { scanRepoUsage } from '../scanLocaleUsage';

/**
 * Guard de claves i18n muertas (T-070).
 *
 * Corre el escaneo real sobre app/, src/, components/ y hooks/ y lo compara
 * contra es.json (fuente de verdad). Es el entregable que importa: sin esto,
 * la limpieza de T-070 se vuelve a llenar sola con la próxima pantalla que se
 * reescribe o el próximo texto que se saca.
 *
 * Falla en las dos direcciones:
 *   - una clave de es.json que nadie usa (huérfana nueva)
 *   - una llamada a t()/i18n.t() cuya clave no está en es.json (clave viva borrada)
 */

/**
 * Excepción DECLARADA, no borrado a medias: T-070 hizo el barrido completo y
 * dejó estas afuera porque la regla del ticket manda "ante la duda, se deja".
 * Cada grupo tiene su propia razón — no es una licencia para sumar más acá
 * sin la misma revisión.
 *
 * - `auth.privacy_*` / `auth.understood`: `app/auth/index.tsx` se reescribió
 *   el 02/09 (T-048/identidad) y no queda claro si el modal de privacidad que
 *   consumía estas claves se sacó a propósito o quedó pendiente de reconectar.
 * - `trust.payment`: no la llama ningún call site hoy, pero
 *   `trustCopy.test.ts` la testea explícitamente por contenido (tono, no
 *   acusatorio) junto con `badge`/`expense`/`vote` — un test dedicado
 *   protegiéndola es la señal más fuerte de "no está muerta" que hay.
 * - `invite.groups_in_common` / `invite.groups_in_common_other`: el resto de
 *   `invite.*` (pantalla de invitación) no existe todavía como screen y se
 *   borró entero — pero el Orquestador pidió explícitamente conservar este
 *   par al arreglar el bug de `_plural` (ver más abajo), no borrarlo con el
 *   resto.
 *
 * Todas están reportadas en el handoff de T-070.
 */
const HUERFANAS_EN_REVISION = new Set([
  'auth.privacy_title',
  'auth.privacy_no_server_title',
  'auth.privacy_no_server_body',
  'auth.privacy_p2p_title',
  'auth.privacy_p2p_body',
  'auth.privacy_members_title',
  'auth.privacy_members_body',
  'auth.privacy_tracking_title',
  'auth.privacy_tracking_body',
  'auth.understood',
  'trust.payment',
  'invite.groups_in_common',
  'invite.groups_in_common_other',
]);

describe('guard de claves i18n muertas', () => {
  const allKeys = flattenKeys(es as Record<string, unknown>);
  const repoRoot = path.resolve(__dirname, '../../..');
  const { usedLiterals, calledLiterals } = scanRepoUsage(repoRoot);

  it('no sobrevive ninguna clave huérfana nueva en es.json', () => {
    const orphans = findOrphanKeys(allKeys, usedLiterals).filter(
      k => !HUERFANAS_EN_REVISION.has(k),
    );
    expect(orphans).toEqual([]);
  });

  it('las 10 huérfanas en revisión siguen siendo exactamente esas — ni una más ni una menos', () => {
    // Si este test se rompe porque el set real quedó MÁS CHICO (alguien
    // volvió a usar una), sacala de HUERFANAS_EN_REVISION. Si quedó MÁS
    // GRANDE, algo nuevo se volvió huérfano y hay que decidirlo, no meterlo acá.
    const orphans = new Set(findOrphanKeys(allKeys, usedLiterals));
    const siguenHuerfanas = [...HUERFANAS_EN_REVISION].filter(k => orphans.has(k));
    expect(siguenHuerfanas.sort()).toEqual([...HUERFANAS_EN_REVISION].sort());
  });

  it('ninguna clave llamada con t()/i18n.t() falta en es.json (clave viva borrada)', () => {
    const missing = findMissingKeys(calledLiterals, allKeys);
    expect(missing).toEqual([]);
  });

  it('las claves dinámicas (categories.*) siguen existiendo', () => {
    const categoryKeys = allKeys.filter(k => k.startsWith('categories.'));
    expect(categoryKeys.length).toBeGreaterThan(0);
  });
});

/**
 * `_plural` es el sufijo de pluralización de i18next v3. Este proyecto corre
 * `compatibilityJSON: 'v4'` (src/i18n/index.ts), que resuelve pluralización
 * contra `_one`/`_other`/etc. (CLDR) — una clave `X_plural` no la resuelve
 * NADIE: ni aparece literal en el código (el guard de arriba la vería
 * huérfana) ni la usa i18next en runtime. Es texto muerto que PARECE vivo
 * porque tiene forma de clave real, y encontrado en carne propia en
 * expense.time_days/hours/minutes: con el sufijo viejo, un pedido de borrado
 * con 2 horas de vida decía "2 día" en vez de "2 días" — bug silencioso, sin
 * error, porque i18next cae al singular como fallback cuando no encuentra la
 * forma plural que busca.
 */
describe('ningún locale usa el sufijo de plural viejo (_plural, i18next v3)', () => {
  it.each([['es', es], ['en', en], ['pt', pt]] as const)('%s no tiene claves *_plural', (_lang, dict) => {
    const conSufijoViejo = flattenKeys(dict as Record<string, unknown>).filter(k => k.endsWith('_plural'));
    expect(conSufijoViejo).toEqual([]);
  });
});
