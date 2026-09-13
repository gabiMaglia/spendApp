import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * T-117 (PO 2026-09-13) — dos ajustes puntuales en `app/expense/new.tsx`:
 *
 * 1. El primer selector de pestañas (Gasto/Ingreso) lleva borde superior.
 *    Como su línea de ABAJO sigue haciendo falta (la banda de descripción
 *    va `noTop`, apoyada en esa línea), la prop tiene que ser `borde="ambos"`
 *    y no `borde="arriba"` — esa perdería la de abajo.
 * 2. El bloque de "quién pagó" va PEGADO al input de monto de arriba: sin
 *    gap y compartiendo línea, mismo patrón que ya usa la descripción
 *    (`Band noTop` + una única `<View>` que los saca del `gap` del scroll).
 */

const RAIZ = join(__dirname, '..', '..');
const SRC = readFileSync(join(RAIZ, 'app/expense/new.tsx'), 'utf8');

describe('T-117 — nuevo gasto: bordes y bandas pegadas', () => {
  it('el selector Gasto/Ingreso lleva borde="ambos" (mantiene la línea de abajo)', () => {
    const bloque = SRC.match(/<Segmented[\s\S]*?options=\{\[\s*\{ key: 'expense'[\s\S]*?\/>/);
    expect(bloque).not.toBeNull();
    expect(bloque![0]).toMatch(/borde="ambos"/);
  });

  it('el bloque de pago (payer) usa Band noTop, pegado al input de monto', () => {
    // Ambas variantes (multiPayer y pagador único) tienen que ir `noTop`: cuál
    // se renderiza depende del estado, y las dos comparten línea con el monto.
    const bloqueAmountAPayer = SRC.slice(
      SRC.indexOf('{/* Amount input'),
      SRC.indexOf('{/* Split section'),
    );
    const bandas = bloqueAmountAPayer.match(/<Band(?:\s+noTop)?>/g) ?? [];
    // La primera es la del monto (sin noTop); las de payer (una u otra rama) van noTop.
    expect(bandas.length).toBeGreaterThanOrEqual(2);
    expect(bandas[0]).toBe('<Band>');
    for (const b of bandas.slice(1)) {
      expect(b).toBe('<Band noTop>');
    }
  });

  it('el monto y el payer viven en la MISMA View (sin gap del scroll entre ellos)', () => {
    // El gap de `styles.scroll` separa hijos DIRECTOS del ScrollView. Envolver
    // monto+payer en una sola `<View>` los saca de esa separación, igual que
    // ya hace el par Segmented+descripción (T-117 replica ese patrón).
    const desde = SRC.indexOf('{/* Amount input');
    const hastaPayerClose = SRC.indexOf('{!multiPayer && (', desde);
    const bloque = SRC.slice(desde, hastaPayerClose);
    // Debe abrir una <View> antes del <Band> de monto y cerrarla recién
    // después del `)}` que cierra el condicional de payer (no antes).
    expect(bloque).toMatch(/<View>\s*<Band>/);
    const cierres = bloque.match(/\n\s*<\/View>\s*\n/g) ?? [];
    expect(cierres.length).toBeGreaterThan(0);
  });
});
