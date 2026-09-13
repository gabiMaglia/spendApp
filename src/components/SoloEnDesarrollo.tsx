import React from 'react';
import { Redirect } from 'expo-router';

/**
 * Pantallas de diagnóstico sólo en desarrollo (T-095 · SEC M-2).
 *
 * El botón que lleva a ellas ya estaba detrás de `__DEV__`, pero la RUTA seguía viva en
 * producción: `spendapp://debug/identity` abría el «borrar todo» desde cualquier web.
 */
export function SoloEnDesarrollo({ children, isDev = __DEV__ }: { children: React.ReactNode; isDev?: boolean }) {
  if (!isDev) return <Redirect href="/" />;
  return <>{children}</>;
}
