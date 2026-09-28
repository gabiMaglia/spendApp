import React from 'react';
import { render } from '@testing-library/react-native';

/**
 * T-202: las cuatro tabs quedan montadas tras la primera visita y, sin
 * `freezeOnBlur`, una en segundo plano sigue re-renderizando con cualquier
 * cambio de store — compite por el hilo de JS con la animación de entrar a
 * otra tab (gama baja, T-202). Se verifica la CONFIGURACIÓN estructural:
 * `screenOptions.freezeOnBlur` llega a `<Tabs>`, y `enableFreeze(true)` se
 * llama al cargar el root layout (`app/_layout.tsx`) — sin eso el prop no
 * hace nada (react-native-screens/src/types.tsx: "When enableFreeze() es
 * run... defaults to true").
 *
 * No se renderiza el árbol real de React Navigation (pide un contexto de
 * navegación que este test no arma) — se capturan los props tal cual los
 * pasa `TabLayout`, mockeando `Tabs`/`Tabs.Screen` como componentes chatos.
 */

let capturedScreenOptions: Record<string, unknown> | undefined;

jest.mock('expo-router', () => {
  const Actual = jest.requireActual('react');
  function Tabs({ screenOptions, children }: any) {
    capturedScreenOptions = screenOptions;
    return Actual.createElement(Actual.Fragment, null, children);
  }
  Tabs.Screen = function TabsScreen() { return null; };
  return { Tabs };
});

jest.mock('react-native-screens', () => ({
  __esModule: true,
  enableFreeze: jest.fn(),
}));

describe('T-202 — freezeOnBlur en las tabs', () => {
  beforeEach(() => {
    capturedScreenOptions = undefined;
  });

  it('screenOptions de <Tabs> incluye freezeOnBlur: true', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TabLayout = require('@/app/(tabs)/_layout').default;
    render(<TabLayout />);

    expect(capturedScreenOptions?.freezeOnBlur).toBe(true);
  });

  it('el root layout llama enableFreeze(true) al cargar (module scope)', () => {
    // No `resetModules`: mezclar dos copias de 'react' entre este require y
    // el `render` de arriba rompe los hooks (dispatcher null). `_layout.tsx`
    // llama `enableFreeze` una sola vez al cargar el módulo — alcanza con
    // importarlo una vez en todo el archivo (jest cachea el módulo).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { enableFreeze } = require('react-native-screens');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/app/_layout');

    expect(enableFreeze).toHaveBeenCalledWith(true);
  });
});
