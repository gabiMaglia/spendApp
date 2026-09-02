import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  estadoDelSaldado, requiereConfirmacion, pagosQueCuentan, saldadosPendientes,
} from '@/src/algorithms/settlementStatus';
import type { Group, Payment, SettlementConfirmation } from '@/src/types/models';

/** Ana le paga a Beto. Lo declara Ana, o sea el que PAGA. */
const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto',
  amount: 500_000, currency: 'ARS', date: 0, createdAt: 0,
  createdById: 'ana', updatedAt: 0, isDeleted: false, ...over,
} as Payment);

const grupo = (mode: 'consensus' | 'open' = 'consensus'): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
  deletionMode: mode, createdAt: 0, createdById: 'ana',
  deletionVotes: [], updatedAt: 0, isDeleted: false,
} as Group);

const acuse = (o: Partial<SettlementConfirmation> = {}): SettlementConfirmation => ({
  userId: 'beto', confirmedAt: 1_000, action: 'confirm', ...o,
});

describe('cuándo hace falta el acuse', () => {
  it('en un grupo abierto no hace falta: saldar nunca necesitó consenso', () => {
    expect(requiereConfirmacion(pago(), grupo('open'))).toBe(false);
    expect(estadoDelSaldado(pago(), grupo('open'))).toBe('efectivo');
  });

  // Un grupo sin `deletionMode` es anterior a T-053. No se le cambia la regla
  // por debajo: si nunca eligió consenso, no se le impone.
  it('un grupo sin modo declarado tampoco lo pide', () => {
    expect(requiereConfirmacion(pago(), { ...grupo(), deletionMode: undefined })).toBe(false);
  });

  it('sin grupo no se inventa una regla', () => {
    expect(requiereConfirmacion(pago(), undefined)).toBe(false);
  });

  // D3 del plan: es su propia declaración de haber recibido la plata.
  it('si lo declara el que COBRA, se efectiviza directo', () => {
    const p = pago({ createdById: 'beto' });
    expect(requiereConfirmacion(p, grupo())).toBe(false);
    expect(estadoDelSaldado(p, grupo())).toBe('efectivo');
  });
});

describe('el estado que se deriva de los acuses', () => {
  it('declarado por el que paga y sin acuse: pendiente', () => {
    expect(estadoDelSaldado(pago(), grupo())).toBe('pendiente');
    expect(estadoDelSaldado(pago({ confirmations: [] }), grupo())).toBe('pendiente');
  });

  it('con el acuse de quien cobra: efectivo', () => {
    expect(estadoDelSaldado(pago({ confirmations: [acuse()] }), grupo())).toBe('efectivo');
  });

  it('rechazado por quien cobra: rechazado', () => {
    const p = pago({ confirmations: [acuse({ action: 'reject' })] });
    expect(estadoDelSaldado(p, grupo())).toBe('rechazado');
  });

  // Un tercero no puede dar por recibida una plata que no recibió él. Sin esto,
  // cualquier miembro del grupo cierra una deuda ajena.
  it('el acuse de un tercero no vale', () => {
    const p = pago({ confirmations: [acuse({ userId: 'ana' }), acuse({ userId: 'caro' })] });
    expect(estadoDelSaldado(p, grupo())).toBe('pendiente');
  });

  // El orden del array es el resultado de una unión entre teléfonos y no
  // significa nada: manda `confirmedAt`.
  it('manda el acuse más nuevo, no el último del array', () => {
    const p = pago({ confirmations: [
      acuse({ action: 'reject', confirmedAt: 5_000 }),
      acuse({ action: 'confirm', confirmedAt: 1_000 }),
    ] });
    expect(estadoDelSaldado(p, grupo())).toBe('rechazado');
  });

  it('y también al revés: un confirm posterior levanta un rechazo', () => {
    const p = pago({ confirmations: [
      acuse({ action: 'reject', confirmedAt: 1_000 }),
      acuse({ action: 'confirm', confirmedAt: 5_000 }),
    ] });
    expect(estadoDelSaldado(p, grupo())).toBe('efectivo');
  });

  // Ante un empate conviene equivocarse hacia la deuda viva y no hacia una
  // plata dada por recibida: lo segundo hace perder plata de verdad.
  it('empatados en el tiempo, gana el rechazo', () => {
    const p = pago({ confirmations: [
      acuse({ action: 'confirm', confirmedAt: 1_000 }),
      acuse({ action: 'reject',  confirmedAt: 1_000 }),
    ] });
    expect(estadoDelSaldado(p, grupo())).toBe('rechazado');
  });
});

describe('qué cuenta para el balance', () => {
  // D1: mientras espera el acuse, quien ya transfirió la plata NO queda de
  // deudor. Es la mitad del pedido del PO; la otra mitad es que tampoco figure
  // como saldado, y eso lo resuelve la UI con `saldadosPendientes`.
  it('un saldado pendiente cuenta igual que uno efectivo', () => {
    expect(pagosQueCuentan([pago()], grupo())).toHaveLength(1);
  });

  it('un saldado rechazado NO cuenta: la deuda vuelve', () => {
    const p = pago({ confirmations: [acuse({ action: 'reject' })] });
    expect(pagosQueCuentan([p], grupo())).toHaveLength(0);
  });

  it('no se lleva pagos de otro grupo', () => {
    expect(pagosQueCuentan([pago({ id: 'p2', groupId: 'otro' })], grupo())).toHaveLength(0);
  });

  it('sin grupo no cuenta nada', () => {
    expect(pagosQueCuentan([pago()], undefined)).toHaveLength(0);
  });

  it('los pendientes se pueden listar aparte, y un borrado no está', () => {
    const vivos = saldadosPendientes([pago(), pago({ id: 'p2', isDeleted: true })], grupo());
    expect(vivos.map(p => p.id)).toEqual(['p1']);
  });
});

/**
 * **Guard de clase, no de estos casos.**
 *
 * Los seis lugares que calculaban balances repetían `payments.filter(p =>
 * p.groupId === g.id)` a mano. Esa forma —la misma lista mantenida en varios
 * lados— es la que produjo T-055, T-057 y T-060, tres veces el mismo bug. Un
 * `.filter` nuevo que se saltee `pagosQueCuentan` deja entrar al balance un
 * saldado que el cobrador rechazó: plata que nadie recibió, contada como
 * recibida.
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
    [join('src', 'sync', 'relaySync.ts')]:
      'el sobre lleva el ESTADO COMPLETO del grupo (regla #8 / ADR-007): un ' +
      'pago rechazado tiene que viajar igual, o el rechazo no llega nunca al ' +
      'otro lado y cada teléfono deriva un estado distinto',
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
