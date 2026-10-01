import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { SoloEnDesarrollo } from '@/src/components/SoloEnDesarrollo';
import { useAuthStore } from '@/src/store/authStore';
import { useLangStore, type LanguageChoice } from '@/src/store/langStore';
import { cargarDatosDeDemo } from '@/src/screens/debug/datosDeDemo';

/**
 * `spendapp://debug/demo?lang=es` (sólo DEV): carga los datos de demo de las
 * capturas de tienda en la cuenta activa y vuelve a Personal.
 */
function CargarDemo() {
  const { lang } = useLocalSearchParams<{ lang?: string }>();
  const yoId = useAuthStore(s => s.currentUser?.id);

  useEffect(() => {
    if (!yoId) return;
    if (lang === 'es' || lang === 'en' || lang === 'pt') useLangStore.getState().setLanguage(lang as LanguageChoice);
    cargarDatosDeDemo(yoId, Date.now());
    router.replace('/');
  }, [yoId, lang]);

  return null;
}

export default function DemoScreen() {
  return <SoloEnDesarrollo><CargarDemo /></SoloEnDesarrollo>;
}
