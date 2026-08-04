import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HeroSigil } from '@/components/hero-sigil';
import { ThemedText } from '@/components/themed-text';
import { AppButton, Card, Pill } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import type { Archetype, StrictnessMode } from '@/domain/types';
import { archetypeLabel } from '@/shared/presentation/archetypes';
import { useApp } from '@/state';

const ARCHETYPES: Archetype[] = ['pathfinder', 'scholar', 'guardian'];
const MODES: Array<{ value: StrictnessMode; label: string; detail: string }> = [
  { value: 'gentle', label: 'Бережный', detail: 'Мягкие последствия' },
  { value: 'balanced', label: 'Равновесие', detail: 'Честно, но без давления' },
  { value: 'strict', label: 'Строгий', detail: 'Заметная цена пропуска' },
];

export function OnboardingScreen() {
  const { finishOnboarding } = useApp();
  const [step, setStep] = useState(0);
  const [contractAccepted, setContractAccepted] = useState(false);
  const [archetype, setArchetype] = useState<Archetype>('pathfinder');
  const [strictness, setStrictness] = useState<StrictnessMode>('balanced');
  const [name, setName] = useState('');

  const finish = () => finishOnboarding({ name, archetype, strictness });

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={[Palette.ink, '#111024', Palette.ink]} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={styles.orb} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.topbar}>
          <ThemedText type="eyebrow" style={styles.brand}>
            ACTUM
          </ThemedText>
          <View style={styles.dots}>
            {[0, 1, 2, 3].map((index) => (
              <View key={index} style={[styles.dot, index === step && styles.dotActive]} />
            ))}
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {step === 0 ? (
            <View style={styles.centerStage}>
              <View style={styles.heroWrap}>
                <HeroSigil size={184} />
                <Pill tone="gold" style={styles.prototypePill}>
                  local-first MVP
                </Pill>
              </View>
              <View style={styles.introCopy}>
                <ThemedText type="display" style={styles.centerText}>
                  Твоя цель.{'\n'}Твой путь.
                </ThemedText>
                <ThemedText style={[styles.lead, styles.centerText]}>
                  Actum превращает реальные намерения в миссии, а честные действия — в историю героя.
                </ThemedText>
              </View>
              <View style={styles.principleRow}>
                <MiniPrinciple icon="◎" label="Одна цель" />
                <MiniPrinciple icon="→" label="Малые шаги" />
                <MiniPrinciple icon="✦" label="Живой прогресс" />
              </View>
            </View>
          ) : null}

          {step === 1 ? (
            <View style={styles.stage}>
              <View style={styles.copyBlock}>
                <ThemedText type="eyebrow" style={styles.brand}>
                  Законы мира
                </ThemedText>
                <ThemedText type="title">Договор честности</ThemedText>
                <ThemedText style={styles.lead}>
                  Actum не проверяет тебя. Смысл появляется, только когда отчёт правдив.
                </ThemedText>
              </View>

              <Rule number="01" title="Действие создаёт прогресс" text="Не планы и не красивые слова — только сделанный шаг." />
              <Rule number="02" title="Провал не ломает игру" text="Честное «не сделал» запускает последствия и путь возвращения." />
              <Rule number="03" title="Двойник — не обещание" text="Он показывает вероятную траекторию по утверждённому плану." />

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: contractAccepted }}
                onPress={() => setContractAccepted((value) => !value)}
                style={({ pressed }) => [styles.contract, pressed && styles.pressed]}>
                <View style={[styles.checkbox, contractAccepted && styles.checkboxChecked]}>
                  {contractAccepted ? <ThemedText style={styles.check}>✓</ThemedText> : null}
                </View>
                <ThemedText style={styles.contractText}>
                  Я буду отмечать результат честно, включая частичное выполнение и пропуски.
                </ThemedText>
              </Pressable>
            </View>
          ) : null}

          {step === 2 ? (
            <View style={styles.stage}>
              <View style={styles.copyBlock}>
                <ThemedText type="eyebrow" style={styles.brand}>
                  Твой герой
                </ThemedText>
                <ThemedText type="title">Выбери архетип</ThemedText>
                <ThemedText style={styles.lead}>
                  Это визуальный образ, а не ограничение. Меняется только настроение пути.
                </ThemedText>
              </View>
              <View style={styles.archetypes}>
                {ARCHETYPES.map((item) => (
                  <Pressable
                    key={item}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: archetype === item }}
                    onPress={() => setArchetype(item)}
                    style={({ pressed }) => [
                      styles.archetype,
                      archetype === item && styles.archetypeActive,
                      pressed && styles.pressed,
                    ]}>
                    <HeroSigil archetype={item} size={94} dimmed={archetype !== item} />
                    <ThemedText type="smallBold" style={styles.centerText}>
                      {archetypeLabel(item)}
                    </ThemedText>
                    <ThemedText type="small" style={[styles.muted, styles.centerText]}>
                      {item === 'pathfinder'
                        ? 'Ищет дорогу'
                        : item === 'scholar'
                          ? 'Собирает знание'
                          : 'Держит обещание'}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {step === 3 ? (
            <View style={styles.stage}>
              <View style={styles.finalHero}>
                <HeroSigil archetype={archetype} size={128} level={1} />
              </View>
              <View style={styles.copyBlock}>
                <ThemedText type="eyebrow" style={styles.brand}>
                  Последний штрих
                </ThemedText>
                <ThemedText type="title">Как тебя называть?</ThemedText>
              </View>
              <TextInput
                accessibilityLabel="Имя героя"
                autoCapitalize="words"
                maxLength={24}
                onChangeText={setName}
                placeholder="Например, Алекс"
                placeholderTextColor={Palette.textDim}
                returnKeyType="done"
                style={styles.input}
                value={name}
              />

              <View style={styles.modeBlock}>
                <ThemedText type="smallBold">Тон последствий</ThemedText>
                <View style={styles.modeList}>
                  {MODES.map((mode) => (
                    <Pressable
                      key={mode.value}
                      onPress={() => setStrictness(mode.value)}
                      style={({ pressed }) => [
                        styles.mode,
                        strictness === mode.value && styles.modeActive,
                        pressed && styles.pressed,
                      ]}>
                      <View style={styles.modeText}>
                        <ThemedText type="smallBold">{mode.label}</ThemedText>
                        <ThemedText type="small" style={styles.muted}>
                          {mode.detail}
                        </ThemedText>
                      </View>
                      <View style={[styles.radio, strictness === mode.value && styles.radioActive]} />
                    </Pressable>
                  ))}
                </View>
              </View>
              <ThemedText type="small" style={[styles.muted, styles.disclaimer]}>
                Actum помогает структурировать личные цели, но не является медицинским устройством и не заменяет специалиста.
              </ThemedText>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          {step > 0 ? (
            <AppButton label="Назад" variant="ghost" onPress={() => setStep((value) => value - 1)} />
          ) : null}
          <AppButton
            label={step === 3 ? 'Начать путь' : 'Продолжить'}
            disabled={(step === 1 && !contractAccepted) || (step === 3 && !name.trim())}
            onPress={step === 3 ? finish : () => setStep((value) => value + 1)}
            style={styles.continueButton}
          />
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function MiniPrinciple({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={styles.miniPrinciple}>
      <ThemedText style={styles.miniIcon}>{icon}</ThemedText>
      <ThemedText type="small" style={styles.muted}>
        {label}
      </ThemedText>
    </View>
  );
}

function Rule({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <Card style={styles.rule}>
      <ThemedText type="eyebrow" style={styles.ruleNumber}>
        {number}
      </ThemedText>
      <View style={styles.ruleCopy}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" style={styles.muted}>
          {text}
        </ThemedText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Palette.ink },
  safe: { flex: 1 },
  orb: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    top: -250,
    right: -180,
    backgroundColor: '#6E5EC622',
  },
  topbar: {
    minHeight: 54,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { color: Palette.gold },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Palette.line },
  dotActive: { width: 22, backgroundColor: Palette.gold },
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 580,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  centerStage: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.five },
  stage: { flex: 1, justifyContent: 'center', gap: Spacing.three },
  heroWrap: { alignItems: 'center', gap: Spacing.two },
  prototypePill: { marginTop: -12 },
  introCopy: { gap: Spacing.three },
  centerText: { textAlign: 'center' },
  lead: { color: Palette.textMuted, fontSize: 17, lineHeight: 26 },
  principleRow: { flexDirection: 'row', gap: Spacing.three },
  miniPrinciple: { alignItems: 'center', gap: 6, minWidth: 82 },
  miniIcon: { color: Palette.goldBright, fontSize: 21 },
  copyBlock: { gap: Spacing.two, marginBottom: Spacing.two },
  muted: { color: Palette.textMuted },
  rule: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: Radius.medium, padding: 14 },
  ruleNumber: { color: Palette.gold, width: 34 },
  ruleCopy: { flex: 1, gap: 3 },
  contract: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.twoHalf,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: '#56462B',
    backgroundColor: '#2A231744',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: Palette.textDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: Palette.gold, borderColor: Palette.gold },
  check: { color: Palette.ink, fontWeight: 900 },
  contractText: { flex: 1, lineHeight: 22 },
  archetypes: { flexDirection: 'row', gap: Spacing.two },
  archetype: {
    flex: 1,
    minHeight: 190,
    padding: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: Radius.large,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
  },
  archetypeActive: { borderColor: Palette.gold, backgroundColor: '#201D28' },
  pressed: { opacity: 0.74 },
  finalHero: { alignItems: 'center', marginBottom: -8 },
  input: {
    minHeight: 58,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    color: Palette.text,
    paddingHorizontal: Spacing.three,
    fontSize: 18,
  },
  modeBlock: { gap: Spacing.two },
  modeList: { gap: Spacing.two },
  mode: {
    minHeight: 58,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modeActive: { borderColor: Palette.violet, backgroundColor: '#1E1B35' },
  modeText: { gap: 2 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: Palette.textDim },
  radioActive: { borderWidth: 5, borderColor: Palette.violetSoft },
  disclaimer: { lineHeight: 19, marginTop: Spacing.two },
  footer: {
    minHeight: 78,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.line,
    backgroundColor: '#090B14EE',
  },
  continueButton: { flex: 1 },
});
