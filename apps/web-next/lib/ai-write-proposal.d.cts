export type NativeWriteProposalItem = {
  partId: number;
  model: string;
  currentStock: number;
  delta: number;
  nextStock: number;
  clampedToZero?: boolean;
};

export type NativeWriteProposalEvent = {
  type: 'write_proposal';
  stage: 'NATIVE_WRITE_PROPOSAL';
  proposal: {
    kind?: string;
    capabilityId: string;
    items: NativeWriteProposalItem[];
  };
  confirmation: {
    confirmationToken: string;
    operationId?: string | null;
    expiresAt?: string | null;
    toolName: string;
    args: { items: Array<{ model: string; changeQty: number }> };
  };
  task: {
    taskId: string;
    revision: number;
    state: string;
    statusPath?: string;
  };
};

export type NativeWriteOutcome =
  | { verified: true; partId?: number; model?: string; stock: number; summary?: string }
  | { verified: false; code?: string | null; reconfirmRequired?: boolean; manualReviewRequired?: boolean; summary?: string };

export type NativeWriteCardStatus =
  | 'proposed'
  | 'executing'
  | 'reconciling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type NativeWriteFailure = {
  category: string;
  message: string;
  retryAllowed: false;
};

export type NativeWriteSuccess = {
  title: string;
  partLabel: string;
  before: number | null;
  after: number;
  verifiedStock: number;
  rows: Array<{ key: string; label: string; value: string }>;
};

export type NativeWriteCard = {
  status: NativeWriteCardStatus;
  event: NativeWriteProposalEvent | null;
  busy: boolean;
  attempts: number;
  failure: NativeWriteFailure | null;
  success: NativeWriteSuccess | null;
  notice: string;
};

export type NativeWriteCardAction =
  | { type: 'confirm' }
  | { type: 'reconcile' }
  | { type: 'settled'; outcome?: NativeWriteOutcome | null; failure?: NativeWriteFailure }
  | { type: 'cancel' }
  | { type: 'expire' };

export type NativeWriteProposalCardModel = {
  title: string;
  partLabel: string;
  partId: number;
  rows: Array<{ key: string; label: string; value: string }>;
  direction: 'increase' | 'decrease' | 'none';
  directionLabel: string;
  currentStock: number;
  delta: number;
  nextStock: number;
  notice: string;
  confirmLabel: string;
  cancelLabel: string;
};

export const WRITE_PROPOSAL_TOOL: string;
export const WRITE_PROPOSAL_CAPABILITY: string;
export const WRITE_PROPOSAL_STAGE: string;
export const WRITE_CARD_STATUS: Record<string, NativeWriteCardStatus>;
export const ACTIVE_STATUSES: NativeWriteCardStatus[];
export const FAILURE_MESSAGES: Record<string, string>;
export const FAILURE_CODES: Record<string, string>;
export const VERIFICATION_PREFIXES: string[];
export const UNAVAILABLE_MESSAGE: string;
export const CANCELLED_MESSAGE: string;
export const CLAMPED_NOTICE: string;

export function isNativeWriteProposalEvent(event: unknown): event is NativeWriteProposalEvent;
export function isNativeWriteProposalItem(item: unknown): item is NativeWriteProposalItem;
export function deltaDirection(delta: number): 'increase' | 'decrease' | 'none';
export function formatDelta(delta: number): string;
export function directionLabel(direction: string): string;
export function toProposalCardModel(event: unknown): NativeWriteProposalCardModel | null;
export function failureFromCode(code: string): NativeWriteFailure;
export function failureFromExecuteError(error: unknown): NativeWriteFailure;
export function failureFromOutcome(outcome: unknown): NativeWriteFailure | null;
export function failureModel(category: string): NativeWriteFailure;
export function successModelFromOutcome(outcome: unknown, proposal: unknown): NativeWriteSuccess | null;
export function pendingMessage(status: string): string;
export function canConfirmWriteCard(card: unknown): boolean;
export function canCancelWriteCard(card: unknown): boolean;
export function isExecutableCard(card: unknown): boolean;
export function createWriteCard(event: unknown): NativeWriteCard;
export function hydrateHistoricalWriteCard(): NativeWriteCard;
export function buildExecuteRequestBody(card: unknown): {
  version: 1;
  expectedRevision: number;
  confirmationToken: string;
  toolName: string;
  args: { items: Array<{ model: string; changeQty: number }> };
} | null;
export function reduceWriteCard(card: unknown, action: NativeWriteCardAction): NativeWriteCard;
