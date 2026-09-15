import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { textFor } from '@/src/services/notifications';
import { nombreDeGrupoEnConflicto, type KeyConflictNotice } from '@/src/services/syncNotices';
import { elegirClaveDeGrupo } from '@/src/services/elegirClaveDeGrupo';
import { purgarGrupoLocalmente } from '@/src/services/salirDelGrupo';
import { conflictoForzado, esOfertaDeInvitacion } from '@/src/sync/groupKeyOffers';
import { useUserStore } from '@/src/store/userStore';
import { ActionButton } from './ActionButton';
import { ButtonRack } from './ButtonRack';
import { UserAvatar } from './UserAvatar';

export interface GroupKeyConflictCardProps {
  notice: KeyConflictNotice;
  /** Remitentes con oferta HOY (`ofertasDe`), no la foto congelada del aviso. */
  senderIds: string[];
  /** La elección (o el borrado local) salió bien: quien la aloja marca el aviso leído y cierra. */
  onResuelto: () => void;
  /** «Decidir después»: cierra y el aviso sigue pendiente. */
  onDespues: () => void;
}

/**
 * **Elegir entre claves distintas para un mismo grupo** (T-136 · ADR-013).
 *
 * Un botón por remitente, con el nombre que ESTE teléfono tiene guardado de
 * ese contacto: no es identidad verificada (ADR-012), y el cuerpo lo dice. El
 * nombre del grupo se muestra SIEMPRE «sin verificar» (`nombreDeGrupoEnConflicto`,
 * PO 2026-09-14): un grupo local en conflicto pudo drenarse con la clave en
 * disputa, así que su nombre guardado puede ser tan del atacante como el del
 * drop — no hay rama "verificado" que mostrar. Elegir borra la copia local del
 * grupo, así que siempre pide confirmación.
 *
 * **Conflicto FORZADO** (`conflictoForzado`, fix round 1): una clave distinta
 * no entró a la tabla de ofertas porque un tope estaba lleno. La real puede no
 * estar entre las ofertas visibles, así que elegir a ciegas acá sería adoptar
 * justo lo que un atacante quiso colar. En ese caso no se ofrece ningún botón
 * de elegir.
 *
 * Y esperar tampoco sirve (revisión final, O-1): la marca de forzado sólo se
 * limpia al olvidar las ofertas del grupo, y un reenvío de la persona real
 * vuelve a chocar con el mismo tope. Por eso el texto no promete que se
 * destraba solo: la única salida es borrar el grupo de este teléfono
 * (`purgarGrupoLocalmente` — grupo, gastos, ofertas, marca y clave, sin
 * publicar nada) y pedir una invitación nueva. El botón aparece SÓLO en este
 * estado, con confirmación.
 */
export function GroupKeyConflictCard({ notice, senderIds, onResuelto, onDespues }: GroupKeyConflictCardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();
  const usuarios = useUserStore(s => s.users);
  const [eligiendo, setEligiendo] = useState<string | null>(null);

  const { title, body } = textFor(notice);
  const grupo = nombreDeGrupoEnConflicto(notice, t);
  const forzado = conflictoForzado(notice.groupId);

  const nombreDe = (id: string): string => {
    if (esOfertaDeInvitacion(id)) return t('sync.key_conflict.invite_sender');
    return usuarios.find(u => u.id === id)?.name ?? t('sync.key_conflict.unknown_name');
  };

  async function elegir(userId: string): Promise<void> {
    setEligiendo(userId);
    const ok = await elegirClaveDeGrupo(notice.groupId, userId).catch(() => false);
    setEligiendo(null);
    if (ok) onResuelto();
    else Alert.alert(t('sync.key_conflict.failed'));
  }

  function confirmarBorrado(): void {
    Alert.alert(
      t('sync.key_conflict.forget_confirm_title', { group: grupo }),
      t('sync.key_conflict.forget_confirm_body'),
      [
        { text: t('sync.key_conflict.cancel'), style: 'cancel' },
        {
          text: t('sync.key_conflict.forget_confirm'),
          style: 'destructive',
          onPress: () => {
            purgarGrupoLocalmente(notice.groupId);
            onResuelto();
          },
        },
      ],
    );
  }

  function confirmar(userId: string): void {
    const name = nombreDe(userId);
    Alert.alert(
      t('sync.key_conflict.confirm_title', { name }),
      t('sync.key_conflict.confirm_body', { group: grupo }),
      [
        { text: t('sync.key_conflict.cancel'), style: 'cancel' },
        {
          text: t('sync.key_conflict.confirm_use'),
          style: 'destructive',
          onPress: () => { void elegir(userId); },
        },
      ],
    );
  }

  return (
    <View testID="key-conflict-card" style={styles.card}>
      <Text style={[Typography.bodyL, { color: c.text, fontWeight: '700' }]}>{title}</Text>
      <Text style={[Typography.bodyS, { color: c.textSecondary }]}>{body}</Text>

      {forzado && (
        <Text style={[Typography.bodyS, { color: c.semantic.warning }]}>
          {t('sync.key_conflict.dissent_dropped')}
        </Text>
      )}

      <ButtonRack placement="inline">
        {!forzado && senderIds.map(id => (
          <View key={id} style={styles.fila}>
            {!esOfertaDeInvitacion(id) && <UserAvatar userId={id} name={nombreDe(id)} size={32} />}
            <ActionButton
              testID={`key-conflict-sender-${id}`}
              label={t('sync.key_conflict.use_key_of', { name: nombreDe(id) })}
              icon={esOfertaDeInvitacion(id) ? 'link-outline' : 'key-outline'}
              variant="secondary"
              loading={eligiendo === id}
              disabled={eligiendo !== null}
              action={() => confirmar(id)}
              style={styles.boton}
            />
          </View>
        ))}
        {forzado && (
          <ActionButton
            testID="key-conflict-forget-group"
            label={t('sync.key_conflict.forget_group')}
            icon="trash-outline"
            variant="danger"
            full
            action={confirmarBorrado}
          />
        )}
        <ActionButton
          testID="key-conflict-later"
          label={t('sync.key_conflict.decide_later')}
          variant="ghost"
          full
          disabled={eligiendo !== null}
          action={onDespues}
        />
      </ButtonRack>
    </View>
  );
}

const styles = StyleSheet.create({
  card:  { gap: Spacing[2] },
  fila:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  boton: { flex: 1 },
});
