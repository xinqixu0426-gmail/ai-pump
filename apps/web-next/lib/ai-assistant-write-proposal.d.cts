export type AiAssistantWriteProposalItem = {
  partId: number;
  model: string;
  currentStock: number;
  delta: number;
  nextStock: number;
  clampedToZero?: boolean;
};

export type AiAssistantWriteProposalEvent = {
  type: 'write_proposal';
  stage: 'AI_ASSISTANT_WRITE_PROPOSAL';
  proposal: {
    capabilityId: string;
    item: AiAssistantWriteProposalItem;
  };
  confirmation: {
    confirmationToken: string;
    expiresAt?: string | null;
  };
};

export type AiAssistantWriteOutcome =
  | { verified: true; partId?: number; model?: string; stock: number; summary?: string }
  | { verified: false; code?: string | null; reconfirmRequired?: boolean; manualReviewRequired?: boolean; summary?: string };

export type AiAssistantWriteCardStatus =
  | 'proposed'
  | 'executing'
  | 'reconciling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type AiAssistantWriteFailure = {
  category: string;
  message: string;
  retryAllowed: false;
};

export type AiAssistantWriteSuccess = {
  title: string;
  partLabel: string;
  before: number | null;
  after: number;
  verifiedStock: number;
  rows: Array<{ key: string; label: string; value: string }>;
};

export type AiAssistantWriteCard = {
  status: AiAssistantWriteCardStatus;
  event: AiAssistantWriteProposalEvent | null;
  busy: boolean;
  attempts: number;
  failure: AiAssistantWriteFailure | null;
  success: AiAssistantWriteSuccess | null;
  notice: string;
};

export type AiAssistantWriteCardAction =
  | { type: 'confirm' }
  | { type: 'settled'; outcome?: AiAssistantWriteOutcome | null; failure?: AiAssistantWriteFailure }
  | { type: 'cancel' }
  | { type: 'expire' };

export type AiAssistantWriteProposalCardModel = {
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
export const WRITE_CARD_STATUS: Record<string, AiAssistantWriteCardStatus>;
export const ACTIVE_STATUSES: AiAssistantWriteCardStatus[];
export const FAILURE_MESSAGES: Record<string, string>;
export const FAILURE_CODES: Record<string, string>;
export const VERIFICATION_PREFIXES: string[];
export const UNAVAILABLE_MESSAGE: string;
export const CANCELLED_MESSAGE: string;
export const CLAMPED_NOTICE: string;

export function isAiAssistantWriteProposalEvent(event: unknown): event is AiAssistantWriteProposalEvent;
export function isAiAssistantWriteProposalItem(item: unknown): item is AiAssistantWriteProposalItem;
export function deltaDirection(delta: number): 'increase' | 'decrease' | 'none';
export function formatDelta(delta: number): string;
export function directionLabel(direction: string): string;
export function toProposalCardModel(event: unknown): AiAssistantWriteProposalCardModel | null;
export function failureFromCode(code: string): AiAssistantWriteFailure;
export function failureFromExecuteError(error: unknown): AiAssistantWriteFailure;
export function failureFromOutcome(outcome: unknown): AiAssistantWriteFailure | null;
export function failureModel(category: string): AiAssistantWriteFailure;
export function successModelFromOutcome(outcome: unknown, proposal: unknown): AiAssistantWriteSuccess | null;
export function pendingMessage(status: string): string;
export function canConfirmWriteCard(card: unknown): boolean;
export function canCancelWriteCard(card: unknown): boolean;
export function isExecutableCard(card: unknown): boolean;
export function createWriteCard(event: unknown): AiAssistantWriteCard;
export function hydrateHistoricalWriteCard(): AiAssistantWriteCard;
export function buildExecuteRequestBody(card: unknown): { confirmationToken: string } | null;
export function reduceWriteCard(card: unknown, action: AiAssistantWriteCardAction): AiAssistantWriteCard;
