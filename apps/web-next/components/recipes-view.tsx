'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Layers3, Package, Plus, RefreshCw } from 'lucide-react';
import { FadePanel } from '@/components/motion/fade-panel';
import { BomTableDialog } from '@/components/recipe/BomTableDialog';
import { CostSummaryPanel } from '@/components/recipe/CostSummaryPanel';
import { MissingPartsBatchDialog } from '@/components/recipe/MissingPartsBatchDialog';
import { ConfigurationPolicyEditor } from '@/components/recipe/ConfigurationPolicyEditor';
import {
  PumpShellTemplateEditor,
  type ShellCatalogOption,
  type TemplateFormState,
  type TemplatePartFormRow,
} from '@/components/recipe/PumpShellTemplateEditor';
import { PumpShellTemplateWorkspace } from '@/components/recipe/PumpShellTemplateWorkspace';
import { ProductCreationDialog } from '@/components/recipe/ProductCreationDialog';
import {
  emptyTemplateForm,
  parseTemplateJsonArray,
  templateFormFromTemplate,
  templateFormForReuse,
  templateFormToInput,
} from '@/components/recipe/pump-shell-template-form';
import {
  RecipeAnalysisPanel,
  type RuleLearningImpact,
} from '@/components/recipe/RecipeAnalysisPanel';
import {
  RecipeBasicSection,
  type LinkedChangeAnnotation,
} from '@/components/recipe/RecipeBasicSection';
import { RecipeCoilSection } from '@/components/recipe/RecipeCoilSection';
import { RecipeComparePanel } from '@/components/recipe/RecipeComparePanel';
import type { RecipeSelectionRow } from '@/components/recipe/RecipeDataTable';
import { RecipeDynamicConfigSection, wireLinkNote } from '@/components/recipe/RecipeDynamicConfigSection';
import { RecipeDetailPanel } from '@/components/recipe/RecipeDetailPanel';
import { RecipeEditor } from '@/components/recipe/RecipeEditor';
import type { RecipeFlowStep } from '@/components/recipe/RecipeSection';
import { RecipeLaborCostSection } from '@/components/recipe/RecipeLaborCostSection';
import {
  InlinePartCreateDialog,
  type InlinePartCreateSeed,
} from '@/components/recipe/InlinePartCreateDialog';
import {
  ModelVariantCompatibilityPanel,
  type ModelVariantEditorTarget,
} from '@/components/recipe/ModelVariantCompatibilityPanel';
import {
  RecipeOptionalPackingSection,
  type PackingModelOption,
} from '@/components/recipe/RecipeOptionalPackingSection';
import {
  RecipeWorkspace,
  type RecipeWorkspaceFilter,
} from '@/components/recipe/RecipeWorkspace';
import {
  findDraftSelectionPart,
  partCostSourceLabel,
  partFormulaLine,
  recipePartSubtotal,
} from '@/components/recipe/recipe-cost-display';
import { useBomPreview } from '@/components/recipe/useBomPreview';
import { useRecipeDraft, type RecipeFormState } from '@/components/recipe/useRecipeDraft';
import { resolveCoilVariantSelection } from '@/components/recipe/coil-selection';
import {
  candidateMatchesPart,
  collectRecipeMissingPartCandidates,
  collectTemplateMissingPartCandidates,
  packagingSubcategoryForDraft,
  type MissingPartCandidate,
} from '@/components/recipe/missing-part-candidates';
import {
  SHELL_COMPONENT_CATEGORY,
  barrelComponentNameOptions,
  isBarrelComponentName,
  isStainlessStretchBarrelComponent,
  type ShellComponentRow,
} from '@/components/recipe/ShellCostEditor';
import { TechnicalDataEditor } from '@/components/technical-data-editor';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/page-header';
import { useConfirmDiscard } from '@/hooks/use-confirm-discard';
import { getAllCoils, type CoilRecord } from '@/lib/coils';
import { money } from '@/lib/format';
import { resolveInlineCatalogPart } from '@/lib/inline-part-resolution';
import { createPart, getAllParts, type Part, type PartInput } from '@/lib/parts';
import {
  analyzeRecipeConfiguration,
  getFactoryLearningHealth,
  resolveRecipeAnalysisFeedback,
  saveRecipeAnalysisFeedback,
  type FactoryLearningHealth,
  type RecipeConfigurationAnalysis,
  type RecipeAnalysisFeedbackDecision,
  type RecipeAnalysisFinding,
} from '@/lib/quality';
import {
  buildRecipeSavePayloadDraft,
  buildTemplateNameMap,
  createModelVariant,
  createRecipe,
  createTemplate,
  deleteModelVariant,
  deleteRecipe,
  deleteTemplate,
  getCoilSpecOptions,
  getRecipeCurrentCost,
  getRecipeDataset,
  getRecipeInventoryStatus,
  getTemplateRecipeDraft,
  previewRecipeCostDraft,
  updateModelVariant,
  updateRecipe,
  updateTemplate,
  type CoilSpecOption,
  type ModelVariantInput,
  type PumpModelVariant,
  type PumpShellTemplate,
  type Recipe,
  type RecipeBomDraftResult,
  type RecipeCurrentCostResult,
  type RecipeCurrentTotalCost,
  type RecipePart,
  type RecipeInventoryStatusResult,
  type ShellComponentInput,
} from '@/lib/recipes';
import { buildTechnicalReferenceFields, calculateBearingSpan, findShellMetaForTemplate, openOffsetFromMeta } from '@/lib/technical-references';
import { templatePartCategoryForName } from '@/lib/template-part-category';

type RecipeSection = 'recipes' | 'templates' | 'variants';

type RecipeDeleteTarget =
  | { kind: 'recipe'; item: Recipe }
  | { kind: 'template'; item: PumpShellTemplate }
  | { kind: 'variant'; item: PumpModelVariant };

type InlinePartCreateTarget = {
  kind: 'template-shell' | 'template-fixed' | 'recipe-optional' | 'recipe-packing';
  rowId?: string;
  seed: InlinePartCreateSeed;
};

type CostDisplaySnapshot = {
  draft: RecipeBomDraftResult | null;
  relatedBomParts: RecipePart[];
  optionalParts: RecipeSelectionRow[];
  packingParts: RecipeSelectionRow[];
  total: number;
  bomCount: number;
  coilCost: number;
  templatePartsCost: number;
  optionalPartsCost: number;
  packingPartsCost: number;
  laborAndManagementCost: number;
  surfaceTreatmentCost: number;
  floatCostReady: boolean;
  cableCostReady: boolean;
  floatCostPart?: RecipePart;
  cableCostPart?: RecipePart;
};

function parseRecipeReviewTarget(search: string): {
  recipeId: number;
  feedbackIds: number[];
  autoAnalyze: boolean;
} | null {
  const params = new URLSearchParams(search);
  const recipeId = Number(params.get('recipeId'));
  if (!Number.isInteger(recipeId) || recipeId <= 0) return null;
  const feedbackIds = Array.from(new Set(
    [params.get('feedbackIds'), params.get('feedbackId')]
      .filter(Boolean)
      .flatMap((value) => String(value).split(','))
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  ));
  return {
    recipeId,
    feedbackIds,
    autoAnalyze: params.get('action') === 'smart-check',
  };
}

const sectionOptions = {
  recipes: { label: '配方', description: 'BOM 与成本管理' },
  templates: { label: '泵壳模板', description: '固定搭配与基础成本' },
} as const;

type RecipeSelection = RecipeSelectionRow;

function packagingMaterialForCatalogPart(part?: Part): string {
  if (!part) return '';
  const identity = `${part.model || ''} ${part.remark || ''}`;
  if (identity.includes('珍珠棉')) return '珍珠棉';
  if (identity.includes('泡沫') || part.subcategory === '内衬') return '泡沫';
  if (identity.includes('木箱')) return '木箱';
  if (identity.includes('彩印') || identity.includes('彩箱')) return '彩印箱';
  if (identity.includes('纸箱') || part.subcategory === '外包装') return '牛皮纸箱';
  return '其他包材';
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function wireOptions(parts: Part[], category: '浮球' | '电缆线', prefix: string): string[] {
  const values = new Set<string>();
  parts.forEach((part) => {
    if (part.category !== category) return;
    if (!part.model.startsWith(prefix)) return;
    const value = part.model.slice(prefix.length).trim();
    if (value) values.add(value);
  });
  return Array.from(values).sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b));
}

function normalizeWireGauge(value: unknown): string {
  return String(value ?? '').trim().replace(/^线径/, '');
}

function matchWireOption(options: string[], wireGauge: unknown): string {
  const normalizedGauge = normalizeWireGauge(wireGauge);
  if (!normalizedGauge) return '';
  return options.find((option) => normalizeWireGauge(option) === normalizedGauge)
    || options.find((option) => normalizeWireGauge(option).includes(normalizedGauge))
    || normalizedGauge;
}

function isDynamicDraftPart(part: RecipePart): boolean {
  const text = `${part.name || ''}${part.model || ''}`;
  return part.name === '线圈转子'
    || part.name === '电容'
    || text.includes('浮球')
    || text.includes('电缆')
    || text.includes('纸箱')
    || text.includes('泡沫')
    || Boolean(part.packagingMaterial);
}

function bomPartsCost(draft: RecipeBomDraftResult | null): number {
  return draft ? draft.parts.reduce((sum, part) => sum + recipePartSubtotal(part), 0) : 0;
}

function liveRecipeTotal(draft: RecipeBomDraftResult | null, form: RecipeFormState): number {
  if (!draft) return 0;
  return bomPartsCost(draft)
    + numberValue(form.assemblyWage)
    + numberValue(form.packingWage)
    + (form.surfaceTreatmentMode === 'none' ? 0 : numberValue(form.surfaceTreatmentCost))
    + numberValue(form.managementFee);
}

