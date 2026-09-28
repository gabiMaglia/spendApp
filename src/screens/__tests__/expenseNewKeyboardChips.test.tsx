import React from 'react';
import { render } from '@testing-library/react-native';
import { KeyboardAvoidingView, Platform } from 'react-native';
import NewExpenseScreen from '@/app/expense/new';
import { useAuthStore } from '@/src/store/authStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useGroupStore } from '@/src/store/groupStore';
import type { User } from '@/src/types/models';

/**
 * B3 (lote 2026-09-28): la fila de chips (adjuntar, grupo, nota) sube con el
 * teclado y se queda arriba en Android — no vuelve a bajar al cerrarlo.
 *
 * Causa raíz: `app/expense/new.tsx` envuelve la pantalla en
 * `KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`.
 * Expo, sin `android.softwareKeyboardLayoutMode` en `app.json` (no está seteado
 * en este proyecto), deja el default de `android:windowSoftInputMode` en
 * `adjustResize` (`node_modules/@expo/config-plugins/.../WindowSoftInputMode.js`
 * — "Default to `adjustResize`"). Con `adjustResize` ya activo, el SO redimensiona
 * la ventana solo; agregarle ADEMÁS `behavior="height"` hace que dos mecanismos
 * midan y animen el mismo espacio a la vez. React Native documenta que
 * `KeyboardAvoidingView` no es necesario (y no se debe combinar) con
 * `adjustResize` en Android — es la causa conocida de que el offset quede
 * pegado arriba tras cerrar el teclado.
 *
 * Este test no simula el teclado nativo (no hay nada que `KeyboardAvoidingView`
 * exponga para eso sin un entorno nativo real) — verifica la causa raíz
 * directamente: qué `behavior` recibe el `KeyboardAvoidingView` que envuelve la
 * fila de chips, por plataforma.
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'ua', name: 'Ana' } as User, isPro: false });
  useGroupStore.setState({ groups: [] });
  usePersonalStore.setState({ entries: [] });
});

describe('B3 — la fila de chips vuelve a bajar al cerrar el teclado (Android)', () => {
  it('en Android NO usa behavior="height" (choca con adjustResize, el default de Expo)', () => {
    Platform.OS = 'android';
    const { UNSAFE_getByType } = render(<NewExpenseScreen />);

    const kav = UNSAFE_getByType(KeyboardAvoidingView);
    expect(kav.props.behavior).not.toBe('height');
  });

  it('en iOS sigue usando behavior="padding" (no regresivo)', () => {
    Platform.OS = 'ios';
    const { UNSAFE_getByType } = render(<NewExpenseScreen />);

    const kav = UNSAFE_getByType(KeyboardAvoidingView);
    expect(kav.props.behavior).toBe('padding');
  });
});
