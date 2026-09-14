import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/primitives';
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
  title = 'Why this?',
  accessibilityLabel,
}: InfoPopoverProps): ReactElement | null {
  const [visible, setVisible] = useState(false);
  const visibleSections = useMemo(() => normalizeSections(sections), [sections]);

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
  const triggerLabel = accessibilityLabel ?? `Show: ${title}`;

  return (
    <>
      <Pressable
        accessibilityHint="Opens an explanation."
        accessibilityLabel={triggerLabel}
        accessibilityRole="button"
        accessibilityState={{ expanded: visible }}
        hitSlop={8}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}>
        <ThemedText
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={styles.triggerGlyph}>
          ?
        </ThemedText>
      </Pressable>

      <Modal
        accessibilityLabel={title}
        animationType="none"
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

          <GlassSurface
            fallbackStyle={styles.cardFallback}
            style={styles.card}
            tintColor="rgba(255, 255, 255, 0.78)">
            <View
              accessibilityViewIsModal
              onAccessibilityEscape={close}
              style={styles.cardBody}>
              <View style={styles.header}>
              <ThemedText accessibilityRole="header" type="subtitle" style={styles.title}>
                {title}
              </ThemedText>
              <Pressable
                accessibilityLabel="Close explanation"
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
                showsVerticalScrollIndicator={false}>
                {visibleSections.map((section, index) => (
                  <InfoSection key={`${section.heading ?? 'section'}-${index}`} section={section} />
                ))}
              </ScrollView>
            </View>
          </GlassSurface>
        </View>
      </Modal>
    </>
  );
}

function InfoSection({ section }: { section: VisibleSection }) {
  const warning = section.tone === 'warning';
  const heading = section.heading || (warning ? 'Warning' : undefined);
  const warningLabel =
    heading?.trim().toLocaleLowerCase('en-US') === 'warning'
      ? `Warning. ${section.body}`
      : `Warning. ${heading ? `${heading}. ` : ''}${section.body}`;

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
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
    backgroundColor: 'rgba(255, 255, 255, 0.68)',
  },
  triggerGlyph: {
    color: Palette.accent,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '800',
  },
  pressed: { opacity: 0.65 },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '72%',
    overflow: 'hidden',
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
    padding: Spacing.three,
    gap: Spacing.twoHalf,
    ...Shadow,
  },
  cardFallback: { backgroundColor: 'rgba(255, 255, 255, 0.97)' },
  cardBody: { flexShrink: 1, gap: Spacing.twoHalf },
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
    borderColor: 'rgba(199, 120, 0, 0.22)',
    backgroundColor: 'rgba(255, 149, 0, 0.08)',
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
    backgroundColor: 'rgba(255, 149, 0, 0.14)',
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
