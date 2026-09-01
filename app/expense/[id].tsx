import React, { useMemo } from 'react';
import {
  Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { v4 as uuidv4 } from 'uuid';
import { hapticLight, hapticWarning } from '@/src/utils/haptics';
import { useTranslation } from 'react-i18next';
import i18n from '@/src/i18n';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { formatMoney } from '@/src/constants/currencies';
import { MoneyText } from '@/src/components/MoneyText';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useGroupStore } from '@/src/store/groupStore';
import { borraAlInstante, deletionModeOf } from '@/src/algorithms/deletionPolicy';
import { useAuthStore } from '@/src/store/authStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useUserStore } from '@/src/store/userStore';
import { useCommentStore } from '@/src/store/commentStore';
import { CommentThread } from '@/src/components/CommentThread';
import { CategoryIcon } from '@/src/components/CategoryIcon';
import { Avatar } from '@/src/components/Avatar';
import { UserAvatar } from '@/src/components/UserAvatar';
import { hueForUser } from '@/src/utils/hueForUser';
import { deletionRound, msUntilDeletion, hasObjected, hasRequested } from '@/src/algorithms/deletionRound';
import { emitirVoto } from '@/src/services/deletionVotes';
import type { CategoryKind } from '@/src/constants/colors';
import { syncedNow } from '@/src/utils/syncedClock';

