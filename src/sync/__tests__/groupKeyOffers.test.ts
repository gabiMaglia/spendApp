import {
  BUCKET_OFERTAS, MAX_OFERTAS_POR_GRUPO, aplicarOferta, claveLocalVinoDeContacto,
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

describe('aplicarOferta (pura)', () => {
  it('una oferta nueva se agrega', () => {
    expect(aplicarOferta([], oferta('beto'))).toEqual([oferta('beto')]);
  });

  it('la misma clave del mismo remitente es no-op (el reenvío de cada arranque)', () => {
    expect(aplicarOferta([oferta('beto')], oferta('beto'))).toBeNull();
  });

  it('la misma clave en mayúsculas es la misma clave', () => {
    expect(aplicarOferta([oferta('beto')], oferta('beto', K1.toUpperCase()))).toBeNull();
  });

  it('otra clave del mismo remitente reemplaza SÓLO su oferta', () => {
    const r = aplicarOferta([oferta('beto'), oferta('carla')], oferta('beto', K2))!;
    expect(r).toHaveLength(2);
    expect(r.find(o => o.fromUserId === 'beto')!.key).toBe(K2);
    expect(r.find(o => o.fromUserId === 'carla')!.key).toBe(K1);
  });

  // Desvío 1 del plan: reemplazar una oferta adoptada borraría la prueba de que
  // la clave local vino de contacto y dejaría un conflicto sin salida.
  it('una oferta ya adoptada no se reemplaza', () => {
    expect(aplicarOferta([oferta('beto', K1, { adoptada: true })], oferta('beto', K2))).toBeNull();
  });

  it(`el tope es ${MAX_OFERTAS_POR_GRUPO} remitentes por grupo: el sexto se ignora`, () => {
    expect(MAX_OFERTAS_POR_GRUPO).toBe(5);
    const cinco = ['a', 'b', 'c', 'd', 'e'].map(id => oferta(id));
    expect(aplicarOferta(cinco, oferta('f', K2))).toBeNull();
  });

  it('con el tope lleno, un remitente que ya estaba puede reemplazar su oferta', () => {
    const cinco = ['a', 'b', 'c', 'd', 'e'].map(id => oferta(id));
    expect(aplicarOferta(cinco, oferta('a', K2))).toHaveLength(5);
  });

  it('el tope es por grupo, no global', () => {
    const cinco = ['a', 'b', 'c', 'd', 'e'].map(id => oferta(id));
    expect(aplicarOferta(cinco, oferta('f', K2, { groupId: 'g2' }))).toHaveLength(6);
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
