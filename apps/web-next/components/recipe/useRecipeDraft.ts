'use client';

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { RecipeSelectionRow } from '@/components/recipe/RecipeDataTable';
import {
  parseRecipePartsJson,
  type CableAccessoryType,
  type Recipe,
  type SurfaceTreatmentMode,
} from '@/lib/recipes';
import { parseTechnicalDataJson, type RecipeTechnicalData } from '@/lib/technical-data';

export type RecipeFormState = {
  name: string;
  spec: string;
  templateId: string;
  variantId: string;
  coilId: string;
  coilSchemeFamilyCode: string;
  coilSpec: string;
  coilSheets: string;
  coilMaterial: string;
  coilSlotType: '小眼' | '国标眼';
  coilWireWeight: string;
  hasFloat: boolean;
  floatWire: string;
  floatPartId?: string;
  floatAccessoryType: CableAccessoryType;
  hasCable: boolean;
  cableLength: string;
  cableWire: string;
  cablePartId?: string;
  cableAccessoryType: CableAccessoryType;
  customBarrelLength: string;
  longScrewExtraLength: string;
  impellerModel: string;
  impellerThickness: string;
  impellerDiameter: string;
  impellerBladeCount: string;
  assemblyWage: string;
  packingWage: string;
  surfaceTreatmentMode: SurfaceTreatmentMode;
  surfaceTreatmentCost: string;
  managementFee: string;
  configurationPolicyJson: string | null;
  technicalData: RecipeTechnicalData;
};

type RecipeDraftState = {
  editingRecipe: Recipe | null;
  form: RecipeFormState;
  optionalParts: RecipeSelectionRow[];
  packingParts: RecipeSelectionRow[];
};

type UseRecipeDraftResult = RecipeDraftState & {
  setForm: Dispatch<SetStateAction<RecipeFormState>>;
  updateForm: (patch: Partial<RecipeFormState>) => void;
  addOptionalPart: () => void;
  addPackingPart: () => void;
  updateOptionalPart: (id: string, patch: Partial<RecipeSelectionRow>) => void;
  updatePackingPart: (id: string, patch: Partial<RecipeSelectionRow>) => void;
  removeOptionalPart: (id: string) => void;
  removePackingPart: (id: string) => void;
  startCreate: () => void;
  startEdit: (recipe: Recipe) => void;
  startClone: (recipe: Recipe) => void;
};

function createEmptyRecipeForm(): RecipeFormState {
  return {
    name: '',
    spec: '',
    templateId: '',
    variantId: '',
    coilId: '',
    coilSchemeFamilyCode: '',
    coilSpec: '',
    coilSheets: '',
    coilMaterial: '钢带',
    coilSlotType: '小眼',
    coilWireWeight: '',
    hasFloat: false,
    floatWire: '',
    floatAccessoryType: 'standard',
    hasCable: false,
    cableLength: '',
    cableWire: '',
    cableAccessoryType: 'standard',
    customBarrelLength: '',
    longScrewExtraLength: '0',
    impellerModel: '',
    impellerThickness: '',
    impellerDiameter: '',
    impellerBladeCount: '',
    assemblyWage: '0',
    packingWage: '0',
    surfaceTreatmentMode: 'none',
    surfaceTreatmentCost: '0',
    managementFee: '0',
    configurationPolicyJson: null,
    technicalData: {},
  };
}

function nextDraftSelectionId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEmptySelection(): RecipeSelectionRow {
  return {
    id: nextDraftSelectionId(),
    model: '',
    supplier: '',
    qty: '1',
    packagingMaterial: '',
    costSource: '',
    snapshotPrice: '',
  };
}

function parseSelections(value?: string, packaging = false): RecipeSelectionRow[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((part) => part?.model)
      .map((part) => ({
        id: nextDraftSelectionId(),
        ...(part.partId != null ? { partId: part.partId } : {}),
        model: String(part.model || ''),
        supplier: String(part.supplier || ''),
        qty: String(part.qty || 1),
        packagingMaterial: String(part.packagingMaterial || (packaging ? '纸箱' : '')),
        costSource: part.costSource === 'manual' ? 'manual' : '',
        snapshotPrice: part.snapshotPrice == null ? '' : String(part.snapshotPrice),
      }));
  } catch {
    return [];
  }
}

function coilWireWeightFromFormula(formula?: string): string {
  const match = String(formula || '').match(/\+\s*([0-9]+(?:\.[0-9]+)?)\s*×/);
  return match?.[1] || '';
}

function savedCoilWireWeight(recipe: Recipe): string {
  if (recipe.coilWireWeight != null && Number(recipe.coilWireWeight) > 0) {
    return String(recipe.coilWireWeight);
  }
  const coilPart = parseRecipePartsJson(recipe.partsJson)
    .find((part) => part.name === '线圈转子' && part.formula);
  return coilWireWeightFromFormula(coilPart?.formula);
}

