import {
  BUCKET_OFERTAS, MAX_CLAVES_DISTINTAS_POR_GRUPO, MAX_REMITENTES_POR_GRUPO,
  aplicarOferta, claveLocalVinoDeContacto, conflictoForzado,
  esOfertaDeInvitacion, estado, estadoDe, idDeOfertaDeInvitacion, marcarAdoptada,
  ofertasDe, olvidarOfertas, registrarOferta, type KeyOffer,
} from '../groupKeyOffers';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage, SECURE_IDS } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

/**
 * T-136 · ADR-013. Las ofertas son lo que reemplaza al «primero en llegar gana»
 * de `adoptDroppedKey`: una por (grupo, remitente), y la clave sólo se adopta
 * sola si todas coinciden.
 */

const K1 = 'a1'.repeat(32);
const K2 = 'b2'.repeat(32);

const oferta = (fromUserId: string, key = K1, over: Partial<KeyOffer> = {}): KeyOffer => ({
  groupId: 'g1', fromUserId, key, epoch: 1, origen: 'contact', receivedAt: 0, adoptada: false, ...over,
});

beforeEach(() => {
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: { id: 'ana' } as User });
  useGroupKeyStore.setState({ keys: [] });
});

/**
 * Fix round 1 (ruling del controller): `aplicarOferta` deja de devolver
 * `KeyOffer[] | null` y pasa a devolver `{ lista, forzarConflicto }`. Es un
 * cambio de spec, no un debilitamiento — lo pide el ticket de seguridad: con
 * el tope viejo de 5 REMITENTES por grupo, un atacante que conoce el secreto
 * de contacto de la víctima podía pinnear 5 peers falsos con la MISMA clave
 * inventada, llenar el tope, y la oferta real del sexto remitente se ignoraba
 * en silencio — ni oferta, ni conflicto, ni aviso — mientras la falsa se
 * adoptaba como unánime. Los tests de acá abajo que antes afirmaban ESE tope
 * por remitente se reescriben para afirmar el tope nuevo: por CLAVES
 * DISTINTAS (`MAX_CLAVES_DISTINTAS_POR_GRUPO = 5`), con el de remitentes
 * (`MAX_REMITENTES_POR_GRUPO = 50`) como cota de almacenamiento nada más.
 */
