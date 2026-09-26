/** `#RGB`/`#RRGGBB` → `rgba(r,g,b,alfa)`. Cualquier otra cosa vuelve tal cual. */
export function conAlfa(color: string, alfa: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const hex = m[1].length === 3 ? m[1].split('').map(ch => ch + ch).join('') : m[1];
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alfa})`;
}
