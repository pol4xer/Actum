import type { MissionExecutionBlock } from '@/domain/types';

const EXPLICIT_SAFETY_TITLE = /(?:безопасн|safety)/iu;
const PREFLIGHT_TITLE =
  /(?:провер(?:ка|ь)|чек|готовност|перед\s+(?:началом|стартом)|самочувств|preflight|readiness)/iu;
const SAFETY_COPY =
  /(?:безопасн|медицин|врач|доктор|инструктор|противопоказ|головокруж|тошнот|боль|судорог|потер[\p{L}]*\s+сознани|одышк|симптом|самочувств|гипервентил|без\s+(?:воды|ванн)|только\s+на\s+суше|устойчив[\p{L}]*\s+положени|dizz|nause|pain|seiz|symptom|hypervent|underwater|dry\s+only)/iu;
const SAFETY_CLAUSE =
  /(?:^|[,;]\s*|\s+и\s+|\s+)(?:(?:при|если)\s+(?:головокруж|тошнот|бол|судорог|одышк|потер[\p{L}]*\s+сознани|спутанност|резк[\p{L}]*\s+ухудш)|без\s+(?:гипервентил|тревожн[\p{L}]*\s+симптом|головокруж|тошнот|бол|судорог|воды|ванн)|только\s+на\s+суше|не\s+гипервентил|немедленно\s+прекрат|прекрат[\p{L}]*\s+(?:блок|упражн|практик)|проконсульт|обрат[\p{L}]*\s+к\s+(?:врач|доктор)|найд[\p{L}]*\s+(?:сертифицированн[\p{L}]*\s+)?инструктор|медицинск[\p{L}]*|безопасн[\p{L}]*|противопоказ[\p{L}]*|dizz|nause|seiz|hypervent)/iu;

/**
 * Detects legacy checklist gates whose only purpose is repeating legal/safety copy.
 *
 * New plans are prompted not to generate these blocks, but saved plan-v5 data must
 * remain usable without another paid generation. The deliberately narrow classifier
 * never hides timer/counter work or ordinary checklists.
 */
export function isSafetyOnlyExecutionBlock(block: MissionExecutionBlock): boolean {
  if (block.kind !== 'checklist') return false;
  if (EXPLICIT_SAFETY_TITLE.test(block.title)) return true;

  const copy = [block.title, ...block.items, block.successCriterion].join(' ');
  return PREFLIGHT_TITLE.test(block.title) && SAFETY_COPY.test(copy);
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
export function presentExecutionSection(title: string): {
  title: string;
  showContext: boolean;
} {
  const normalized = title.trim();
  if (!EXPLICIT_SAFETY_TITLE.test(normalized)) {
    return { title: normalized, showContext: true };
  }

  const neutralTitle = normalized
    .replace(/безопасн[\p{L}]*/giu, '')
    .replace(/\bsafety\b/giu, '')
    .replace(/\s+/gu, ' ')
    .trim();

  return { title: neutralTitle || 'Старт', showContext: false };
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
