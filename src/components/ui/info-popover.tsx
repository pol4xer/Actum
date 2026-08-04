import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Palette, Radius, Shadow, Spacing } from '@/constants/theme';
import type { ContextInfoSection, ContextInfoTone } from '@/shared/presentation/context-info';

export type InfoPopoverProps = Readonly<{
  sections: readonly ContextInfoSection[];
  title?: string;
  accessibilityLabel?: string;
}>;

type VisibleSection = Readonly<{
  heading?: string;
  body: string;
  tone: ContextInfoTone;
}>;

/** A compact trigger for presentation-only context that works on native and web. */
export function InfoPopover({
  sections,
  title = 'Почему так?',
  accessibilityLabel,
}: InfoPopoverProps): ReactElement | null {
  const [visible, setVisible] = useState(false);
  const visibleSections = useMemo(() => normalizeSections(sections), [sections]);
  const hasWarning = visibleSections.some((section) => section.tone === 'warning');

  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof document === 'undefined') return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setVisible(false);
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [visible]);

  if (!visibleSections.length) return null;

  const close = () => setVisible(false);
  const triggerLabel = accessibilityLabel ?? `Показать: ${title}`;

  return (
    <>
      <Pressable
        accessibilityHint={
          hasWarning
            ? 'Открывает пояснение, содержащее предупреждение.'
            : 'Открывает пояснение.'
        }
        accessibilityLabel={triggerLabel}
        accessibilityRole="button"
        accessibilityState={{ expanded: visible }}
        hitSlop={8}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [
          styles.trigger,
          hasWarning && styles.triggerWarning,
          pressed && styles.pressed,
        ]}>
        <ThemedText
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.triggerGlyph, hasWarning && styles.triggerGlyphWarning]}>
          ?
        </ThemedText>
      </Pressable>

      <Modal
        accessibilityLabel={title}
        animationType="fade"
        onRequestClose={close}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={visible}>
        <View style={styles.overlay}>
          <Pressable
            accessible={false}
            onPress={close}
            style={StyleSheet.absoluteFill}
            tabIndex={-1}
          />

          <View
            accessibilityViewIsModal
            onAccessibilityEscape={close}
            style={styles.card}>
            <View style={styles.header}>
              <ThemedText accessibilityRole="header" type="subtitle" style={styles.title}>
                {title}
              </ThemedText>
              <Pressable
                accessibilityLabel="Закрыть пояснение"
                accessibilityRole="button"
                hitSlop={8}
                onPress={close}
                style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
                <ThemedText
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={styles.closeGlyph}>
                  ×
                </ThemedText>
              </Pressable>
            </View>

            <ScrollView
              alwaysBounceVertical={false}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator>
              {visibleSections.map((section, index) => (
                <InfoSection key={`${section.heading ?? 'section'}-${index}`} section={section} />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function InfoSection({ section }: { section: VisibleSection }) {
  const warning = section.tone === 'warning';
  const heading = section.heading || (warning ? 'Предупреждение' : undefined);
  const warningLabel =
    heading?.trim().toLocaleLowerCase('ru-RU') === 'предупреждение'
      ? `Предупреждение. ${section.body}`
      : `Предупреждение. ${heading ? `${heading}. ` : ''}${section.body}`;

  return (
    <View
      accessible={warning || undefined}
      accessibilityLabel={warning ? warningLabel : undefined}
      accessibilityRole={warning ? 'alert' : undefined}
      style={[styles.section, warning && styles.sectionWarning]}>
      {heading ? (
        <View style={styles.sectionHeadingRow}>
          {warning ? (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={styles.warningBadge}>
              <ThemedText style={styles.warningBadgeGlyph}>!</ThemedText>
            </View>
          ) : null}
          <ThemedText
            accessibilityElementsHidden={warning || undefined}
            importantForAccessibility={warning ? 'no' : 'auto'}
            type="eyebrow"
            style={[styles.sectionHeading, warning && styles.warningText]}>
            {heading}
          </ThemedText>
        </View>
      ) : null}
      <ThemedText
        accessibilityElementsHidden={warning || undefined}
        importantForAccessibility={warning ? 'no' : 'auto'}
        selectable
        type="small"
        style={[styles.body, warning && styles.warningBody]}>
        {section.body}
      </ThemedText>
    </View>
  );
}

function normalizeSections(sections: readonly ContextInfoSection[]): VisibleSection[] {
  return sections.flatMap((section) => {
    const body = section.body.trim();
    if (!body) return [];
    const heading = section.heading?.trim();
    return [
      {
        ...(heading ? { heading } : {}),
        body,
        tone: section.tone === 'warning' ? 'warning' : 'default',
      },
    ];
  });
}

const styles = StyleSheet.create({
  trigger: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surfaceSoft,
  },
  triggerWarning: {
    borderColor: '#76502B',
    backgroundColor: '#2D2319',
  },
  triggerGlyph: {
    color: Palette.violetSoft,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '800',
  },
  triggerGlyphWarning: { color: Palette.warning },
  pressed: { opacity: 0.65 },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
    backgroundColor: 'rgba(5, 7, 13, 0.72)',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '82%',
    overflow: 'hidden',
    borderRadius: Radius.large,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.inkRaised,
    padding: Spacing.three,
    gap: Spacing.twoHalf,
    ...Shadow,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: { flex: 1 },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.surfaceSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
  },
  closeGlyph: {
    color: Palette.textMuted,
    fontSize: 22,
    lineHeight: 24,
  },
  content: { gap: Spacing.two },
  section: {
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    padding: Spacing.twoHalf,
    gap: Spacing.one,
  },
  sectionWarning: {
    borderColor: '#76502B',
    backgroundColor: '#2D2319',
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  sectionHeading: { flex: 1, color: Palette.violetSoft },
  warningBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#56391F',
  },
  warningBadgeGlyph: {
    color: Palette.warning,
    fontSize: 13,
    lineHeight: 15,
    fontWeight: '800',
  },
  warningText: { color: Palette.warning },
  body: { color: Palette.textMuted, lineHeight: 21 },
  warningBody: { color: Palette.text },
});
