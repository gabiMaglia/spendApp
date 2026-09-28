import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { pagosQueCuentan } from '@/src/algorithms/settlementStatus';
import type { Group, Payment } from '@/src/types/models';

/** Ana le paga a Beto. Lo declara Ana, o sea el que PAGA. */
const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto',
  amount: 500_000, currency: 'ARS', date: 0, createdAt: 0,
  createdById: 'ana', updatedAt: 0, isDeleted: false, ...over,
} as Payment);

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
  miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
  createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false, ...over,
} as Group);

describe('qué cuenta para el balance (T-186: sin acuse)', () => {
  it('un saldado declarado cuenta al instante', () => {
    expect(pagosQueCuentan([pago()], grupo())).toHaveLength(1);
  });

  it('un saldado borrado no cuenta', () => {
    expect(pagosQueCuentan([pago({ isDeleted: true })], grupo())).toHaveLength(0);
  });

  it('no se lleva pagos de otro grupo', () => {
    expect(pagosQueCuentan([pago({ id: 'p2', groupId: 'otro' })], grupo())).toHaveLength(0);
  });

  it('sin grupo no cuenta nada', () => {
    expect(pagosQueCuentan([pago()], undefined)).toHaveLength(0);
  });
});

/**
 * **Guard de clase, no de estos casos.**
 *
 * Los seis lugares que calculaban balances repetían `payments.filter(p =>
 * p.groupId === g.id)` a mano. Esa forma —la misma lista mantenida en varios
 * lados— es la que produjo T-055, T-057 y T-060, tres veces el mismo bug. Un
 * `.filter` nuevo que se saltee `pagosQueCuentan` vuelve a abrir la puerta.
 */
describe('nadie vuelve a filtrar los pagos a mano', () => {
  const RAIZ = join(__dirname, '..', '..', '..');

  /**
   * Los únicos lugares donde filtrar pagos por grupo a mano es correcto, **con
   * el motivo escrito**. Agregar una entrada acá es una decisión consciente:
   * quien la agregue tiene que poder explicar por qué ese filtro no alimenta un
   * balance. Todo lo demás va por `pagosQueCuentan`.
   */
  const PERMITIDOS: Record<string, string> = {
    [join('src', 'algorithms', 'settlementStatus.ts')]:
      'es la fuente única',
    [join('src', 'sync', 'relay', 'adaptadorHushSplit.ts')]:
      // T-191 (Task 0): este filtro vivía en relaySync.ts#buildGroupPayload y
      // se movió acá (adaptador.armar) al dibujar la frontera núcleo/HushSplit
      // — mismo código, mismo motivo, otro archivo.
      'el sobre lleva el ESTADO COMPLETO del grupo (regla #8 / ADR-007): un ' +
      'pago borrado tiene que viajar igual, o el tombstone no llega nunca al ' +
      'otro lado y cada teléfono deriva un estado distinto',
    [join('src', 'sync', 'acotarDeltaAlGrupo.ts')]:
      'mismo motivo que relaySync.ts, del lado receptor (T-132/S3-A1): recorta ' +
      'el delta del RELAY a lo que pertenece a `groupId` (aislamiento entre ' +
      'grupos), no a lo que cuenta para el balance — un pago borrado tiene ' +
      'que seguir aplicándose vía LWW o el tombstone nunca llega al otro lado',
  };

  function archivos(dir: string, out: string[] = []): string[] {
    for (const nombre of readdirSync(dir)) {
      if (nombre === 'node_modules' || nombre === '__tests__' || nombre.startsWith('.')) continue;
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) archivos(ruta, out);
      else if (/\.tsx?$/.test(nombre)) out.push(ruta);
    }
    return out;
  }

  it('el filtro por groupId sobre pagos vive en un solo archivo', () => {
    const culpables: string[] = [];
    for (const ruta of [...archivos(join(RAIZ, 'src')), ...archivos(join(RAIZ, 'app'))]) {
      if (Object.keys(PERMITIDOS).some(ok => ruta.endsWith(ok))) continue;
      readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
        if (/\bpayments?\b[\w.]*\.filter\(/.test(linea) && /\.groupId\s*===/.test(linea)) {
          culpables.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1}`);
        }
      });
    }
    expect(culpables).toEqual([]);
  });
});
