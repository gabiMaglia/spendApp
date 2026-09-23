import React, { useState } from 'react';
import { TabHeader } from '@/src/components/TabHeader';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderColapsable } from '@/src/hooks/useHeaderColapsable';
import { router } from 'expo-router';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { formatMoney } from '@/src/constants/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Fab, FabRow, FAB_BOTTOM_GAP, FAB_HEIGHT } from '@/src/components/Fab';
import { SplitStat, StatLead } from '@/src/components/Band';
import { BudgetSheet } from '@/src/components/BudgetSheet';
import { useHeaderPadding, useLimiteContenido } from '@/src/components/CollapsibleHeader';
import { usePersonalStore, toMonthKey } from '@/src/store/personalStore';
import { useTranslation } from 'react-i18next';
import { UnconvertedNotice } from '@/src/components/UnconvertedNotice';
import { capitalizar } from '@/src/utils/capitalizar';

import { monthLabel } from '@/src/screens/personal/utils/monthLabel';
import { usePersonalDebtsAndGroups } from '@/src/screens/personal/hooks/usePersonalDebtsAndGroups';
import { usePersonalMonthTotals } from '@/src/screens/personal/hooks/usePersonalMonthTotals';
import { useMonthRollover } from '@/src/screens/personal/hooks/useMonthRollover';
import { useBudgetSummary } from '@/src/screens/personal/hooks/useBudgetSummary';
import { useRemoveEntry } from '@/src/screens/personal/hooks/useRemoveEntry';
import { PersonalMonthNav } from '@/src/screens/personal/components/PersonalMonthNav';
import { PersonalBudgetMeter } from '@/src/screens/personal/components/PersonalBudgetMeter';
import { MovimientosHeader } from '@/src/screens/personal/components/MovimientosHeader';
import { MovimientosList } from '@/src/screens/personal/components/MovimientosList';

