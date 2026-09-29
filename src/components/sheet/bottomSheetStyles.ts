import { StyleSheet } from 'react-native';

import { Spacing } from '@/src/constants/spacing';
import { GAP_FILA } from '@/src/components/sheet/constantes';

/** Estilos de la hoja de `BottomSheet`; aparte para que el componente no pase el tope de líneas. */
export const styles = StyleSheet.create({
  // Sin `backgroundColor`: el velo es la capa animada de arriba. Si volviera a
  // pintarse acá, el fondo aparecería de golpe y el fade no se vería.
  root:      { flex: 1, justifyContent: 'flex-end' },
  // El sheet nunca tapa toda la pantalla: siempre se ve un poco del fondo,
  // así se entiende que es una capa y no una pantalla nueva.
  /**
   * ⚠️ **El `maxHeight` NO va acá.** Estaba en la hoja, y su padre —el
   * `KeyboardAvoidingView`— **no tiene alto definido**: se mide por su
   * contenido. Un porcentaje contra un padre sin alto no acota nada, así que una
   * hoja alta (la del recorte de avatar: 320px de visor + textos + botonera)
   * **crecía más que la pantalla y se le cortaba el fondo**. Los botones estaban
   * ahí —el árbol los tenía— pero abajo del borde.
   *
   * Ahora lo lleva el `KeyboardAvoidingView`, cuyo padre sí tiene alto definido
   * (`root`, `flex: 1` del modal), y el porcentaje se resuelve de verdad.
   */
  kav:       { maxHeight: '86%' },
  sheet:     {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 8,
  },
  grabber:   { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing[1] },
  grabberAero: { width: 44, height: 5, borderRadius: 3, marginTop: 2 },

  // El título lleva su propio aire arriba y abajo, y es el MISMO que el de una
  // fila (`rowPadV`), así que la banda del título y las de abajo tienen el mismo
  // ritmo. Antes sólo tenía padding abajo y lo de arriba era lo que sobraba del
  // grabber: 24 contra 14, o sea el título pegado al borde inferior de su propia
  // banda.
  titleRow:  {
    flexDirection: 'row', alignItems: 'center', gap: GAP_FILA,
    paddingHorizontal: Spacing.screenPad,
    paddingVertical: Spacing.rowPadV,
    borderBottomWidth: 1,
  },
  title:     { flex: 1, fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  closeBtn:  { width: 28, alignItems: 'flex-end' },

  body:      { flexGrow: 0 },
  /**
   * **El contenido libre de un sheet lleva el mismo aire lateral que una
   * pantalla.** Hasta ahora la hoja no tenía padding horizontal —sólo lo tenían
   * las filas tipo banda— así que todo sheet que pasa un `<Text>` o un input
   * quedaba **pegado a los dos bordes**. Y eran muchos: editar nombre, contacto
   * nuevo, presupuesto, elegir grupo, recorte de avatar.
   *
   * Las filas que SÍ tienen que llegar al borde —una opción con su hairline, un
   * toggle— lo recuperan con un margen negativo del mismo tamaño (ver `SheetRows`).
   * Así el default es el correcto para el caso común y la excepción se declara.
   */
  bodyPad:   { paddingHorizontal: Spacing.screenPad },
  footer:    {
    borderTopWidth: 1,
    paddingHorizontal: Spacing.screenPad, paddingTop: Spacing[3],
  },
});
