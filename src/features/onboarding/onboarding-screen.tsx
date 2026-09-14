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
import { AppButton } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import type { Archetype, StrictnessMode } from '@/domain/types';
import { archetypeLabel } from '@/shared/presentation/archetypes';
import { useApp } from '@/state';

const ARCHETYPES: Archetype[] = ['pathfinder', 'scholar', 'guardian'];
const MODES: Array<{ value: StrictnessMode; label: string }> = [
  { value: 'gentle', label: 'Gentle' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'strict', label: 'Strict' },
];

export function OnboardingScreen() {
  const { finishOnboarding } = useApp();
  const [step, setStep] = useState(0);
  const [archetype, setArchetype] = useState<Archetype>('pathfinder');
  const [strictness, setStrictness] = useState<StrictnessMode>('balanced');
  const [name, setName] = useState('');

  const finish = () => finishOnboarding({ name, archetype, strictness });

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.topbar}>
          <ThemedText type="eyebrow" style={styles.brand}>
            ACTUM
          </ThemedText>
          <View style={styles.dots}>
            {[0, 1, 2].map((index) => (
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
              <HeroSigil size={154} />
              <View style={styles.introCopy}>
                <ThemedText type="display" style={styles.centerText}>
                  One goal.{'\n'}One step at a time.
                </ThemedText>
                <ThemedText style={[styles.lead, styles.centerText]}>
                  Actum builds your plan and guides you through it.
                </ThemedText>
              </View>
            </View>
          ) : null}

          {step === 1 ? (
            <View style={styles.stage}>
              <View style={styles.copyBlock}>
                <ThemedText type="title">Choose your hero</ThemedText>
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
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {step === 2 ? (
            <View style={styles.stage}>
              <View style={styles.finalHero}>
                <HeroSigil archetype={archetype} size={128} level={1} />
              </View>
              <View style={styles.copyBlock}>
                <ThemedText type="title">What should we call you?</ThemedText>
              </View>
              <TextInput
                accessibilityLabel="Hero name"
                autoCapitalize="words"
                maxLength={24}
                onChangeText={setName}
                placeholder="For example, Alex"
                placeholderTextColor={Palette.textDim}
                returnKeyType="done"
                style={styles.input}
                value={name}
              />

              <View style={styles.modeBlock}>
                <ThemedText type="smallBold">Pace</ThemedText>
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
                      </View>
                      <View style={[styles.radio, strictness === mode.value && styles.radioActive]} />
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          {step > 0 ? (
            <AppButton label="Back" variant="ghost" onPress={() => setStep((value) => value - 1)} />
          ) : null}
          <AppButton
            label={step === 2 ? 'Start' : 'Continue'}
            disabled={step === 2 && !name.trim()}
            onPress={step === 2 ? finish : () => setStep((value) => value + 1)}
            style={styles.continueButton}
          />
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Palette.ink },
  safe: { flex: 1 },
  topbar: {
    minHeight: 54,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { color: Palette.accent },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Palette.line },
  dotActive: { width: 22, backgroundColor: Palette.accent },
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
  introCopy: { gap: Spacing.three },
  centerText: { textAlign: 'center' },
  lead: { color: Palette.textMuted, fontSize: 17, lineHeight: 26 },
  copyBlock: { gap: Spacing.two, marginBottom: Spacing.two },
  muted: { color: Palette.textMuted },
  archetypes: { flexDirection: 'row', gap: Spacing.two },
  archetype: {
    flex: 1,
    minHeight: 158,
    padding: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: Radius.large,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
  },
  archetypeActive: { borderColor: Palette.accent, backgroundColor: 'rgba(0, 122, 255, 0.08)' },
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
  modeActive: { borderColor: Palette.accent, backgroundColor: 'rgba(0, 122, 255, 0.08)' },
  modeText: { gap: 2 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: Palette.textDim },
  radioActive: { borderWidth: 5, borderColor: Palette.accent },
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
    backgroundColor: 'rgba(248, 248, 250, 0.94)',
  },
  continueButton: { flex: 1 },
});
