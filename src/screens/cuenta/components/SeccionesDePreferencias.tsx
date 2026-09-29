import React from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { Band, BandRow, SectionLabel, Segmented } from '@/src/components/Band';
import { CurrencyPicker } from '@/src/components/CurrencyPicker';
import { SkinPicker } from '@/src/components/SkinPicker';
import { SUPPORTED_LANGUAGES } from '@/src/i18n';
import { useSettingsStore } from '@/src/store/settingsStore';
import { useCurrenciesInUse } from '@/src/store/currenciesInUse';
import { usePersonalStore } from '@/src/store/personalStore';
import { useThemeStore } from '@/src/store/themeStore';
import { useLangStore, type LanguageChoice } from '@/src/store/langStore';
import { needsRates, readCache } from '@/src/services/fx';
import { useColors } from '@/src/skins/useSkin';
import { LinkRow, ToggleRow } from '@/src/screens/cuenta/components/FilasDeCuenta';

/**
 * Presupuesto, notificaciones, rendimiento, apariencia, moneda e idioma.
 * Fragmento: cada etiqueta y banda es hija directa del scroll de la pantalla.
 */
export function SeccionesDePreferencias({ onEditarPresupuesto }: { onEditarPresupuesto: () => void }) {
  const c = useColors();
  const { t, i18n } = useTranslation();

  const {
    notifExpenses, setNotifExpenses,
    notifDeletions, setNotifDeletions,
    notifInvites, setNotifInvites,
    notifSettlements, setNotifSettlements,
    reduceAnimations, setReduceAnimations,
  } = useSettingsStore();
  const displayCurrency    = useSettingsStore(s => s.displayCurrency);
  const setDisplayCurrency = useSettingsStore(s => s.setDisplayCurrency);

  const monedasEnUso = useCurrenciesInUse();
  const fxCache      = readCache();

  const budget = usePersonalStore(s => s.budget);

  const { themeChoice, setThemeChoice } = useThemeStore();

  const { choice: langChoice, setLanguage } = useLangStore();
  const langOptions: LanguageChoice[] = ['auto', ...SUPPORTED_LANGUAGES];
  const langLabel = (opt: LanguageChoice) =>
    opt === 'auto' ? t('profile.language_auto') : opt.toUpperCase();

  return (
    <>
      {/* Presupuesto — editar el ya armado (PO 2026-09-22). La configuración
          INICIAL sigue siendo el estado vacío de Personal; esta fila monta
          el mismo BudgetSheet para ajustarlo una vez que ya existe. */}
      <SectionLabel label={t('profile.section_budget')} />
      <Band>
        <LinkRow
          label={t('personal.budget_sheet_title')}
          icon="wallet-outline"
          sub={budget.monthlyAmount > 0 ? formatMoney(budget.monthlyAmount, budget.currency) : undefined}
          onPress={onEditarPresupuesto}
          last
        />
      </Band>

      {/* Notificaciones */}
      <SectionLabel label={t('profile.section_notifications')} />
      <Band>
        <ToggleRow label={t('profile.notif_expenses')}    value={notifExpenses}    onChange={setNotifExpenses} />
        <ToggleRow label={t('profile.notif_deletions')}   value={notifDeletions}   onChange={setNotifDeletions} />
        <ToggleRow label={t('profile.notif_invites')}     value={notifInvites}     onChange={setNotifInvites} />
        <ToggleRow label={t('profile.notif_settlements')} value={notifSettlements} onChange={setNotifSettlements} last />
      </Band>

      {/* Rendimiento (PO 2026-09-22): apaga el odómetro de números y la
          animación de entrada/salida de los sheets — pensado para equipos
          de gama baja, pero visible y disponible para cualquiera. */}
      <SectionLabel label={t('profile.section_performance')} />
      <Band>
        <ToggleRow
          label={t('profile.reduce_animations')}
          sub={t('profile.reduce_animations_sub')}
          value={reduceAnimations}
          onChange={setReduceAnimations}
          last
        />
      </Band>

      {/* Apariencia */}
      <SectionLabel label={t('profile.section_appearance')} />
      <Band>
        <BandRow>
          <Text style={[Typography.bodyL, { color: c.text, flex: 1 }]}>{t('profile.theme')}</Text>
          <Segmented
            compact
            value={themeChoice}
            onChange={setThemeChoice}
            options={[
              { key: 'auto',  label: t('profile.theme_auto') },
              { key: 'light', label: t('profile.theme_light') },
              { key: 'dark',  label: t('profile.theme_dark') },
            ]}
          />
        </BandRow>
        <SkinPicker last />
      </Band>

      {/* Moneda */}
      <SectionLabel label={t('profile.section_currency')} />
      <Band>
        <CurrencyPicker
          value={displayCurrency}
          onChange={setDisplayCurrency}
          ratesFetchedAt={fxCache?.fetchedAt ?? null}
          ratesNeeded={needsRates(monedasEnUso, displayCurrency)}
          locale={i18n.language}
        />
      </Band>

      {/* Idioma */}
      <SectionLabel label={t('profile.section_language')} />
      <Band>
        <BandRow last>
          <Text style={[Typography.bodyL, { color: c.text, flex: 1 }]}>{t('profile.language')}</Text>
          <Segmented
            compact
            value={langChoice}
            onChange={setLanguage}
            options={langOptions.map(opt => ({ key: opt, label: langLabel(opt) }))}
          />
        </BandRow>
      </Band>
    </>
  );
}
