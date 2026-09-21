import { generateGroupKey } from '../envelopeCrypto';
import { deriveAvatarTopic } from '../avatarTopic';

describe('deriveAvatarTopic', () => {
  it('es determinística para la misma clave/usuario/digest', async () => {
    const key = generateGroupKey();
    const a = await deriveAvatarTopic(key, 'u1', 'digest1');
    const b = await deriveAvatarTopic(key, 'u1', 'digest1');
    expect(a).toBe(b);
  });

  it('cambia si cambia el digest (la foto)', async () => {
    const key = generateGroupKey();
    const a = await deriveAvatarTopic(key, 'u1', 'digest1');
    const b = await deriveAvatarTopic(key, 'u1', 'digest2');
    expect(a).not.toBe(b);
  });

  it('cambia si cambia el usuario', async () => {
    const key = generateGroupKey();
    const a = await deriveAvatarTopic(key, 'u1', 'digest1');
    const b = await deriveAvatarTopic(key, 'u2', 'digest1');
    expect(a).not.toBe(b);
  });
});
