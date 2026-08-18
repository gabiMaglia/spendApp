import { signEnvelope, verifyEnvelope } from '../envelopeSign';
import { generateIdentity } from '../groupInvite';
import { sealEnvelope, generateGroupKey, openEnvelope } from '../envelopeCrypto';

const SOBRE = 'c29icmUtc2VsbGFkbw==';

describe('firma de sobres', () => {
  it('ida y vuelta: se verifica y devuelve el sobre intacto', () => {
    const yo = generateIdentity();

    const abierto = verifyEnvelope(signEnvelope(SOBRE, yo.privateKey))!;

    expect(abierto.sealed).toBe(SOBRE);
    expect(abierto.senderKey).toBe(yo.publicKey);
  });

  // Es LA garantía: alguien que conoce el topic puede escribir, pero no puede
  // hacer pasar su basura por un sobre legítimo.
  it('un sobre alterado NO verifica', () => {
    const yo = generateIdentity();
    const firmado = JSON.parse(signEnvelope(SOBRE, yo.privateKey));
    firmado.p = 'b3RyYS1jb3Nh';

    expect(verifyEnvelope(JSON.stringify(firmado))).toBeNull();
  });

  it('una firma de otra clave NO verifica', () => {
    const yo = generateIdentity();
    const otro = generateIdentity();
    const firmado = JSON.parse(signEnvelope(SOBRE, yo.privateKey));
    firmado.k = otro.publicKey;

    expect(verifyEnvelope(JSON.stringify(firmado))).toBeNull();
  });

  // Aceptar los que no traen firma "por compatibilidad" dejaría abierta
  // exactamente la puerta que esto cierra.
  it('un sobre SIN firma se rechaza', () => {
    expect(verifyEnvelope(SOBRE)).toBeNull();
    expect(verifyEnvelope(JSON.stringify({ p: SOBRE }))).toBeNull();
  });

  it('basura y formatos desconocidos devuelven null en vez de tirar', () => {
    expect(verifyEnvelope('no soy json')).toBeNull();
    expect(verifyEnvelope(JSON.stringify({ v: 99, p: SOBRE, k: 'aa', s: 'bb' }))).toBeNull();
    expect(verifyEnvelope(JSON.stringify({ v: 1, p: SOBRE, k: 'zz', s: 'zz' }))).toBeNull();
  });

  // La firma autentica, NO protege: quien no tiene la clave del grupo sigue sin
  // poder leer nada aunque firme perfecto.
  it('firmar no revela el contenido', () => {
    const yo = generateIdentity();
    const clave = generateGroupKey();
    const sellado = sealEnvelope(clave, 'gasto secreto');

    const firmado = signEnvelope(sellado, yo.privateKey);

    expect(firmado).not.toContain('gasto secreto');
    expect(openEnvelope(generateGroupKey(), verifyEnvelope(firmado)!.sealed)).toBeNull();
  });
});
