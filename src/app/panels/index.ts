import type { ComponentType } from 'preact';
import { AVAILABLE_OPS, OPS, type AvailableOpId, type RegistryOpId } from '../../i18n/ops';
import type { Locale } from '../../i18n/locales';
import type { UiStrings } from '../../i18n/types';
import type { Session, SessionAction } from '../state/session';

export interface PanelProps {
  session: Session;
  locale: Locale;
  t: UiStrings['workbench'];
  busy: boolean;
  updating: boolean;
  publish: (action: Extract<SessionAction, { type: 'op/input' | 'selection/all' | 'selection/toggle' }>) => void;
  onNavigate: (op: AvailableOpId) => void;
  onRun: () => void;
}
export type PanelDefinitions = Partial<Record<RegistryOpId, ComponentType<PanelProps>>>;
type PanelModule = { panels: PanelDefinitions };
type PanelRegistry = PanelDefinitions & Record<AvailableOpId, ComponentType<PanelProps>>;

export function buildPanelRegistry(modules: Record<string, PanelModule>): PanelRegistry {
  const registry: PanelDefinitions = {};
  for (const { panels } of Object.values(modules)) {
    for (const [id, panel] of Object.entries(panels)) {
      if (!OPS.some(op => op.id === id)) throw new Error(`Unknown panel: ${id}`);
      if (Object.hasOwn(registry, id)) throw new Error(`Duplicate panel: ${id}`);
      registry[id as RegistryOpId] = panel;
    }
  }
  for (const { id } of AVAILABLE_OPS) {
    if (!registry[id]) throw new Error(`Missing panel: ${id}`);
  }
  return registry as PanelRegistry;
}
export const panelRegistry = buildPanelRegistry(import.meta.glob<PanelModule>('./*.panel.tsx', { eager: true }));
