import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppButton, Pill } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { Mission, MissionOutcome } from '@/domain/types';

type Outcome = Exclude<MissionOutcome, 'pending'>;

export function CheckInModal({
  mission,
  visible,
  onClose,
  onSubmit,
}: {
  mission?: Mission;
  visible: boolean;
  onClose(): void;
  onSubmit(outcome: Outcome, note?: string): void;
}) {
  const [outcome, setOutcome] = useState<Outcome>('completed');
  const [note, setNote] = useState('');

  const submit = async () => {
    await Haptics.notificationAsync(
      outcome === 'completed'
        ? Haptics.NotificationFeedbackType.Success
        : outcome === 'partial'
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Error,
    ).catch(() => undefined);
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

          <View style={styles.options}>
            <OutcomeChoice
              icon="✓"
              title="Выполнено"
              text={`Полная награда · +${mission?.xp ?? 0} XP`}
              selected={outcome === 'completed'}
              tone="success"
              onPress={() => setOutcome('completed')}
            />
            <OutcomeChoice
              icon="≈"
              title="Частично"
              text="Часть награды · серия не растёт"
              selected={outcome === 'partial'}
              tone="warning"
              onPress={() => setOutcome('partial')}
            />
            <OutcomeChoice
              icon="—"
              title="Не получилось"
              text="Последствие + короткий путь возвращения"
              selected={outcome === 'skipped'}
              tone="danger"
              onPress={() => setOutcome('skipped')}
            />
          </View>

          <View style={styles.noteBlock}>
            <ThemedText type="smallBold">Что повлияло? <ThemedText type="small" style={styles.muted}>(необязательно)</ThemedText></ThemedText>
            <TextInput
              accessibilityLabel="Заметка о результате"
              maxLength={280}
              multiline
              onChangeText={setNote}
              placeholder="Короткая честная заметка поможет перестроить план…"
              placeholderTextColor={Palette.textDim}
              style={styles.input}
              value={note}
            />
          </View>

          <View style={styles.spacer} />
          <AppButton
            label={
              outcome === 'completed'
                ? 'Забрать награду'
                : outcome === 'partial'
                  ? 'Сохранить честный результат'
                  : 'Принять последствие'
            }
            onPress={submit}
          />
          <ThemedText type="small" style={[styles.muted, styles.center]}>
            Честный провал полезнее ложной победы.
          </ThemedText>
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
  tone,
  onPress,
}: {
  icon: string;
  title: string;
  text: string;
  selected: boolean;
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
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
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
  spacer: { flex: 1 },
});