describe('aplicarOferta (pura)', () => {
  it('una oferta nueva se agrega', () => {
    expect(aplicarOferta([], oferta('beto'))).toEqual({ lista: [oferta('beto')], forzarConflicto: false });
  });

  it('la misma clave del mismo remitente es no-op (el reenvío de cada arranque)', () => {
    expect(aplicarOferta([oferta('beto')], oferta('beto'))).toEqual({ lista: null, forzarConflicto: false });
  });

  it('la misma clave en mayúsculas es la misma clave', () => {
    expect(aplicarOferta([oferta('beto')], oferta('beto', K1.toUpperCase())))
      .toEqual({ lista: null, forzarConflicto: false });
  });

  it('otra clave del mismo remitente reemplaza SÓLO su oferta', () => {
    const r = aplicarOferta([oferta('beto'), oferta('carla')], oferta('beto', K2)).lista!;
    expect(r).toHaveLength(2);
    expect(r.find(o => o.fromUserId === 'beto')!.key).toBe(K2);
    expect(r.find(o => o.fromUserId === 'carla')!.key).toBe(K1);
  });

  // Desvío 1 del plan: reemplazar una oferta adoptada borraría la prueba de que
  // la clave local vino de contacto y dejaría un conflicto sin salida.
  it('una oferta ya adoptada no se reemplaza', () => {
    expect(aplicarOferta([oferta('beto', K1, { adoptada: true })], oferta('beto', K2)))
      .toEqual({ lista: null, forzarConflicto: false });
  });

  it('el tope es por grupo, no global (claves distintas de OTRO grupo no cuentan)', () => {
    const cinco = ['a', 'b', 'c', 'd', 'e'].map(id => oferta(id, K1));
    // K2 en g2 es una clave nueva ahí, y g2 no tiene ninguna todavía: entra.
    const r = aplicarOferta(cinco, oferta('f', K2, { groupId: 'g2' }));
    expect(r).toEqual({ lista: [...cinco, oferta('f', K2, { groupId: 'g2' })], forzarConflicto: false });
  });

  it('5 remitentes con la MISMA clave + un 6to remitente con esa misma clave → se agrega, sigue unánime', () => {
    expect(MAX_REMITENTES_POR_GRUPO).toBe(50);
    const cinco = ['a', 'b', 'c', 'd', 'e'].map(id => oferta(id, K1));
    const r = aplicarOferta(cinco, oferta('f', K1));
    expect(r.forzarConflicto).toBe(false);
    expect(r.lista).toHaveLength(6);
    expect(estadoDe(r.lista!)).toBe('unanime');
  });

  it(`5 claves DISTINTAS (tope ${MAX_CLAVES_DISTINTAS_POR_GRUPO}) + una 6ta distinta → NO se guarda, pero fuerza conflicto`, () => {
    expect(MAX_CLAVES_DISTINTAS_POR_GRUPO).toBe(5);
    const cincoDistintas = ['a', 'b', 'c', 'd', 'e'].map((id, i) => oferta(id, `${i}${i}`.repeat(32)));
    const r = aplicarOferta(cincoDistintas, oferta('f', K2));
    expect(r).toEqual({ lista: null, forzarConflicto: true });
  });

  it('con el tope de claves lleno, un remitente que ya estaba puede reemplazar su oferta con una clave YA presente', () => {
    const cincoDistintas = ['a', 'b', 'c', 'd', 'e'].map((id, i) => oferta(id, `${i}${i}`.repeat(32)));
    // "a" cambia a la clave de "b": sigue habiendo 5 claves distintas en total, no 6.
    const claveDeB = cincoDistintas[1]!.key;
    const r = aplicarOferta(cincoDistintas, oferta('a', claveDeB));
    expect(r.forzarConflicto).toBe(false);
    expect(r.lista).toHaveLength(5);
  });

  it(`tope de ${MAX_REMITENTES_POR_GRUPO} remitentes: el ${MAX_REMITENTES_POR_GRUPO + 1}° con una clave YA presente no se guarda pero no fuerza conflicto`, () => {
    const cincuenta = Array.from({ length: MAX_REMITENTES_POR_GRUPO }, (_, i) => oferta(`u${i}`, K1));
    const r = aplicarOferta(cincuenta, oferta('extra', K1));
    expect(r).toEqual({ lista: null, forzarConflicto: false });
  });

  it(`tope de ${MAX_REMITENTES_POR_GRUPO} remitentes: el ${MAX_REMITENTES_POR_GRUPO + 1}° con una clave DISTINTA no se guarda pero fuerza conflicto`, () => {
    // Los 50 comparten K1: sólo 1 clave distinta, muy por debajo del tope de
    // claves. Igual el remitente 51 con K2 no entra — es el tope de
    // ALMACENAMIENTO, no el de claves, el que lo bloquea acá — pero la
    // disidencia no se puede perder.
    const cincuenta = Array.from({ length: MAX_REMITENTES_POR_GRUPO }, (_, i) => oferta(`u${i}`, K1));
    const r = aplicarOferta(cincuenta, oferta('extra', K2));
    expect(r).toEqual({ lista: null, forzarConflicto: true });
  });
});

describe('estadoDe (pura)', () => {
  it('sin ofertas es sin_ofertas, haya o no clave local', () => {
    expect(estadoDe([])).toBe('sin_ofertas');
    expect(estadoDe([], K1)).toBe('sin_ofertas');
  });

  it('dos remitentes con la misma clave son unánimes', () => {
    expect(estadoDe([oferta('beto'), oferta('carla')])).toBe('unanime');
  });

  it('dos claves distintas son conflicto', () => {
    expect(estadoDe([oferta('beto'), oferta('mallory', K2)])).toBe('conflicto');
  });

  it('una oferta distinta de la clave local es conflicto; igual, unánime', () => {
    expect(estadoDe([oferta('beto', K2)], K1)).toBe('conflicto');
    expect(estadoDe([oferta('beto')], K1.toUpperCase())).toBe('unanime');
  });
});

