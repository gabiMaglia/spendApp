import { envelopeRow } from '../relay';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

/**
 * T-032. La marca le dice al servidor que puede borrar los sobres anteriores
 * del mismo remitente en el mismo topic.
 *
 * El default tiene que ser **false**. Sólo los sobres de grupo llevan estado
 * completo; los de contacto e invitación llevan mensajes distintos por el mismo
 * canal —una tarjeta y una entrega de clave— y compactarlos borraría el que el
 * otro todavía no leyó. Que el default sea el seguro es lo que hace que agregar
 * un canal nuevo mañana no pierda datos por olvido.
 */
describe('marca de compactación', () => {
  it('POR DEFECTO un sobre NO es compactable', () => {
    expect(envelopeRow('t', 'x', 'dev1')).toMatchObject({ compactable: false });
  });

  it('se puede marcar explícitamente', () => {
    expect(envelopeRow('t', 'x', 'dev1', true)).toMatchObject({ compactable: true });
  });

  it('la marca viaja junto al sobre, no aparte', () => {
    expect(envelopeRow('topic-1', 'payload', 'dev1', true)).toEqual({
      topic: 'topic-1', payload: 'payload', sender: 'dev1', compactable: true,
    });
  });
});