function formFromRecipe(recipe: Recipe): RecipeFormState {
  return {
    name: recipe.name,
    spec: recipe.spec,
    templateId: recipe.templateId ? String(recipe.templateId) : '',
    variantId: recipe.modelVariantId ? String(recipe.modelVariantId) : '',
    coilId: recipe.coilId ? String(recipe.coilId) : '',
    coilSchemeFamilyCode: recipe.coilSchemeFamilyCode || '',
    coilSpec: recipe.coilSpec || '',
    coilSheets: recipe.coilSheets ? String(recipe.coilSheets) : '',
    coilMaterial: recipe.coilMaterial || '钢带',
    coilSlotType: recipe.coilSlotType || '小眼',
    coilWireWeight: savedCoilWireWeight(recipe),
    hasFloat: Boolean(recipe.hasFloat),
    floatWire: recipe.floatWire || '',
    floatPartId: String(parseRecipePartsJson(recipe.partsJson).find(part => part.costRole === 'float' || /^浮球(?:-|$)/.test(part.name || ''))?.partId || ''),
    floatAccessoryType: recipe.floatAccessoryType || 'standard',
    hasCable: Boolean(recipe.hasCable),
    cableLength: recipe.cableLength ? String(recipe.cableLength) : '',
    cableWire: recipe.cableWire || '',
    cablePartId: String(parseRecipePartsJson(recipe.partsJson).find(part => part.cableAssembly || part.costRole === 'cable')?.partId || ''),
    cableAccessoryType: recipe.cableAccessoryType || 'standard',
    customBarrelLength: recipe.customBarrelLength ? String(recipe.customBarrelLength) : '',
    longScrewExtraLength: String(recipe.longScrewExtraLength || 0),
    impellerModel: recipe.impellerModel || '',
    impellerThickness: recipe.impellerThickness ? String(recipe.impellerThickness) : '',
    impellerDiameter: recipe.impellerDiameter ? String(recipe.impellerDiameter) : '',
    impellerBladeCount: recipe.impellerBladeCount ? String(recipe.impellerBladeCount) : '',
    assemblyWage: String(recipe.assemblyWage || 0),
    packingWage: String(recipe.packingWage || 0),
    surfaceTreatmentMode: recipe.surfaceTreatmentMode || 'none',
    surfaceTreatmentCost: String(recipe.surfaceTreatmentCost || 0),
    managementFee: String(recipe.managementFee || 0),
    configurationPolicyJson: recipe.configurationPolicyJson || null,
    technicalData: parseTechnicalDataJson(recipe.technicalDataJson),
  };
}

function selectionsFromRecipe(recipe: Recipe) {
  return {
    optionalParts: parseSelections(recipe.extraPartsJson),
    packingParts: parseSelections(recipe.packingPartsJson, true),
  };
}

export function useRecipeDraft(): UseRecipeDraftResult {
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [form, setForm] = useState<RecipeFormState>(createEmptyRecipeForm);
  const [optionalParts, setOptionalParts] = useState<RecipeSelectionRow[]>([]);
  const [packingParts, setPackingParts] = useState<RecipeSelectionRow[]>([]);

  const updateForm = useCallback((patch: Partial<RecipeFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  }, []);

  const addOptionalPart = useCallback(() => {
    setOptionalParts((current) => [...current, createEmptySelection()]);
  }, []);

  const addPackingPart = useCallback(() => {
    setPackingParts((current) => [...current, createEmptySelection()]);
  }, []);

  const updateOptionalPart = useCallback((id: string, patch: Partial<RecipeSelectionRow>) => {
    setOptionalParts((current) => current.map((part) => (
      part.id === id ? { ...part, ...patch } : part
    )));
  }, []);

  const updatePackingPart = useCallback((id: string, patch: Partial<RecipeSelectionRow>) => {
    setPackingParts((current) => current.map((part) => (
      part.id === id ? { ...part, ...patch } : part
    )));
  }, []);

  const removeOptionalPart = useCallback((id: string) => {
    setOptionalParts((current) => current.filter((part) => part.id !== id));
  }, []);

  const removePackingPart = useCallback((id: string) => {
    setPackingParts((current) => current.filter((part) => part.id !== id));
  }, []);

  const startCreate = useCallback(() => {
    setEditingRecipe(null);
    setForm(createEmptyRecipeForm());
    setOptionalParts([]);
    setPackingParts([]);
  }, []);

  const startEdit = useCallback((recipe: Recipe) => {
    const selections = selectionsFromRecipe(recipe);
    setEditingRecipe(recipe);
    setForm(formFromRecipe(recipe));
    setOptionalParts(selections.optionalParts);
    setPackingParts(selections.packingParts);
  }, []);

  const startClone = useCallback((recipe: Recipe) => {
    const selections = selectionsFromRecipe(recipe);
    setEditingRecipe(null);
    setForm({
      ...formFromRecipe(recipe),
      name: `${recipe.name || '未命名配方'} - 副本`,
      variantId: '',
    });
    setOptionalParts(selections.optionalParts);
    setPackingParts(selections.packingParts);
  }, []);

  return {
    editingRecipe,
    form,
    optionalParts,
    packingParts,
    setForm,
    updateForm,
    addOptionalPart,
    addPackingPart,
    updateOptionalPart,
    updatePackingPart,
    removeOptionalPart,
    removePackingPart,
    startCreate,
    startEdit,
    startClone,
  };
}
