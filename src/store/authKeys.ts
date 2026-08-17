/**
 * Claves del storage de auth, en un módulo aparte porque las necesitan tanto
 * `authStore` como `accountLink`, y si una importara a la otra habría ciclo.
 */
export const AUTH_KEYS = {
  USER:    'current_user',
  IS_PRO:  'is_pro',
  PROFILE: 'profile',
} as const;

/** Perfil persistido de una cuenta. NO se borra en el signOut. */
export function profileKey(uid: string): string {
  return `${AUTH_KEYS.PROFILE}::u:${uid}`;
}
