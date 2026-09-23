import { usePersonalStore } from '@/src/store/personalStore';

/**
 * Presupuesto efectivo del mes y "disponible tras saldar" (T-137).
 *
 * `disponibleTrasSaldar` tiene que descontar lo que debés Y sumar lo que te
 * deben — las DOS direcciones, siempre, una sola vez cada una. `remaining`
 * no sirve de base directa: si "Incluir lo que me deben" está prendido en el
 * presupuesto, `owedToMe` ya está adentro (se sumaría dos veces); si está
 * apagado, no está (nunca se sumaría). Se arranca de `remaining` SIN ese
 * agregado condicional y se suman las dos deudas acá, ajenas al toggle de
 * presupuesto — son cosas distintas.
 */
export function useBudgetSummary({
  totalIncome, positiveCarryover, totalSpent, owedToMe, youOwe,
}: {
  totalIncome: number;
  positiveCarryover: number;
  totalSpent: number;
  owedToMe: number;
  youOwe: number;
}) {
  const budget = usePersonalStore(s => s.budget);

  const baseBudget      = budget.monthlyAmount;
  const effectiveBudget = baseBudget + totalIncome + positiveCarryover + (budget.includeOwedToMe ? owedToMe : 0);
  const remaining       = effectiveBudget - totalSpent;
  const pct             = effectiveBudget > 0 ? Math.min(totalSpent / effectiveBudget, 1) : 0;
  const hasBudget        = baseBudget > 0;

  const remainingSinDeudas = remaining - (budget.includeOwedToMe ? owedToMe : 0);
  const disponibleTrasSaldar = remainingSinDeudas + owedToMe - youOwe;

  return {
    budget, baseBudget, effectiveBudget, remaining, pct, hasBudget,
    disponibleTrasSaldar,
  };
}
