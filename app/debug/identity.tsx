import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { isRelayConfigured } from '@/src/sync/relay';
import { ensureContactSecret, listPeers, peersIncompletos } from '@/src/sync/contactChannel';
import {
  registerDeviceKey, fetchAccountKeys, verifyMyKeyRegistered,
} from '@/src/sync/deviceKeys';
import { unverifiedAuthors, authorStats } from '@/src/sync/authorHealth';
import {
  recordStats, verifyCost, unverifiableBreakdown, invalidRecords, benchmarkVerify,
} from '@/src/sync/recordHealth';
import { signingAuthors } from '@/src/sync/ratchet';
import { useLiveValue } from '@/src/hooks/useLiveValue';
import { blockingFailures } from '@/src/sync/publishHealth';
import { omittedCount } from '@/src/sync/recordHealth';
import { clockOffsetMs, hasClockReference, clockIsOff } from '@/src/utils/syncedClock';
import { ensureIdentity } from '@/src/store/identityStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { wipeAllAccounts } from '@/src/store/wipeDevice';
import { Alert } from 'react-native';

/**
 * Diagnóstico del índice de identidad (solo DEV).
 *
 * Existe porque "sigo viendo dos cuentas" es un síntoma que se puede explicar de
 * varias formas —código viejo en el bundle, el índice vacío, el usuario eligió
 * "cuenta aparte"— y adivinar cuál sale caro. Acá se ve el estado real.
 */
