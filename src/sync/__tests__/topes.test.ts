import { readFileSync } from 'fs';
import { resolve } from 'path';
import { excesoDe, byteLengthUtf8, MAX_TEXTO_CORTO, MAX_NOTA, MAX_MIEMBROS, MAX_REGISTRO_BYTES } from '../topes';
import { MAX_SLICE_BYTES } from '../slices';

describe('byteLengthUtf8', () => {
  it('cuenta bytes reales, no unidades UTF-16', () => {
    expect(byteLengthUtf8('abc')).toBe(3);
    expect(byteLengthUtf8('ñ')).toBe(2);
    expect(byteLengthUtf8('😀')).toBe(4);
  });
});

describe('excesoDe — qué tope viola un registro', () => {
  it('un registro normal no viola nada', () => {
    expect(excesoDe({ id: 'e1', description: 'Cena', note: 'con propina', memberIds: ['a', 'b'] })).toBeNull();
  });
  it('description larga', () => {
    expect(excesoDe({ id: 'e1', description: 'x'.repeat(MAX_TEXTO_CORTO + 1) })).toBe('description');
  });
  it('name largo (grupos)', () => {
    expect(excesoDe({ id: 'g1', name: 'x'.repeat(MAX_TEXTO_CORTO + 1) })).toBe('name');
  });
  it('note larga', () => {
    expect(excesoDe({ id: 'e1', note: 'x'.repeat(MAX_NOTA + 1) })).toBe('note');
  });
  it('demasiados miembros', () => {
    expect(excesoDe({ id: 'g1', memberIds: Array.from({ length: MAX_MIEMBROS + 1 }, (_, i) => `u${i}`) })).toBe('memberIds');
  });
  it('un registro que pesa más que el tope duro, aunque cada campo sea razonable', () => {
    const splits = Array.from({ length: 6_000 }, (_, i) => ({ userId: `usuario-${i}`, amount: 1, isPaid: false }));
    expect(excesoDe({ id: 'e1', description: 'Cena', splits })).toBe('bytes');
  });
  it('campos ausentes o de otro tipo no cuentan como exceso', () => {
    expect(excesoDe({ id: 'e1', description: 123, memberIds: 'no-es-array' })).toBeNull();
  });
  it('el tope duro es el mismo que el de las rebanadas', () => {
    expect(MAX_REGISTRO_BYTES).toBe(MAX_SLICE_BYTES);
  });
});

describe('guard: los inputs de texto libre tienen maxLength', () => {
  it.each([
    ['app/expense/new.tsx', /onChangeText=\{setDescription\}[\s\S]{0,400}?maxLength=\{MAX_TEXTO_CORTO\}/],
    ['app/expense/new.tsx', /onChangeText=\{setNote\}[\s\S]{0,400}?maxLength=\{MAX_NOTA\}/],
    ['app/groups/new.tsx',  /onChangeText=\{setName\}[\s\S]{0,400}?maxLength=\{MAX_TEXTO_CORTO\}/],
  ])('%s', (archivo, patron) => {
    const texto = readFileSync(resolve(__dirname, '../../..', archivo), 'utf8');
    expect(texto).toMatch(patron);
  });
});
