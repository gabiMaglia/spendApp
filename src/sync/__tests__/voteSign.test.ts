import { ed25519, ED25519_TORSION_SUBGROUP } from '@noble/curves/ed25519.js';
import { signVote, verifyVote } from '../voteSign';
import { canonicalVote, voteStatement, roundIdFor } from '../voteCore';
import { toHex, fromHex, utf8Bytes } from '../hexBytes';
import type { DeletionVote } from '@/src/types/models';

/**
 * **Un voto firmado, y por qué UNO POR UNO** (T-041 · S8, §5 del plan).
 *
 * El array de votos no se firma: es una unión de aportes de gente distinta, y
 * una firma sobre un conjunto que crece se invalida cada vez que crece — el
 * primer voto de un tercero dejaría al autor marcado como falso. Se firma cada
 * **enunciado** por separado, y la propiedad que eso compra —romper un voto no
 * toca los demás— es el test central de este archivo.
 */

function par(seed: number) {
  const priv = new Uint8Array(32).fill(seed);
  return { priv: toHex(priv), pub: toHex(ed25519.getPublicKey(priv)) };
}

const BETO = par(11);
const CARO = par(12);
const IMPOSTOR = par(13);

const GASTO = 'e-1';
const RONDA = roundIdFor(GASTO, 'beto', 1_000);

const firmado = (vote: DeletionVote, priv: string): DeletionVote =>
  ({ ...vote, ...signVote(GASTO, vote, priv) });

const pedido: DeletionVote = {
  userId: 'beto', votedAt: 1_000, action: 'delete', roundId: RONDA, forced: true,
};
const objecion: DeletionVote = {
  userId: 'caro', votedAt: 2_000, action: 'cancel', roundId: RONDA,
};
const restauracion: DeletionVote = {
  userId: 'caro', votedAt: 3_000, action: 'cancel', intent: 'restore', roundId: RONDA,
};

describe('un voto firmado por su autor verifica', () => {
  it.each([
    ['pedido', pedido],
    ['objeción', objecion],
    ['restauración', restauracion],
  ])('%s', (_n, voto) => {
    const v = firmado(voto, voto.userId === 'beto' ? BETO.priv : CARO.priv);
    expect(verifyVote(GASTO, v, [voto.userId === 'beto' ? BETO.pub : CARO.pub])).toBe('valida');
  });
});

/**
 * Cada campo del enunciado, roto por separado. Los dos que más importan:
 * `roundId` —sacar un voto de su ronda para revivir una vieja— y `expenseId`,
 * que ni siquiera vive en el voto: sin él, una objeción valdría para cualquier
 * gasto.
 */
describe('romper cualquier campo del enunciado invalida ESE voto', () => {
  const base = firmado(pedido, BETO.priv);

  const mutaciones: [string, DeletionVote][] = [
    ['userId',  { ...base, userId: 'caro' }],
    ['votedAt', { ...base, votedAt: 1_001 }],
    ['action',  { ...base, action: 'cancel' }],
    ['intent',  { ...base, intent: 'restore' }],
    ['forced',  { ...base, forced: undefined }],
    ['roundId', { ...base, roundId: roundIdFor(GASTO, 'beto', 9_999) }],
    ['roundId ausente', { ...base, roundId: undefined }],
  ];

  it.each(mutaciones)('%s', (_campo, mutado) => {
    expect(verifyVote(GASTO, mutado, [BETO.pub])).toBe('invalida');
  });

  it('expenseId (no viaja en el voto, y sin él la firma valdría para cualquier gasto)', () => {
    expect(verifyVote('e-otro', base, [BETO.pub])).toBe('invalida');
  });

  it('y el voto intacto sigue válido: la mutación probó algo', () => {
    expect(verifyVote(GASTO, base, [BETO.pub])).toBe('valida');
  });
});

/**
 * **La razón de firmar uno por uno.** Si la firma cubriera el conjunto, tocar
 * un voto invalidaría el de todos los demás, y el que rompe elegiría a quién
 * ensuciar.
 */
