import { AiView } from '@/components/ai-view';

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawPrompt = Array.isArray(params.prompt) ? params.prompt[0] : params.prompt;
  const rawFileId = Array.isArray(params.fileId) ? params.fileId[0] : params.fileId;
  const initialPrompt = typeof rawPrompt === 'string' ? rawPrompt.trim().slice(0, 500) : '';
  const parsedFileId = Number(rawFileId);
  const initialAttachmentId = Number.isInteger(parsedFileId) && parsedFileId > 0 ? parsedFileId : undefined;
  return <AiView initialPrompt={initialPrompt} initialAttachmentId={initialAttachmentId} />;
}