export default function PersonalScreen() {
  const scheme = useColorScheme() ?? 'light';
  // T-121: sin aire entre el header y el bloque de deuda migrado (mismo
  // criterio que tenía Inicio, T-130).
  const headerPad = useHeaderPadding(0);
  const limiteContenido = useLimiteContenido();
  const { t } = useTranslation();
  const c = Colors[scheme];

  const today = toMonthKey(Date.now());
  const [activeMonth, setActiveMonth] = useState(today);
  const [showBudgetSheet, setShowBudgetSheet] = useState(false);
  const [avisoVisto, setAvisoVisto] = useState(false);
  const atCurrentMonth = activeMonth >= today;

  /** Scroll del header colapsable. */
  const { scrollHandler, progress, contenidoMinimo, alMedirScroll } = useHeaderColapsable();

  const { cur, monthEntries, entriesOrdenadas, totalIncome, totalExpense, totalGroup,
    totalSpent, positiveCarryover, pendientes, personalPending } = usePersonalMonthTotals(activeMonth);
  const { currentUser, owedToMe, youOwe, misGrupos } = usePersonalDebtsAndGroups(cur);
  useMonthRollover(usePersonalStore(s => s.lastSeenMonth), owedToMe);
  const { budget, effectiveBudget, remaining, pct, hasBudget, disponibleTrasSaldar } = useBudgetSummary({
    totalIncome, positiveCarryover, totalSpent, owedToMe, youOwe,
  });
  const handleRemove = useRemoveEntry();

  // capitalizar (PO 2026-09-22): el nombre se guarda tal como se tipeó — si
  // alguien lo escribió en minúscula, el saludo lo mostraba así. La UI es
  // quien prolija la primera letra, sin tocar el dato guardado.
  const firstName = capitalizar(currentUser?.name?.split(' ')[0] ?? 'vos');

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        style={limiteContenido}
        onLayout={alMedirScroll}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        // paddingBottom 140→24 (PO 2026-09-22) se pasó de largo: con pocos
        // movimientos en el mes el FAB ("Ingreso"/"Gasto") queda flotando
        // FIJO sobre la última fila real (no sobre aire de sobra) y la tapa
        // sin forma de scrollear para destaparla — se vio en el emulador con
        // sólo 4 movimientos. El mínimo tiene que cubrir lo que el FAB ocupa
        // (separación + alto) más un respiro; sigue siendo bastante menos que
        // el 140 original para que, con listas largas, el final del scroll
        // llegue cerca de la tab bar en vez de dejar un hueco de sobra.
        // flexGrow (PO 2026-09-22): a diferencia de Grupos/Amigos/Actividad, a
        // Personal le faltaba esto — sin él, con pocos movimientos, el
        // contenido no se estira hasta el borde inferior y queda un hueco de
        // fondo desnudo antes de la tab bar (confirmado en el Motorola físico).
        contentContainerStyle={[
          { paddingTop: headerPad, paddingBottom: FAB_BOTTOM_GAP + FAB_HEIGHT + Spacing[3], flexGrow: 1 },
          contenidoMinimo,
        ]}
        // PO 2026-09-20: el encabezado de "Movimientos" queda pegado arriba
        // del scroll mientras la lista pasa por debajo — 3 hijos directos
        // fijos (todo lo de arriba / el encabezado sticky / la lista), así
        // el índice no se rompe si algo cambia adentro del bloque de arriba.
        stickyHeaderIndices={[1]}
      >
        <View>
          {/* T-121: migrado de Inicio — reusa owedToMe/youOwe, ya derivados
              de useDirectedDebts (no se duplica el cálculo). Sin pending: a
              diferencia de la vieja Inicio, esta fuente no tiene noción de
              "conversión en vuelo" — igual que el SplitStat de deuda de más
              abajo, que también convive en esta pantalla. */}
          <SplitStat
            noTop
            items={[
              { label: t('friends.owed_to_you'), value: formatMoney(owedToMe, cur), color: c.semantic.positive },
              { label: t('friends.you_owe'),     value: formatMoney(youOwe, cur),   color: c.textSecondary },
            ]}
          />

          <PersonalMonthNav
            activeMonth={activeMonth}
            atCurrentMonth={atCurrentMonth}
            onChangeMonth={setActiveMonth}
          />

          <PersonalBudgetMeter
            hasBudget={hasBudget}
            totalSpent={totalSpent}
            remaining={remaining}
            pct={pct}
            effectiveBudget={effectiveBudget}
            cur={cur}
            personalPending={!!personalPending}
            includeOwedToMe={budget.includeOwedToMe}
            owedToMe={owedToMe}
            onOpenBudgetSheet={() => setShowBudgetSheet(true)}
          />

          {/* El ingreso a lo ancho y los dos gastos abajo (PO 2026-09-02). En una
              sola fila de tres, un ingreso y dos gastos se leen como comparables
              entre sí, y no lo son: los de abajo salen del de arriba. Al lado
              del ingreso, cantidad de grupos (PO 2026-09-20, reemplaza la fila
              "Grupos · Balance" — mismo `misGrupos` ya derivado arriba). */}
          <StatLead
            sunken
            noTop
            lead={{
              label: t('personal.summary_income'),
              value: `+${formatMoney(totalIncome, cur)}`,
              color: c.semantic.positive,
            }}
            leadRight={{
              label: t('tabs.groups'),
              value: String(misGrupos.length),
            }}
            items={[
              { label: t('personal.summary_personal'), value: formatMoney(totalExpense, cur) },
              { label: t('personal.summary_groups'),   value: formatMoney(totalGroup, cur) },
            ]}
          />

          {/* Deuda direccional: banda propia, nunca mezclada con lo gastado
              (ADR-006). "Te deben"/"Debés" ya se muestran arriba del todo —
              acá NO se repiten, sólo el número que ese bloque no tiene: cuánto
              queda disponible DESPUÉS de saldar TODO. Sin `youOwe` no hay nada
              propio que saldar y por lo tanto nada nuevo que agregar acá. */}
          {youOwe > 0 && (
            <SplitStat
              noTop
              items={[{
                label: t('personal.available_after_debts'),
                // formatMoney() siempre devuelve el valor absoluto (T-137): el
                // signo hay que ponerlo a mano, si no un negativo se mostraba
                // en rojo pero SIN el "-" — se leía positivo a simple vista.
                value: `${disponibleTrasSaldar < 0 ? '-' : ''}${formatMoney(disponibleTrasSaldar, cur)}`,
                // Rojo cuando saldar todo te deja en negativo: es justamente
                // el caso en el que el número importa.
                color: disponibleTrasSaldar >= 0 ? c.semantic.positive : c.semantic.negative,
              }]}
            />
          )}

          {pendientes.length > 0 && (
            <UnconvertedNotice
              visible={!avisoVisto}
              display={cur}
              unconverted={pendientes}
              onClose={() => setAvisoVisto(true)}
            />
          )}
        </View>

        <MovimientosHeader count={monthEntries.length} />

        <MovimientosList
          entries={entriesOrdenadas}
          monthLabelText={monthLabel(activeMonth)}
          onRemove={handleRemove}
        />
      </Animated.ScrollView>

      <TabHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.greeting', { name: firstName })}
        progress={progress}
      />

      <FabRow>
        {/* T-137: es un BOTÓN (acción), no un monto — va con el color de marca,
            no con `semantic.positive`, aunque lo que agregue sea dinero a
            favor. El verde queda reservado a mostrar montos ya calculados. */}
        <Fab
          variant="secondary"
          onPress={() => router.push({ pathname: '/expense/new', params: { allowIncome: '1', kind: 'income' } } as any)}
          icon="trending-up-outline"
          label={t('personal.fab_income')}
          backgroundColor={c.brand.primarySoft}
          borderColor={c.hair}
          iconColor={c.brand.primary}
          textColor={c.brand.primary}
        />
        <Fab
          onPress={() => router.push({ pathname: '/expense/new', params: { allowIncome: '1' } } as any)}
          icon="add"
          label={t('personal.fab_expense')}
          backgroundColor={c.brand.primary}
        />
      </FabRow>

      <BudgetSheet visible={showBudgetSheet} onClose={() => setShowBudgetSheet(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
});
