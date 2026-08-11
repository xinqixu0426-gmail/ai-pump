import type {
  TemplateFormState,
  TemplatePartFormRow,
  TemplateRotorParamKey,
  TemplateRotorParamsState,
} from '@/components/recipe/PumpShellTemplateEditor';
import {
  isBarrelComponentName,
  isStainlessStretchBarrelComponent,
  isSubassemblyComponent,
  normalizeBarrelComponentName,
  type ShellComponentFormRow,
  type ShellComponentRow,
} from '@/components/recipe/ShellCostEditor';
import type {
  PumpShellTemplate,
  ShellComponentInput,
  TemplateInput,
  TemplatePartInput,
} from '@/lib/recipes';

type TemplatePartRow = {
  name?: string;
  model?: string;
  supplier?: string;
  qty?: number;
};

const templateRotorParamFields: Array<{
  key: TemplateRotorParamKey;
  label: string;
  unit?: string;
  type?: 'text' | 'number';
}> = [
  { key: 'upper_bearing', label: '上轴承', type: 'text' },
  { key: 'lower_bearing', label: '下轴承', type: 'text' },
  { key: 'piece_count', label: '转子片数', unit: '片' },
  { key: 'rotor_dia', label: '转子直径', unit: 'mm' },
  { key: 'bearing_span', label: '开档', unit: 'mm' },
  { key: 'stack_offset', label: '定位', unit: 'mm' },
  { key: 'oil_seal_dia', label: '油封孔径', unit: 'mm' },
  { key: 'impeller_dia', label: '叶轮孔径', unit: 'mm' },
  { key: 'impeller_span', label: '叶轮开档', unit: 'mm' },
  { key: 'impeller_depth', label: '叶轮深度', unit: 'mm' },
  { key: 'thread_length', label: '螺纹长度', unit: 'mm' },
  { key: 'thread_dia', label: '螺纹直径', unit: 'mm' },
];

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nextSelectionId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultTemplateParts(): TemplatePartFormRow[] {
  return ['花板轴承', '油缸轴承', '机械油封', '骨架油封'].map((name) => ({
    id: nextSelectionId(),
    name,
    model: '',
    qty: 1,
    supplier: '',
  }));
}

function emptyTemplateRotorParams(): TemplateRotorParamsState {
  return templateRotorParamFields.reduce((params, field) => {
    params[field.key] = '';
    return params;
  }, {} as TemplateRotorParamsState);
}

export function emptyTemplateForm(): TemplateFormState {
  return {
    shellModel: '',
    description: '',
    assemblyWage: '0',
    packingWage: '0',
    surfaceTreatmentMode: 'none',
    surfaceTreatmentCost: '0',
    costMode: 'bundle',
    bundleCost: '0',
    bundleNote: '',
    partRows: defaultTemplateParts(),
    componentRows: [],
    rotorParams: emptyTemplateRotorParams(),
  };
}

export function parseTemplateJsonArray<T>(value?: string): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function templateFormFromTemplate(template: PumpShellTemplate): TemplateFormState {
  const partRows = parseTemplateJsonArray<TemplatePartRow>(template.partsJson).map((part) => ({
    id: nextSelectionId(),
    name: part.name || '',
    model: part.model || '',
    qty: Number(part.qty || 1),
    supplier: part.supplier || '',
  }));
  const componentRows: ShellComponentFormRow[] = parseTemplateJsonArray<ShellComponentRow>(
    template.shellComponentsJson
  ).map((component) => {
    const isStainlessBarrel = isStainlessStretchBarrelComponent(component);
    const isSubassembly = isSubassemblyComponent(component);
    return {
      id: nextSelectionId(),
      name: isBarrelComponentName(component.name || '')
        ? normalizeBarrelComponentName(component.name || '', isStainlessBarrel)
        : component.name || '',
      model: component.model || '',
      supplier: component.supplier || '',
      qty: Number(component.qty || 1),
      unitCost: Number(component.unitCost || 0),
      pricingMode: isStainlessBarrel ? 'lengthCm' as const : 'fixed' as const,
      included: component.included !== false,
      optional: Boolean(component.optional),
      componentType: isStainlessBarrel
        ? 'stainlessStretchBarrel'
        : isSubassembly
          ? 'subassembly'
          : 'standard',
      subassemblyContents: (component.subassemblyContents || []).map((item) => ({
        id: nextSelectionId(),
        name: item.name || '',
        qty: Number(item.qty || 1),
        referenceUnitPrice: item.referenceUnitPrice == null ? null : Number(item.referenceUnitPrice),
        note: item.note || '',
      })),
      note: component.note || '',
    };
  });
  const rotorParams = emptyTemplateRotorParams();
  try {
    const parsed = JSON.parse(template.rotorParamsJson || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      templateRotorParamFields.forEach((field) => {
        const value = parsed[field.key];
        rotorParams[field.key] = value == null ? '' : String(value);
      });
    }
  } catch {
    // Invalid saved rotor params are ignored in the form.
  }

  return {
    shellModel: template.shellModel || '',
    description: template.description || '',
    assemblyWage: String(template.assemblyWage || 0),
    packingWage: String(template.packingWage || 0),
    surfaceTreatmentMode: template.surfaceTreatmentMode
      || (template.paintingWage == null ? 'none' : 'painting'),
    surfaceTreatmentCost: String(template.surfaceTreatmentCost ?? template.paintingWage ?? 0),
    costMode: template.costMode === 'bundle' ? 'bundle' : 'components',
    bundleCost: String(template.bundleCost || 0),
    bundleNote: template.bundleNote || '',
    partRows: partRows.length > 0 ? partRows : defaultTemplateParts(),
    componentRows,
    rotorParams,
  };
}

