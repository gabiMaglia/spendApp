import {
  generateGroupKey, sealEnvelope, openEnvelope, deriveTopic, toHex, fromHex,
} from '../envelopeCrypto';

describe('sobre cifrado — ida y vuelta', () => {
  it('lo que se cierra se abre igual', () => {
    const key = generateGroupKey();
    const texto = '{"expenses":[{"id":"e1","amount":12550}]}';
    expect(openEnvelope(key, sealEnvelope(key, texto))).toBe(texto);
  });

  it('sobrevive acentos, ñ y emoji', () => {
    const key = generateGroupKey();
    const texto = 'Cena en el Bodegón 🍕 con María — 1.250,50 ARS';
    expect(openEnvelope(key, sealEnvelope(key, texto))).toBe(texto);
  });

  it('el string vacío también', () => {
    const key = generateGroupKey();
    expect(openEnvelope(key, sealEnvelope(key, ''))).toBe('');
  });

  it('aguanta un payload grande', () => {
    const key = generateGroupKey();
    const grande = JSON.stringify({ data: 'x'.repeat(50_000) });
    expect(openEnvelope(key, sealEnvelope(key, grande))).toBe(grande);
  });
});

describe('el servidor no puede leer nada', () => {
  it('el ciphertext no contiene el texto plano', () => {
    const key = generateGroupKey();
    const sobre = sealEnvelope(key, 'Alquiler 50000 pagado por Gabriel');

    expect(sobre).not.toContain('Alquiler');
    expect(sobre).not.toContain('Gabriel');
    expect(sobre).not.toContain('50000');
  });

  // Nonce aleatorio de 24 bytes: cifrar dos veces lo mismo NO da lo mismo, así
  // que el servidor tampoco puede deducir "este sobre repite al anterior".
  it('cifrar dos veces el mismo texto da sobres distintos', () => {
    const key = generateGroupKey();
    const a = sealEnvelope(key, 'mismo texto');
    const b = sealEnvelope(key, 'mismo texto');

    expect(a).not.toBe(b);
    expect(openEnvelope(key, a)).toBe(openEnvelope(key, b));
  });
});

describe('sobres que NO se deben poder abrir', () => {
  it('con otra clave devuelve null, no basura', () => {
    const sobre = sealEnvelope(generateGroupKey(), 'secreto');
    expect(openEnvelope(generateGroupKey(), sobre)).toBeNull();
  });

  // AEAD: alterar un bit hace fallar el descifrado en vez de devolver algo raro.
  // Es lo que permite detectar un sobre inyectado en un topic conocido.
  it('un sobre alterado devuelve null', () => {
    const key = generateGroupKey();
    const sobre = sealEnvelope(key, 'no me toques');
    const alterado = sobre.slice(0, -4) + (sobre.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');

    expect(openEnvelope(key, alterado)).toBeNull();
  });

  it('basura inyectada en el topic devuelve null en vez de tirar', () => {
    const key = generateGroupKey();
    expect(() => openEnvelope(key, 'esto no es un sobre')).not.toThrow();
    expect(openEnvelope(key, 'esto no es un sobre')).toBeNull();
  });

  it('un sobre truncado devuelve null', () => {
    const key = generateGroupKey();
    expect(openEnvelope(key, sealEnvelope(key, 'hola').slice(0, 10))).toBeNull();
  });

  it('una clave de largo inválido no pasa desapercibida', () => {
    expect(() => sealEnvelope(new Uint8Array(16), 'x')).toThrow();
  });
});

describe('deriveTopic', () => {
  it('es determinista: misma clave y época, mismo topic', async () => {
    const key = generateGroupKey();
    expect(await deriveTopic(key, 1)).toBe(await deriveTopic(key, 1));
  });

  // Al rotar la época el topic cambia, así que el que salió del grupo ni
  // siquiera puede derivar dónde está el canal nuevo.
  it('otra época da otro topic', async () => {
    const key = generateGroupKey();
    expect(await deriveTopic(key, 2)).not.toBe(await deriveTopic(key, 1));
  });

  it('otra clave da otro topic', async () => {
    expect(await deriveTopic(generateGroupKey(), 1))
      .not.toBe(await deriveTopic(generateGroupKey(), 1));
  });
});

describe('hex', () => {
  it('ida y vuelta sin pérdida', () => {
    const bytes = generateGroupKey();
    expect(Array.from(fromHex(toHex(bytes)))).toEqual(Array.from(bytes));
  });
});
