import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/src/constants/spacing';
import { DetailHeader, useRellenoDetailHeader } from '@/src/components/CollapsibleHeader';
import { Typography } from '@/src/constants/typography';
import { useGroupStore } from '@/src/store/groupStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { useAuthStore } from '@/src/store/authStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useUserStore } from '@/src/store/userStore';
import { CommentThread } from '@/src/components/CommentThread';
import { useRecordTrust } from '@/src/hooks/useRecordTrust';
import { esYo, mismaPersona } from '@/src/store/identityAlias';
import { useColors } from '@/src/skins/useSkin';
import { enDisputa, autoresVerificados } from '@/src/sync/confianza/autoriaTrust';
import { InlineWarningBanner } from '@/src/components/InlineWarningBanner';
import { useContadorDeRenders } from '@/src/hooks/useContadorDeRenders';
import { netoParaMi, permisosDeGasto } from '@/src/screens/expenseDetail/permisosDeGasto';
import { useComentariosDelGasto } from '@/src/screens/expenseDetail/hooks/useComentariosDelGasto';
import { useAccionesDeGasto } from '@/src/screens/expenseDetail/hooks/useAccionesDeGasto';
import { GastoNoEncontrado } from '@/src/screens/expenseDetail/components/GastoNoEncontrado';
import { AccionesDelHeader } from '@/src/screens/expenseDetail/components/AccionesDelHeader';
import { HeroDelGasto } from '@/src/screens/expenseDetail/components/HeroDelGasto';
import { MiBalanceEnGasto } from '@/src/screens/expenseDetail/components/MiBalanceEnGasto';
import { DetalleDelReparto } from '@/src/screens/expenseDetail/components/DetalleDelReparto';
import { SeccionDeGasto } from '@/src/screens/expenseDetail/components/SeccionDeGasto';
import { FilaBorrarGasto } from '@/src/screens/expenseDetail/components/FilaBorrarGasto';

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  // ARRIBA del early return: un hook después de un return condicional rompe
  // el orden de hooks entre renders. Lo atrapó el lint.
  const groups = useGroupStore(st => st.groups);
  const c = useColors();
  // Aero: el header flota y el contenido arranca debajo de su tarjeta (T-227).
  const relleno = useRellenoDetailHeader();

  const { currentUser } = useAuthStore();
  const expense = useExpenseStore(s => s.expenses.find(e => e.id === id));
  const getUserName = useUserStore(s => s.getUserName);
  const {
    comments, addComment, removeComment, removeCommentsForExpense,
  } = useComentariosDelGasto(id);

  const dateStr = useMemo(() => {
    if (!expense) return '';
    return new Date(expense.date).toLocaleDateString('es-AR', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  }, [expense]);

  /**
   * **La marca de T-041** (S10). El hook va ACÁ ARRIBA, antes del early
   * return: uno después de un return condicional rompe el orden entre renders.
   */
  const marcaDeGasto = useRecordTrust('expense', expense ? [expense] : [])[expense?.id ?? ''];
  const isArchivedFn = useArchiveStore(s => s.isArchived);

  // Se resuelven antes del early return porque las acciones (un hook) los usan.
  const grupoDelGasto = expense ? groups.find(g => g.id === expense.groupId) : undefined;
  const grupoArchivado = grupoDelGasto ? isArchivedFn(grupoDelGasto.id) : false;
  const { handleAddComment, handleRequestDelete } = useAccionesDeGasto({
    id, expense, currentUser, grupoArchivado, addComment, removeCommentsForExpense,
  });

  useContadorDeRenders('Detalle de gasto', {
    expense, commentsCount: comments.length, groupsCount: groups.length,
  });

  if (!expense) return <GastoNoEncontrado />;

  const isCreator = esYo(expense.createdById);
  const disputada = enDisputa(expense);
  // T-170 · D-3 (decisión del PO): quién abrió la disputa, para mostrarlo.
  // TODOS los autores ATRIBUIBLES (`autoresVerificados`: firma que cierra,
  // D9 afuera del merge) — SIN filtrar por `expense.createdById` vigente.
  //
  // Filtrar por el vigente era el defecto de la ronda 3 del verificador: el
  // núcleo sigue ganando por `rev` (R4), así que Mallory puede re-estampar
  // con un `rev` mayor y CONVERTIRSE en el creador vigente. Un filtro contra
  // ese id escondía justo a la atacante y dejaba sólo al autor genuino en la
  // lista — lo opuesto de lo que el PO pidió («mostrar quién abrió la
  // disputa»).
  const autoresDeLaDisputa = disputada ? [...autoresVerificados(expense)] : [];

  const esMiembroDelGrupo = grupoDelGasto !== undefined
    && grupoDelGasto.memberIds.some(m => mismaPersona(m, currentUser?.id ?? ''));
  const { borradoDirecto, puedeEditar } = permisosDeGasto({
    hayUsuario: !!currentUser,
    isCreator,
    isDeleted: !!expense.isDeleted,
    grupoResuelto: grupoDelGasto !== undefined,
    esMiembroDelGrupo,
  });

  // Un registro que llega por sync puede no traer estos campos (versión vieja
  // del otro lado, o dato a medio escribir). Sin los `?? []` la pantalla no
  // abre y no hay forma de ver el gasto ni de arreglarlo.
  const splits = expense.splits ?? [];

  const nombreDe = (uid: string) => (esYo(uid) ? t('common.you') : getUserName(uid));

  const myShare = splits.find(s => esYo(s.userId))?.amount ?? 0;
  const isPayer = esYo(expense.paidById);
  const netForMe = netoParaMi({ amount: expense.amount, myShare, isPayer });

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: c.bg }]}>
      {/* Header con mármol (PO 2026-09-23): mismo `DetailHeader` que Nuevo gasto,
          así el mármol cubre también la barra de estado. */}
      <DetailHeader
        title={t('expense.detail_title')}
        onBack={() => router.back()}
        right={puedeEditar || (isCreator && !expense.isDeleted) ? (
          <AccionesDelHeader
            expenseId={expense.id}
            puedeEditar={puedeEditar}
            puedeBorrar={isCreator && !expense.isDeleted}
            onBorrar={handleRequestDelete}
          />
        ) : undefined}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingTop: Spacing[4] + relleno }]}>
        <HeroDelGasto expense={expense} dateStr={dateStr} marca={marcaDeGasto} nombreDe={nombreDe} />

        <MiBalanceEnGasto
          pagador={isPayer ? t('common.you') : getUserName(expense.paidById)}
          myShare={myShare}
          netForMe={netForMe}
          currency={expense.currency}
        />

        <DetalleDelReparto expense={expense} splits={splits} getUserName={getUserName} />

        {expense.note ? (
          <SeccionDeGasto titulo={t('expense.note')} margenTitulo={8}>
            <Text style={[Typography.bodyM, { color: c.text }]}>{expense.note}</Text>
          </SeccionDeGasto>
        ) : null}

        {/* Autoría en disputa (T-170 · D-3, decisión del PO): decir QUIÉN la
            abrió, no sólo ocultar "Forzar" en silencio. Sólo autores
            ATRIBUIBLES — nunca una entrada sin verificar ni un id inyectado. */}
        {autoresDeLaDisputa.length > 0 && (
          <InlineWarningBanner
            icon="warning-outline"
            title={t('expense.authorship_disputed_title')}
            body={t('expense.authorship_disputed_body', {
              names: autoresDeLaDisputa.map(nombreDe).join(', '),
            })}
          />
        )}

        {/* T-186: cualquier miembro borra al instante, sin ronda que abrir —
            sólo se muestra si el usuario puede borrar. */}
        {!expense.isDeleted && currentUser && borradoDirecto && (
          <FilaBorrarGasto onPress={handleRequestDelete} />
        )}

        {/* Comentarios. Con el mismo margen lateral que el resto del contenido: se
            pegaba a los bordes de la pantalla (PO 2026-09-13, T-111). */}
        <View style={{ marginTop: Spacing[6], paddingHorizontal: Spacing.screenPad }}>
          <CommentThread
            comments={comments}
            currentUserId={currentUser?.id ?? ''}
            authorName={getUserName}
            onAdd={handleAddComment}
            onDelete={removeComment}
          />
        </View>

        <View style={{ height: Spacing[9] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1 },
  scroll:   { paddingTop: Spacing[4] },
});
