const HUE_COUNT = 7;

/** Devuelve un hue 0–6 consistente para cualquier userId. */
export function hueForUser(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) % HUE_COUNT;
  }
  return Math.abs(hash);
}
