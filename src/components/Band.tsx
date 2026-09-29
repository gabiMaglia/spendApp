/**
 * Primitivas del reskin "flat bands" — fachada (T-218).
 *
 * El archivo llegó a 636 líneas (tope duro 400, PO 2026-09-28) y se partió por
 * tema en `src/components/band/`: bandas y filas (`BandBase`), casilleros de
 * cifras (`Stats`) y el control segmentado / pestañas (`Segmented`). Las
 * pantallas siguen importando de acá; no cambia ningún import ni nada visible.
 */
export { useC, SectionLabel, Band, BandRow, Meter, SoonBadge } from '@/src/components/band/BandBase';
export { SplitStat, StatGrid, StatLead, type StatItem } from '@/src/components/band/Stats';
export { Segmented, type SegmentedVariant } from '@/src/components/band/Segmented';
