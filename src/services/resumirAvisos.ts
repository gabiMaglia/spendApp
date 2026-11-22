import type { Notice } from './syncNotices';

/** Con más de esta cantidad en un mismo sync, sale un resumen en vez de una ráfaga. */
export const UMBRAL_RESUMEN = 2;

export type ResumenAvisos = {
  count: number;
  /** Grupos distintos; los avisos personales o de producto no suman. */
  groups: number;
  /** Sólo si todo lo que tiene grupo es del mismo. */
  groupName: string | null;
};

export function resumirAvisos(notices: Notice[]): ResumenAvisos {
  const porGrupo = new Map<string, string>();
  for (const n of notices) {
    if ('groupId' in n) porGrupo.set(n.groupId, n.groupName);
  }
  return {
    count: notices.length,
    groups: porGrupo.size,
    groupName: porGrupo.size === 1 ? [...porGrupo.values()][0] : null,
  };
}
