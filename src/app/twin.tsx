import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { HeroSigil } from '@/components/hero-sigil';
import { ThemedText } from '@/components/themed-text';
import { Card, Pill, ProgressBar, Screen, ScreenHeader } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { useApp } from '@/state/app-context';

export default function TwinScreen() {
  const { state } = useApp();

  if (!state.activeGoal || !state.activePlan) {
    return (
      <Screen>
        <ScreenHeader
          eyebrow="Двойник"
          title="Траектории появятся после цели"
          subtitle="Потенциальная линия строится только от принятого плана, а не от обещаний."
        />
        <Card>
          <ThemedText type="subtitle">Нет исходной точки</ThemedText>
          <ThemedText style={styles.muted}>Создай цель на вкладке «Сегодня».</ThemedText>
        </Card>
      </Screen>
    );
  }

  const missions = state.activePlan.missions;
  const completed = missions.filter((mission) => mission.outcome === 'completed').length;
  const partial = missions.filter((mission) => mission.outcome === 'partial').length;
  const reported = missions.filter((mission) => mission.outcome !== 'pending').length;
  const projectedXp = missions.slice(0, Math.max(1, reported)).reduce((sum, mission) => sum + mission.xp, 0);
  const actualXp = state.checkIns.reduce((sum, item) => sum + item.xpDelta, 0);
  const adherence = reported ? (completed + partial * 0.45) / reported : 0;
  const potentialLight = Math.min(100, 18 + reported * 7);

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Реальный vs потенциальный"
        title="Две траектории"
        subtitle="Не приговор и не обещание — честное сравнение с утверждённым планом."
      />

      <View style={styles.twins}>
        <TwinCard
          label="Ты сейчас"
          tone="real"
          level={state.character.level}
          energy={state.character.energy}
          light={state.character.worldLight}
          xp={actualXp}
          archetype={state.profile?.archetype}
        />
        <TwinCard
          label="По плану"
          tone="potential"
          level={Math.floor(projectedXp / 100) + 1}
          energy={Math.min(100, 76 + reported * 6)}
          light={potentialLight}
          xp={projectedXp}
          archetype={state.profile?.archetype}
        />
      </View>

      <Card accent>
        <View style={styles.cardHeader}>
          <View style={styles.flex}>
            <ThemedText type="eyebrow" style={styles.gold}>
              Разрыв траекторий
            </ThemedText>
            <ThemedText type="subtitle">
              {reported === 0
                ? 'Обе линии пока совпадают'
                : adherence >= 0.8
                  ? 'Ты почти на линии потенциала'
                  : adherence >= 0.45
                    ? 'Разрыв можно закрыть'
                    : 'Сейчас важен путь возвращения'}
            </ThemedText>
          </View>
          <Pill tone={adherence >= 0.8 ? 'success' : adherence >= 0.45 ? 'warning' : 'violet'}>
            {Math.round(adherence * 100)}%
          </Pill>
        </View>
        <ProgressBar
          value={adherence}
          color={adherence >= 0.8 ? Palette.success : Palette.gold}
        />
        <ThemedText style={styles.muted}>
          Расчёт использует только события текущей версии плана: {completed} выполнено, {partial} частично,
          {' '}{reported - completed - partial} пропущено.
        </ThemedText>
      </Card>

      <View style={styles.section}>
        <ThemedText type="eyebrow" style={styles.muted}>
          Что изменилось
        </ThemedText>
        <ComparisonRow
          icon="✦"
          title="Опыт"
          actual={`${actualXp} XP`}
          potential={`${projectedXp} XP`}
          delta={projectedXp - actualXp}
        />
        <ComparisonRow
          icon="◐"
          title="Свет мира"
          actual={`${state.character.worldLight}%`}
          potential={`${potentialLight}%`}
          delta={potentialLight - state.character.worldLight}
        />
        <ComparisonRow
          icon="↟"
          title="Полные действия"
          actual={`${completed}`}
          potential={`${reported}`}
          delta={reported - completed}
        />
      </View>

      <Card style={styles.method}>
        <Pill tone="violet">confidence band · prototype</Pill>
        <ThemedText type="subtitle">Как читать двойника</ThemedText>
        <ThemedText style={styles.muted}>
          Потенциальный герой показывает игровой результат, который был бы получен при полном выполнении уже прошедших миссий. Он не предсказывает тело, здоровье, доход или гарантированный жизненный результат.
        </ThemedText>
      </Card>
    </Screen>
  );
}

function TwinCard({
  label,
  tone,
  level,
  energy,
  light,
  xp,
  archetype,
}: {
  label: string;
  tone: 'real' | 'potential';
  level: number;
  energy: number;
  light: number;
  xp: number;
  archetype: Parameters<typeof HeroSigil>[0]['archetype'];
}) {
  const real = tone === 'real';
  return (
    <LinearGradient
      colors={real ? ['#182431', '#121823'] : ['#251E37', '#151426']}
      style={[styles.twinCard, real ? styles.realCard : styles.potentialCard]}>
      <Pill tone={real ? 'neutral' : 'violet'}>{label}</Pill>
      <HeroSigil archetype={archetype} level={level} size={104} dimmed={real && light < 20} />
      <View style={styles.twinStats}>
        <MiniStat label="энергия" value={`${energy}%`} />
        <MiniStat label="свет" value={`${light}%`} />
        <MiniStat label="xp" value={xp} />
      </View>
    </LinearGradient>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.miniStat}>
      <ThemedText type="eyebrow" style={styles.muted}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

function ComparisonRow({
  icon,
  title,
  actual,
  potential,
  delta,
}: {
  icon: string;
  title: string;
  actual: string;
  potential: string;
  delta: number;
}) {
  return (
    <View style={styles.comparison}>
      <View style={styles.comparisonIcon}>
        <ThemedText style={styles.violet}>{icon}</ThemedText>
      </View>
      <View style={styles.flex}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" style={styles.muted}>
          Сейчас {actual} · По плану {potential}
        </ThemedText>
      </View>
      <ThemedText type="smallBold" style={delta > 0 ? styles.warning : styles.success}>
        {delta > 0 ? `−${delta}` : '≈'}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  muted: { color: Palette.textMuted },
  gold: { color: Palette.gold },
  violet: { color: Palette.violetSoft },
  warning: { color: Palette.warning },
  success: { color: Palette.success },
  twins: { flexDirection: 'row', gap: Spacing.two },
  twinCard: {
    flex: 1,
    minHeight: 260,
    borderRadius: Radius.large,
    borderWidth: 1,
    padding: Spacing.twoHalf,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  realCard: { borderColor: '#304756' },
  potentialCard: { borderColor: '#50457B' },
  twinStats: { width: '100%', flexDirection: 'row' },
  miniStat: { flex: 1, alignItems: 'center', gap: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  section: { gap: Spacing.two },
  comparison: {
    minHeight: 68,
    borderRadius: Radius.medium,
    backgroundColor: Palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
    padding: Spacing.twoHalf,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
  },
  comparisonIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#201C35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  method: { backgroundColor: '#131525' },
});