/** "2 días" / "5 horas" / "40 minutos": basta para saber si hay que apurarse. */
function formatearRestante(ms: number): string {
  const horas = Math.floor(ms / 3600_000);
  if (horas >= 24) return i18n.t('expense.time_days', { count: Math.floor(horas / 24) });
  if (horas >= 1)  return i18n.t('expense.time_hours', { count: horas });
  return i18n.t('expense.time_minutes', { count: Math.max(1, Math.floor(ms / 60_000)) });
}

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  // ARRIBA del early return de la línea ~74: un hook después de un return
  // condicional rompe el orden de hooks entre renders. Lo atrapó el lint.
  const groups = useGroupStore(st => st.groups);
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { currentUser } = useAuthStore();
  const expense = useExpenseStore(s => s.expenses.find(e => e.id === id));
  const updateExpense = useExpenseStore(s => s.updateExpense);
  const { getUserName } = useUserStore();
  // OJO: NO seleccionar `st.forExpense(id)` acá. Ese método arma un array
  // nuevo en cada llamada, y zustand compara por identidad: cada render produce
  // una referencia distinta, React la ve como "cambió" y vuelve a renderizar,
  // para siempre. Da "Maximum update depth exceeded" y la pantalla no abre.
  // Se selecciona el array crudo (referencia estable) y se filtra en un useMemo.
  const allComments = useCommentStore(st => st.comments);
  const comments = useMemo(
    () => allComments
      .filter(cm => cm.expenseId === id && !cm.isDeleted)
      .sort((a, b) => a.createdAt - b.createdAt),
    [allComments, id],
  );
  const addComment = useCommentStore(st => st.addComment);
  const removeComment = useCommentStore(st => st.removeComment);
  const removeCommentsForExpense = useCommentStore(st => st.removeForExpense);

  const dateStr = useMemo(() => {
    if (!expense) return '';
    return new Date(expense.date).toLocaleDateString('es-AR', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  }, [expense]);

  if (!expense) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
        <View style={styles.notFound}>
          <Text style={[Typography.bodyL, { color: c.textSecondary }]}>
            {t('expense.not_found')}
          </Text>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={[Typography.bodyM, { color: c.brand.primary }]}>
              {t('common.go_back')}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isCreator = expense.createdById === currentUser?.id;

  // En un grupo de borrado LIBRE (elegido al crearlo) cualquier miembro borra
  // al instante, igual que Splitwise: la defensa no es impedir sino que quede
  // visible en Actividad y se pueda restaurar de un toque. En un grupo con
  // acuerdo sigue mandando la regla #2 y sólo el creador del gasto fuerza.
  const grupoDelGasto = groups.find(g => g.id === expense.groupId);
  // Si el grupo no se puede resolver (todavía no sincronizó, dato a medias) se
  // cae al comportamiento de siempre —el creador manda— y NO al más
  // restrictivo: quitarle el override al creador por no encontrar el grupo
  // sería una regresión silenciosa. Lo atrapó `expenseDetail.test.tsx`.
  const borradoDirecto = !currentUser ? false
    : grupoDelGasto ? borraAlInstante(grupoDelGasto, currentUser.id, expense.createdById)
    : isCreator;

  function handleAddComment(text: string) {
    if (!currentUser || !id) return;
    const now = syncedNow();
    addComment({
      id:        uuidv4(),
      expenseId: id,
      authorId:  currentUser.id,
      text,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    });
  }
  // Un registro que llega por sync puede no traer estos campos (versión vieja
  // del otro lado, o dato a medio escribir). Sin los `?? []` la pantalla no
  // abre y no hay forma de ver el gasto ni de arreglarlo.
  const splits = expense.splits ?? [];

  const ronda = deletionRound(expense);
  const hayPedido = ronda !== null && ronda.status === 'open';
  const yoPedi    = currentUser ? hasRequested(expense, currentUser.id) : false;
  const yoObjete  = currentUser ? hasObjected(expense, currentUser.id) : false;

  /**
   * Pedir el borrado ABRE UNA RONDA NUEVA: se limpian los votos anteriores.
   *
   * Si se acumularan, una objeción vieja bloquearía cualquier pedido futuro
   * para siempre, y un pedido viejo que sobreviviera a la objeción vencería al
   * instante al reabrirse — borrando sin darle a nadie sus 72hs.
   */
  function pedirBorrado() {
    if (!currentUser || !expense) return;
    updateExpense(expense.id, {
      deletionVotes: emitirVoto(expense, currentUser.id, 'delete', Date.now()),
    });
  }

  /** Se borra ya, sin ventana para objetar: creador, o grupo de borrado libre. */
  function forzarBorrado() {
    if (!currentUser || !expense) return;
    updateExpense(expense.id, {
      deletionVotes: emitirVoto(expense, currentUser.id, 'force', Date.now()),
      isDeleted: true,
    });
    // Cascada: si no, los comentarios quedan huérfanos apuntando a un gasto
    // inexistente y viajando en cada sync.
    removeCommentsForExpense(expense.id);
    router.back();
  }

  function handleRequestDelete() {
    if (!currentUser || !expense) return;
    hapticWarning();

    // En un grupo de borrado LIBRE no hay ronda que abrir: se borra y listo,
    // con restaurar como contraparte. Ofrecer "pedir el borrado" ahí sería
    // ofrecer un trámite que ese grupo decidió no tener.
    if (grupoDelGasto && deletionModeOf(grupoDelGasto) === 'open') {
      Alert.alert(
        t('expense.delete_title'),
        t('expense.delete_body_open'),
        [
          { text: t('common.cancel'), style: 'cancel' as const },
          { text: t('expense.delete_expense'), style: 'destructive' as const, onPress: forzarBorrado },
        ],
      );
      return;
    }

    // El creador elige: pedirlo y esperar, o forzarlo. Los demás sólo pueden
    // pedirlo (regla de negocio #2).
    const opciones = isCreator
      ? [
          { text: t('common.cancel'), style: 'cancel' as const },
          { text: t('expense.delete_request'), onPress: pedirBorrado },
          { text: t('expense.delete_force'), style: 'destructive' as const, onPress: forzarBorrado },
        ]
      : [
          { text: t('common.cancel'), style: 'cancel' as const },
          { text: t('expense.delete_request'), style: 'destructive' as const, onPress: pedirBorrado },
        ];

    Alert.alert(
      t('expense.delete_title'),
      isCreator ? t('expense.delete_body_creator') : t('expense.delete_body_member'),
      opciones,
    );
  }

  /** Objetar mata la ronda: el gasto no se borra hasta que alguien pida de nuevo. */
  function objetarBorrado() {
    if (!currentUser || !expense) return;
    hapticLight();
    updateExpense(expense.id, {
      deletionVotes: emitirVoto(expense, currentUser.id, 'object', Date.now()),
    });
  }

  /**
   * Retirar MI pedido, que desde S8 es una acción PROPIA y no una objeción
   * disfrazada: si otra persona sigue queriendo borrar, su ronda sigue viva.
   *
   * Lo que no cambió: frenar es AGREGAR un voto, nunca sacar los que hay. Ver
   * `src/services/deletionVotes.ts`.
   */
  function retirarPedido() {
    if (!currentUser || !expense) return;
    hapticLight();
    updateExpense(expense.id, {
      deletionVotes: emitirVoto(expense, currentUser.id, 'withdraw', Date.now()),
    });
  }

  const nombreDe = (uid: string) => (uid === currentUser?.id ? t('common.you') : getUserName(uid));
  const restante = ronda ? formatearRestante(msUntilDeletion(ronda)) : '';

  // Restaurar y objetar frenan las dos, pero no son lo mismo y el cartel no
  // puede contar una historia que no pasó (R-Q2 del PO).
  const frenada = ronda !== null && ronda.status !== 'open';
  const tituloDeRonda = !ronda ? '' :
    ronda.status === 'restored' ? t('expense.delete_restored_title', { name: nombreDe(ronda.stoppedBy!) }) :
    ronda.status === 'objected' ? t('expense.delete_objected_title', { name: nombreDe(ronda.stoppedBy!) }) :
    t('expense.delete_pending_title');
  const cuerpoDeRonda = !ronda ? '' :
    ronda.status === 'restored' ? t('expense.delete_restored_body') :
    ronda.status === 'objected' ? t('expense.delete_objected_body') :
    t('expense.delete_pending_body', { name: nombreDe(ronda.requestedBy), time: restante });

  const myShare = splits.find(s => s.userId === currentUser?.id)?.amount ?? 0;
  const isPayer = expense.paidById === currentUser?.id;
  const netForMe = isPayer ? expense.amount - myShare : -myShare;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.borderHair }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={c.brand.primary} />
        </Pressable>
        <Text style={[Typography.h3, { color: c.text }]} numberOfLines={1}>
          {t('expense.detail_title')}
        </Text>
        {isCreator && !expense.isDeleted ? (
          <View style={styles.headerRight}>
            <Pressable
              onPress={() => router.push(`/expense/new?expenseId=${expense.id}` as any)}
              style={styles.iconBtn}
            >
              <Ionicons name="pencil-outline" size={20} color={c.brand.primary} />
            </Pressable>
            <Pressable onPress={handleRequestDelete} style={styles.iconBtn}>
              <Ionicons name="trash-outline" size={20} color={c.semantic.negative} />
            </Pressable>
          </View>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Hero */}
        <View style={styles.hero}>
          <CategoryIcon kind={expense.category as CategoryKind} size={64} />
          <Text style={[Typography.h1, { color: c.text, textAlign: 'center', marginTop: 12 }]}>
            {expense.description}
          </Text>
          <MoneyText minor={expense.amount} code={expense.currency} style={[Typography.amountL, { color: c.text, marginTop: 4 }]} />
          <Text style={[Typography.bodyS, { color: c.textTertiary, marginTop: 4 }]}>
            {dateStr}
          </Text>
        </View>

        {/* Mi balance en este gasto */}
        <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
          <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', marginBottom: 12 }]}>
            {t('expense.your_balance')}
          </Text>
          <View style={styles.balanceRow}>
            <View style={styles.balanceCol}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>
                {t('expense.paid_by')}
              </Text>
              <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600', marginTop: 2 }]}>
                {isPayer ? t('common.you') : getUserName(expense.paidById)}
              </Text>
            </View>
            <View style={styles.balanceDivider} />
            <View style={styles.balanceCol}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>
                {t('expense.your_share')}
              </Text>
              <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600', marginTop: 2 }]}>
                {formatMoney(myShare, expense.currency)}
              </Text>
            </View>
            <View style={styles.balanceDivider} />
            <View style={styles.balanceCol}>
              <Text style={[Typography.caption, { color: c.textTertiary }]}>
                {t('expense.net')}
              </Text>
              <Text style={[Typography.amountS, {
                color: netForMe >= 0 ? c.semantic.positive : c.semantic.negative,
                marginTop: 2,
              }]}>
                {netForMe >= 0 ? '+' : ''}{formatMoney(netForMe, expense.currency)}
              </Text>
            </View>
          </View>
        </View>

        {/* Splits */}
        <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
          <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', marginBottom: 12 }]}>
            {t('expense.split_detail')}
          </Text>
          {splits.map((split, i) => {
            const name = split.userId === currentUser?.id
              ? t('common.you')
              : getUserName(split.userId);
            const isThisPayer = expense.paidById === split.userId;
            return (
              <View
                key={split.userId}
                style={[
                  styles.splitRow,
                  i < splits.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderHair },
                ]}
              >
                <UserAvatar userId={split.userId} name={name} size={36} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[Typography.bodyM, { color: c.text, fontWeight: '600' }]}>
                    {name}
                    {isThisPayer && (
                      <Text style={{ color: c.textTertiary, fontWeight: '400' }}>
                        {' '}· {t('expense.paid_label')}
                      </Text>
                    )}
                  </Text>
                </View>
                <Text style={[Typography.amountS, { color: c.text }]}>
                  {formatMoney(split.amount, expense.currency)}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Nota */}
        {expense.note ? (
          <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.borderHair }]}>
            <Text style={[Typography.caption, { color: c.textTertiary, textTransform: 'uppercase', marginBottom: 8 }]}>
              {t('expense.note')}
            </Text>
            <Text style={[Typography.bodyM, { color: c.text }]}>{expense.note}</Text>
          </View>
        ) : null}

        {/* Estado de la solicitud de borrado. Decir QUIÉN lo pidió y CUÁNTO
            falta es lo que hace accionable el aviso: "pendiente" a secas no le
            dice a nadie si tiene que hacer algo ni cuándo. */}
        {ronda && !expense.isDeleted && (
          <View style={[
            styles.section, styles.warningSection,
            frenada
              ? { backgroundColor: c.surfaceSunken, borderColor: c.borderHair }
              : { backgroundColor: c.semantic.warningSoft, borderColor: c.semantic.warning },
          ]}>
            <Ionicons
              name={frenada ? 'hand-left-outline' : 'time-outline'}
              size={18}
              color={frenada ? c.textSecondary : c.semantic.warning}
            />
            <View style={{ flex: 1 }}>
              <Text style={[Typography.bodyM, {
                color: frenada ? c.text : c.semantic.warning, fontWeight: '600',
              }]}>
                {tituloDeRonda}
              </Text>
              <Text style={[Typography.bodyS, {
                color: frenada ? c.textSecondary : c.semantic.warning,
                marginTop: 2, opacity: 0.9,
              }]}>
                {cuerpoDeRonda}
              </Text>
            </View>
          </View>
        )}

        {/* Acciones. Objetar y retirar el pedido NO son lo mismo: objetar frena
            el borrado de todos, retirar sólo me saca a mí. */}
        {!expense.isDeleted && currentUser && (
          <View style={[styles.section, { paddingHorizontal: Spacing.screenPad, gap: Spacing[2] }]}>
            {hayPedido && !yoPedi && !yoObjete && (
              <Pressable
                accessibilityRole="button"
                onPress={objetarBorrado}
                style={[styles.actionBtn, { borderColor: c.brand.primary, backgroundColor: c.surface }]}
              >
                <Ionicons name="hand-left-outline" size={16} color={c.brand.primary} />
                <Text style={[Typography.bodyM, { color: c.brand.primary, fontWeight: '600' }]}>
                  {t('expense.object_delete')}
                </Text>
              </Pressable>
            )}

            {hayPedido && yoPedi && (
              <Pressable
                accessibilityRole="button"
                onPress={retirarPedido}
                style={[styles.actionBtn, { borderColor: c.borderHair, backgroundColor: c.surface }]}
              >
                <Text style={[Typography.bodyM, { color: c.textSecondary, fontWeight: '600' }]}>
                  {t('expense.withdraw_request')}
                </Text>
              </Pressable>
            )}

            {!hayPedido && (
              <Pressable
                accessibilityRole="button"
                onPress={handleRequestDelete}
                style={[styles.actionBtn, { borderColor: c.semantic.negativeSoft, backgroundColor: c.semantic.negativeSoft }]}
              >
                <Ionicons name="trash-outline" size={16} color={c.semantic.negative} />
                <Text style={[Typography.bodyM, { color: c.semantic.negative, fontWeight: '600' }]}>
                  {borradoDirecto ? t('expense.delete_expense') : t('expense.request_delete')}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Comentarios */}
        <View style={{ marginTop: Spacing[6] }}>
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
  header:   {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPad, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn:    { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  headerRight:{ flexDirection: 'row', alignItems: 'center' },
  iconBtn:    { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  scroll:   { paddingTop: Spacing[4] },
  hero:     { alignItems: 'center', paddingHorizontal: Spacing.screenPad, marginBottom: Spacing[5] },
  section:  {
    marginHorizontal: Spacing.screenPad, marginBottom: Spacing[4],
    borderRadius: Radius.lg, borderWidth: 1, padding: Spacing[4],
  },
  balanceRow:    { flexDirection: 'row', alignItems: 'center' },
  balanceCol:    { flex: 1, alignItems: 'center' },
  balanceDivider:{ width: StyleSheet.hairlineWidth, height: 32, backgroundColor: '#E0D9D0' },
  splitRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  warningSection:{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  actionBtn:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: Radius.md, borderWidth: 1,
  },
  notFound:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});
