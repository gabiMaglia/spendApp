/**
 * Sheets y modales — fachada (T-223).
 *
 * El archivo llegó a 660 líneas (tope duro 400, PO 2026-09-28) y se partió por
 * tema en `src/components/sheet/`: la hoja con su animación y teclado
 * (`BottomSheet`), las filas (`SheetRows`), el campo de texto (`SheetInput`) y
 * los botones del pie con la confirmación (`SheetActions`). Las pantallas siguen
 * importando de acá; no cambia ningún import ni nada visible.
 */
export { BottomSheet } from '@/src/components/sheet/BottomSheet';
export {
  SheetOption, SheetOptionAvatar, SheetNote, SheetLabel, SheetToggle,
} from '@/src/components/sheet/SheetRows';
export { SheetInput } from '@/src/components/sheet/SheetInput';
export { SheetButton, SheetActions, ConfirmSheet } from '@/src/components/sheet/SheetActions';
