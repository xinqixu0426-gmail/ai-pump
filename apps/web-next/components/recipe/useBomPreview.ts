'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RecipeSelectionRow } from '@/components/recipe/RecipeDataTable';
import {
  previewRecipeBomDraft,
  type CableAccessoryType,
  type RecipeBomDraftResult,
  type RecipePart,
} from '@/lib/recipes';

type BomPreviewInput = Parameters<typeof previewRecipeBomDraft>[0];

export type BomPreviewForm = {
  templateId: string;
  variantId: string;
  coilId: string;
  coilSchemeFamilyCode: string;
  customBarrelLength: string;
  longScrewExtraLength: string;
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
};

type RunBomPreviewOptions = {
  captureError?: boolean;
};

type UseBomPreviewOptions = {
  active: boolean;
  form: BomPreviewForm;
  optionalParts: RecipeSelectionRow[];
  packingParts: RecipeSelectionRow[];
  hasStainlessBarrel: boolean;
  autoDelayMs?: number;
};

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectionToRecipeParts(
  parts: RecipeSelectionRow[],
  packaging = false
): RecipePart[] {
  return parts
    .filter((part) => part.model.trim())
    .map((part) => ({
      ...(part.partId !== undefined ? { partId: part.partId } : {}),
      model: part.model.trim(),
      supplier: part.supplier.trim(),
      qty: numberValue(part.qty) || 1,
      ...(packaging ? { packagingMaterial: part.packagingMaterial.trim() || '纸箱' } : {}),
      ...(part.costSource === 'manual'
        ? { snapshotPrice: numberValue(part.snapshotPrice), costSource: 'manual' as const }
        : {}),
    }));
}

function buildBomPreviewInput(
  form: BomPreviewForm,
  optionalParts: RecipeSelectionRow[],
  packingParts: RecipeSelectionRow[],
  hasStainlessBarrel: boolean
): BomPreviewInput | null {
  const canPreview = Boolean(
    form.templateId
    || optionalParts.length > 0
    || packingParts.length > 0
    || form.hasFloat
    || form.hasCable
    || form.coilSpec
    || form.coilSheets
  );
  if (!canPreview) return null;

  return {
    templateId: Number(form.templateId),
    modelVariantId: form.variantId ? Number(form.variantId) : null,
    coilId: form.coilId ? Number(form.coilId) : null,
    coilSchemeFamilyCode: form.coilSchemeFamilyCode,
    customBarrelLength: hasStainlessBarrel ? form.customBarrelLength || null : null,
    longScrewExtraLength: hasStainlessBarrel ? form.longScrewExtraLength || 0 : 0,
    coilSpec: form.coilSpec,
    coilSheets: form.coilSheets,
    coilMaterial: form.coilMaterial,
    coilSlotType: form.coilSlotType,
    coilWireWeight: form.coilWireWeight || null,
    optionalParts: selectionToRecipeParts(optionalParts),
    hasFloat: form.hasFloat,
    floatWire: form.floatWire,
    floatPartId: form.floatPartId ? Number(form.floatPartId) : undefined,
    floatAccessoryType: form.floatAccessoryType,
    hasCable: form.hasCable,
    cableLength: form.cableLength,
    cableWire: form.cableWire,
    cablePartId: form.cablePartId ? Number(form.cablePartId) : undefined,
    cableAccessoryType: form.cableAccessoryType,
    packingParts: selectionToRecipeParts(packingParts, true),
  };
}

export function useBomPreview({
  active,
  form,
  optionalParts,
  packingParts,
  hasStainlessBarrel,
  autoDelayMs = 400,
}: UseBomPreviewOptions) {
  const [draft, setDraft] = useState<RecipeBomDraftResult | null>(null);
  const [acceptedInput, setAcceptedInput] = useState<BomPreviewInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const activeRef = useRef(false);
  const {
    templateId,
    variantId,
    coilId,
    coilSchemeFamilyCode,
    customBarrelLength,
    longScrewExtraLength,
    coilSpec,
    coilSheets,
    coilMaterial,
    coilSlotType,
    coilWireWeight,
    hasFloat,
    floatWire,
    floatAccessoryType,
    hasCable,
    cableLength,
    cableWire,
    cableAccessoryType,
  } = form;
  const input = useMemo(() => buildBomPreviewInput(
    {
      templateId,
      variantId,
      coilId,
      coilSchemeFamilyCode,
      customBarrelLength,
      longScrewExtraLength,
      coilSpec,
      coilSheets,
      coilMaterial,
      coilSlotType,
      coilWireWeight,
      hasFloat,
      floatWire,
      floatAccessoryType,
      hasCable,
      cableLength,
      cableWire,
      cableAccessoryType,
    },
    optionalParts,
    packingParts,
    hasStainlessBarrel
  ), [
    templateId,
    variantId,
    coilId,
    coilSchemeFamilyCode,
    customBarrelLength,
    longScrewExtraLength,
    coilSpec,
    coilSheets,
    coilMaterial,
    coilSlotType,
    coilWireWeight,
    hasFloat,
    floatWire,
    floatAccessoryType,
    hasCable,
    cableLength,
    cableWire,
    cableAccessoryType,
    hasStainlessBarrel,
    optionalParts,
    packingParts,
  ]);

  const runRequest = useCallback(async (
    requestInput: BomPreviewInput,
    options: RunBomPreviewOptions = {}
  ): Promise<RecipeBomDraftResult> => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const nextDraft = await previewRecipeBomDraft(requestInput);
      if (requestId === requestRef.current) {
        setDraft(nextDraft);
        setAcceptedInput(requestInput);
      }
      return nextDraft;
    } catch (error) {
      if (requestId === requestRef.current && options.captureError !== false) {
        setError(error instanceof Error ? error.message : '生成 BOM 草稿失败');
      }
      throw error;
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  const replace = useCallback((nextDraft: RecipeBomDraftResult | null) => {
    requestRef.current += 1;
    setDraft(nextDraft);
    setAcceptedInput(null);
    setLoading(false);
    setError(null);
  }, []);

  const reset = useCallback(() => replace(null), [replace]);
  const clearError = useCallback(() => setError(null), []);
  const run = useCallback(async (
    options: RunBomPreviewOptions = {}
  ): Promise<RecipeBomDraftResult | null> => {
    if (!input) {
      reset();
      return null;
    }
    return runRequest(input, options);
  }, [input, reset, runRequest]);

  useEffect(() => {
    const runImmediately = active && !activeRef.current;
    activeRef.current = active;
    if (!active) {
      requestRef.current += 1;
      setLoading(false);
      return;
    }
    if (!input) {
      reset();
      return;
    }

    requestRef.current += 1;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void run({ captureError: true }).catch(() => undefined);
    }, runImmediately ? 0 : autoDelayMs);
    return () => window.clearTimeout(timer);
  }, [active, autoDelayMs, input, reset, run]);

  return {
    draft,
    loading,
    stale: Boolean(draft && acceptedInput !== input),
    error,
    canPreview: Boolean(input),
    run,
    replace,
    reset,
    clearError,
  };
}
