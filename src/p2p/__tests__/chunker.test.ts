import { toFrames, Reassembler } from '../chunker';

describe('chunker', () => {
  it('un payload chico entra en un solo frame y roundtrip', () => {
    const frames = toFrames('hola', 'm1');
    expect(frames).toHaveLength(1);
    const r = new Reassembler();
    expect(r.push(frames[0])).toBe('hola');
  });

  it('parte un payload grande y lo reensambla idéntico', () => {
    const payload = 'x'.repeat(50 * 1024) + '|con|pipes|y|{"json":true}';
    const frames = toFrames(payload, 'm1', 1024);
    expect(frames.length).toBeGreaterThan(1);

    const r = new Reassembler();
    let out: string | null = null;
    for (const f of frames) out = r.push(f) ?? out;
    expect(out).toBe(payload);
  });

  it('reensambla aunque los frames lleguen desordenados', () => {
    const payload = 'abcdefghij'.repeat(500);
    const frames = toFrames(payload, 'm1', 100);
    const shuffled = [...frames].reverse();

    const r = new Reassembler();
    let out: string | null = null;
    for (const f of shuffled) out = r.push(f) ?? out;
    expect(out).toBe(payload);
  });

  it('maneja dos mensajes concurrentes (distinto msgId) sin mezclarlos', () => {
    const a = toFrames('AAAA', 'ma', 2); // 2 frames
    const b = toFrames('BBBB', 'mb', 2);
    const r = new Reassembler();
    // intercalados
    expect(r.push(a[0])).toBeNull();
    expect(r.push(b[0])).toBeNull();
    expect(r.push(b[1])).toBe('BBBB');
    expect(r.push(a[1])).toBe('AAAA');
  });

  it('data que contiene el separador "|" se preserva', () => {
    const payload = 'a|b|c|d|e';
    const r = new Reassembler();
    expect(r.push(toFrames(payload, 'm1')[0])).toBe(payload);
  });

  it('ignora frames malformados (devuelve null)', () => {
    const r = new Reassembler();
    expect(r.push('basura-sin-separadores')).toBeNull();
    expect(r.push('m1|x|2|data')).toBeNull();      // índice no numérico
    expect(r.push('m1|5|2|data')).toBeNull();      // i >= n
  });

  it('un chunk duplicado no rompe el conteo', () => {
    const frames = toFrames('HELLO', 'm1', 2); // ['m1|0|3|HE','m1|1|3|LL','m1|2|3|O']
    const r = new Reassembler();
    r.push(frames[0]);
    r.push(frames[0]); // duplicado
    r.push(frames[1]);
    expect(r.push(frames[2])).toBe('HELLO');
  });
});
