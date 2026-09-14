import type { Mission, MissionExecutionBlock, RoutineUnit } from '@/domain/types';

import {
  actionableExecutionBlocks,
  withoutExecutionSafetyCopy,
} from './execution-visibility';

export type MissionActionPresentation = Readonly<{
  id: string;
  title: string;
  dose?: string;
  instruction?: string;
  items?: readonly string[];
  criterion?: string;
}>;

export type MissionDayPresentation = Readonly<{
  actions: readonly MissionActionPresentation[];
  dayCriterion?: string;
}>;

/**
 * Converts every supported persisted execution contract into the same compact,
 * actionable day model. UI surfaces can change without touching plan data.
 */
export function presentMissionDay(mission: Mission): MissionDayPresentation {
  if (mission.execution?.kind === 'in_app') {
    return {
      actions: actionableExecutionBlocks(mission.execution.blocks).map(presentExecutionBlock),
      dayCriterion: withoutExecutionSafetyCopy(mission.execution.successCriterion),
    };
  }

  if (mission.execution?.kind === 'routine') {
    return {
      actions: mission.execution.actions.map((action, index) => ({
        id: `routine-${index}`,
        title: action.title,
        dose: joinParts([
          `${action.sets} × ${action.quantity} ${routineUnitLabel(action.unit, action.unitLabel, action.quantity)}`,
          action.workSecondsPerSet && action.unit !== 'seconds' && action.unit !== 'minutes'
            ? `up to ${formatCompactDuration(action.workSecondsPerSet)} per set`
            : undefined,
          action.restSeconds > 0
            ? `rest ${formatCompactDuration(action.restSeconds)}`
            : undefined,
          clean(action.tempo),
        ]),
        instruction: withoutExecutionSafetyCopy(action.instruction),
        criterion: withoutExecutionSafetyCopy(action.successCriterion),
      })),
      dayCriterion: withoutExecutionSafetyCopy(mission.completionCriterion),
    };
  }

  const items =
    mission.steps
      ?.map((step) => withoutExecutionSafetyCopy(step))
      .filter(isString) ?? [];
  const fallbackInstruction = withoutExecutionSafetyCopy(mission.description);

  return {
    actions: [
      {
        id: 'legacy-action',
        title: mission.title,
        dose:
          mission.execution?.kind === 'timer'
            ? `Timer · ${formatCompactDuration(mission.execution.durationSeconds)}`
            : undefined,
        ...(items.length > 1
          ? { items }
          : { instruction: items[0] ?? fallbackInstruction }),
        criterion: withoutExecutionSafetyCopy(mission.completionCriterion),
      },
    ],
    dayCriterion: withoutExecutionSafetyCopy(mission.completionCriterion),
  };
}

function presentExecutionBlock(
  block: MissionExecutionBlock,
  index: number,
): MissionActionPresentation {
  if (block.kind === 'timer') {
    return {
      id: `timer-${index}`,
      title: block.title,
      dose: joinParts([
        `${block.sets} × ${formatCompactDuration(block.durationSecondsPerSet)}`,
        block.restSeconds > 0
          ? `rest ${formatCompactDuration(block.restSeconds)}`
          : undefined,
      ]),
      instruction: withoutExecutionSafetyCopy(block.instruction),
      criterion: withoutExecutionSafetyCopy(block.successCriterion),
    };
  }

  if (block.kind === 'counter') {
    return {
      id: `counter-${index}`,
      title: block.title,
      dose: joinParts([
        `${block.sets} × ${block.targetPerSet} ${routineUnitLabel(block.unit, block.unitLabel, block.targetPerSet)}`,
        block.workSecondsPerSet > 0
          ? `up to ${formatCompactDuration(block.workSecondsPerSet)} per set`
          : undefined,
        block.restSeconds > 0
          ? `rest ${formatCompactDuration(block.restSeconds)}`
          : undefined,
        clean(block.tempo),
      ]),
      instruction: withoutExecutionSafetyCopy(block.instruction),
      criterion: withoutExecutionSafetyCopy(block.successCriterion),
    };
  }

  if (block.kind === 'checklist') {
    return {
      id: `checklist-${index}`,
      title: block.title,
      dose: `${block.items.length} ${block.items.length === 1 ? 'action' : 'actions'}`,
      items: block.items.map(clean).filter(isString),
      criterion: withoutExecutionSafetyCopy(block.successCriterion),
    };
  }

  return {
    id: `text-log-${index}`,
    title: block.title,
    dose: `${block.minCharacters}–${block.maxCharacters} characters`,
    instruction: withoutExecutionSafetyCopy(block.prompt),
    criterion: withoutExecutionSafetyCopy(block.successCriterion),
  };
}

function routineUnitLabel(unit: RoutineUnit, custom: string | undefined, quantity: number) {
  if (unit === 'custom') return clean(custom) ?? (quantity === 1 ? 'unit' : 'units');
  const labels: Record<Exclude<RoutineUnit, 'custom'>, string> = {
    reps: 'reps',
    seconds: 'sec',
    minutes: 'min',
    pages: 'pages',
    items: 'items',
    words: 'words',
    meters: 'm',
    attempts: 'attempts',
  };
  const label = labels[unit];
  return quantity === 1 && label.endsWith('s') ? label.slice(0, -1) : label;
}

function formatCompactDuration(seconds: number) {
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} sec`;
}

function joinParts(values: readonly (string | undefined)[]) {
  return values.filter(isString).join(' · ');
}

function clean(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function isString(value: string | undefined): value is string {
  return Boolean(value);
}
