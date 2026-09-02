import { View, Text, useColorScheme } from 'react-native';
import { Colors } from '@/src/constants/colors';
import { Typography } from '@/src/constants/typography';

interface ActivityLineProps {
  /** Quién lo hizo. Va en negrita. */
  who: string;
  /** Qué hizo, YA traducido — «agregó un gasto», «restauró», … */
  action: string;
  /** Sobre qué: descripción y grupo, ya armados. */
  subject: string;
  /** Cuándo, ya formateado en relativo. */
  ts: string;
}

/**
 * La línea de texto de una fila del feed de actividad: **quién**, **qué hizo**
 * y **sobre qué**, más el cuándo abajo.
 *
 * Estaba copiada en tres filas del feed —gasto agregado, pedido de borrado y,
 * desde S8, restaurado— con la misma tipografía, el mismo negrita y el mismo
 * color secundario en cada copia. Al cuarto uso se extrae, que es la regla del
 * proyecto.
 *
 * **Recibe los textos ya traducidos**: un componente reusable no llama a `t()`.
 * Quién decide el copy es la pantalla, que es la que sabe si el sujeto va entre
 * comillas o no.
 */
export function ActivityLine({ who, action, subject, ts }: ActivityLineProps) {
  const c = Colors[useColorScheme() ?? 'light'];

  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      {/* **Dos renglones como techo.** Sin esto, una descripción larga junto al
          nombre del grupo se parte en tres o cuatro, la fila se estira, y el
          separador —pensado para filas de una línea— deja de alcanzar para
          distinguir dónde termina una y empieza la otra. Reportado por el PO
          después del reskin: «no deja ver dónde termina una noti y empieza
          otra». Se corta el texto, no se achica la tipografía: lo que importa
          es quién y qué, y eso entra siempre al principio. */}
      <Text numberOfLines={2} style={[Typography.bodyM, { color: c.text, lineHeight: 20 }]}>
        <Text style={{ fontWeight: '700' }}>{who}</Text>
        {` ${action} `}
        <Text style={{ color: c.textSecondary }}>{subject}</Text>
      </Text>
      <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 4 }]}>{ts}</Text>
    </View>
  );
}
