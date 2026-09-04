// Modelo WatermelonDB para `payments` (ADR-001). `amount`/`exchangeRate`
// enteros en la menor unidad de la moneda (ADR-002). Liquidar ≠ borrar: no
// requiere consenso (CLAUDE.md §Reglas de negocio críticas).
import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class PaymentModel extends Model {
  static table = 'payments';

  @field('group_id') groupId!: string;
  @field('from_user_id') fromUserId!: string;
  @field('to_user_id') toUserId!: string;
  @field('amount') amount!: number; // entero menor unidad (ADR-002)
  @field('currency') currency!: string;
  @field('target_currency') targetCurrency!: string | null;
  @field('exchange_rate') exchangeRate!: number | null; // entero escalado (ADR-002 §exchange_rate)
  @field('date') date!: number;
  @field('created_at') createdAt!: number;
  @field('created_by_id') createdById!: string;
  @field('note') note!: string | null;

  // LWW manual (ADR-001 §Alternativas descartadas) — NUNCA @date auto-gestionado.
  @field('updated_at') updatedAt!: number;
  // Tombstone (R-01/R-02) — nunca DELETE físico.
  @field('is_deleted') isDeleted!: boolean;
}
