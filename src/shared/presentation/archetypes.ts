import type { Archetype } from '@/domain/types';

export type ArchetypePresentation = {
  icon: string;
  label: string;
  colors: readonly [string, string];
};

export const ARCHETYPE_PRESENTATION: Record<Archetype, ArchetypePresentation> = {
  pathfinder: { icon: '⌁', label: 'Следопыт', colors: ['#6FE0D4', '#3E7E8B'] },
  scholar: { icon: '✦', label: 'Хранитель знаний', colors: ['#B8A9FF', '#6555B9'] },
  guardian: { icon: '◇', label: 'Страж', colors: ['#FFD37B', '#9C6A29'] },
};

export function archetypeLabel(archetype: Archetype): string {
  return ARCHETYPE_PRESENTATION[archetype].label;
}
