import type { NativeWriteCard, NativeWriteFailure, NativeWriteOutcome } from './ai-write-proposal';

export type NativeWriteResponse = { status: number; body: unknown };
export type NativeWriteRequest = (path: string, options: { method: string; body?: string }) => Promise<NativeWriteResponse>;

export type NativeWriteConfirmationResult =
  | { kind: 'verified'; outcome: NativeWriteOutcome; reconciled?: boolean }
  | { kind: 'failed'; outcome?: NativeWriteOutcome; failure: NativeWriteFailure }
  | { kind: 'reconciling'; status?: string | null }
  | { kind: 'not_executable' };

export const RECONCILE_MAX_UI_ATTEMPTS: number;
export const RECONCILE_RETRY_DELAY_MS: number;
export function confirmNativeWriteProposal(input: {
  request: NativeWriteRequest;
  card: NativeWriteCard;
  reconcileAttempts?: number;
  wait?: (attempt: number) => Promise<void>;
}): Promise<NativeWriteConfirmationResult>;
export function executePath(taskId: string): string;
export function reconcilePath(taskId: string): string;
export function outcomeOf(body: unknown): { outcome: NativeWriteOutcome | null; taskState: string | null; resolved: boolean; status: string | null };
