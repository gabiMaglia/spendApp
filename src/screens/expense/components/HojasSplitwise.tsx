import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import type { CurrencyCode } from '@/src/constants/currencies';
import { BottomSheet, SheetActions, SheetButton, SheetOptionAvatar } from '@/src/components/Sheet';
import { PayerSplitter } from '@/src/components/PayerSplitter';
import { OPCIONES_REPETIR, type RecurrenceValue } from '@/src/components/RecurrencePicker';
import { useUserStore } from '@/src/store/userStore';
import { AbanicoCubos } from '@/src/components/menu/AbanicoCubos';
import type { OpcionCubo } from '@/src/components/menu/tipos';
import { useColors, useSkin } from '@/src/skins/useSkin';
import type { Payer } from '@/src/types/models';
import type { useRepartoDeGasto } from '@/src/screens/expense/hooks/useRepartoDeGasto';
import { BloqueReparto } from '@/src/screens/expense/components/BloqueReparto';
import type { HojaAbierta } from '@/src/screens/expense/components/HojasDeGasto';

/**
 * Hojas del alta estilo Splitwise (feat/reskin, B4): lo que en Clásico está
 * abierto en el formulario —quién pagó, cómo se divide, repetir— acá se abre
 * desde la frase y desde la barra. Reusan los mismos bloques y el mismo
 * estado; sólo cambia dónde se muestran.
 */
export function HojasSplitwise({
  abierta, onClose,
  members, payerId, onPayerChange, multiPayer, payers, amount, currency, onPayersChange, onTogglePayerMode,
  reparto, recurrence, onRecurrenceChange, anclaRepetir,
}: {
  abierta: HojaAbierta;
  onClose: () => void;
  members: string[];
  payerId: string;
  onPayerChange: (id: string) => void;
  multiPayer: boolean;
  payers: Payer[];
  amount: number;
  currency: CurrencyCode;
  onPayersChange: (p: Payer[]) => void;
  onTogglePayerMode: () => void;
  reparto: ReturnType<typeof useRepartoDeGasto>;
  recurrence: RecurrenceValue;
  onRecurrenceChange: (v: RecurrenceValue) => void;
  /** El chip de repetir de la barra: de ahí sale la fila de cubos. */
  anclaRepetir: React.RefObject<View | null>;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const { skin } = useSkin();
  const getUserName = useUserStore(s => s.getUserName);
  const opcionesRepetir: OpcionCubo<RecurrenceValue>[] = OPCIONES_REPETIR.map(o => ({
    valor: o.value, icono: o.icon, tinte: skin.colors.brand.primary, etiqueta: t(o.labelKey),
  }));

  const link = (key: string) => (
    <Pressable onPress={onTogglePayerMode} hitSlop={8} style={styles.link}>
      <Text style={[Typography.bodyL, { color: c.brand.primary }]}>{t(key)}</Text>
    </Pressable>
  );

  // PO 2026-11-03: donde se edita algo, la hoja se confirma con «Listo»;
  // cerrarla sin botón no daba la impresión de que se guardara.
  // Envuelto en `SheetActions`: suelto, el `flex: 1` del botón lo deja sin alto.
  const listo = <SheetActions><SheetButton testID="hoja-listo" label={t('common.done')} onPress={onClose} /></SheetActions>;

  return (
    <>
      <BottomSheet
        visible={abierta === 'pagadores'}
        onClose={onClose}
        title={t('expense.who_paid')}
        footer={multiPayer ? listo : undefined}
      >
        {multiPayer ? (
          <View style={styles.columna}>
            <PayerSplitter
              members={members.map(uid => ({ id: uid, name: getUserName(uid) }))}
              value={payers}
              totalAmount={amount}
              currency={currency}
              onChange={onPayersChange}
            />
            {link('payers.single')}
          </View>
        ) : (
          <>
            {members.map((uid, i) => (
              <SheetOptionAvatar
                key={uid}
                userId={uid}
                name={getUserName(uid)}
                selected={uid === payerId}
                onPress={() => { onPayerChange(uid); onClose(); }}
                last={i === members.length - 1}
              />
            ))}
            {link('payers.multiple')}
          </>
        )}
      </BottomSheet>

      <BottomSheet
        visible={abierta === 'reparto'}
        onClose={onClose}
        title={t('expense.split_how')}
        footer={listo}
      >
        <BloqueReparto
          sinEtiqueta
          splitMode={reparto.splitMode}
          percentSub={reparto.percentSub}
          samePercent={reparto.samePercent}
          customPercents={reparto.customPercents}
          splits={reparto.splits}
          lastPercent={reparto.lastPercent}
          percentError={reparto.percentError}
          currency={currency}
          onSplitModeChange={reparto.cambiarModo}
          onPercentSubChange={reparto.cambiarSubModo}
          onSamePercentChange={reparto.setSamePercent}
          onCustomPercentsChange={reparto.setCustomPercents}
        />
      </BottomSheet>

      <AbanicoCubos
        visible={abierta === 'repetir'} onClose={onClose} ancla={anclaRepetir} orientacion="fila"
        opciones={opcionesRepetir} seleccionado={recurrence}
        onElegir={v => onRecurrenceChange(v)} pie={t('recurrence.hint')}
        accessibilityLabel={t('recurrence.label')} etiquetaCerrar={t('common.close')} testID="menu-repetir"
      />
    </>
  );
}

const styles = StyleSheet.create({
  columna: { gap: Spacing[2], paddingHorizontal: Spacing.screenPad, paddingVertical: Spacing[2] },
  link: { alignSelf: 'flex-start', paddingHorizontal: Spacing.screenPad, paddingVertical: 14 },
});