describe('store de ofertas', () => {
  it('registrar devuelve true la primera vez y false al repetir', () => {
    expect(registrarOferta(oferta('beto'))).toBe(true);
    expect(registrarOferta(oferta('beto'))).toBe(false);
    expect(ofertasDe('g1')).toHaveLength(1);
  });

  it('estado mira todas las ofertas del grupo', () => {
    registrarOferta(oferta('beto'));
    expect(estado('g1')).toBe('unanime');
    registrarOferta(oferta('mallory', K2));
    expect(estado('g1')).toBe('conflicto');
    expect(estado('otro')).toBe('sin_ofertas');
  });

  it('vive en un bucket CIFRADO (guarda claves)', () => {
    expect(SECURE_IDS).toContain(BUCKET_OFERTAS);
  });

  it('está scopeado por cuenta: otra cuenta no ve las ofertas', () => {
    registrarOferta(oferta('beto'));
    useAuthStore.setState({ currentUser: { id: 'otra' } as User });
    expect(ofertasDe('g1')).toEqual([]);
  });

  it('un dato corrupto se degrada a «sin ofertas»', () => {
    createSecureStorage('groupkeys').set('key_offers_v1::u:ana', '{no es json');
    expect(ofertasDe('g1')).toEqual([]);
  });

  it('olvidarOfertas borra sólo las del grupo', () => {
    registrarOferta(oferta('beto'));
    registrarOferta(oferta('beto', K1, { groupId: 'g2' }));
    olvidarOfertas('g1');
    expect(ofertasDe('g1')).toEqual([]);
    expect(ofertasDe('g2')).toHaveLength(1);
  });

  it('registrarOferta devuelve true cuando fuerza conflicto, aunque no cambie la tabla', () => {
    for (let i = 0; i < MAX_CLAVES_DISTINTAS_POR_GRUPO; i++) {
      registrarOferta(oferta(`u${i}`, `${i}${i}`.repeat(32)));
    }
    expect(estado('g1')).toBe('conflicto'); // 5 claves distintas entre sí, ya es conflicto por la tabla

    expect(registrarOferta(oferta('extra', K2))).toBe(true); // no entra a la tabla...
    expect(ofertasDe('g1')).toHaveLength(MAX_CLAVES_DISTINTAS_POR_GRUPO); // ...no creció...
    expect(conflictoForzado('g1')).toBe(true); // ...pero quedó marcado.
  });

  it('conflictoForzado hace que estado() sea conflicto aunque la tabla sola diría otra cosa', () => {
    // Ana llena el tope de REMITENTES (no el de claves) con la misma clave:
    // la tabla sola diría "unánime".
    for (let i = 0; i < MAX_REMITENTES_POR_GRUPO; i++) registrarOferta(oferta(`u${i}`, K1));
    expect(estadoDe(ofertasDe('g1'))).toBe('unanime');

    // Un remitente 51 con una clave distinta no entra por el tope de
    // almacenamiento, pero fuerza conflicto: estado() tiene que reflejarlo.
    registrarOferta(oferta('extra', K2));
    expect(estado('g1')).toBe('conflicto');
  });

  it('olvidarOfertas limpia también el conflicto forzado', () => {
    for (let i = 0; i < MAX_REMITENTES_POR_GRUPO; i++) registrarOferta(oferta(`u${i}`, K1));
    registrarOferta(oferta('extra', K2));
    expect(conflictoForzado('g1')).toBe(true);

    olvidarOfertas('g1');

    expect(conflictoForzado('g1')).toBe(false);
    expect(estado('g1')).toBe('sin_ofertas');
  });
});

describe('claveLocalVinoDeContacto', () => {
  it('sin clave local es false', () => {
    registrarOferta(oferta('beto'));
    marcarAdoptada('g1', 'beto');
    expect(claveLocalVinoDeContacto('g1')).toBe(false);
  });

  it('es true sólo con una oferta ADOPTADA cuya clave es la local', () => {
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: K1, epoch: 1 }] });
    registrarOferta(oferta('beto'));
    expect(claveLocalVinoDeContacto('g1')).toBe(false);
    marcarAdoptada('g1', 'beto');
    expect(claveLocalVinoDeContacto('g1')).toBe(true);
  });

  it('una oferta adoptada con OTRA clave no cuenta (la local vino de ensureKey/QR/invitación)', () => {
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: K2, epoch: 1 }] });
    registrarOferta(oferta('beto'));
    marcarAdoptada('g1', 'beto');
    expect(claveLocalVinoDeContacto('g1')).toBe(false);
  });
});

describe('remitente de una oferta de invitación', () => {
  it('se identifica por la huella de quien invita, con prefijo propio', () => {
    const id = idDeOfertaDeInvitacion('fp123');
    expect(id).toBe('invite:fp123');
    expect(esOfertaDeInvitacion(id)).toBe(true);
    expect(esOfertaDeInvitacion('u-beto')).toBe(false);
  });
});
