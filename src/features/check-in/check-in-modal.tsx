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
import { InfoPopover } from '@/components/ui/info-popover';
import { AppButton } from '@/components/ui/primitives';
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
              <ThemedText type="title">Check-in</ThemedText>
              <View style={styles.missionRow}>
                <ThemedText type="small" numberOfLines={2} style={[styles.muted, styles.flex]}>
                  {mission?.title}
                </ThemedText>
                {mission?.completionCriterion ? (
                  <InfoPopover
                    title="Completion criterion"
                    accessibilityLabel="Show the completion criterion"
                    sections={[{ body: mission.completionCriterion }]}
                  />
                ) : null}
              </View>
            </View>
            <Pressable
              accessibilityLabel="Close"
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
            {!canSubmit ? (
              <View style={styles.unavailableCard}>
                <View style={styles.rowBetween}>
                  <ThemedText type="smallBold" style={styles.flex}>
                    Finish your session first
                  </ThemedText>
                  <InfoPopover
                    title="Why is check-in unavailable?"
                    sections={[
                      {
                        body: 'Check-in is linked to a saved session log, so an empty result cannot be submitted.',
                      },
                    ]}
                  />
                </View>
              </View>
            ) : null}

            <View style={styles.options}>
              <View style={styles.rowBetween}>
                <ThemedText type="subtitle">Result</ThemedText>
                <InfoPopover
                  title="How is the result scored?"
                  sections={[
                    { heading: 'Completed', body: `Full reward: +${mission?.xp ?? 0} XP.` },
                    { heading: 'Partial', body: 'Partial reward; your streak does not increase.' },
                    { heading: 'Not completed', body: 'Your result is saved without a reward.' },
                  ]}
                />
              </View>
              <OutcomeChoice
                icon="✓"
                title="Completed"
                selected={outcome === 'completed'}
                disabled={!canSubmit || !runSuccessful}
                tone="success"
                onPress={() => setOutcome('completed')}
              />
              <OutcomeChoice
                icon="≈"
                title="Partial"
                selected={outcome === 'partial'}
                disabled={!canSubmit}
                tone="warning"
                onPress={() => setOutcome('partial')}
              />
              <OutcomeChoice
                icon="—"
                title="Not completed"
                selected={outcome === 'skipped'}
                disabled={!canSubmit}
                tone="danger"
                onPress={() => setOutcome('skipped')}
              />
            </View>

            <View style={styles.noteBlock}>
              <ThemedText type="smallBold">
                Comment{' '}
                <ThemedText type="small" style={styles.muted}>
                  (optional)
                </ThemedText>
              </ThemedText>
              <TextInput
                accessibilityLabel="Result note"
                maxLength={280}
                multiline
                onChangeText={(value) => {
                  setNote(value);
                  if (run && onSaveComment) onSaveComment(run.id, value);
                }}
                placeholder="A short note…"
                placeholderTextColor={Palette.textDim}
                style={styles.input}
                value={note}
              />
            </View>

            <AppButton
              label="Save"
              disabled={!canSubmit}
              onPress={submit}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function OutcomeChoice({
  icon,
  title,
  selected,
  disabled = false,
  tone,
  onPress,
}: {
  icon: string;
  title: string;
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
  missionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
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
  flex: { flex: 1 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  unavailableCard: {
    gap: Spacing.one,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(199, 120, 0, 0.22)',
    backgroundColor: 'rgba(255, 149, 0, 0.08)',
    padding: Spacing.twoHalf,
  },
  options: { gap: Spacing.two },
  option: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    padding: Spacing.twoHalf,
  },
  optionDisabled: { opacity: 0.42 },
  pressed: { opacity: 0.72 },
  outcomeIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionCopy: { flex: 1, gap: 2 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: Palette.textDim },
  noteBlock: { gap: Spacing.two },
  input: {
    minHeight: 76,
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