export default function IdentityDebugScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  /**
   * `identitySnapshot` lee de MMKV, no del estado del store, así que
   * seleccionarlo y llamarlo no suscribe a nada: leía disco en CADA render y
   * nunca se actualizaba al cambiar de cuenta. Es la misma forma rota que el
   * contador de avisos, encontrada por el guard de `sinLeerDelStore`.
   *
   * `useLiveValue` es lo que esta misma pantalla ya usa para los contadores de
   * la fase B, por la misma razón: valores que viven fuera de React.
   */
  const snapshot = useLiveValue(() => useAuthStore.getState().identitySnapshot());
  const groups = useGroupStore(st => st.groups);
  const expenses = useExpenseStore(st => st.expenses);

  const dosCuentas = snapshot.known.length > 1;

  // Estado del sync. Es lo que convierte un "no me llega nada" en un diagnóstico:
  // sin relay configurado, sin secreto propio o con contactos a los que les
  // faltan las públicas, la entrega de claves de grupo NO puede salir — y el
  // síntoma es siempre el mismo, no pasa nada y no hay error.
  const claves = useGroupKeyStore(st => st.keys);
  const peers = listPeers();
  const incompletos = peersIncompletos().length;
  const miSecreto = ensureContactSecret();

  const sinClave = groups.filter(g => !g.isDeleted && !claves.some(k => k.groupId === g.id));

  // Estado del directorio de claves (ADR-004). Sin esto, "no me sincroniza" y
  // "no pude registrar mi clave" se ven exactamente igual.
  // Los tres viven en variables de módulo que el sync actualiza por detrás.
  // Leerlos en el render dejaba la pantalla congelada en el valor del montaje:
  // el sync contaba bien y acá se veían ceros para siempre.
  const bloqueantes  = useLiveValue(blockingFailures);
  const [directorio, setDirectorio] = React.useState<string>('—');
  const sinVerificar = useLiveValue(unverifiedAuthors);
  const stats = useLiveValue(authorStats);
  const [misClaves, setMisClaves] = React.useState<string[]>([]);

  const [alta, setAlta] = React.useState<string | null>(null);

  // Firmas de registro (T-041 · S6). Modo MARCA: se cuenta, no se descarta —
  // todo lo que aparece acá se aplicó y sumó al balance igual.
  const firmas    = useLiveValue(recordStats);
  const omitidos  = useLiveValue(omittedCount);
  const costo     = useLiveValue(verifyCost);
  const sinFirma  = useLiveValue(unverifiableBreakdown);
  const invalidos = useLiveValue(invalidRecords);
  const firmantes = useLiveValue(signingAuthors);

  React.useEffect(() => {
    const cuenta = snapshot.activeAccountId;
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
  }, [snapshot.activeAccountId]);

  /**
   * Cuánto tarda UNA verificación en ESTE teléfono. Es el gate S6→S7: el plan
   * midió 3,9 ms/op en una laptop Intel y se negó, bien, a inventar el
   * multiplicador de Hermes. Corre diferido para no trabar el primer render, y
   * existe porque `costo` no dice nada hasta que haya tráfico firmado real.
   */
  const [bench, setBench] = React.useState<number | null>(null);
  React.useEffect(() => {
    const id = setTimeout(() => setBench(benchmarkVerify(20)), 0);
    return () => clearTimeout(id);
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="close" size={24} color={c.text} />
        </Pressable>
        <Text style={[Typography.h3, { color: c.text }]}>Identidad (DEV)</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Block title="CUENTA ACTIVA" c={c}>
          <Row label="accountId" value={snapshot.activeAccountId ?? '(sin sesión)'} c={c} />
          <Row label="grupos visibles" value={String(groups.length)} c={c} />
          <Row label="gastos visibles" value={String(expenses.length)} c={c} />
        </Block>

        <Block title="SYNC" c={c}>
          <Row label="relay configurado" value={isRelayConfigured() ? 'sí' : 'NO'} c={c}
               warn={!isRelayConfigured()} />
          <Row label="mi buzón de contacto" value={miSecreto ? miSecreto.slice(0, 12) + '…' : 'NO'} c={c}
               warn={!miSecreto} />
          <Row label="contactos con buzón" value={String(Object.keys(peers).length)} c={c} />
          <Row label="…sin claves públicas" value={String(incompletos)} c={c} warn={incompletos > 0} />
          <Row label="grupos con clave" value={`${claves.length} de ${groups.filter(g => !g.isDeleted).length}`} c={c}
               warn={sinClave.length > 0} />
        </Block>

        {/* Si publicar falla y nadie lo cuenta, el sintoma es "no me llega
            nada" sin nada que mirar. Ya paso dos veces. */}
        {bloqueantes.length > 0 && (
          <View style={[styles.card, { borderColor: c.semantic.negative }]}>
            <Text style={[Typography.bodyM, { color: c.semantic.negative, fontWeight: '600' }]}>
              {bloqueantes.length} grupo(s) que NO se están publicando
            </Text>
            {bloqueantes.map(f => (
              <Text key={f.groupId} style={[Typography.bodyS, { color: c.textSecondary }]}>
                {useGroupStore.getState().getById(f.groupId)?.name ?? f.groupId}: {f.reason}
                {f.reason === 'too_large'
                  ? ' — el sobre pasó los 256KB. Los cambios de este grupo dejaron de viajar.'
                  : ' — falta la clave del grupo.'}
              </Text>
            ))}
          </View>
        )}

        <Block title="DIRECTORIO DE CLAVES (ADR-004)" c={c}>
          {/* Lectura del directorio, no intento de escritura. Ver el efecto arriba. */}
          <Row label="mi clave" value={directorio} c={c} warn={directorio === 'falta'} />
          {alta !== null && (
            <Row label="intento de alta" value={alta} c={c} warn={alta !== 'dada de alta recién'} />
          )}
          <Row label="dispositivos de esta cuenta" value={String(misClaves.length)} c={c}
               warn={misClaves.length === 0} />
          <Row label="esta es" value={`${ensureIdentity().publicKey.slice(0, 12)}…`} c={c} />
          {/*
            Fase B en modo AVISO: se cuenta lo que no verifica, no se descarta.
            Este número es el que decide si algún día se puede pasar a rechazo.
            Cero sostenido con gente real ⇒ el borde de Apple no pega en la
            práctica. Distinto de cero ⇒ rechazar romperia a alguien legítimo.
          */}
          {/*
            Los tres juntos o ninguno. "Sin verificar: 0" solo no dice nada:
            da cero tanto si todo verifico como si no se pudo consultar nada.
            Solo significa algo al lado de un "verificados" distinto de cero.
          */}
          <Row label="sobres verificados" value={String(stats.ok)} c={c}
               warn={stats.ok === 0 && stats.sin_directorio > 0} />
          <Row label="no se pudo consultar" value={String(stats.sin_directorio)} c={c}
               warn={stats.sin_directorio > 0} />
          <Row label="autores sin verificar" value={String(sinVerificar.length)} c={c}
               warn={sinVerificar.length > 0} />
          {sinVerificar.map(o => (
            <Text key={`${o.groupId}${o.senderKey}`} style={[Typography.bodyS, { color: c.textSecondary }]}>
              {o.accountId.slice(0, 8)}… firmó con {o.senderKey.slice(0, 8)}… ×{o.count}
            </Text>
          ))}
        </Block>

        {/*
          T-041 · S6 — firmas POR REGISTRO, en modo MARCA.
          Nada de esto rechaza nada: todo lo contado acá entró y sumó al balance.
          Los cuatro juntos o ninguno: `no_verificable` en 0 significa cosas
          opuestas segun `valida` sea 0 o no.
        */}
        <Block title="FIRMAS DE REGISTRO (T-041)" c={c}>
          <Row label="verificadas" value={String(firmas.valida)} c={c}
               warn={firmas.valida === 0 && firmas.no_verificable > 0} />
          <Row label="no se pudo verificar" value={String(firmas.no_verificable)} c={c} />
          <Row label="…de autores que nunca firman" value={String(sinFirma.desconocido)} c={c} />
          <Row label="…de autores que sí firman" value={String(sinFirma.firma)} c={c}
               warn={sinFirma.firma > 0} />
          {/* La señal. El criterio de cierre de la fase de rechazo es este
              numero sostenido en 0 con "verificadas" > 0. */}
          <Row label="firma que NO cierra" value={String(firmas.invalida)} c={c}
               warn={firmas.invalida > 0} />
          {/* Cuarta categoria (D4): nadie puede firmarlos por diseño. No se
              mezclan con los de arriba y su piso NO cuenta para el cierre. */}
          <Row label="no firmables por diseño" value={String(firmas.no_firmable)} c={c} />
          <Row label="autores a los que vimos firmar" value={String(firmantes.length)} c={c} />
          {/* Sin esta fila, los cuatro contadores en cero significan DOS cosas
              opuestas: que no llegó ningún sobre, o que llegó y ya lo teníamos
              todo. Con `omitidos` en 0 y todo lo demás en 0, el sync no está
              trayendo nada. */}
          <Row label="ya los tenía (no se recuentan)" value={String(omitidos)} c={c}
               warn={omitidos === 0 && firmas.valida === 0 && firmas.no_verificable === 0} />
          {invalidos.map(o => (
            <Text key={`${o.groupId}${o.authorId}`} style={[Typography.bodyS, { color: c.textSecondary }]}>
              {o.authorId.slice(0, 8)}… en {o.groupId.slice(0, 8)}… ×{o.count}
            </Text>
          ))}
          {/* El gate S6→S7: cuanto cuesta verificar en Hermes, en ESTE aparato. */}
          <Row
            label="costo real medido"
            value={costo.msPorOp === null
              ? `— (todavía ninguna, ${costo.ops} ops)`
              : `${costo.msPorOp.toFixed(2)} ms/op · ${costo.ops} ops`}
            c={c}
          />
          <Row
            label="banco de pruebas de este teléfono"
            value={bench === null ? 'midiendo…' : `${bench.toFixed(2)} ms/op`}
            c={c}
            warn={bench !== null && bench > 20}
          />
        </Block>

        <Block title="RELOJ (ADR-005)" c={c}>
          <Row
            label="referencia del relay"
            value={hasClockReference() ? 'sí' : 'todavía no'}
            c={c}
            warn={!hasClockReference()}
          />
          <Row
            label="desfase de este teléfono"
            value={`${Math.round(clockOffsetMs() / 1000)} s`}
            c={c}
            warn={clockIsOff()}
          />
        </Block>

        {/* Corregir `updatedAt` arregla el merge, pero NO lo que el usuario VE:
            las fechas de los gastos siguen saliendo del reloj del teléfono. */}
        {clockIsOff() && (
          <View style={[styles.card, { borderColor: c.semantic.warning }]}>
            <Text style={[Typography.bodyM, { color: c.semantic.warning, fontWeight: '600' }]}>
              La hora de este teléfono está mal
            </Text>
            <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
              El sync ya se corrige solo, pero las FECHAS de los gastos que cargues
              van a salir con la hora equivocada. Conviene arreglarla en los ajustes
              del sistema.
            </Text>
          </View>
        )}

        {incompletos > 0 && (
          <View style={[styles.card, { borderColor: c.semantic.warning }]}>
            <Text style={[Typography.bodyM, { color: c.semantic.warning, fontWeight: '600' }]}>
              {incompletos} contacto(s) a medias
            </Text>
            <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
              Se agregaron con una versión anterior del código, que no mandaba las
              claves públicas. Sin ellas no se les puede entregar la clave de un
              grupo. La app les manda la tarjeta al arrancar; si los dos abren la
              app queda reparado solo. Si no, volvé a escanear el QR.
            </Text>
          </View>
        )}

        <Block title={`CUENTAS CONOCIDAS EN ESTE DEVICE (${snapshot.known.length})`} c={c}>
          {snapshot.known.length === 0 ? (
            <Text style={[Typography.bodyS, { color: c.textTertiary }]}>
              El índice está vacío. Si ya entraste con algún proveedor después de
              actualizar, esto no debería estar vacío: significa que la app está
              corriendo código viejo (recargá con una sacudida → Reload).
            </Text>
          ) : (
            snapshot.known.map(a => {
              const perfil = snapshot.profiles.find(p => p.accountId === a.accountId);
              return (
                <View key={a.accountId} style={[styles.card, { borderColor: c.borderHair }]}>
                  <Row label="accountId" value={a.accountId} c={c} />
                  <Row label="nombre" value={perfil?.name ?? '—'} c={c} />
                  <Row
                    label="mail conocido"
                    value={a.email ?? '(NUNCA lo supimos)'}
                    c={c}
                    warn={a.email === undefined}
                  />
                  {a.accountId === snapshot.activeAccountId && (
                    <Text style={[Typography.bodyS, { color: c.semantic.positive }]}>← activa</Text>
                  )}
                </View>
              );
            })
          )}
        </Block>

        <Block title="EMPEZAR DE CERO" c={c}>
          <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
            Borra todas las cuentas de este teléfono y sus datos, para poder
            probar el primer login sin desinstalar la app. El tema y el idioma
            no se tocan.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              Alert.alert(
                'Borrar todas las cuentas',
                'Se borran las cuentas de este dispositivo y TODOS sus gastos, grupos y pagos. No se puede deshacer.',
                [
                  { text: 'Cancelar', style: 'cancel' },
                  {
                    text: 'Borrar todo',
                    style: 'destructive',
                    onPress: () => {
                      wipeAllAccounts();
                      router.replace('/auth');
                    },
                  },
                ],
              );
            }}
            style={[styles.card, { borderColor: c.semantic.negative, alignItems: 'center' }]}
          >
            <Text style={[Typography.bodyM, { color: c.semantic.negative, fontWeight: '700' }]}>
              Borrar todas las cuentas y datos
            </Text>
          </Pressable>
        </Block>

        {dosCuentas && (
          <View style={[styles.card, { borderColor: c.semantic.negative }]}>
            <Text style={[Typography.bodyM, { color: c.semantic.negative, fontWeight: '600' }]}>
              Hay {snapshot.known.length} cuentas separadas
            </Text>
            <Text style={[Typography.bodyS, { color: c.textSecondary }]}>
              Si sos la misma persona, al entrar con el otro proveedor la app tiene
              que preguntarte si querés unirlas. Si NO te preguntó, mandale esta
              pantalla al equipo: con los mails de arriba se sabe por qué.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Block({ title, c, children }: { title: string; c: any; children: React.ReactNode }) {
  return (
    <View style={{ gap: Spacing[2] }}>
      <Text style={[Typography.label, { color: c.textSecondary }]}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value, c, warn }: { label: string; value: string; c: any; warn?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[Typography.bodyS, { color: c.textTertiary }]}>{label}</Text>
      <Text
        selectable
        style={[Typography.bodyS, styles.value, { color: warn ? c.semantic.negative : c.text }]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], padding: Spacing.screenPad },
  scroll: { padding: Spacing.screenPad, gap: Spacing[6] },
  card:   { borderWidth: 1, borderRadius: Radius.md, padding: Spacing[3], gap: 4 },
  row:    { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing[3] },
  value:  { flexShrink: 1, textAlign: 'right', fontWeight: '600' },
});
