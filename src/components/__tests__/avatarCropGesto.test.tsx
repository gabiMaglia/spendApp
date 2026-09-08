import React from 'react';
import { render } from '@testing-library/react-native';

/**
 * **El objeto de gesto tiene que sobrevivir a un re-render** — el crash de iOS
 * del 2026-09-08.
 *
 * `GestureDetector` memoiza los handlers nativos **por identidad del objeto**
 * (`gesturesToAttach`, en `react-native-gesture-handler/lib/commonjs/handlers/
 * gestures/GestureDetector/index.js:62`), y su propio código pide envolver la
 * configuración en `useMemo`. Cuando el gesto se creaba en cada render, el
 * `onEnd` disparaba `setAjuste` → re-render → objeto nuevo → RNGH desenganchaba
 * y volvía a enganchar los handlers **mientras el gesto terminaba**, y eso tumba
 * la app al tocar el recorte.
 *
 * El arreglo tiene dos mitades y este test cubre las dos: el ajuste vive en un
 * `ref` (no hay re-render) y los gestos están memoizados (si lo hubiera, la
 * identidad aguanta).
 */
const gestosVistos: unknown[] = [];

jest.mock('react-native-gesture-handler', () => {
  const React2 = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  const encadenable = () => {
    const g: Record<string, unknown> = {};
    for (const m of ['onBegin', 'onUpdate', 'onEnd', 'onFinalize']) g[m] = () => g;
    return g;
  };
  return {
    GestureHandlerRootView: View,
    GestureDetector: ({ gesture, children }: { gesture: unknown; children: React.ReactNode }) => {
      gestosVistos.push(gesture);
      return React2.createElement(View, null, children);
    },
    Gesture: {
      Pan: encadenable,
      Pinch: encadenable,
      Simultaneous: (...gs: unknown[]) => ({ simultaneos: gs }),
    },
  };
});

// eslint-disable-next-line import/first
import { AvatarCropSheet } from '../AvatarCropSheet';

const props = {
  visible: true,
  uri: 'file:///foto.jpg',
  width: 4032,
  height: 3024,
  onCancel: jest.fn(),
  onConfirm: jest.fn(),
};

beforeEach(() => { gestosVistos.length = 0; });

describe('la identidad del gesto', () => {
  it('NO cambia al re-renderizar con las mismas medidas', () => {
    const { rerender } = render(<AvatarCropSheet {...props} />);
    rerender(<AvatarCropSheet {...props} />);
    rerender(<AvatarCropSheet {...props} />);

    expect(gestosVistos.length).toBeGreaterThan(1);
    for (const g of gestosVistos) expect(g).toBe(gestosVistos[0]);
  });

  it('SÍ cambia si cambian las medidas, que es cuando la matemática cambia', () => {
    const { rerender } = render(<AvatarCropSheet {...props} />);
    const primero = gestosVistos[0];

    rerender(<AvatarCropSheet {...props} width={100} height={200} />);

    expect(gestosVistos[gestosVistos.length - 1]).not.toBe(primero);
  });
});
