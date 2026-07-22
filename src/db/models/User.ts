// Modelo WatermelonDB para `users` (ADR-001). PK = UUID cliente fijado en
// `_raw.id` por el código que crea el registro (R-03) — WatermelonDB NUNCA
// genera el id.
import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class UserModel extends Model {
  static table = 'users';

  @field('name') name!: string;
  @field('email') email!: string;
  @field('username') username!: string | null;
  @field('avatar_url') avatarUrl!: string | null;
  @field('auth_provider') authProvider!: 'google' | 'apple';
  @field('created_at') createdAt!: number;

  // LWW manual (ADR-001 §Alternativas descartadas) — NUNCA @date auto-gestionado.
  @field('updated_at') updatedAt!: number;
  // Tombstone (R-01/R-02) — nunca DELETE físico.
  @field('is_deleted') isDeleted!: boolean;
}
