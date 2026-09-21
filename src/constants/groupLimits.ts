/**
 * Límites de gastos por grupo (PO 2026-09-20, camino alternativo a T-058):
 * en vez de compactar el buzón, se evita que un grupo se acerque al techo de
 * sync (~720 gastos con el tope de 1MB de `006_payload_limit.sql`) limitando
 * el crecimiento y ofreciendo un traspaso a un grupo nuevo.
 */
export const LIMITE_GASTOS_GRUPO = 450;
export const AVISO_GASTOS_GRUPO = 350;
