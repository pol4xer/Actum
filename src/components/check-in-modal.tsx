import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { RunSummary } from '@/components/in-app-mission-runner';
import { AppButton, Pill } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { isMissionRunSuccessful } from '@/domain/mission-run';
import { Mission, MissionOutcome, MissionRun } from '@/domain/types';
import { NotificationFeedbackType, notify } from '@/lib/haptics';

type Outcome = Exclude<MissionOutcome, 'pending'>;

export function CheckInModal({
  mission,
  run,
  visible,
  onClose,
  onSaveComment,
  onSubmit,
}: {
  mission?: Mission;
  run?: MissionRun;
  visible: boolean;
  onClose(): void;
  onSaveComment?(runId: string, value: string): void;
  onSubmit(outcome: Outcome, note?: string): void;
}) {
  const [outcome, setOutcome] = useState<Outcome>('completed');
  const [note, setNote] = useState('');
  const requiresRun = mission?.execution?.kind === 'in_app';
  const canSubmit = !requiresRun || run?.status === 'awaiting_checkin';
  const runSuccessful = requiresRun ? Boolean(run && isMissionRunSuccessful(run)) : true;

  useEffect(() => {
    if (!visible) return;
    setOutcome(runSuccessful ? 'completed' : 'partial');
    setNote(run?.finalCommentDraft ?? '');
  }, [mission?.id, run?.id, runSuccessful, visible]);

  const submit = async () => {
    await notify(
      outcome === 'completed'
        ? NotificationFeedbackType.Success
        : outcome === 'partial'
          ? NotificationFeedbackType.Warning
          : NotificationFeedbackType.Error,
    );
    onSubmit(outcome, note);
    setNote('');
    setOutcome('completed');
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      visible={visible}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Pill tone="gold">честный check-in</Pill>
              <ThemedText type="title">Как всё прошло?</ThemedText>
              <ThemedText style={styles.muted}>{mission?.title}</ThemedText>
            </View>
            <Pressable
              accessibilityLabel="Закрыть"
              accessibilityRole="button"
              onPress={onClose}
              style={styles.close}>
              <ThemedText style={styles.closeText}>×</ThemedText>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {mission?.completionCriterion ? (
              <View style={styles.criterionCard}>
                <ThemedText type="eyebrow" style={styles.muted}>
                  критерий полного выполнения
                </ThemedText>
                <ThemedText type="smallBold">{mission.completionCriterion}</ThemedText>
              </View>
            ) : null}

            {mission && run ? <RunSummary mission={mission} run={run} /> : null}

            {!canSubmit ? (
              <View style={styles.unavailableCard}>
                <ThemedText type="smallBold">Сначала заверши встроенную сессию Actum.</ThemedText>
                <ThemedText type="small" style={styles.muted}>
                  Check-in привязывается к сохранённому журналу, поэтому пустой результат не будет принят.
                </ThemedText>
              </View>
            ) : null}

            <View style={styles.options}>
              <OutcomeChoice
                icon="✓"
                title="Выполнено"
                text={`Полная награда · +${mission?.xp ?? 0} XP`}
                selected={outcome === 'completed'}
                disabled={!canSubmit || !runSuccessful}
                tone="success"
                onPress={() => setOutcome('completed')}
              />
              <OutcomeChoice
                icon="≈"
                title="Частично"
                text="Часть награды · серия не растёт"
                selected={outcome === 'partial'}
                disabled={!canSubmit}
                tone="warning"
                onPress={() => setOutcome('partial')}
              />
              <OutcomeChoice
                icon="—"
                title="Не выполнено"
                text="Результат сохранится без награды"
                selected={outcome === 'skipped'}
                disabled={!canSubmit}
                tone="danger"
                onPress={() => setOutcome('skipped')}
              />
            </View>

            <View style={styles.noteBlock}>
              <ThemedText type="smallBold">
                Итоговый комментарий и недочёты{' '}
                <ThemedText type="small" style={styles.muted}>
                  (необязательно)
                </ThemedText>
              </ThemedText>
              <TextInput
                accessibilityLabel="Заметка о результате"
                maxLength={280}
                multiline
                onChangeText={(value) => {
                  setNote(value);
                  if (run && onSaveComment) onSaveComment(run.id, value);
                }}
                placeholder="Что получилось, где не хватило времени, что изменить в следующей сессии…"
                placeholderTextColor={Palette.textDim}
                style={styles.input}
                value={note}
              />
            </View>

            <AppButton
              label={
                outcome === 'completed'
                  ? 'Забрать награду'
                  : outcome === 'partial'
                    ? 'Сохранить честный результат'
                    : 'Сохранить результат'
              }
              disabled={!canSubmit}
              onPress={submit}
            />
            <ThemedText type="small" style={[styles.muted, styles.center]}>
              Фактические результаты и комментарии останутся в журнале Actum.
            </ThemedText>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function OutcomeChoice({
  icon,
  title,
  text,
  selected,
  disabled = false,
  tone,
  onPress,
}: {
  icon: string;
  title: string;
  text: string;
  selected: boolean;
  disabled?: boolean;
  tone: 'success' | 'warning' | 'danger';
  onPress(): void;
}) {
  const colors = {
    success: Palette.success,
    warning: Palette.warning,
    danger: Palette.danger,
  };
  return (
    <Pressable
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        disabled && styles.optionDisabled,
        selected && { borderColor: colors[tone], backgroundColor: `${colors[tone]}14` },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.outcomeIcon, { borderColor: colors[tone] }]}>
        <ThemedText style={{ color: colors[tone], fontSize: 20 }}>{icon}</ThemedText>
      </View>
      <View style={styles.optionCopy}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" style={styles.muted}>
          {text}
        </ThemedText>
      </View>
      <View style={[styles.radio, selected && { borderWidth: 5, borderColor: colors[tone] }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Palette.inkRaised },
  safe: { flex: 1, paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.three },
  content: { flexGrow: 1, gap: Spacing.three, paddingBottom: Spacing.four },
  handle: {
    alignSelf: 'center',
    width: 46,
    height: 5,
    borderRadius: 3,
    backgroundColor: Palette.line,
    marginTop: Spacing.two,
  },
  header: { flexDirection: 'row', gap: Spacing.three },
  headerCopy: { flex: 1, gap: Spacing.two },
  close: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: Palette.surface,
  },
  closeText: { color: Palette.textMuted, fontSize: 27, lineHeight: 29 },
  muted: { color: Palette.textMuted },
  center: { textAlign: 'center' },
  criterionCard: {
    gap: Spacing.one,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: '#4A432E',
    backgroundColor: '#262316',
    padding: Spacing.twoHalf,
  },
  unavailableCard: {
    gap: Spacing.one,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: '#614A2C',
    backgroundColor: '#2A2117',
    padding: Spacing.twoHalf,
  },
  options: { gap: Spacing.two },
  option: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    padding: Spacing.twoHalf,
  },
  optionDisabled: { opacity: 0.42 },
  pressed: { opacity: 0.72 },
  outcomeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  optionCopy: { flex: 1, gap: 2 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: Palette.textDim },
  noteBlock: { gap: Spacing.two },
  input: {
    minHeight: 96,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    color: Palette.text,
    padding: Spacing.three,
    fontSize: 16,
    textAlignVertical: 'top',
  },
});
