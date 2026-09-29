import type { AiAssistantWriteCard, AiAssistantWriteFailure, AiAssistantWriteOutcome } from './ai-assistant-write-proposal';

export type AiAssistantWriteResponse = { status: number; body: unknown };
export type AiAssistantWriteRequest = (path: string, options: { method: string; body?: string }) => Promise<AiAssistantWriteResponse>;

export type AiAssistantWriteConfirmationResult =
  | { kind: 'verified'; outcome: AiAssistantWriteOutcome; reconciled?: boolean }
  | { kind: 'failed'; outcome?: AiAssistantWriteOutcome; failure: AiAssistantWriteFailure }
  | { kind: 'not_executable' };

export function confirmAiAssistantWriteProposal(input: {
  request: AiAssistantWriteRequest;
  card: AiAssistantWriteCard;
}): Promise<AiAssistantWriteConfirmationResult>;
export function executePath(): string;
