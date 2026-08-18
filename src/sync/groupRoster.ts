import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';

/**
 * Quién puede publicar en cada grupo: `userId → clave pública de su dispositivo`.
 *
 * Se aprende **de los propios sobres**: el primero que llega firmado por alguien
 * fija su identidad para ese grupo. De ahí en más, un sobre que diga venir de esa
 * persona con OTRA clave se rechaza.
 *
 * Es confianza al primer uso (TOFU), la misma regla que ya usan los contactos.
 * No es perfecta —el primer sobre podría ser del atacante— pero cierra el caso
 * real: alguien que se mete DESPUÉS no puede hacerse pasar por un miembro
 * existente, que es lo que permitiría publicarle gastos falsos a un grupo.
 *
 * Alternativa descartada: distribuir un roster firmado por el creador. Exige que
 * todos conozcan la clave del creador antes del primer sync, y eso sólo se
 * consigue viéndose la cara — justo lo que el PO puso como requisito duro que NO
 * se puede pedir.
 *
 * ⚠️ LIMITACIÓN CONOCIDA (T-040): una cuenta en DOS dispositivos rompe esto.
 * La identidad es del aparato, así que el segundo teléfono firma con otra clave
 * y sus sobres se rechazan — y se rechazan EN SILENCIO, que es la peor forma de
 * fallar. Lo mismo pasa si alguien reinstala la app. Mitigación de hoy: el
 * roster se puede ver y reiniciar desde la pantalla de diagnóstico (DEV). La
 * solución de verdad es una identidad por CUENTA con varios dispositivos
 * autorizados, o rotación de época; está ticketeada, no resuelta.
 */

const storage = createSecureStorage('groupkeys');
const KEY = 'roster_v1';

type Roster = Record<string, Record<string, string>>; // groupId → userId → pubkey

function leer(): Roster {
  const raw = readScoped(storage, KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Roster;
  } catch {
    return {}; // corrupto: se degrada a "no conozco a nadie", no rompe
  }
}

export function knownPublisher(groupId: string, userId: string): string | undefined {
  return leer()[groupId]?.[userId];
}

/**
 * ¿Este sobre puede aplicarse?
 *
 * `true` si la identidad coincide con la pineada, o si es la primera vez que
 * vemos a esa persona en ese grupo (y entonces se pinea).
 */
export function acceptPublisher(groupId: string, userId: string, publicKey: string): boolean {
  if (!groupId || !userId || !publicKey) return false;

  const roster = leer();
  const delGrupo = roster[groupId] ?? {};
  const pineada = delGrupo[userId];

  if (pineada !== undefined) return pineada === publicKey;

  delGrupo[userId] = publicKey;
  roster[groupId] = delGrupo;
  writeScoped(storage, KEY, JSON.stringify(roster));
  return true;
}

/** Sólo para tests y para el borrado de cuenta. */
export function clearRoster(): void {
  writeScoped(storage, KEY, JSON.stringify({}));
}
