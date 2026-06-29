import { Part, PumpModelVariant, PumpShellTemplate, ShellComponent, TemplatePart } from '../types';
import { DEFAULT_LONG_SCREW_EXTRA_LENGTH, applyLongScrewRule } from './businessRules';

function parseJsonArray<T>(value?: string): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseShellMeta(selectedTemplate: PumpShellTemplate | null, parts: Part[]) {
  if (!selectedTemplate) return null;
  const shellPart = parts.find(p => p.model === selectedTemplate.shellModel && p.category === '泵壳');
  if (!shellPart?.notes) return null;
  try { return JSON.parse(shellPart.notes); } catch { return null; }
}

export function buildRecipeTemplateContext(input: {
  selectedTemplate: PumpShellTemplate | null;
  selectedModelVariant: PumpModelVariant | null;
  parts: Part[];
  customBarrelLength: string | number | null | undefined;
}) {
  const { selectedTemplate, selectedModelVariant, parts, customBarrelLength } = input;
  const selectedTemplateCostMode = selectedTemplate?.costMode || 'components';
  const templateParts = selectedTemplate ? parseJsonArray<TemplatePart>(selectedTemplate.partsJson) : [];
  const shellComponents = selectedTemplate ? parseJsonArray<ShellComponent>(selectedTemplate.shellComponentsJson) : [];
  const shellMetaInfo = parseShellMeta(selectedTemplate, parts);
  const effectiveBarrelLength = customBarrelLength || selectedModelVariant?.barrelLength || null;
  const effectiveLongScrewExtraLength = selectedModelVariant?.longScrewExtraLength ?? DEFAULT_LONG_SCREW_EXTRA_LENGTH;
  const adjustedTemplateParts = templateParts.map(part => applyLongScrewRule(part, effectiveBarrelLength, effectiveLongScrewExtraLength));

  return {
    selectedTemplateCostMode,
    templateParts,
    shellComponents,
    shellMetaInfo,
    effectiveBarrelLength,
    effectiveLongScrewExtraLength,
    adjustedTemplateParts,
  };
}
