import React from 'react';

import {
  registerDeviceKey, fetchAccountKeys, verifyMyKeyRegistered,
} from '@/src/sync/confianza/deviceKeys';

/**
 * Estado del directorio de claves (ADR-004) para la cuenta activa. Sin esto,
 * "no me sincroniza" y "no pude registrar mi clave" se ven exactamente igual.
 * T-223: salió de `app/debug/identity.tsx`.
 */
export function useDirectorioDeClaves(cuenta: string | null) {
  const [directorio, setDirectorio] = React.useState<string>('—');
  const [misClaves, setMisClaves] = React.useState<string[]>([]);
  const [alta, setAlta] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!cuenta) return;
    void (async () => {
      // La verdad es la LECTURA del directorio: no necesita sesión, así que no
      // depende de haber logueado en ESTE arranque.
      //
      // Antes esta fila mostraba el resultado de `registerDeviceKey`, que es una
      // ESCRITURA. Sin sesión —o sea, en cualquier apertura que no venga de un
      // login— devolvía `no_session` y se leía como "algo está roto", con la
      // clave perfectamente registrada del otro lado.
      const presente = await verifyMyKeyRegistered();
      setDirectorio(presente);

      // Sólo se intenta dar de alta si realmente falta. Si no hay sesión, acá
      // el `no_session` sí significa algo: hay que reloguearse.
      if (presente === 'falta') {
        const r = await registerDeviceKey();
        setAlta(r.ok ? 'dada de alta recién' : r.reason);
      }

      setMisClaves(await fetchAccountKeys(cuenta));
    })();
  }, [cuenta]);

  return { directorio, alta, misClaves };
}