function useLatestValue<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export function RecipesView() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [currentCosts, setCurrentCosts] = useState<RecipeCurrentTotalCost[]>([]);
  const [templates, setTemplates] = useState<PumpShellTemplate[]>([]);
  const [variants, setVariants] = useState<PumpModelVariant[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [currentCopperPricePerKg, setCurrentCopperPricePerKg] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataWarning, setDataWarning] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<RecipeSection>('recipes');
  const [query, setQuery] = useState('');
  const [templateId, setTemplateId] = useState('全部');
  const [quickFilter, setQuickFilter] = useState<RecipeWorkspaceFilter>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [detailRecipe, setDetailRecipe] = useState<Recipe | null>(null);
  const [detailCurrentCost, setDetailCurrentCost] = useState<RecipeCurrentCostResult | null>(null);
  const [detailCurrentCostError, setDetailCurrentCostError] = useState<string | null>(null);
  const [inventoryStatus, setInventoryStatus] = useState<RecipeInventoryStatusResult | null>(null);
  const [inventoryStatusLoading, setInventoryStatusLoading] = useState(false);
  const [inventoryStatusError, setInventoryStatusError] = useState<string | null>(null);
  const inventoryStatusRequestRef = useRef(0);
  const {
    editingRecipe,
    form,
    optionalParts,
    packingParts,
    setForm,
    updateForm: updateDraftForm,
    addOptionalPart: addOptionalDraftPart,
    addPackingPart: addPackingDraftPart,
    updateOptionalPart: updateOptionalDraftPart,
    updatePackingPart: updatePackingDraftPart,
    removeOptionalPart: removeOptionalDraftPart,
    removePackingPart: removePackingDraftPart,
    startCreate: startCreateDraft,
    startEdit: startEditDraft,
    startClone: startCloneDraft,
  } = useRecipeDraft();
  const formTemplate = templates.find((template) => String(template.id) === form.templateId);
  const formShellMeta = useMemo(() => findShellMetaForTemplate(formTemplate, parts), [formTemplate, parts]);
  const formTemplateShellComponents = useMemo(
    () => parseTemplateJsonArray<ShellComponentRow>(formTemplate?.shellComponentsJson),
    [formTemplate?.shellComponentsJson]
  );
  const hasStainlessStretchBarrelComponent = formTemplateShellComponents.some((component) => component.included !== false && isStainlessStretchBarrelComponent(component));
  const hasStainlessBarrel = formTemplate?.costMode === 'components'
    ? hasStainlessStretchBarrelComponent
    : formShellMeta?.isStainless === true;
  const {
    draft: bomDraft,
    loading: bomDraftLoading,
    stale: bomDraftStale,
    error: bomDraftError,
    canPreview: canPreviewBomDraft,
    run: runBomPreview,
    reset: resetBomPreview,
    clearError: clearBomPreviewError,
  } = useBomPreview({
    active: drawerOpen,
    form,
    optionalParts,
    packingParts,
    hasStainlessBarrel,
  });
  const [recipeAnalysis, setRecipeAnalysis] = useState<RecipeConfigurationAnalysis | null>(null);
  const [recipeAnalysisOpen, setRecipeAnalysisOpen] = useState(false);
  const [recipeAnalysisLoading, setRecipeAnalysisLoading] = useState(false);
  const [analysisSaveGateOpen, setAnalysisSaveGateOpen] = useState(false);
  const [templateMatchDialogOpen, setTemplateMatchDialogOpen] = useState(false);
  const [bomDetailsOpen, setBomDetailsOpen] = useState(false);
  const [variantEditorTarget, setVariantEditorTarget] = useState<ModelVariantEditorTarget>(null);
  const [coilSpecs, setCoilSpecs] = useState<CoilSpecOption[]>([]);
  const [coilRecords, setCoilRecords] = useState<CoilRecord[]>([]);
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false);
  const [shellComponentPartsRefreshing, setShellComponentPartsRefreshing] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PumpShellTemplate | null>(null);
  const [templateReuseSource, setTemplateReuseSource] = useState<PumpShellTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecipeDeleteTarget | null>(null);
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(emptyTemplateForm());
  const [inlinePartCreateTarget, setInlinePartCreateTarget] = useState<InlinePartCreateTarget | null>(null);
  const [productCreationOpen, setProductCreationOpen] = useState(false);
  const [missingPartsBatchTarget, setMissingPartsBatchTarget] = useState<'template' | 'recipe' | null>(null);
  const [costDisplaySnapshot, setCostDisplaySnapshot] = useState<CostDisplaySnapshot | null>(null);
  const [autoAnalyzeRecipeId, setAutoAnalyzeRecipeId] = useState<number | null>(null);
  const [reviewEvidenceTargets, setReviewEvidenceTargets] = useState<FactoryLearningHealth['items']>([]);
  const [reviewEvidenceBatchTotal, setReviewEvidenceBatchTotal] = useState(0);
  const [reviewEvidenceLoading, setReviewEvidenceLoading] = useState(false);
  const [reviewEvidenceResolving, setReviewEvidenceResolving] = useState(false);
  const [reviewEvidenceNotice, setReviewEvidenceNotice] = useState<string | null>(null);
  const [reviewEvidenceBatchCompleted, setReviewEvidenceBatchCompleted] = useState(false);
  const [reviewRuleLearning, setReviewRuleLearning] = useState<RuleLearningImpact | null>(null);
  const autoWireSelectionRef = useRef({ floatWire: '', cableWire: '' });
  const autoAnalysisStartedRef = useRef<number | null>(null);
  const deepLinkHandledRef = useRef(false);
  const partsReadPromiseRef = useRef<Promise<Part[]> | null>(null);
  const templateDraftRequestRef = useRef(0);
  const runRecipeAnalysisRef = useLatestValue(runRecipeAnalysis);
  const reviewEvidenceTarget = reviewEvidenceTargets[0] || null;
  const reviewEvidenceCompletedCount = Math.max(0, reviewEvidenceBatchTotal - reviewEvidenceTargets.length);
  const {
    dirty: recipeFormDirty,
    discardPromptOpen: recipeDiscardPromptOpen,
    discardMessage: recipeDiscardMessage,
    markDirty: markRecipeDirty,
    resetDirty: resetRecipeDirty,
    requestClose: requestRecipeClose,
    confirmDiscard: confirmRecipeDiscard,
    cancelDiscard: cancelRecipeDiscard,
  } = useConfirmDiscard({
    open: drawerOpen,
    busy: saving,
    onDiscard: closeRecipeEditor,
    message: '当前配方草稿有尚未保存的修改，确定放弃吗？',
  });
  const {
    dirty: templateFormDirty,
    discardPromptOpen: templateDiscardPromptOpen,
    discardMessage: templateDiscardMessage,
    markDirty: markTemplateDirty,
    resetDirty: resetTemplateDirty,
    requestClose: requestTemplateClose,
    confirmDiscard: confirmTemplateDiscard,
    cancelDiscard: cancelTemplateDiscard,
  } = useConfirmDiscard({
    open: templateDrawerOpen,
    busy: saving,
    onDiscard: closeTemplateEditor,
    message: '当前泵壳模板有尚未保存的修改，确定放弃吗？',
  });

  async function load(force = false) {
    setError(null);
    setDataWarning(null);
    if (force) setRefreshing(true);
    else setLoading(true);

    try {
      const [data, partRows] = await Promise.all([getRecipeDataset(), getAllParts()]);
      setRecipes(data.recipes);
      setCurrentCosts(data.currentCosts);
      setDataWarning(data.currentCostsWarning);
      setTemplates(data.templates);
      setVariants(data.variants);
      setParts(partRows);
      setCurrentCopperPricePerKg(data.currentCopperPricePerKg);
      void getCoilSpecOptions().then(setCoilSpecs).catch(() => setCoilSpecs([]));
      void getAllCoils().then(setCoilRecords).catch(() => setCoilRecords([]));
    } catch (err) {
      setError(err instanceof Error ? err.message : '配方加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const readPartsFresh = useCallback(async () => {
    if (partsReadPromiseRef.current) return partsReadPromiseRef.current;
    const request = getAllParts();
    partsReadPromiseRef.current = request;
    try {
      return await request;
    } finally {
      partsReadPromiseRef.current = null;
    }
  }, []);

  const refreshShellComponentParts = useCallback(async () => {
    setShellComponentPartsRefreshing(true);
    try {
      const freshParts = await readPartsFresh();
      setParts(freshParts);
    } catch (refreshError) {
      setFormError(refreshError instanceof Error ? refreshError.message : '零件刷新失败');
    } finally {
      setShellComponentPartsRefreshing(false);
    }
  }, [readPartsFresh]);

  const resolveCatalogPart = useCallback(async (
    input: PartInput
  ): Promise<{ part: Part; created: boolean }> => {
    const result = await resolveInlineCatalogPart({
      input,
      readParts: readPartsFresh,
      createPart,
    });
    setParts(result.rows);
    return { part: result.part, created: result.created };
  }, [readPartsFresh]);

  const createShellComponentPart = useCallback(async (input: {
    model: string;
    supplier: string;
    catalogUnitCost: number;
  }) => {
    const model = input.model.trim();
    const supplier = input.supplier.trim();
    const catalogUnitCost = Number(input.catalogUnitCost);
    if (!model) throw new Error('请先填写零件型号');
    if (!supplier) throw new Error('请先填写供应商');
    if (!Number.isFinite(catalogUnitCost) || catalogUnitCost <= 0) throw new Error('请输入大于 0 的目录成本价');

    return resolveCatalogPart({
      model,
      category: SHELL_COMPONENT_CATEGORY,
      catalogUnitCost,
      supplier,
      stock: 0,
      remark: '从泵壳模板自由搭配中就地建档',
    });
  }, [resolveCatalogPart]);

  const prepareRecipeEditorUi = useCallback(() => {
    setReviewEvidenceTargets([]);
    setReviewEvidenceBatchTotal(0);
    setReviewEvidenceNotice(null);
    setReviewEvidenceBatchCompleted(false);
    setReviewRuleLearning(null);
    setReviewEvidenceLoading(false);
    autoWireSelectionRef.current = { floatWire: '', cableWire: '' };
    setTemplateMatchDialogOpen(false);
    setBomDetailsOpen(false);
    setRecipeAnalysis(null);
    setAnalysisSaveGateOpen(false);
    setFormError(null);
    setDrawerOpen(true);
  }, []);

  const openEditDrawer = useCallback((recipe: Recipe) => {
    templateDraftRequestRef.current += 1;
    resetRecipeDirty();
    startEditDraft(recipe);
    resetBomPreview();
    prepareRecipeEditorUi();
  }, [prepareRecipeEditorUi, resetBomPreview, resetRecipeDirty, startEditDraft]);

  const syncRecipeTechnicalFileCount = useCallback((recipeId: number | null | undefined, technicalFileCount: number) => {
    if (!recipeId) return;
    setRecipes((prev) => prev.map((recipe) => (
      recipe.id === recipeId ? { ...recipe, technicalFileCount } : recipe
    )));
    setDetailRecipe((prev) => (
      prev?.id === recipeId ? { ...prev, technicalFileCount } : prev
    ));
  }, []);
  const handleTechnicalFileCountChange = useCallback((count: number) => {
    syncRecipeTechnicalFileCount(editingRecipe?.id, count);
  }, [editingRecipe?.id, syncRecipeTechnicalFileCount]);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!templateDrawerOpen && !drawerOpen) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshShellComponentParts();
    };
    void refreshShellComponentParts();
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [drawerOpen, refreshShellComponentParts, templateDrawerOpen]);

  useEffect(() => {
    if (loading || deepLinkHandledRef.current) return;
    deepLinkHandledRef.current = true;
    const target = parseRecipeReviewTarget(window.location.search);
    if (!target) return;

    const recipe = recipes.find((item) => item.id === target.recipeId);
    if (!recipe) {
      setError(`未找到配方 #${target.recipeId}，该配方可能已归档或删除`);
      return;
    }

    setActiveSection('recipes');
    setDetailRecipe(null);
    openEditDrawer(recipe);
    if (target.feedbackIds.length > 0) {
      setReviewEvidenceBatchCompleted(false);
      setReviewRuleLearning(null);
      setReviewEvidenceLoading(true);
      void getFactoryLearningHealth(200)
        .then((health) => {
          const requestedOrder = new Map(target.feedbackIds.map((feedbackId, index) => [feedbackId, index]));
          const evidence = health.items.filter((item) => (
            requestedOrder.has(item.feedbackId)
            && item.recipeId === recipe.id
            && item.needsRecheck
          )).sort((left, right) => (
            (requestedOrder.get(left.feedbackId) || 0) - (requestedOrder.get(right.feedbackId) || 0)
          ));
          setReviewEvidenceTargets(evidence);
          setReviewEvidenceBatchTotal(evidence.length);
          if (evidence.length === 0) {
            clearReviewTaskSearchParams();
            setReviewEvidenceNotice('这组待复核任务已经处理，或不再属于当前配方。');
          } else if (evidence.length < target.feedbackIds.length) {
            setReviewEvidenceNotice(`其中 ${target.feedbackIds.length - evidence.length} 条反馈已经处理，继续处理剩余 ${evidence.length} 条。`);
          } else {
            setReviewEvidenceNotice(null);
          }
        })
        .catch((err) => {
          setReviewEvidenceNotice(null);
          setFormError(err instanceof Error ? err.message : '待复核证据读取失败');
        })
        .finally(() => setReviewEvidenceLoading(false));
    }
    if (target.autoAnalyze) setAutoAnalyzeRecipeId(recipe.id);
  }, [loading, openEditDrawer, recipes]);

  useEffect(() => {
    if (
      !autoAnalyzeRecipeId
      || !drawerOpen
      || editingRecipe?.id !== autoAnalyzeRecipeId
      || autoAnalysisStartedRef.current === autoAnalyzeRecipeId
    ) return;
    autoAnalysisStartedRef.current = autoAnalyzeRecipeId;
    setAutoAnalyzeRecipeId(null);

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('action');
    window.history.replaceState(
      window.history.state,
      '',
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
    );
    void runRecipeAnalysisRef.current();
  }, [autoAnalyzeRecipeId, drawerOpen, editingRecipe?.id, runRecipeAnalysisRef]);

  const templateNameMap = useMemo(() => buildTemplateNameMap(templates), [templates]);
  const currentCostMap = useMemo(() => new Map(currentCosts.map((item) => [item.recipeId, item])), [currentCosts]);

  useEffect(() => {
    if (!detailRecipe) {
      setDetailCurrentCost(null);
      setDetailCurrentCostError(null);
      return;
    }

    let cancelled = false;
    setDetailCurrentCostError(null);
    void getRecipeCurrentCost(detailRecipe.id)
      .then((result) => {
        if (!cancelled) setDetailCurrentCost(result);
      })
      .catch((err) => {
        if (!cancelled) setDetailCurrentCostError(err instanceof Error ? err.message : '当前成本读取失败');
      })
      .finally(() => {
      });

    return () => {
      cancelled = true;
    };
  }, [detailRecipe]);

  const shellOpenFactor = hasStainlessBarrel ? openOffsetFromMeta(formShellMeta) : null;
  const linkedBearingSpan = hasStainlessBarrel && shellOpenFactor != null
    ? calculateBearingSpan(form.customBarrelLength, shellOpenFactor)
    : '';
  const technicalReferenceFields = useMemo(
    () => buildTechnicalReferenceFields({ shellMetaInfo: formShellMeta, selectedTemplate: formTemplate || null }),
    [formShellMeta, formTemplate]
  );
  const selectedFormCoilSpec = coilSpecs.find((spec) => spec.spec === form.coilSpec);
  const formMaterialOptions = selectedFormCoilSpec?.materials?.length ? selectedFormCoilSpec.materials : ['钢带'];
  const formSlotTypes = selectedFormCoilSpec?.variants
    ?.filter((variant) => variant.material === form.coilMaterial)
    .map((variant) => variant.slotType);
  const formSlotTypeOptions = formSlotTypes?.length ? formSlotTypes : (selectedFormCoilSpec?.slotTypes?.length ? selectedFormCoilSpec.slotTypes : ['小眼']);
  const coilSheetOptions = useMemo(() => (
    Array.from(new Set(coilRecords
      .filter((coil) => (
        coil.schemeStatus === 'official'
        && (!form.coilSpec || coil.spec === form.coilSpec)
        && (!form.coilMaterial || coil.material === form.coilMaterial)
        && (!form.coilSlotType || coil.slotType === form.coilSlotType)
      ))
      .map((coil) => Number(coil.sheets || 0))
      .filter((sheets) => sheets > 0)))
      .sort((a, b) => a - b)
      .map(String)
  ), [coilRecords, form.coilMaterial, form.coilSlotType, form.coilSpec]);
  const coilSchemeOptions = useMemo(() => coilRecords
    .filter((coil) => (
      coil.spec === form.coilSpec
      && coil.material === form.coilMaterial
      && coil.slotType === form.coilSlotType
      && coil.schemeStatus === 'official'
      && Number(coil.sheets) === Number(form.coilSheets)
    ))
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.id - right.id), [coilRecords, form.coilMaterial, form.coilSheets, form.coilSlotType, form.coilSpec]);
  const coilFamilyOptions = useMemo(() => {
    const families = new Map<string, CoilRecord>();
    coilRecords
      .filter((coil) => (
        coil.spec === form.coilSpec
        && coil.material === form.coilMaterial
        && coil.slotType === form.coilSlotType
        && coil.schemeStatus === 'official'
        && coil.pricingMode === 'calculated'
        && Boolean(coil.schemeFamilyCode)
      ))
      .forEach((coil) => {
        if (!families.has(coil.schemeFamilyCode)) families.set(coil.schemeFamilyCode, coil);
      });
    return [...families.entries()].map(([code, coil]) => ({
      code,
      label: [
        code,
        coil.ratedVoltageV ? `${coil.ratedVoltageV}V` : '',
        coil.ratedFrequencyHz ? `${coil.ratedFrequencyHz}Hz` : '',
        coil.market,
      ].filter(Boolean).join(' · '),
    }));
  }, [coilRecords, form.coilMaterial, form.coilSlotType, form.coilSpec]);
  const exactCoilRecord = useMemo(() => coilSchemeOptions.find((coil) => (
    coil.id === Number(form.coilId)
  )) || null, [coilSchemeOptions, form.coilId]);
  const floatWireOptions = useMemo(() => wireOptions(parts, '浮球', '浮球-线径'), [parts]);
  const cableWireOptions = useMemo(() => wireOptions(parts, '电缆线', '电缆-线径'), [parts]);
  const recommendedFloatWire = matchWireOption(floatWireOptions, bomDraft?.coilSnapshot?.wireGauge);
  const recommendedCableWire = matchWireOption(cableWireOptions, bomDraft?.coilSnapshot?.wireGauge);
  const floatCostReady = form.hasFloat && Boolean(form.floatWire);
  const cableCostReady = form.hasCable && Boolean(form.cableWire) && numberValue(form.cableLength) > 0;
  const floatCostPart = useMemo(() => {
    if (!floatCostReady) return undefined;
    const model = `浮球-线径${normalizeWireGauge(form.floatWire)}`;
    return bomDraft?.parts.find((part) => (
      part.model === model
      && String(part.name || '').includes('浮球')
      && (part.floatAccessoryType || 'standard') === form.floatAccessoryType
    ));
  }, [bomDraft, floatCostReady, form.floatAccessoryType, form.floatWire]);
  const cableCostPart = useMemo(() => {
    if (!cableCostReady) return undefined;
    const model = `电缆-线径${normalizeWireGauge(form.cableWire)}`;
    return bomDraft?.parts.find((part) => (
      part.model === model
      && part.cableAssembly === true
      && Number(part.cableLength || 0) === numberValue(form.cableLength)
      && (part.cableAccessoryType || 'standard') === form.cableAccessoryType
    ));
  }, [bomDraft, cableCostReady, form.cableAccessoryType, form.cableLength, form.cableWire]);
  const isFloatWireRecommended = Boolean(
    form.hasFloat
    && recommendedFloatWire
    && normalizeWireGauge(form.floatWire) === normalizeWireGauge(recommendedFloatWire)
  );
  const isCableWireRecommended = Boolean(
    form.hasCable
    && recommendedCableWire
    && normalizeWireGauge(form.cableWire) === normalizeWireGauge(recommendedCableWire)
  );
  const linkedChangeAnnotations = useMemo<LinkedChangeAnnotation[]>(() => {
    const annotations: LinkedChangeAnnotation[] = [];
    const shellPart = bomDraft?.parts.find((part) => part.dynamicRule === 'stainlessShellBundleByBarrelLength');
    if (shellPart) {
      annotations.push({
        label: '泵壳整体成本',
        value: money(Number(shellPart.snapshotPrice || 0)),
        note: partFormulaLine(shellPart) || '随不锈钢机筒长度计入泵壳套件成本',
        tone: 'blue',
      });
    }

    const stainlessBarrelPart = bomDraft?.parts.find((part) => part.dynamicRule === 'stainlessStretchBarrelByLength');
    if (stainlessBarrelPart) {
      annotations.push({
        label: '不锈钢拉伸筒',
        value: `${Number(stainlessBarrelPart.qty || 0)} cm`,
        note: partFormulaLine(stainlessBarrelPart) || '长度来自配方/常用配置预设',
        tone: 'blue',
      });
    }

    const longScrewPart = bomDraft?.parts.find((part) => part.dynamicRule === 'longScrewByBarrelLength');
    if (longScrewPart) {
      annotations.push({
        label: '不锈钢长螺丝',
        value: longScrewPart.screwLength ? `${longScrewPart.screwLength} mm` : longScrewPart.model,
        note: partFormulaLine(longScrewPart) || '随机筒长度和补偿长度联动',
        tone: 'blue',
      });
    }

    if (bomDraft?.capacitorModel) {
      annotations.push({
        label: '关联电容',
        value: bomDraft.capacitorModel,
        note: bomDraft.coilSnapshot?.defaultCapacitor
          ? `由线圈默认电容 ${bomDraft.coilSnapshot.defaultCapacitor} 匹配`
          : '由线圈规格匹配',
        tone: 'green',
      });
    }

    if (form.hasFloat) {
      annotations.push({
        label: '浮球线径',
        value: form.floatWire || recommendedFloatWire || '-',
        note: wireLinkNote(form.hasFloat, form.floatWire, recommendedFloatWire),
        tone: isFloatWireRecommended ? 'green' : recommendedFloatWire ? 'amber' : 'slate',
      });
    }

    if (form.hasCable) {
      annotations.push({
        label: '电缆线径',
        value: form.cableWire || recommendedCableWire || '-',
        note: wireLinkNote(form.hasCable, form.cableWire, recommendedCableWire),
        tone: isCableWireRecommended ? 'green' : recommendedCableWire ? 'amber' : 'slate',
      });
    }

    return annotations;
  }, [
    bomDraft,
    form.cableWire,
    form.floatWire,
    form.hasCable,
    form.hasFloat,
    isCableWireRecommended,
    isFloatWireRecommended,
    recommendedCableWire,
    recommendedFloatWire,
  ]);
  const linkedChangeSummary = useMemo(
    () => [
      ...linkedChangeAnnotations.filter((item) => item.tone === 'amber'),
      ...linkedChangeAnnotations.filter((item) => item.tone !== 'amber'),
    ]
      .slice(0, 3)
      .map((item) => `${item.label} ${item.value}`)
      .join(' · '),
    [linkedChangeAnnotations]
  );
  const hasLinkedChangeWarning = linkedChangeAnnotations.some((item) => item.tone === 'amber');
  const partModelOptions = useMemo(
    () => Array.from(new Set(parts.filter((part) => part.category !== '包装').map((part) => part.model).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    [parts]
  );
  const shellComponentParts = useMemo(
    () => parts.filter((part) => part.category === SHELL_COMPONENT_CATEGORY && part.model.trim()),
    [parts]
  );
  const shellComponentModelOptions = useMemo(
    () => Array.from(new Set(shellComponentParts.map((part) => part.model))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    [shellComponentParts]
  );
  const shellCatalogOptions = useMemo<ShellCatalogOption[]>(() => {
    const grouped = new Map<string, Part[]>();
    parts
      .filter((part) => part.category === '泵壳' && part.model.trim())
      .forEach((part) => {
        const rows = grouped.get(part.model) || [];
        rows.push(part);
        grouped.set(part.model, rows);
      });
    return Array.from(grouped.entries())
      .map(([model, rows]) => ({
        model,
        rows: rows.sort((left, right) => left.catalogUnitCost - right.catalogUnitCost),
      }))
      .sort((left, right) => left.model.localeCompare(right.model, 'zh-Hans-CN'));
  }, [parts]);
  const packingModelOptions = useMemo<PackingModelOption[]>(() => {
    const byModel = new Map<string, Part>();
    parts
      .filter((part) => part.category === '包装' && part.model)
      .forEach((part) => {
        if (!byModel.has(part.model)) byModel.set(part.model, part);
      });
    return Array.from(byModel.values())
      .sort((left, right) => (
        (left.subcategory || '').localeCompare(right.subcategory || '', 'zh-Hans-CN')
        || left.model.localeCompare(right.model, 'zh-Hans-CN')
      ))
      .map((part) => ({
        key: `${part.model}-${part.supplier}`,
        model: part.model,
        label: `${part.subcategory || '未分类'} · ${packagingMaterialForCatalogPart(part)}`,
      }));
  }, [parts]);
  const liveTotal = useMemo(() => liveRecipeTotal(bomDraft, form), [bomDraft, form]);
  const relatedBomParts = useMemo(() => {
    if (!bomDraft) return [];
    const manualModels = new Set([...optionalParts, ...packingParts].map((part) => part.model.trim()).filter(Boolean));
    return bomDraft.parts.filter((part) => !manualModels.has(part.model) && !isDynamicDraftPart(part));
  }, [bomDraft, optionalParts, packingParts]);
  const relatedBomPartsCost = useMemo(
    () => relatedBomParts.reduce((sum, part) => sum + recipePartSubtotal(part), 0),
    [relatedBomParts]
  );
  const optionalPartsCost = useMemo(() => optionalParts.reduce((sum, part) => sum + recipePartSubtotal(findDraftSelectionPart(bomDraft, part)), 0), [bomDraft, optionalParts]);
  const packingPartsCost = useMemo(() => packingParts.reduce((sum, part) => sum + recipePartSubtotal(findDraftSelectionPart(bomDraft, part)), 0), [bomDraft, packingParts]);
  const laborAndManagementCost = useMemo(() => (
    numberValue(form.assemblyWage) + numberValue(form.packingWage) + numberValue(form.managementFee)
  ), [form.assemblyWage, form.managementFee, form.packingWage]);
  const surfaceTreatmentPreviewCost = form.surfaceTreatmentMode === 'none' ? 0 : numberValue(form.surfaceTreatmentCost);
  useEffect(() => {
    if (!drawerOpen || !bomDraft) {
      setCostDisplaySnapshot(null);
      return;
    }
    if (bomDraftLoading || bomDraftStale) return;
    setCostDisplaySnapshot({
      draft: bomDraft,
      relatedBomParts,
      optionalParts: optionalParts.map((row) => ({ ...row })),
      packingParts: packingParts.map((row) => ({ ...row })),
      total: liveTotal,
      bomCount: bomDraft.parts.length,
      coilCost: Number(bomDraft.coilSnapshot?.totalCost || 0),
      templatePartsCost: relatedBomPartsCost,
      optionalPartsCost,
      packingPartsCost,
      laborAndManagementCost,
      surfaceTreatmentCost: surfaceTreatmentPreviewCost,
      floatCostReady,
      cableCostReady,
      floatCostPart,
      cableCostPart,
    });
  }, [
    bomDraft,
    bomDraftLoading,
    bomDraftStale,
    cableCostPart,
    cableCostReady,
    drawerOpen,
    floatCostPart,
    floatCostReady,
    laborAndManagementCost,
    liveTotal,
    optionalPartsCost,
    optionalParts,
    packingPartsCost,
    packingParts,
    relatedBomParts,
    relatedBomPartsCost,
    surfaceTreatmentPreviewCost,
  ]);
  const costDisplayRefreshing = Boolean(bomDraft && (bomDraftLoading || bomDraftStale));
  const displayedCosts = costDisplayRefreshing && costDisplaySnapshot
    ? costDisplaySnapshot
    : {
        draft: bomDraft,
        relatedBomParts,
        optionalParts,
        packingParts,
        total: liveTotal,
        bomCount: bomDraft?.parts.length || 0,
        coilCost: Number(bomDraft?.coilSnapshot?.totalCost || 0),
        templatePartsCost: relatedBomPartsCost,
        optionalPartsCost,
        packingPartsCost,
        laborAndManagementCost,
        surfaceTreatmentCost: surfaceTreatmentPreviewCost,
        floatCostReady,
        cableCostReady,
        floatCostPart,
        cableCostPart,
      };
  const laborCostWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (numberValue(form.assemblyWage) <= 0) warnings.push('安装工资未填写或为 0，人工成本可能漏算');
    if (numberValue(form.packingWage) <= 0) warnings.push('打包工资未填写或为 0，人工成本可能漏算');
    if (numberValue(form.managementFee) <= 0) warnings.push('管理费未填写或为 0，管理成本可能漏算');
    if (form.surfaceTreatmentMode === 'none') {
      warnings.push('表面处理未启用；如需要喷漆或其他处理，成本可能漏算');
    } else if (numberValue(form.surfaceTreatmentCost) <= 0) {
      warnings.push('表面处理费用未填写或为 0，表面处理成本可能漏算');
    }
    return warnings;
  }, [form.assemblyWage, form.managementFee, form.packingWage, form.surfaceTreatmentCost, form.surfaceTreatmentMode]);
  const laborCostComplete = laborCostWarnings.length === 0;
  const missingConfigHints = useMemo(() => {
    const hints: string[] = [];
    if (!form.name.trim()) hints.push('未填写成品型号');
    if (!form.templateId) hints.push('未选择泵壳模板');
    if (!form.coilSpec || !form.coilSheets) hints.push('线圈规格或片数不完整');
    else if (!form.coilId) hints.push('未选择具体线圈方案');
    if (form.hasCable && (!form.cableWire || !form.cableLength)) hints.push('电缆线径或长度不完整');
    if (form.hasFloat && !form.floatWire) hints.push('浮球线径未填写');
    if (bomDraftError) hints.push(bomDraftError);
    return hints;
  }, [bomDraftError, form.cableLength, form.cableWire, form.coilId, form.coilSheets, form.coilSpec, form.floatWire, form.hasCable, form.hasFloat, form.name, form.templateId]);
  const costWarningHints = useMemo(() => {
    const hints: string[] = [];
    if (packingParts.length === 0) hints.push('尚未配置包装材料，成本可能不完整');
    if (!relatedBomParts.length) hints.push('尚未匹配模板 BOM，配件成本可能不完整');
    if (!bomDraft?.coilSnapshot) hints.push('尚未生成线圈成本，线圈成本可能不完整');
    hints.push(...laborCostWarnings);
    return hints;
  }, [bomDraft?.coilSnapshot, laborCostWarnings, packingParts.length, relatedBomParts.length]);
  const recipeSaveBlockedByWarnings = costWarningHints.length > 0;
  const templateMissingPartCandidates = useMemo(
    () => collectTemplateMissingPartCandidates(templateForm, parts),
    [parts, templateForm]
  );
  const recipeMissingPartCandidates = useMemo(
    () => collectRecipeMissingPartCandidates(optionalParts, packingParts, parts),
    [optionalParts, packingParts, parts]
  );
  const configurationStatus = useMemo(() => {
    const floatReady = !form.hasFloat || Boolean(form.floatWire);
    const cableReady = !form.hasCable || Boolean(form.cableWire && form.cableLength);
    const steps: RecipeFlowStep[] = [
      { id: 'recipe-basic-section', label: '基础信息', done: Boolean(form.name.trim() && form.templateId) },
      { id: 'recipe-coil-section', label: '线圈成本', done: Boolean(!bomDraftStale && (form.coilId || (coilSchemeOptions.length === 0 && form.coilSchemeFamilyCode)) && form.coilSpec && form.coilSheets && bomDraft?.coilSnapshot) },
      { id: 'recipe-dynamic-config-section', label: '浮球/电缆', done: floatReady && cableReady },
      { id: 'recipe-optional-packing-section', label: '包装与配件', done: packingParts.length > 0 },
      { id: 'recipe-labor-section', label: '人工管理', done: laborCostComplete },
    ];
    const completedCount = steps.filter((item) => item.done).length;
    return {
      steps,
      completionPercent: Math.round((completedCount / steps.length) * 100),
    };
  }, [
    bomDraft,
    bomDraftStale,
    form.cableLength,
    form.cableWire,
    form.coilId,
    form.coilSchemeFamilyCode,
    form.coilSheets,
    form.coilSpec,
    form.floatWire,
    form.hasCable,
    form.hasFloat,
    form.name,
    form.templateId,
    laborCostComplete,
    coilSchemeOptions.length,
    packingParts.length,
  ]);

  useEffect(() => {
    if (!drawerOpen || !selectedFormCoilSpec) return;
    setForm((current) => {
      if (current.coilSpec !== selectedFormCoilSpec.spec) return current;
      const selection = resolveCoilVariantSelection(
        selectedFormCoilSpec,
        current.coilMaterial,
        current.coilSlotType
      );
      if (selection.material === current.coilMaterial && selection.slotType === current.coilSlotType) {
        return current;
      }
      const currentSheets = Number(current.coilSheets);
      const sheetsRemainValid = currentSheets > 0 && selection.sheets.includes(currentSheets);
      return {
        ...current,
        coilMaterial: selection.material,
        coilSlotType: selection.slotType,
        coilSheets: sheetsRemainValid ? current.coilSheets : '',
        coilId: '',
        coilSchemeFamilyCode: '',
        coilWireWeight: '',
      };
    });
  }, [drawerOpen, form.coilMaterial, form.coilSlotType, form.coilSpec, selectedFormCoilSpec, setForm]);

  useEffect(() => {
    if (!drawerOpen) return;
    setForm((current) => {
      const selected = coilSchemeOptions.find((coil) => coil.id === Number(current.coilId));
      if (selected) {
        if (current.coilSchemeFamilyCode === selected.schemeFamilyCode) return current;
        return { ...current, coilSchemeFamilyCode: selected.schemeFamilyCode || '' };
      }
      if (coilSchemeOptions.length > 0) {
        const automatic = coilSchemeOptions.length === 1 ? coilSchemeOptions[0] : null;
        const automaticCoilId = automatic ? String(automatic.id) : '';
        const automaticFamily = automatic?.schemeFamilyCode || '';
        if (current.coilId === automaticCoilId && current.coilSchemeFamilyCode === automaticFamily) return current;
        return { ...current, coilId: automaticCoilId, coilSchemeFamilyCode: automaticFamily, coilWireWeight: '' };
      }
      const familyStillValid = coilFamilyOptions.some((family) => family.code === current.coilSchemeFamilyCode);
      const automaticFamily = familyStillValid
        ? current.coilSchemeFamilyCode
        : coilFamilyOptions.length === 1 ? coilFamilyOptions[0].code : '';
      if (!current.coilId && current.coilSchemeFamilyCode === automaticFamily) return current;
      return { ...current, coilId: '', coilSchemeFamilyCode: automaticFamily, coilWireWeight: '' };
    });
  }, [coilFamilyOptions, coilSchemeOptions, drawerOpen, setForm]);

  useEffect(() => {
    if (!drawerOpen) return;
    setForm((current) => {
      const technicalData = { ...current.technicalData };
      let changed = false;
      const pieceCount = current.coilSheets.trim();

      if (pieceCount) {
        if (technicalData.pieceCount !== pieceCount) {
          technicalData.pieceCount = pieceCount;
          changed = true;
        }
      } else if (technicalData.pieceCount !== undefined) {
        delete technicalData.pieceCount;
        changed = true;
      }

      if (hasStainlessBarrel && shellOpenFactor != null) {
        if (linkedBearingSpan) {
          if (technicalData.bearingSpan !== linkedBearingSpan) {
            technicalData.bearingSpan = linkedBearingSpan;
            changed = true;
          }
        } else if (technicalData.bearingSpan !== undefined) {
          delete technicalData.bearingSpan;
          changed = true;
        }
      }

      return changed ? { ...current, technicalData } : current;
    });
  }, [drawerOpen, form.coilSheets, hasStainlessBarrel, linkedBearingSpan, setForm, shellOpenFactor]);

  useEffect(() => {
    if (!drawerOpen || !exactCoilRecord?.wireWeight) return;
    setForm((current) => current.coilWireWeight
      ? current
      : { ...current, coilWireWeight: String(exactCoilRecord.wireWeight) });
  }, [drawerOpen, exactCoilRecord, setForm]);

  useEffect(() => {
    const wireGauge = bomDraft?.coilSnapshot?.wireGauge;
    if (!drawerOpen || !wireGauge) return;
    const nextFloatWire = matchWireOption(floatWireOptions, wireGauge);
    const nextCableWire = matchWireOption(cableWireOptions, wireGauge);
    if (!nextFloatWire && !nextCableWire) return;

    setForm((current) => {
      const patch: Partial<RecipeFormState> = {};
      const currentFloatWire = normalizeWireGauge(current.floatWire);
      const currentCableWire = normalizeWireGauge(current.cableWire);
      const previousAutoFloatWire = normalizeWireGauge(autoWireSelectionRef.current.floatWire);
      const previousAutoCableWire = normalizeWireGauge(autoWireSelectionRef.current.cableWire);
      if (nextFloatWire && (!currentFloatWire || (previousAutoFloatWire && currentFloatWire === previousAutoFloatWire))) {
        patch.floatWire = nextFloatWire;
        autoWireSelectionRef.current.floatWire = nextFloatWire;
      }
      if (nextCableWire && (!currentCableWire || (previousAutoCableWire && currentCableWire === previousAutoCableWire))) {
        patch.cableWire = nextCableWire;
        autoWireSelectionRef.current.cableWire = nextCableWire;
      }
      return Object.keys(patch).length > 0 ? { ...current, ...patch } : current;
    });
  }, [bomDraft?.coilSnapshot?.wireGauge, cableWireOptions, drawerOpen, floatWireOptions, setForm]);

  function updateForm(patch: Partial<RecipeFormState>, invalidateBom = true, dirty = true) {
    if (dirty) markRecipeDirty();
    updateDraftForm(patch);
    if (invalidateBom) clearBomPreviewError();
  }

  function scrollToCostWarningTarget() {
    const targetId = laborCostWarnings.length > 0
      ? 'recipe-labor-section'
      : packingParts.length === 0
        ? 'recipe-optional-packing-section'
        : 'recipe-basic-section';
    const target = document.getElementById(targetId);
    const toggle = target?.querySelector<HTMLButtonElement>('button[aria-expanded]');
    if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
    window.requestAnimationFrame(() => target?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function defaultSupplierForModel(model: string, category?: string): string {
    const candidates = parts
      .filter((part) => part.model === model && (!category || part.category === category))
      .filter((part) => String(part.supplier || '').trim());
    const suppliers = Array.from(new Set(candidates.map(part => String(part.supplier || '').trim()).filter(Boolean)));
    return suppliers.length === 1 ? suppliers[0] : '';
  }

  function defaultUnitPriceForModel(model: string, category?: string, supplier?: string): number {
    const candidates = parts.filter((part) => (
      part.model === model
      && (!category || part.category === category)
    ));
    const exact = supplier
      ? candidates.find((part) => String(part.supplier || '').trim() === String(supplier).trim())
      : null;
    if (exact) return Number(exact.catalogUnitCost || 0);
    return candidates.length === 1 ? Number(candidates[0].catalogUnitCost || 0) : 0;
  }

  function stablePartId(model: string, supplier: string, category?: string): number | undefined {
    const candidates = parts.filter(part => (
      part.model === model
      && (!category || part.category === category)
      && (!supplier || String(part.supplier || '').trim() === supplier.trim())
    ));
    return candidates.length === 1 ? candidates[0].id : undefined;
  }

  function openCreateDrawer() {
    templateDraftRequestRef.current += 1;
    resetRecipeDirty();
    startCreateDraft();
    resetBomPreview();
    prepareRecipeEditorUi();
  }

  function openCloneRecipe(recipe: Recipe) {
    templateDraftRequestRef.current += 1;
    setProductCreationOpen(false);
    setActiveSection('recipes');
    resetRecipeDirty();
    startCloneDraft(recipe);
    resetBomPreview();
    prepareRecipeEditorUi();
    markRecipeDirty();
  }

  async function openCreateFromTemplate(template: PumpShellTemplate) {
    setProductCreationOpen(false);
    setActiveSection('recipes');
    resetRecipeDirty();
    startCreateDraft();
    resetBomPreview();
    prepareRecipeEditorUi();
    await onTemplateChange(String(template.id), template, false);
  }

  async function onTemplateChange(
    nextTemplateId: string,
    templateOverride?: PumpShellTemplate,
    dirty = true
  ) {
    const requestId = ++templateDraftRequestRef.current;
    const templateId = Number(nextTemplateId);
    if (!Number.isInteger(templateId) || templateId <= 0) {
      updateForm({
        templateId: nextTemplateId,
        variantId: '',
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
        configurationPolicyJson: null,
      }, true, dirty);
      resetBomPreview();
      return;
    }

    try {
      const nextTemplate = templateOverride || templates.find((template) => template.id === templateId);
      const nextShellMeta = findShellMetaForTemplate(nextTemplate, parts);
      const nextHasStainlessBarrel = nextShellMeta?.isStainless === true;
      const { recipeDraft } = await getTemplateRecipeDraft(templateId);
      if (requestId !== templateDraftRequestRef.current) return;
      updateForm({
        templateId: String(recipeDraft.templateId),
        variantId: '',
        ...(!nextHasStainlessBarrel ? { customBarrelLength: '', longScrewExtraLength: '0' } : {}),
        impellerModel: '',
        impellerThickness: '',
        impellerDiameter: '',
        impellerBladeCount: '',
        assemblyWage: String(recipeDraft.assemblyWage || 0),
        packingWage: String(recipeDraft.packingWage || 0),
        surfaceTreatmentMode: recipeDraft.surfaceTreatmentMode || 'none',
        surfaceTreatmentCost: String(recipeDraft.surfaceTreatmentCost || 0),
        configurationPolicyJson: recipeDraft.configurationPolicyJson || null,
      }, true, dirty);
      clearBomPreviewError();
      setFormError(null);
    } catch (error) {
      if (requestId !== templateDraftRequestRef.current) return;
      setFormError(error instanceof Error ? error.message : '应用泵壳模板失败');
    }
  }


  function addOptionalPart() {
    markRecipeDirty();
    addOptionalDraftPart();
    clearBomPreviewError();
  }

  function addPackingPart() {
    markRecipeDirty();
    addPackingDraftPart();
    clearBomPreviewError();
  }

  function updateOptionalPart(id: string, patch: Partial<RecipeSelection>) {
    markRecipeDirty();
    const nextPatch = { ...patch };
    if (patch.model !== undefined && patch.supplier === undefined) {
      nextPatch.supplier = defaultSupplierForModel(String(patch.model || ''));
      nextPatch.snapshotPrice = '';
      nextPatch.costSource = '';
    }
    if (patch.supplier !== undefined) {
      nextPatch.snapshotPrice = '';
      nextPatch.costSource = '';
    }
    const nextModel = String(nextPatch.model ?? optionalParts.find(part => part.id === id)?.model ?? '');
    const nextSupplier = String(nextPatch.supplier ?? optionalParts.find(part => part.id === id)?.supplier ?? '');
    nextPatch.partId = stablePartId(nextModel, nextSupplier);
    updateOptionalDraftPart(id, nextPatch);
    clearBomPreviewError();
  }

  function updatePackingPart(id: string, patch: Partial<RecipeSelection>) {
    markRecipeDirty();
    const nextPatch = { ...patch };
    if (patch.model !== undefined && patch.supplier === undefined) {
      const nextSupplier = defaultSupplierForModel(String(patch.model || ''), '包装');
      const catalogPart = parts.find((candidate) => (
        candidate.category === '包装'
        && candidate.model === String(patch.model || '')
        && (!nextSupplier || candidate.supplier === nextSupplier)
      ));
      nextPatch.supplier = nextSupplier;
      nextPatch.packagingMaterial = packagingMaterialForCatalogPart(catalogPart);
      nextPatch.snapshotPrice = '';
      nextPatch.costSource = '';
    }
    if (patch.supplier !== undefined) {
      nextPatch.snapshotPrice = '';
      nextPatch.costSource = '';
    }
    const nextModel = String(nextPatch.model ?? packingParts.find(part => part.id === id)?.model ?? '');
    const nextSupplier = String(nextPatch.supplier ?? packingParts.find(part => part.id === id)?.supplier ?? '');
    nextPatch.partId = stablePartId(nextModel, nextSupplier, '包装');
    updatePackingDraftPart(id, nextPatch);
    clearBomPreviewError();
  }

  function isRecipeCatalogMissing(kind: 'optional' | 'packing', row: RecipeSelectionRow): boolean {
    const model = row.model.trim();
    const supplier = row.supplier.trim();
    if (!model) return false;
    const inferredCategory = kind === 'optional' ? templatePartCategoryForName(model) : null;
    return !parts.some((part) => (
      part.model === model
      && (kind === 'packing'
        ? part.category === '包装'
        : inferredCategory
          ? part.category === inferredCategory
          : part.category !== '包装' && part.category !== '线圈转子')
      && (!supplier || part.supplier === supplier)
    ));
  }

  function openInlineRecipePart(kind: 'optional' | 'packing', row: RecipeSelectionRow) {
    const knownOptionalCategory = kind === 'optional' ? templatePartCategoryForName(row.model) : null;
    const inferredCategory = kind === 'packing' ? '包装' : (knownOptionalCategory || '配件');
    if (inferredCategory === '线圈转子') {
      setFormError('线圈转子使用独立线圈方案，不进入零件库；请在线圈配置中建立正式方案');
      return;
    }
    setInlinePartCreateTarget({
      kind: kind === 'packing' ? 'recipe-packing' : 'recipe-optional',
      rowId: row.id,
      seed: {
        contextLabel: kind === 'packing' ? '配方包装材料' : '配方选配件',
        model: row.model,
        supplier: row.supplier,
        category: inferredCategory,
        subcategory: kind === 'packing' ? packagingSubcategoryForDraft(row) : '',
        catalogUnitCost: row.costSource === 'manual' ? Number(row.snapshotPrice || 0) : 0,
        stock: 0,
        categoryScope: kind === 'packing' || knownOptionalCategory ? 'locked' : 'non-packaging',
      },
    });
  }

  function handleInlinePartResolved(result: { part: Part; created: boolean }) {
    const target = inlinePartCreateTarget;
    if (!target) return;
    const part = result.part;
    if (target.kind === 'template-shell' && part.category !== '泵壳') {
      throw new Error('整套泵壳只能绑定“泵壳”分类的正式零件');
    }
    if (target.kind === 'template-fixed' && target.seed.categoryScope === 'locked' && part.category !== target.seed.category) {
      throw new Error(`模板固定配件必须绑定“${target.seed.category}”分类的正式零件`);
    }
    if (target.kind === 'recipe-optional' && (
      part.category === '包装'
      || part.category === '线圈转子'
      || (target.seed.categoryScope === 'locked' && part.category !== target.seed.category)
    )) {
      throw new Error(target.seed.categoryScope === 'locked'
        ? `配方选配件必须绑定“${target.seed.category}”分类的正式零件`
        : '配方选配件不能绑定包装或线圈转子记录');
    }
    if (target.kind === 'recipe-packing' && (
      part.category !== '包装'
      || !['外包装', '内衬', '固定包材'].includes(part.subcategory || '')
    )) {
      throw new Error('配方包装只能绑定具有正式二级分类的“包装”零件');
    }
    if (target.kind === 'template-shell') {
      markTemplateDirty();
      setTemplateForm((current) => ({
        ...current,
        shellModel: part.model,
        bundleCost: current.costMode === 'bundle' && part.catalogUnitCost > 0
          ? String(part.catalogUnitCost)
          : current.bundleCost,
      }));
    } else if (target.kind === 'template-fixed' && target.rowId) {
      markTemplateDirty();
      setTemplateForm((current) => ({
        ...current,
        partRows: current.partRows.map((row) => row.id === target.rowId
          ? { ...row, model: part.model, supplier: part.supplier }
          : row),
      }));
    } else if (target.kind === 'recipe-optional' && target.rowId) {
      markRecipeDirty();
      updateOptionalDraftPart(target.rowId, {
        partId: part.id,
        model: part.model,
        supplier: part.supplier,
        costSource: '',
        snapshotPrice: '',
      });
      clearBomPreviewError();
    } else if (target.kind === 'recipe-packing' && target.rowId) {
      markRecipeDirty();
      updatePackingDraftPart(target.rowId, {
        partId: part.id,
        model: part.model,
        supplier: part.supplier,
        packagingMaterial: packagingMaterialForCatalogPart(part),
        costSource: '',
        snapshotPrice: '',
      });
      clearBomPreviewError();
    }
    setFormError(null);
    setInlinePartCreateTarget(null);
  }

  async function handleMissingPartsCompleted(candidates: MissingPartCandidate[], freshParts: Part[]) {
    const resolved = new Map<string, Part>();
    for (const candidate of candidates) {
      const part = freshParts.find((item) => candidateMatchesPart(candidate, item));
      if (!part) throw new Error(`零件“${candidate.model}”已提交，但回读后未找到匹配记录，请刷新后检查，勿重复提交`);
      resolved.set(candidate.key, part);
    }

    setParts(freshParts);
    if (missingPartsBatchTarget === 'template') {
      markTemplateDirty();
      setTemplateForm((current) => {
        let next = current;
        for (const candidate of candidates) {
          const part = resolved.get(candidate.key);
          if (!part) continue;
          if (candidate.targetKind === 'template-shell') {
            next = {
              ...next,
              shellModel: part.model,
              bundleCost: next.costMode === 'bundle' ? String(part.catalogUnitCost) : next.bundleCost,
            };
          } else if (candidate.targetKind === 'template-component' && candidate.rowId) {
            next = {
              ...next,
              componentRows: next.componentRows.map((row) => row.id === candidate.rowId
                ? { ...row, model: part.model, supplier: part.supplier, unitCost: part.catalogUnitCost }
                : row),
            };
          } else if (candidate.targetKind === 'template-fixed' && candidate.rowId) {
            next = {
              ...next,
              partRows: next.partRows.map((row) => row.id === candidate.rowId
                ? { ...row, model: part.model, supplier: part.supplier }
                : row),
            };
          }
        }
        return next;
      });
    } else if (missingPartsBatchTarget === 'recipe') {
      markRecipeDirty();
      for (const candidate of candidates) {
        const part = resolved.get(candidate.key);
        if (!part || !candidate.rowId) continue;
        if (candidate.targetKind === 'recipe-optional') {
          updateOptionalDraftPart(candidate.rowId, {
            partId: part.id,
            model: part.model,
            supplier: part.supplier,
            costSource: '',
            snapshotPrice: '',
          });
        } else if (candidate.targetKind === 'recipe-packing') {
          updatePackingDraftPart(candidate.rowId, {
            partId: part.id,
            model: part.model,
            supplier: part.supplier,
            packagingMaterial: packagingMaterialForCatalogPart(part),
            costSource: '',
            snapshotPrice: '',
          });
        }
      }
      clearBomPreviewError();
    }
    setFormError(null);
    setMissingPartsBatchTarget(null);
  }

  function removeOptionalPart(id: string) {
    markRecipeDirty();
    removeOptionalDraftPart(id);
    clearBomPreviewError();
  }

  function removePackingPart(id: string) {
    markRecipeDirty();
    removePackingDraftPart(id);
    clearBomPreviewError();
  }

  function toggleCompareRecipe(id: number) {
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current.slice(-1), id];
    });
  }

  async function refreshInventoryStatus(recipe: Recipe) {
    const request = ++inventoryStatusRequestRef.current;
    setInventoryStatusLoading(true);
    setInventoryStatusError(null);
    try {
      const result = await getRecipeInventoryStatus(recipe.id);
      if (request === inventoryStatusRequestRef.current) setInventoryStatus(result);
    } catch (err) {
      if (request !== inventoryStatusRequestRef.current) return;
      setInventoryStatus(null);
      setInventoryStatusError(err instanceof Error ? err.message : '库存状态读取失败');
    } finally {
      if (request === inventoryStatusRequestRef.current) setInventoryStatusLoading(false);
    }
  }

  function openRecipeDetail(recipe: Recipe) {
    setDetailRecipe(recipe);
    setInventoryStatus(null);
    setInventoryStatusError(null);
    void refreshInventoryStatus(recipe);
  }

  function openCreateVariant() {
    setVariantEditorTarget({ mode: 'create' });
  }

  function openEditVariant(variant: PumpModelVariant) {
    setVariantEditorTarget({ mode: 'edit', variant });
  }

  function openCloneVariant(variant: PumpModelVariant) {
    setVariantEditorTarget({ mode: 'clone', variant });
  }

  async function submitVariant(input: ModelVariantInput, editingVariant: PumpModelVariant | null) {
    setSaving(true);
    setError(null);
    try {
      if (editingVariant) await updateModelVariant(editingVariant, input);
      else await createModelVariant(input);
      await load(true);
      setVariantEditorTarget(null);
      setActiveSection('variants');
    } catch (err) {
      throw err instanceof Error ? err : new Error('常用配置保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeVariant(variant: PumpModelVariant) {
    setSaving(true);
    setError(null);
    try {
      await deleteModelVariant(variant);
      await load(true);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '常用配置删除失败');
    } finally {
      setSaving(false);
    }
  }

  function openCreateTemplate() {
    setProductCreationOpen(false);
    resetTemplateDirty();
    setEditingTemplate(null);
    setTemplateReuseSource(null);
    setTemplateForm(emptyTemplateForm());
    setFormError(null);
    setTemplateDrawerOpen(true);
  }

  function openInlineShellPart() {
    setInlinePartCreateTarget({
      kind: 'template-shell',
      seed: {
        contextLabel: '泵壳模板整套泵壳',
        model: templateForm.shellModel,
        category: '泵壳',
        catalogUnitCost: Number(templateForm.bundleCost || 0),
        stock: 0,
        categoryScope: 'locked',
      },
    });
  }

  function openInlineFixedPart(row: TemplatePartFormRow, category: string | null) {
    if (category === '线圈转子') {
      setFormError('线圈转子使用独立线圈方案，不进入零件库；请调整固定配件名称或在线圈页面建档');
      return;
    }
    setInlinePartCreateTarget({
      kind: 'template-fixed',
      rowId: row.id,
      seed: {
        contextLabel: `模板固定配件 · ${row.name || '未命名配件'}`,
        model: row.model,
        supplier: row.supplier || '',
        category: category || '配件',
        catalogUnitCost: 0,
        stock: 0,
        categoryScope: category ? 'locked' : 'non-packaging',
      },
    });
  }

  function openEditTemplate(template: PumpShellTemplate) {
    resetTemplateDirty();
    setEditingTemplate(template);
    setTemplateReuseSource(null);
    setTemplateForm(templateFormFromTemplate(template));
    setFormError(null);
    setTemplateDrawerOpen(true);
  }

  function openReuseTemplate(template: PumpShellTemplate) {
    resetTemplateDirty();
    setEditingTemplate(null);
    setTemplateReuseSource(template);
    setTemplateForm(templateFormForReuse(template, templates));
    setFormError(null);
    setTemplateDrawerOpen(true);
  }

  function closeTemplateEditor() {
    setMissingPartsBatchTarget((current) => current === 'template' ? null : current);
    setTemplateDrawerOpen(false);
    setTemplateReuseSource(null);
  }

  function closeRecipeEditor() {
    templateDraftRequestRef.current += 1;
    setMissingPartsBatchTarget((current) => current === 'recipe' ? null : current);
    setDrawerOpen(false);
  }

  async function submitTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const continueToRecipe = !editingTemplate && submitter?.name === 'continueToRecipe';
    if (!templateForm.shellModel.trim()) {
      setFormError(templateForm.costMode === 'bundle' ? '请从零件库选择泵壳型号' : '请填写组合模板名称');
      return;
    }
    const input = templateFormToInput(templateForm);
    if (JSON.parse(input.partsJson).length === 0) {
      setFormError('至少需要一个固定配件');
      return;
    }
    if (input.costMode === 'bundle' && input.bundleCost <= 0) {
      setFormError('泵壳套件模式需要填写套件价格');
      return;
    }
    if (input.costMode === 'components' && JSON.parse(input.shellComponentsJson).filter((row: ShellComponentInput) => row.included !== false).length === 0) {
      setFormError('自由搭配模式至少需要一个计入成本的组件');
      return;
    }
    if (input.costMode === 'components') {
      const includedComponents = JSON.parse(input.shellComponentsJson).filter((row: ShellComponentInput) => row.included !== false) as ShellComponentInput[];
      if (includedComponents.some((row) => !row.model || !shellComponentModelOptions.includes(row.model))) {
        setFormError('自由搭配组件的零件型号只能选择“泵壳搭配”类别中的零件');
        return;
      }
      if (includedComponents.some((row) => row.componentType === 'subassembly' && (!row.subassemblyContents || row.subassemblyContents.length === 0))) {
        setFormError('供应商小套件至少需要填写一个组成项');
        return;
      }
      if (includedComponents.some((row) => isBarrelComponentName(row.name) && !barrelComponentNameOptions.includes(row.name as typeof barrelComponentNameOptions[number]))) {
        setFormError('请选择机筒类型：铝机筒、不锈钢拉伸筒或铁机筒');
        return;
      }
    }
    setSaving(true);
    setFormError(null);
    setError(null);
    try {
      const savedTemplate = editingTemplate
        ? await updateTemplate(editingTemplate, input)
        : await createTemplate(input);
      await load(true);
      resetTemplateDirty();
      setTemplateDrawerOpen(false);
      setTemplateReuseSource(null);
      if (continueToRecipe) {
        setActiveSection('recipes');
        resetRecipeDirty();
        startCreateDraft();
        resetBomPreview();
        prepareRecipeEditorUi();
        await onTemplateChange(String(savedTemplate.id), savedTemplate, false);
      } else {
        setActiveSection('templates');
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '泵壳模板保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeTemplate(template: PumpShellTemplate) {
    setSaving(true);
    setError(null);
    try {
      await deleteTemplate(template);
      await load(true);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '泵壳模板删除失败');
    } finally {
      setSaving(false);
    }
  }

  async function buildBomDraft(options: { silent?: boolean } = {}) {
    if (!canPreviewBomDraft) {
      if (!options.silent) setFormError('请先选择泵壳模板，或至少添加一个选配/包装/电缆配置');
      resetBomPreview();
      return null;
    }
    if (!options.silent) setFormError(null);
    try {
      return await runBomPreview({
        captureError: options.silent === true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '生成 BOM 草稿失败';
      if (!options.silent) setFormError(message);
      return null;
    }
  }

  async function analyzeCurrentRecipeDraft(draft: RecipeBomDraftResult) {
    return analyzeRecipeConfiguration({
      recipeId: editingRecipe?.id,
      limit: 5,
      draft: {
        id: editingRecipe?.id,
        name: form.name.trim() || '未命名配方草稿',
        spec: form.spec,
        templateId: form.templateId ? Number(form.templateId) : null,
        coilId: form.coilId ? Number(form.coilId) : null,
        coilSchemeFamilyCode: form.coilSchemeFamilyCode,
        coilSpec: form.coilSpec,
        coilSheets: numberValue(form.coilSheets),
        coilMaterial: form.coilMaterial,
        coilSlotType: form.coilSlotType,
        hasFloat: form.hasFloat,
        floatWire: form.floatWire,
        hasCable: form.hasCable,
        cableLength: numberValue(form.cableLength),
        savedTotalCost: liveTotal,
        parts: draft.parts,
      },
    });
  }

  async function runRecipeAnalysis(options: { preserveSaveGate?: boolean } = {}) {
    setRecipeAnalysisLoading(true);
    if (!options.preserveSaveGate) setAnalysisSaveGateOpen(false);
    setFormError(null);
    try {
      const draft = await buildBomDraft();
      if (!draft) return;
      const analysis = await analyzeCurrentRecipeDraft(draft);
      setRecipeAnalysis(analysis);
      setRecipeAnalysisOpen(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '配方智能检查失败');
    } finally {
      setRecipeAnalysisLoading(false);
    }
  }

  function completeCurrentReviewEvidence(message: string) {
    if (!reviewEvidenceTarget) return;
    const remaining = reviewEvidenceTargets.filter(
      (item) => item.feedbackId !== reviewEvidenceTarget.feedbackId
    );
    setReviewEvidenceTargets(remaining);
    if (remaining.length === 0) {
      setReviewEvidenceBatchCompleted(true);
      clearReviewTaskSearchParams();
    }
    setReviewEvidenceNotice(
      remaining.length > 0
        ? `${message}，继续处理下一条（剩余 ${remaining.length} 条）。`
        : `${message}，本配方的待复核任务已全部完成。`
    );
  }

  function clearReviewTaskSearchParams() {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('feedbackIds');
    nextUrl.searchParams.delete('feedbackId');
    nextUrl.searchParams.delete('action');
    window.history.replaceState(
      window.history.state,
      '',
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
    );
  }

  function skipCurrentReviewEvidence() {
    if (reviewEvidenceTargets.length < 2 || !reviewEvidenceTarget) return;
    setReviewEvidenceTargets((current) => [...current.slice(1), current[0]]);
    setReviewEvidenceNotice('已暂时跳过当前提醒，继续处理下一条；原反馈状态没有改变。');
  }

  async function saveAnalysisFeedback(
    finding: RecipeAnalysisFinding,
    decision: RecipeAnalysisFeedbackDecision,
    note: string
  ): Promise<boolean> {
    if (!editingRecipe?.id) return false;
    setFormError(null);
    try {
      const result = await saveRecipeAnalysisFeedback(editingRecipe.id, {
        findingKey: finding.key,
        findingType: finding.type,
        decision,
        note,
        findingSnapshot: {
          title: finding.title,
          severity: finding.severity,
          confidence: finding.confidence,
        },
      });
      setReviewRuleLearning(result.ruleLearning || null);
      if (reviewEvidenceTarget?.findingKey === finding.key && decision !== 'review') {
        completeCurrentReviewEvidence('已按当前配方重新确认当前提醒');
      }
      await runRecipeAnalysis({ preserveSaveGate: analysisSaveGateOpen });
      return true;
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '检查反馈保存失败');
      return false;
    }
  }

  async function resolveMissingReviewEvidence() {
    if (!reviewEvidenceTarget) return;
    setReviewEvidenceResolving(true);
    setFormError(null);
    try {
      const result = await resolveRecipeAnalysisFeedback(reviewEvidenceTarget.feedbackId);
      setReviewRuleLearning(result.ruleLearning || null);
      completeCurrentReviewEvidence('已确认当前原提醒不再出现');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '待复核反馈处理失败');
    } finally {
      setReviewEvidenceResolving(false);
    }
  }

  async function submitRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveRecipe();
  }

  async function saveRecipe(options: { skipIntelligenceCheck?: boolean } = {}) {
    if (!form.name.trim()) {
      setFormError('成品型号不能为空');
      return;
    }
    if (recipeSaveBlockedByWarnings) {
      setFormError('存在成本警告，请处理后再保存配方');
      scrollToCostWarningTarget();
      return;
    }
    setSaving(true);
    setFormError(null);
    setError(null);
    try {
      const draft = await buildBomDraft();
      if (!draft) return;
      if (!options.skipIntelligenceCheck) {
        setRecipeAnalysisLoading(true);
        const analysis = await analyzeCurrentRecipeDraft(draft);
        setRecipeAnalysis(analysis);
        if (analysis.summary.highConfidenceAlertCount > 0) {
          setAnalysisSaveGateOpen(true);
          setRecipeAnalysisOpen(true);
          return;
        }
        setAnalysisSaveGateOpen(false);
      }
      const costDraft = await previewRecipeCostDraft({
        parts: draft.parts,
        assemblyWage: numberValue(form.assemblyWage),
        packingWage: numberValue(form.packingWage),
        surfaceTreatmentMode: form.surfaceTreatmentMode,
        surfaceTreatmentCost: form.surfaceTreatmentMode === 'none' ? 0 : numberValue(form.surfaceTreatmentCost),
        managementFee: numberValue(form.managementFee),
        coilMaterial: form.coilMaterial || '钢带',
        coilSlotType: form.coilSlotType,
        customBarrelLength: (draft.customBarrelLength ?? form.customBarrelLength) || null,
        longScrewExtraLength: draft.longScrewExtraLength ?? numberValue(form.longScrewExtraLength),
        enableLongScrewByBarrelLength: draft.parts.some((part) => part.dynamicRule === 'longScrewByBarrelLength'),
      });

      const payload = await buildRecipeSavePayloadDraft({
        recipeId: editingRecipe?.id,
        expectedUpdatedAt: editingRecipe?.updatedAt,
        form: {
          name: form.name,
          spec: form.spec,
          templateId: form.templateId || null,
          coilId: form.coilId || null,
          coilSchemeFamilyCode: form.coilSchemeFamilyCode,
          coilSpec: form.coilSpec,
          coilSheets: form.coilSheets,
          coilMaterial: form.coilMaterial,
          coilSlotType: form.coilSlotType,
          coilWireWeight: form.coilWireWeight || null,
          hasFloat: form.hasFloat,
          floatWire: form.floatWire,
          floatAccessoryType: form.floatAccessoryType,
          hasCable: form.hasCable,
          cableLength: form.cableLength,
          cableWire: form.cableWire,
          cableAccessoryType: form.cableAccessoryType,
          customBarrelLength: hasStainlessBarrel ? form.customBarrelLength || null : null,
          longScrewExtraLength: hasStainlessBarrel ? form.longScrewExtraLength || 0 : 0,
          modelVariantId: form.variantId || null,
          impellerModel: form.impellerModel,
          impellerThickness: form.impellerThickness || null,
          impellerDiameter: form.impellerDiameter || null,
          impellerBladeCount: form.impellerBladeCount || null,
          assemblyWage: form.assemblyWage,
          packingWage: form.packingWage,
          surfaceTreatmentMode: form.surfaceTreatmentMode,
          surfaceTreatmentCost: form.surfaceTreatmentCost,
          managementFee: form.managementFee,
          configurationPolicyJson: form.configurationPolicyJson,
        },
        costDraft,
        packingParts,
        optionalParts,
        technicalData: form.technicalData,
      });

      if (editingRecipe) await updateRecipe(editingRecipe.id, payload);
      else await createRecipe(payload);
      await load(true);
      resetRecipeDirty();
      setRecipeAnalysisOpen(false);
      setAnalysisSaveGateOpen(false);
      closeRecipeEditor();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '配方保存失败');
    } finally {
      setRecipeAnalysisLoading(false);
      setSaving(false);
    }
  }

  async function removeRecipe(recipe: Recipe) {
    setSaving(true);
    setError(null);
    try {
      await deleteRecipe(recipe.id, recipe.updatedAt);
      await load(true);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '配方删除失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="配方"
        description="选择泵壳、线圈转子和选配后直接生成 BOM 与成本；泵壳模板只维护稳定的固定搭配。"
        actions={(
          <>
          <Button
            onClick={() => void load(true)}
            disabled={refreshing || saving}
            icon={<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />}
          >
            刷新
          </Button>
          {activeSection === 'variants' ? (
            <Button onClick={openCreateVariant} disabled={saving} icon={<Plus size={15} />}>
              新建配置
            </Button>
          ) : activeSection === 'templates' ? (
            <Button onClick={openCreateTemplate} disabled={saving} icon={<Plus size={15} />}>
              新建模板
            </Button>
          ) : activeSection === 'recipes' ? (
            <Button onClick={openCreateDrawer} disabled={saving} icon={<Plus size={15} />}>
              新建配方
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => setProductCreationOpen(true)} disabled={saving} icon={<Plus size={15} />}>
            新建产品
          </Button>
          </>
        )}
      />

      <FadePanel delay={0.01} className="flex flex-col gap-3 rounded-panel border border-line bg-white p-3 shadow-panel md:flex-row md:items-center md:justify-between">
        <div className="grid w-full gap-2 sm:grid-cols-2 md:w-auto" role="group" aria-label="配方功能区">
          <button
            type="button"
            onClick={() => setActiveSection('recipes')}
            aria-pressed={activeSection === 'recipes'}
            className={`flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all duration-150 sm:min-w-48 ${
              activeSection === 'recipes'
                ? 'border-sky-500 bg-sky-50 text-sky-950 shadow-sm ring-1 ring-sky-200'
                : 'border-line bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-ink'
            }`}
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
              activeSection === 'recipes' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              <Package size={18} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold">{sectionOptions.recipes.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  activeSection === 'recipes' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  {recipes.length} 个
                </span>
              </span>
              <span className="mt-0.5 block text-xs opacity-75">{sectionOptions.recipes.description}</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('templates')}
            aria-pressed={activeSection === 'templates'}
            className={`flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all duration-150 sm:min-w-48 ${
              activeSection === 'templates'
                ? 'border-amber-500 bg-amber-50 text-amber-950 shadow-sm ring-1 ring-amber-200'
                : 'border-line bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-ink'
            }`}
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
              activeSection === 'templates' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              <Layers3 size={18} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold">{sectionOptions.templates.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  activeSection === 'templates' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  {templates.length} 套
                </span>
              </span>
              <span className="mt-0.5 block text-xs opacity-75">{sectionOptions.templates.description}</span>
            </span>
          </button>
        </div>
        <div className="text-xs text-muted">
          {activeSection === 'recipes' ? '当前正在管理产品配方' : '当前正在维护泵壳固定模板'}
        </div>
      </FadePanel>

      {activeSection === 'recipes' ? (
        <RecipeWorkspace
          recipes={recipes}
          templates={templates}
          currentCosts={currentCosts}
          currentCopperPricePerKg={currentCopperPricePerKg}
          query={query}
          templateId={templateId}
          quickFilter={quickFilter}
          compareIds={compareIds}
          loading={loading}
          saving={saving}
          error={error}
          warning={dataWarning}
          onQueryChange={setQuery}
          onTemplateIdChange={setTemplateId}
          onQuickFilterChange={setQuickFilter}
          onClearCompare={() => setCompareIds([])}
          onOpenCompare={() => setCompareOpen(true)}
          onToggleCompare={toggleCompareRecipe}
          onView={openRecipeDetail}
          onEdit={openEditDrawer}
          onClone={openCloneRecipe}
          onRemove={(recipe) => setDeleteTarget({ kind: 'recipe', item: recipe })}
        />
      ) : null}

      <PumpShellTemplateWorkspace
        visible={activeSection === 'templates'}
        templates={templates}
        parts={parts}
        saving={saving}
        onEdit={openEditTemplate}
        onReuse={openReuseTemplate}
        onRemove={(template) => setDeleteTarget({ kind: 'template', item: template })}
      />

      <ModelVariantCompatibilityPanel
        visible={activeSection === 'variants'}
        variants={variants}
        templates={templates}
        coilSpecs={coilSpecs}
        coilRecords={coilRecords}
        editorTarget={variantEditorTarget}
        saving={saving}
        error={error}
        onOpenEdit={openEditVariant}
        onOpenClone={openCloneVariant}
        onCloseEditor={() => setVariantEditorTarget(null)}
        onSubmit={submitVariant}
        onRemove={(variant) => setDeleteTarget({ kind: 'variant', item: variant })}
      />

      <RecipeDetailPanel
        recipe={detailRecipe}
        templateName={detailRecipe?.templateId ? templateNameMap.get(detailRecipe.templateId) || '' : ''}
        currentSummary={detailRecipe ? currentCostMap.get(detailRecipe.id) || null : null}
        currentCost={detailCurrentCost}
        currentCostError={detailCurrentCostError}
        inventoryStatus={inventoryStatus}
        inventoryStatusLoading={inventoryStatusLoading}
        inventoryStatusError={inventoryStatusError}
        onClose={() => setDetailRecipe(null)}
        onRefreshInventory={refreshInventoryStatus}
      />

      <RecipeComparePanel
        open={compareOpen}
        recipes={recipes}
        templates={templates}
        compareIds={compareIds}
        onClose={() => setCompareOpen(false)}
      />

      <PumpShellTemplateEditor
        open={templateDrawerOpen}
        editingTemplate={editingTemplate}
        reuseSource={templateReuseSource}
        templates={templates}
        form={templateForm}
        formError={formError}
        saving={saving}
        shellCatalogOptions={shellCatalogOptions}
        shellComponentModelOptions={shellComponentModelOptions}
        shellComponentParts={shellComponentParts}
        shellComponentPartsRefreshing={shellComponentPartsRefreshing}
        partCatalog={parts}
        getDefaultSupplier={defaultSupplierForModel}
        getDefaultUnitPrice={defaultUnitPriceForModel}
        onRefreshShellComponentParts={refreshShellComponentParts}
        onCreateShellComponentPart={createShellComponentPart}
        onOpenCreateShellPart={openInlineShellPart}
        onOpenCreateFixedPart={openInlineFixedPart}
        missingPartCount={templateMissingPartCandidates.length}
        onOpenMissingParts={() => setMissingPartsBatchTarget('template')}
        dirty={templateFormDirty}
        onFormChange={(update) => {
          markTemplateDirty();
          setTemplateForm(update);
        }}
        onClose={requestTemplateClose}
        onSubmit={submitTemplate}
      />

      <RecipeEditor
        open={drawerOpen}
        editing={Boolean(editingRecipe)}
        saving={saving}
        analysisLoading={recipeAnalysisLoading}
        saveBlocked={recipeSaveBlockedByWarnings}
        costLoading={bomDraftLoading}
        formError={formError}
        dirty={recipeFormDirty}
        steps={configurationStatus.steps}
        missingPartCount={recipeMissingPartCandidates.length}
        onClose={requestRecipeClose}
        onAnalyze={() => void runRecipeAnalysis()}
        onOpenMissingParts={() => setMissingPartsBatchTarget('recipe')}
        onSubmit={submitRecipe}
      >
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <RecipeBasicSection
              form={form}
              templates={templates}
              hasStainlessBarrel={hasStainlessBarrel}
              templateParts={displayedCosts.relatedBomParts}
              templatePartsCost={displayedCosts.templatePartsCost}
              complete={configurationStatus.steps[0].done}
              linkedChanges={linkedChangeAnnotations}
              linkedChangeSummary={linkedChangeSummary}
              hasLinkedChangeWarning={hasLinkedChangeWarning}
              onChange={(patch) => updateForm(patch)}
              onTemplateChange={onTemplateChange}
              onOpenTemplateParts={() => setTemplateMatchDialogOpen(true)}
            />

            <RecipeCoilSection
              form={form}
              coilSpecs={coilSpecs}
              sheetOptions={coilSheetOptions}
              materialOptions={formMaterialOptions}
              slotTypeOptions={formSlotTypeOptions}
              schemeOptions={coilSchemeOptions}
              familyOptions={coilFamilyOptions}
              coilSnapshot={displayedCosts.draft?.coilSnapshot}
              complete={configurationStatus.steps[1].done}
              capacitorModel={displayedCosts.draft?.capacitorModel || ''}
              onSpecChange={(coilSpec) => {
                const selection = coilSpec
                  ? resolveCoilVariantSelection(
                      coilSpecs.find((spec) => spec.spec === coilSpec),
                      form.coilMaterial,
                      form.coilSlotType
                    )
                  : { material: '钢带', slotType: '小眼' as const };
                updateForm({
                  coilSpec,
                  coilSheets: '',
                  coilId: '',
                  coilSchemeFamilyCode: '',
                  coilMaterial: selection.material,
                  coilSlotType: selection.slotType,
                  coilWireWeight: '',
                });
              }}
              onSheetsChange={(coilSheets) => updateForm({ coilSheets, coilId: '', coilSchemeFamilyCode: '', coilWireWeight: '' })}
              onMaterialChange={(coilMaterial) => {
                const selection = resolveCoilVariantSelection(
                  selectedFormCoilSpec,
                  coilMaterial,
                  form.coilSlotType
                );
                updateForm({
                  coilMaterial: selection.material,
                  coilSlotType: selection.slotType,
                  coilSheets: '',
                  coilId: '',
                  coilSchemeFamilyCode: '',
                  coilWireWeight: '',
                });
              }}
              onSlotTypeChange={(coilSlotType) => updateForm({ coilSlotType, coilSheets: '', coilId: '', coilSchemeFamilyCode: '', coilWireWeight: '' })}
              onSchemeChange={(coilId) => {
                const selected = coilSchemeOptions.find((coil) => String(coil.id) === coilId);
                updateForm({ coilId, coilSchemeFamilyCode: selected?.schemeFamilyCode || '', coilWireWeight: '' });
              }}
              onFamilyChange={(coilSchemeFamilyCode) => updateForm({ coilId: '', coilSchemeFamilyCode, coilWireWeight: '' })}
              onWireWeightChange={(coilWireWeight) => updateForm({ coilWireWeight })}
            />

            <RecipeDynamicConfigSection
              form={form}
              floatWireOptions={floatWireOptions}
              cableWireOptions={cableWireOptions}
              recommendedFloatWire={recommendedFloatWire}
              recommendedCableWire={recommendedCableWire}
              isFloatWireRecommended={isFloatWireRecommended}
              isCableWireRecommended={isCableWireRecommended}
              complete={configurationStatus.steps[2].done}
              floatCostReady={displayedCosts.floatCostReady}
              cableCostReady={displayedCosts.cableCostReady}
              costLoading={costDisplayRefreshing}
              floatCostPart={displayedCosts.floatCostPart}
              cableCostPart={displayedCosts.cableCostPart}
              onChange={(patch) => updateForm(patch)}
              onFloatWireChange={(floatWire) => {
                autoWireSelectionRef.current.floatWire = '';
                updateForm({ floatWire });
              }}
              onCableWireChange={(cableWire) => {
                autoWireSelectionRef.current.cableWire = '';
                updateForm({ cableWire });
              }}
            />

            <RecipeOptionalPackingSection
              optionalParts={optionalParts}
              packingParts={packingParts}
              optionalPartsCost={displayedCosts.optionalPartsCost}
              packingPartsCost={displayedCosts.packingPartsCost}
              complete={configurationStatus.steps[3].done}
              partModelOptions={partModelOptions}
              packingModelOptions={packingModelOptions}
              bomDraft={displayedCosts.draft}
              optionalCostRows={displayedCosts.optionalParts}
              packingCostRows={displayedCosts.packingParts}
              saving={saving}
              onAddOptionalPart={addOptionalPart}
              onUpdateOptionalPart={updateOptionalPart}
              onRemoveOptionalPart={removeOptionalPart}
              onAddPackingPart={addPackingPart}
              onUpdatePackingPart={updatePackingPart}
              onRemovePackingPart={removePackingPart}
              isCatalogMissing={isRecipeCatalogMissing}
              onCreateCatalogPart={openInlineRecipePart}
            />

            <ConfigurationPolicyEditor
              value={form.configurationPolicyJson}
              parts={parts}
              onChange={(configurationPolicyJson) => updateForm({ configurationPolicyJson })}
            />

            <RecipeLaborCostSection
              form={form}
              warnings={laborCostWarnings}
              complete={laborCostComplete}
              totalCost={laborAndManagementCost + surfaceTreatmentPreviewCost}
              onChange={(patch) => updateForm(patch)}
            />

            <TechnicalDataEditor
              recipeId={editingRecipe?.id}
              recipeUpdatedAt={editingRecipe?.updatedAt}
              value={form.technicalData}
              onChange={(technicalData) => updateForm({ technicalData }, false)}
              referenceFields={technicalReferenceFields}
              impellerModel={form.impellerModel}
              impellerThickness={form.impellerThickness}
              impellerDiameter={form.impellerDiameter}
              impellerBladeCount={form.impellerBladeCount}
              linkedRotorFields={{
                pieceCount: '跟随线圈片数',
                ...(hasStainlessBarrel && shellOpenFactor != null
                  ? { bearingSpan: `机筒长度 - 开档系数 ${shellOpenFactor}` }
                  : {}),
              }}
              onTechnicalFileCountChange={handleTechnicalFileCountChange}
              onImpellerChange={(patch) => updateForm(patch)}
            />
              </div>

              <CostSummaryPanel
                bomCount={displayedCosts.bomCount}
                loading={costDisplayRefreshing}
                ready={Boolean(bomDraft)}
                saving={saving}
                total={displayedCosts.total}
                coilCost={displayedCosts.coilCost}
                templatePartsCost={displayedCosts.templatePartsCost}
                optionalPartsCost={displayedCosts.optionalPartsCost}
                packingPartsCost={displayedCosts.packingPartsCost}
                laborAndManagementCost={displayedCosts.laborAndManagementCost}
                surfaceTreatmentCost={displayedCosts.surfaceTreatmentCost}
                missingConfigHints={missingConfigHints}
                costWarningHints={costWarningHints}
                steps={configurationStatus.steps}
                completionPercent={configurationStatus.completionPercent}
                onRefresh={() => void buildBomDraft()}
                onOpenBom={() => setBomDetailsOpen(true)}
                onGoToCostWarnings={scrollToCostWarningTarget}
              />
            </div>
      </RecipeEditor>

      <ProductCreationDialog
        open={productCreationOpen}
        recipes={recipes}
        templates={templates}
        saving={saving}
        onClose={() => setProductCreationOpen(false)}
        onCloneRecipe={openCloneRecipe}
        onCreateFromTemplate={openCreateFromTemplate}
        onCreateTemplate={openCreateTemplate}
      />

      <InlinePartCreateDialog
        open={Boolean(inlinePartCreateTarget)}
        seed={inlinePartCreateTarget?.seed || null}
        supplierOptions={parts.map((part) => part.supplier)}
        onClose={() => setInlinePartCreateTarget(null)}
        onResolve={resolveCatalogPart}
        onResolved={handleInlinePartResolved}
      />

      <MissingPartsBatchDialog
        open={Boolean(missingPartsBatchTarget)}
        candidates={missingPartsBatchTarget === 'template' ? templateMissingPartCandidates : recipeMissingPartCandidates}
        supplierOptions={parts.map((part) => part.supplier)}
        onClose={() => setMissingPartsBatchTarget(null)}
        onCompleted={handleMissingPartsCompleted}
      />

      <RecipeAnalysisPanel
        open={recipeAnalysisOpen}
        analysis={recipeAnalysis}
        analysisLoading={recipeAnalysisLoading}
        saveGateOpen={analysisSaveGateOpen}
        saving={saving}
        feedbackEnabled={Boolean(editingRecipe?.id)}
        reviewEvidenceTargets={reviewEvidenceTargets}
        reviewEvidenceBatchTotal={reviewEvidenceBatchTotal}
        reviewEvidenceCompletedCount={reviewEvidenceCompletedCount}
        reviewEvidenceLoading={reviewEvidenceLoading}
        reviewEvidenceResolving={reviewEvidenceResolving}
        reviewEvidenceNotice={reviewEvidenceNotice}
        reviewEvidenceBatchCompleted={reviewEvidenceBatchCompleted}
        reviewRuleLearning={reviewRuleLearning}
        onClose={() => {
          setRecipeAnalysisOpen(false);
          setAnalysisSaveGateOpen(false);
        }}
        onSkipReviewEvidence={skipCurrentReviewEvidence}
        onResolveMissingReviewEvidence={() => void resolveMissingReviewEvidence()}
        onSaveFeedback={saveAnalysisFeedback}
        onContinueSave={() => {
          setRecipeAnalysisOpen(false);
          void saveRecipe({ skipIntelligenceCheck: true });
        }}
        onReturnToQuality={() => window.location.assign('/dashboard?view=quality')}
      />

      <BomTableDialog
        open={bomDetailsOpen}
        parts={bomDraft?.parts || []}
        total={liveTotal}
        onClose={() => setBomDetailsOpen(false)}
        getSubtotal={recipePartSubtotal}
        getSourceLabel={partCostSourceLabel}
        getFormula={partFormulaLine}
      />
      <BomTableDialog
        open={templateMatchDialogOpen}
        title="模板匹配明细"
        parts={relatedBomParts}
        total={relatedBomPartsCost}
        onClose={() => setTemplateMatchDialogOpen(false)}
        getSubtotal={recipePartSubtotal}
        getSourceLabel={partCostSourceLabel}
        getFormula={partFormulaLine}
      />

      <ConfirmDialog
        open={recipeDiscardPromptOpen}
        title="放弃未保存的配方？"
        description={recipeDiscardMessage}
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        confirmVariant="danger"
        busy={saving}
        onConfirm={confirmRecipeDiscard}
        onClose={cancelRecipeDiscard}
        layer="top"
      />

      <ConfirmDialog
        open={templateDiscardPromptOpen}
        title="放弃未保存的模板？"
        description={templateDiscardMessage}
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        confirmVariant="danger"
        busy={saving}
        onConfirm={confirmTemplateDiscard}
        onClose={cancelTemplateDiscard}
        layer="top"
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.kind === 'recipe'
          ? '删除配方？'
          : deleteTarget?.kind === 'template'
            ? '删除泵壳模板？'
            : '删除常用配置？'}
        description={deleteTarget?.kind === 'recipe'
          ? `配方“${deleteTarget.item.name || deleteTarget.item.id}”及其当前配置将从当前配方列表中移除，历史审计记录仍会保留。`
          : deleteTarget?.kind === 'template'
            ? `泵壳模板“${deleteTarget.item.shellModel || deleteTarget.item.id}”将被删除；如果仍被配方引用，后端会拒绝执行。`
            : deleteTarget?.kind === 'variant'
              ? `常用配置“${deleteTarget.item.modelName || deleteTarget.item.id}”将被删除。已创建的配方不会受到影响。`
              : ''}
        confirmLabel={deleteTarget?.kind === 'recipe'
          ? '删除配方'
          : deleteTarget?.kind === 'template'
            ? '删除模板'
            : '删除配置'}
        confirmVariant="danger"
        busy={saving}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.kind === 'recipe') void removeRecipe(deleteTarget.item);
          else if (deleteTarget.kind === 'template') void removeTemplate(deleteTarget.item);
          else void removeVariant(deleteTarget.item);
        }}
        onClose={() => {
          if (!saving) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
