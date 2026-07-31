import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppButton, Card, Pill, Screen, ScreenHeader } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { buildGoal, checkGoalRisk } from '@/domain/goal-engine';
import { GeneratedGoal, GoalInput } from '@/domain/types';
import { AIPlannerError, generateGoalWithAI } from '@/lib/ai-planner';
import { useApp } from '@/state/app-context';

type Stage = 'intent' | 'details' | 'generating' | 'review' | 'error' | 'blocked';

const MINUTES = [10, 20, 30];
const HORIZONS = [
  { value: 7, label: '7 дней' },
  { value: 14, label: '2 недели' },
  { value: 28, label: '4 недели' },
];

export function GoalBuilder() {
  const { createGoal } = useApp();
  const [stage, setStage] = useState<Stage>('intent');
  const [prompt, setPrompt] = useState('');
  const [dailyMinutes, setDailyMinutes] = useState(20);
  const [horizonDays, setHorizonDays] = useState(14);
  const [currentLevel, setCurrentLevel] = useState<GoalInput['currentLevel']>('starting');
  const [preview, setPreview] = useState<GeneratedGoal>();
  const [generationError, setGenerationError] = useState('');
  const risk = useMemo(() => checkGoalRisk(prompt), [prompt]);
  const input = useMemo(
    () => ({ prompt, dailyMinutes, horizonDays, currentLevel }),
    [currentLevel, dailyMinutes, horizonDays, prompt],
  );

  const continueFromIntent = () => setStage(risk.safe ? 'details' : 'blocked');
  const generate = async () => {
    setGenerationError('');
    setStage('generating');
    try {
      setPreview(await generateGoalWithAI(input));
      setStage('review');
    } catch (error) {
      setGenerationError(
        error instanceof AIPlannerError ? error.message : 'Не удалось получить план от GPT.',
      );
      setStage('error');
    }
  };
  const useLocalFallback = () => {
    setPreview(buildGoal(input));
    setStage('review');
  };
  const save = () => {
    if (preview) createGoal(preview);
  };

  if (stage === 'blocked') {
    return (
      <Screen>
        <View style={styles.blocked}>
          <View style={styles.blockedIcon}>
            <ThemedText style={styles.blockedGlyph}>!</ThemedText>
          </View>
          <Pill tone="danger">safety gate</Pill>
          <ThemedText type="title" style={styles.center}>
            {!risk.safe ? risk.title : 'Нужна другая формулировка'}
          </ThemedText>
          <ThemedText style={[styles.lead, styles.center]}>
            {!risk.safe
              ? risk.message
              : 'Переформулируй намерение как небольшой безопасный шаг.'}
          </ThemedText>
          <AppButton label="Изменить цель" onPress={() => setStage('intent')} style={styles.fullWidth} />
          <ThemedText type="small" style={[styles.muted, styles.center]}>
            Если есть непосредственная опасность для тебя или другого человека, обратись в местную экстренную службу.
          </ThemedText>
        </View>
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <ScreenHeader
          eyebrow={`Новая цель · ${stage === 'intent' ? '1' : stage === 'details' ? '2' : '3'} из 3`}
          title={
            stage === 'intent'
              ? 'Что хочешь изменить?'
              : stage === 'details'
                ? 'Сделаем цель реальной'
                : stage === 'generating'
                  ? 'GPT собирает маршрут'
                  : stage === 'error'
                    ? 'План пока не пришёл'
                    : 'Твой первый маршрут'
          }
          subtitle={
            stage === 'intent'
              ? 'Напиши обычными словами. Пока только одна главная цель.'
              : stage === 'details'
                ? 'Нам нужны ограничения, а не идеальные условия.'
                : stage === 'generating'
                  ? 'Отправляем цель в OpenAI и ждём структурированный план.'
                  : stage === 'error'
                    ? 'Можно повторить запрос или продолжить с локальным шаблоном.'
                    : preview?.plan.research.method === 'openai-responses-v1'
                      ? 'GPT вернул план, который уже превращён в главы и миссии Actum.'
                      : 'Локальный fallback собрал план без сети.'
          }
        />

        {stage === 'intent' ? (
          <>
            <TextInput
              accessibilityLabel="Формулировка цели"
              autoFocus
              multiline
              onChangeText={setPrompt}
              placeholder="Например: хочу дочитать книгу, научиться готовить пять блюд или разобрать документы"
              placeholderTextColor={Palette.textDim}
              style={styles.promptInput}
              textAlignVertical="top"
              value={prompt}
            />
            <View style={styles.exampleBlock}>
              <ThemedText type="eyebrow" style={styles.muted}>
                Подходящие для MVP цели
              </ThemedText>
              <View style={styles.exampleWrap}>
                {['Дочитать книгу', 'Выучить основы испанского', 'Разобрать документы'].map(
                  (example) => (
                    <Pressable
                      key={example}
                      onPress={() => setPrompt(example)}
                      style={({ pressed }) => [styles.example, pressed && styles.pressed]}>
                      <ThemedText type="small">{example}</ThemedText>
                    </Pressable>
                  ),
                )}
              </View>
            </View>
            <Card style={styles.notice}>
              <ThemedText style={styles.noticeIcon}>⌁</ThemedText>
              <ThemedText type="small" style={styles.noticeText}>
                Опасные, медицинские и экстремальные запросы не превращаются в actionable-план.
              </ThemedText>
            </Card>
            <AppButton
              label="Проверить намерение"
              disabled={prompt.trim().length < 5}
              onPress={continueFromIntent}
            />
          </>
        ) : null}

        {stage === 'details' ? (
          <>
            <Question title="Сколько времени реально есть в день?">
              <ChoiceRow>
                {MINUTES.map((value) => (
                  <Choice
                    key={value}
                    label={`${value} мин`}
                    selected={dailyMinutes === value}
                    onPress={() => setDailyMinutes(value)}
                  />
                ))}
              </ChoiceRow>
            </Question>

            <Question title="Какой первый горизонт?">
              <ChoiceRow>
                {HORIZONS.map((option) => (
                  <Choice
                    key={option.value}
                    label={option.label}
                    selected={horizonDays === option.value}
                    onPress={() => setHorizonDays(option.value)}
                  />
                ))}
              </ChoiceRow>
            </Question>

            <Question title="Точка старта">
              <View style={styles.levelList}>
                <LevelChoice
                  label="Начинаю с нуля"
                  selected={currentLevel === 'starting'}
                  onPress={() => setCurrentLevel('starting')}
                />
                <LevelChoice
                  label="Есть небольшой опыт"
                  selected={currentLevel === 'some-experience'}
                  onPress={() => setCurrentLevel('some-experience')}
                />
                <LevelChoice
                  label="Возвращаюсь после паузы"
                  selected={currentLevel === 'returning'}
                  onPress={() => setCurrentLevel('returning')}
                />
              </View>
            </Question>

            <View style={styles.buttonRow}>
              <AppButton label="Назад" variant="ghost" onPress={() => setStage('intent')} />
              <AppButton label="Собрать план с GPT" onPress={generate} style={styles.flex} />
            </View>
          </>
        ) : null}

        {stage === 'generating' ? (
          <Card accent style={styles.generatingCard}>
            <ActivityIndicator color={Palette.goldBright} size="large" />
            <ThemedText type="subtitle" style={styles.center}>
              Разбираем цель на реальные шаги…
            </ThemedText>
            <ThemedText style={[styles.muted, styles.center]}>
              Обычно это занимает несколько секунд. Не закрывай development build.
            </ThemedText>
          </Card>
        ) : null}

        {stage === 'error' ? (
          <Card style={styles.errorCard}>
            <Pill tone="warning">AI недоступен</Pill>
            <ThemedText type="subtitle">Не удалось получить план</ThemedText>
            <ThemedText style={styles.muted}>{generationError}</ThemedText>
            <AppButton label="Повторить запрос к GPT" onPress={generate} />
            <AppButton label="Использовать локальный план" variant="secondary" onPress={useLocalFallback} />
            <AppButton label="Изменить параметры" variant="ghost" onPress={() => setStage('details')} />
          </Card>
        ) : null}

        {stage === 'review' && preview ? (
          <>
            <Card accent>
              <View style={styles.cardTop}>
                <Pill tone="success">проверено · low-risk</Pill>
                <ThemedText type="small" style={styles.muted}>
                  v1
                </ThemedText>
              </View>
              <ThemedText type="subtitle">{preview.goal.title}</ThemedText>
              <ThemedText style={styles.lead}>{preview.plan.summary}</ThemedText>
              <View style={styles.planMeta}>
                <Meta value={`${dailyMinutes} мин`} label="в день" />
                <Meta value={`${horizonDays}`} label="дней" />
                <Meta value={`${preview.plan.missions.length}`} label="миссий" />
              </View>
            </Card>

            <View style={styles.section}>
              <ThemedText type="eyebrow" style={styles.muted}>
                Первые миссии
              </ThemedText>
              {preview.plan.missions.slice(0, 3).map((mission, index) => (
                <View key={mission.id} style={styles.missionPreview}>
                  <View style={styles.sequence}>
                    <ThemedText type="smallBold" style={styles.sequenceText}>
                      {index + 1}
                    </ThemedText>
                  </View>
                  <View style={styles.missionCopy}>
                    <ThemedText type="smallBold">{mission.title}</ThemedText>
                    <ThemedText type="small" style={styles.muted}>
                      {mission.estimatedMinutes} мин · {mission.xp} XP
                    </ThemedText>
                  </View>
                </View>
              ))}
            </View>

            <Card style={styles.methodCard}>
              <View style={styles.methodHeader}>
                <ThemedText type="smallBold">Методология MVP</ThemedText>
                <Pill tone="violet">
                  {preview.plan.research.method === 'openai-responses-v1' ? 'GPT · Responses API' : 'local fallback'}
                </Pill>
              </View>
              <ThemedText type="small" style={styles.muted}>
                {preview.plan.research.method === 'openai-responses-v1'
                  ? 'План создан GPT по твоей формулировке и ограничениям. Это быстрый MVP без глубокого web-research.'
                  : 'Это контролируемый локальный шаблон на случай, если AI-сервер недоступен.'}
              </ThemedText>
            </Card>

            <View style={styles.buttonRow}>
              <AppButton label="Изменить" variant="ghost" onPress={() => setStage('details')} />
              <AppButton label="Принять план" icon="✦" onPress={save} style={styles.flex} />
            </View>
          </>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Question({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.question}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {children}
    </View>
  );
}

function ChoiceRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.choiceRow}>{children}</View>;
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceActive,
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold" style={selected && styles.choiceTextActive}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function LevelChoice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.levelChoice,
        selected && styles.levelChoiceActive,
        pressed && styles.pressed,
      ]}>
      <View style={[styles.radio, selected && styles.radioActive]} />
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

function Meta({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.meta}>
      <ThemedText type="subtitle" style={styles.gold}>
        {value}
      </ThemedText>
      <ThemedText type="eyebrow" style={styles.muted}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  lead: { color: Palette.textMuted, lineHeight: 24 },
  muted: { color: Palette.textMuted },
  gold: { color: Palette.goldBright },
  center: { textAlign: 'center' },
  fullWidth: { width: '100%' },
  pressed: { opacity: 0.7 },
  promptInput: {
    minHeight: 180,
    borderRadius: Radius.large,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    padding: Spacing.three,
    color: Palette.text,
    fontSize: 18,
    lineHeight: 27,
  },
  exampleBlock: { gap: Spacing.two },
  exampleWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  example: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surfaceSoft,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.medium,
    padding: Spacing.twoHalf,
    gap: Spacing.two,
  },
  noticeIcon: { color: Palette.violetSoft, fontSize: 22 },
  noticeText: { flex: 1, color: Palette.textMuted },
  question: { gap: Spacing.two, marginBottom: Spacing.two },
  choiceRow: { flexDirection: 'row', gap: Spacing.two },
  choice: {
    flex: 1,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
  },
  choiceActive: { borderColor: Palette.gold, backgroundColor: '#2A2419' },
  choiceTextActive: { color: Palette.goldBright },
  levelList: { gap: Spacing.two },
  levelChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
    minHeight: 54,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    paddingHorizontal: Spacing.three,
  },
  levelChoiceActive: { borderColor: Palette.violet, backgroundColor: '#1D1A32' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: Palette.textDim },
  radioActive: { borderWidth: 5, borderColor: Palette.violetSoft },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  generatingCard: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  errorCard: { gap: Spacing.three, borderColor: '#5B4228' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planMeta: {
    flexDirection: 'row',
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.line,
  },
  meta: { flex: 1, gap: 3 },
  section: { gap: Spacing.two },
  missionPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
    minHeight: 64,
    borderRadius: Radius.medium,
    backgroundColor: Palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
    padding: Spacing.twoHalf,
  },
  sequence: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2B251A',
    borderWidth: 1,
    borderColor: '#5D4B2B',
  },
  sequenceText: { color: Palette.goldBright },
  missionCopy: { flex: 1, gap: 2 },
  methodCard: { borderRadius: Radius.medium },
  methodHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  blocked: {
    flex: 1,
    minHeight: 580,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
  },
  blockedIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#331B24',
    borderWidth: 1,
    borderColor: '#6C3142',
  },
  blockedGlyph: { color: Palette.danger, fontSize: 40, fontWeight: 300 },
});
