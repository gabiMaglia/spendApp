import { turnstileHtml, parseTurnstileMessage } from '../turnstileHtml';

describe('turnstileHtml', () => {
  it('carga el script oficial y usa la site key escapada', () => {
    const html = turnstileHtml('0x4AAA"</script>');
    expect(html).toContain('https://challenges.cloudflare.com/turnstile/v0/api.js');
    expect(html).toContain(JSON.stringify('0x4AAA"</script>').replace(/</g, '\\u003c'));
    expect(html).not.toContain('0x4AAA"</script>');
  });
  it('pide aparecer sólo si hace falta interacción', () => {
    expect(turnstileHtml('k')).toContain("appearance: 'interaction-only'");
  });
  it('usa tamaño flexible para que un desafío alto en Android no se corte', () => {
    expect(turnstileHtml('k')).toContain("size: 'flexible'");
  });
  /**
   * T-147 (rediseño, evidencia de campo del PO): el widget se veía "gigante"
   * (zoom de Android) — sin `maximum-scale`/`user-scalable=no`, el WebView
   * puede reescalar la página al medir su contenido, agrandando la casilla
   * en vez de dejarla a tamaño natural.
   */
  it('fija el viewport (sin zoom) para que el widget no se vea gigante en Android', () => {
    const html = turnstileHtml('k');
    expect(html).toMatch(/<meta name="viewport" content="[^"]*maximum-scale=1[^"]*"/);
    expect(html).toMatch(/<meta name="viewport" content="[^"]*user-scalable=no[^"]*"/);
  });
});

describe('parseTurnstileMessage', () => {
  it.each([
    ['{"type":"token","token":"abc"}', { type: 'token', token: 'abc' }],
    ['{"type":"error","code":"110200"}', { type: 'error', code: '110200' }],
    ['{"type":"expired"}', { type: 'expired' }],
    ['{"type":"interactive"}', { type: 'interactive' }],
    ['{"type":"height","height":120}', { type: 'height', height: 120 }],
    ['{"type":"height","height":0}', { type: 'height', height: 0 }],
    ['{"type":"height","height":600}', { type: 'height', height: 600 }],
  ])('%s', (raw, esperado) => expect(parseTurnstileMessage(raw)).toEqual(esperado));
  it.each([
    '',
    'no-json',
    '{"type":"token"}',
    '{"type":"otro"}',
    '{"type":"token","token":5}',
    '{"type":"height"}',
    '{"type":"height","height":"120"}',
    '{"type":"height","height":-1}',
    '{"type":"height","height":601}',
  ])('inválido: %s', raw => expect(parseTurnstileMessage(raw)).toBeNull());
});
