import { AiView } from '@/components/ai-view';

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawPrompt = Array.isArray(params.prompt) ? params.prompt[0] : params.prompt;
  const initialPrompt = typeof rawPrompt === 'string' ? rawPrompt.trim().slice(0, 500) : '';
  return <AiView initialPrompt={initialPrompt} />;
}