export function templateFormToInput(form: TemplateFormState): TemplateInput {
  const partsPayload: TemplatePartInput[] = form.partRows
    .filter((row) => row.name.trim() && row.model.trim())
    .map((row) => ({
      name: row.name.trim(),
      model: row.model.trim(),
      supplier: row.supplier?.trim() || '',
      qty: numberValue(String(row.qty)) || 1,
    }));
  const componentsPayload: ShellComponentInput[] = form.costMode === 'components'
    ? form.componentRows
        .filter((row) => row.name.trim())
        .map((row) => {
          const isStainlessBarrel = row.componentType === 'stainlessStretchBarrel';
          const isSubassembly = row.componentType === 'subassembly';
          return {
            name: row.name.trim(),
            model: row.model?.trim() || '',
            supplier: row.supplier?.trim() || '',
            qty: numberValue(String(row.qty)) || 1,
            unitCost: Math.max(0, numberValue(String(row.unitCost))),
            pricingMode: isStainlessBarrel ? 'lengthCm' : 'fixed',
            included: row.included !== false,
            optional: Boolean(row.optional),
            componentType: isStainlessBarrel
              ? 'stainlessStretchBarrel'
              : isSubassembly
                ? 'subassembly'
                : 'standard',
            ...(isSubassembly ? {
              subassemblyContents: row.subassemblyContents
                .filter((item) => item.name.trim())
                .map((item) => ({
                  name: item.name.trim(),
                  qty: numberValue(String(item.qty)) || 1,
                  ...(item.referenceUnitPrice == null
                    ? {}
                    : { referenceUnitPrice: Math.max(0, numberValue(String(item.referenceUnitPrice))) }),
                  note: item.note?.trim() || '',
                })),
            } : {}),
            note: row.note?.trim() || '',
          };
        })
    : [];
  const rotorParamsPayload = templateRotorParamFields.reduce<Record<string, string>>(
    (payload, field) => {
      const value = form.rotorParams[field.key].trim();
      if (value) payload[field.key] = value;
      return payload;
    },
    {}
  );

  return {
    shellModel: form.shellModel.trim(),
    description: form.description.trim(),
    partsJson: JSON.stringify(partsPayload),
    shellComponentsJson: JSON.stringify(componentsPayload),
    rotorParamsJson: JSON.stringify(rotorParamsPayload),
    assemblyWage: Math.max(0, numberValue(form.assemblyWage)),
    packingWage: Math.max(0, numberValue(form.packingWage)),
    paintingWage: form.surfaceTreatmentMode === 'none'
      ? null
      : Math.max(0, numberValue(form.surfaceTreatmentCost)),
    surfaceTreatmentMode: form.surfaceTreatmentMode,
    surfaceTreatmentCost: form.surfaceTreatmentMode === 'none'
      ? 0
      : Math.max(0, numberValue(form.surfaceTreatmentCost)),
    costMode: form.costMode,
    bundleCost: form.costMode === 'bundle' ? Math.max(0, numberValue(form.bundleCost)) : 0,
    bundleNote: form.costMode === 'bundle' ? form.bundleNote.trim() : '',
  };
}