describe('romper un voto no invalida los de los demás', () => {
  it('el conjunto sobrevive a un voto adulterado', () => {
    const conjunto = [
      { ...firmado(pedido, BETO.priv), votedAt: 1_001 },  // adulterado
      firmado(objecion, CARO.priv),
      firmado(restauracion, CARO.priv),
    ];
    const claves = [BETO.pub, CARO.pub];

    expect(conjunto.map(v => verifyVote(GASTO, v, claves)))
      .toEqual(['invalida', 'valida', 'valida']);
  });

  it('agregar un voto nuevo no toca la firma de los que ya estaban', () => {
    const antes = firmado(objecion, CARO.priv);
    const conjunto = [antes, firmado(pedido, BETO.priv)];

    expect(verifyVote(GASTO, conjunto[0]!, [CARO.pub])).toBe('valida');
  });
});

describe('lo que no se puede saber no se acusa', () => {
  it('un voto sin firma —un peer viejo, o lo anterior a S8— es `no_verificable`', () => {
    expect(verifyVote(GASTO, { userId: 'beto', votedAt: 1, action: 'cancel' }, [BETO.pub]))
      .toBe('no_verificable');
  });

  it('sin ninguna clave del autor tampoco se acusa', () => {
    expect(verifyVote(GASTO, firmado(pedido, BETO.priv), [])).toBe('no_verificable');
  });

  it('una firma que no cierra por hex roto es `invalida`, no una excepción', () => {
    const roto = { ...firmado(pedido, BETO.priv), s: 'zz' };
    expect(verifyVote(GASTO, roto, [BETO.pub])).toBe('invalida');
  });
});

describe('firmar el voto de otro es suplantar, y se ve', () => {
  it('la pública del impostor no es la del autor declarado', () => {
    const falso = firmado(pedido, IMPOSTOR.priv);
    expect(verifyVote(GASTO, falso, [BETO.pub])).toBe('invalida');
  });
});

/**
 * `zip215: false`, igual que `verifyCore`. Con el modo permisivo una pública de
 * orden chico y `s = 0` valen para CUALQUIER mensaje: un solo voto valdría como
 * objeción y como pedido a la vez.
 */
describe('el modo estricto de la curva está aplicado de verdad', () => {
  const A = ED25519_TORSION_SUBGROUP[1]!;
  const sigTorsion = A + '00'.repeat(32);

  it('el vector de torsión pasa en modo permisivo (si no, el test no prueba nada)', () => {
    const msg = utf8Bytes(canonicalVote(GASTO, pedido));
    expect(ed25519.verify(fromHex(sigTorsion), msg, fromHex(A), { zip215: true })).toBe(true);
  });

  it('`verifyVote` lo rechaza', () => {
    expect(verifyVote(GASTO, { ...pedido, k: A, s: sigTorsion }, [A])).toBe('invalida');
  });
});

describe('el enunciado', () => {
  it('lleva versión y tipo: un voto no puede leerse como el núcleo de otra cosa', () => {
    expect(voteStatement(GASTO, pedido)).toMatchObject({ v: 1, t: 'vote' });
  });

  it('un campo ausente no se inventa', () => {
    expect(canonicalVote(GASTO, objecion)).not.toContain('forced');
    expect(canonicalVote(GASTO, objecion)).not.toContain('intent');
  });

  it('el `roundId` es determinista y distinto por persona y por momento', () => {
    expect(roundIdFor(GASTO, 'beto', 1_000)).toBe(roundIdFor(GASTO, 'beto', 1_000));
    expect(roundIdFor(GASTO, 'beto', 1_000)).not.toBe(roundIdFor(GASTO, 'caro', 1_000));
    expect(roundIdFor(GASTO, 'beto', 1_000)).not.toBe(roundIdFor(GASTO, 'beto', 1_001));
    expect(roundIdFor(GASTO, 'beto', 1_000)).not.toBe(roundIdFor('e-2', 'beto', 1_000));
  });
});
