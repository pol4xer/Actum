import type { MissionExecutionBlock } from '@/domain/types';

const EXPLICIT_SAFETY_TITLE = /(?:безопасн|safety)/iu;
const PREFLIGHT_TITLE =
  /(?:провер(?:ка|ь)|чек|готовност|перед\s+(?:началом|стартом)|самочувств|preflight|readiness)/iu;
// Bound English symptom words so painting and seizing an opportunity remain actionable.
const SAFETY_COPY =
  /(?:безопасн|медицин|врач|доктор|инструктор|противопоказ|головокруж|тошнот|боль|судорог|потер[\p{L}]*\s+сознани|одышк|симптом|самочувств|гипервентил|без\s+(?:воды|ванн)|только\s+на\s+суше|устойчив[\p{L}]*\s+положени|\b(?:dizz(?:y|iness|ier|iest)|nause(?:a|ous(?:ness)?|ate[ds]?|ating|ation)|pain(?:s|ful(?:ly|ness)?)?|seizures?|symptom(?:s|atic(?:ally)?)?|hyperventilat(?:e[ds]?|ing|ions?)|underwater|dry\s+only)\b)/iu;
const SAFETY_ONLY_ITEM_COPY =
  /(?:головокруж|тошнот|боль|судорог|потер[\p{L}]*\s+сознани|одышк|симптом|самочувств|гипервентил|без\s+(?:воды|ванн)|только\s+на\s+суше|устойчив[\p{L}]*\s+положени|(?:обычн|спокойн)[\p{L}]*\s+дыхани|глубок[\p{L}]*\s+вдох|\b(?:dizz(?:y|iness|ier|iest)|nause(?:a|ous(?:ness)?|ate[ds]?|ating|ation)|pain(?:s|ful(?:ly|ness)?)?|seizures?|symptom(?:s|atic(?:ally)?)?|hyperventilat(?:e[ds]?|ing|ions?)|underwater|dry\s+only)\b)/iu;
const SAFETY_CLAUSE =
  /(?:^|[,;]\s*|\s+и\s+|\s+)(?:(?:при|если)\s+(?:головокруж|тошнот|бол|судорог|одышк|потер[\p{L}]*\s+сознани|спутанност|резк[\p{L}]*\s+ухудш)|без\s+(?:гипервентил|тревожн[\p{L}]*\s+симптом|головокруж|тошнот|бол|судорог|воды|ванн)|только\s+на\s+суше|не\s+гипервентил|немедленно\s+прекрат|прекрат[\p{L}]*\s+(?:блок|упражн|практик)|проконсульт|обрат[\p{L}]*\s+к\s+(?:врач|доктор)|найд[\p{L}]*\s+(?:сертифицированн[\p{L}]*\s+)?инструктор|(?:практик|упражн)[\p{L}]*\s+(?:проход|выполня)[\p{L}]*\s+(?:только\s+)?(?:в|на)\s+безопасн[\p{L}]*|\b(?:dizz(?:y|iness|ier|iest)|nause(?:a|ous(?:ness)?|ate[ds]?|ating|ation)|seizures?|hyperventilat(?:e[ds]?|ing|ions?))\b)/iu;

/**
 * Detects legacy checklist gates whose only purpose is repeating legal/safety copy.
 *
 * New plans are prompted not to generate these blocks, but saved plan-v5 data must
 * remain usable without another paid generation. The deliberately narrow classifier
 * never hides timer/counter work or ordinary checklists.
 */
export function isSafetyOnlyExecutionBlock(block: MissionExecutionBlock): boolean {
  if (block.kind !== 'checklist') return false;
  const safetyTitled =
    EXPLICIT_SAFETY_TITLE.test(block.title) || PREFLIGHT_TITLE.test(block.title);
  return (
    safetyTitled &&
    block.items.length > 0 &&
    block.items.every((item) => SAFETY_ONLY_ITEM_COPY.test(item))
  );
}

export function actionableExecutionBlocks(
  blocks: readonly MissionExecutionBlock[],
): MissionExecutionBlock[] {
  return blocks.filter((block) => !isSafetyOnlyExecutionBlock(block));
}

export function containsExecutionSafetyCopy(value: string | undefined): boolean {
  return Boolean(value && SAFETY_COPY.test(value));
}

/** Neutralizes safety-led phase labels in already paid plans at display time. */
export function presentExecutionSection(title: string, context?: string): {
  title: string;
  showContext: boolean;
} {
  const normalized = title.trim();
  if (!EXPLICIT_SAFETY_TITLE.test(normalized) || !SAFETY_COPY.test(context ?? '')) {
    return { title: normalized, showContext: true };
  }

  const neutralTitle = normalized
    .replace(/безопасн[\p{L}]*/giu, '')
    .replace(/\bsafety\b/giu, '')
    .replace(/\s+/gu, ' ')
    .trim();

  return { title: neutralTitle || 'Start', showContext: false };
}

/**
 * Removes legacy warning clauses from executable copy while preserving the
 * concrete action before them. Legal copy has one dedicated home in Settings.
 */
export function withoutExecutionSafetyCopy(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  const sentences = normalized.match(/[^.!?]+[.!?]?/gu) ?? [normalized];
  const visible = sentences
    .map((sentence) => {
      const match = SAFETY_CLAUSE.exec(sentence);
      if (!match) return sentence.trim();
      const prefix = sentence
        .slice(0, match.index)
        .replace(/[\s,;:–—-]+$/gu, '')
        .trim();
      const ending = sentence.match(/[.!?]\s*$/u)?.[0].trim() ?? '';
      const danglingPrefix = /(?:^|\s)(?:в|во|на|с|со|к|ко|и|или|для|при|по)$/iu.test(prefix);
      if (!prefix || danglingPrefix) return '';
      return ending && !/[.!?]$/u.test(prefix) ? `${prefix}${ending}` : prefix;
    })
    .filter(Boolean);

  const result = visible.join(' ').replace(/\s+/gu, ' ').trim();
  return result || undefined;
}
