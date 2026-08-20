'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CircleAlert,
  Database,
  RefreshCw,
  Save,
  ServerCog,
  ShieldCheck,
  TestTube2,
} from 'lucide-react';
import { FadePanel } from '@/components/motion/fade-panel';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { InlineNotice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelBody } from '@/components/ui/panel';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  getRuntimeSettings,
  saveRuntimeSettings,
  testRuntimeAi,
  type AiProvider,
  type RuntimeConfigSnapshot,
  type RuntimeSettingsInput,
  type RuntimeSettingsValues,
} from '@/lib/runtime-settings';

type FormState = RuntimeSettingsValues & {
  deepseekApiKey: string;
  kimiApiKey: string;
};

type SetupSection = 'ai' | 'knowledge' | 'deployment';

const setupSections: Array<{ value: SetupSection; label: string }> = [
  { value: 'ai', label: 'AI 助手' },
  { value: 'knowledge', label: '知识检索' },
  { value: 'deployment', label: '部署环境' },
];

const initialValues: RuntimeSettingsValues = {
  aiProvider: 'auto',
  deepseekModel: 'deepseek-v4-flash',
  deepseekBaseUrl: 'https://api.deepseek.com',
  kimiModel: 'kimi-k3',
  kimiReasoningEffort: 'low',
  kimiBaseUrl: 'https://api.moonshot.cn/v1',
  aiVisionEnabled: true,
  knowledgeAutoSyncEnabled: true,
  knowledgeVectorEnabled: true,
  knowledgeVectorAutoSyncEnabled: true,
  knowledgeHybridSearchEnabled: true,
  knowledgeVectorBatchSize: 16,
  knowledgeEmbeddingModel: 'Xenova/multilingual-e5-small',
  knowledgeEmbeddingDimensions: 384,
  knowledgeEmbeddingDtype: 'q8',
  knowledgeModelCacheDir: '',
  knowledgeModelOffline: false,
};

function formFromSnapshot(snapshot: RuntimeConfigSnapshot): FormState {
  return {
    ...snapshot.values,
    deepseekApiKey: '',
    kimiApiKey: '',
  };
}

function ToggleRow({
  checked,
  onChange,
  label,
  restart,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  restart?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <span className="flex items-center gap-2 text-sm font-medium text-ink">
        {label}
        {restart ? <StatusBadge tone="amber">重启生效</StatusBadge> : <StatusBadge tone="green">即时生效</StatusBadge>}
      </span>
      <Checkbox
        size="md"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function SecretStatus({
  configured,
  source,
}: {
  configured: boolean;
  source: string;
}) {
  if (!configured) return <StatusBadge tone="amber">未配置</StatusBadge>;
  return <StatusBadge tone="green">{source === 'runtime' ? '网页已配置' : '环境变量'}</StatusBadge>;
}

export function SetupView() {
  const [snapshot, setSnapshot] = useState<RuntimeConfigSnapshot | null>(null);
  const [form, setForm] = useState<FormState>({ ...initialValues, deepseekApiKey: '', kimiApiKey: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [section, setSection] = useState<SetupSection>('ai');
  const [reloadConfirmationOpen, setReloadConfirmationOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const next = await getRuntimeSettings();
      setSnapshot(next);
      setForm(formFromSnapshot(next));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '运行设置加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const activeProvider = form.aiProvider;
  const hasDeepseekKey = Boolean(form.deepseekApiKey.trim() || snapshot?.secrets.deepseekApiKey.configured);
  const hasKimiKey = Boolean(form.kimiApiKey.trim() || snapshot?.secrets.kimiApiKey.configured);
  const canTest = activeProvider === 'auto'
    ? hasDeepseekKey
    : activeProvider === 'deepseek'
      ? hasDeepseekKey
      : hasKimiKey;
  const deploymentReady = useMemo(
    () => snapshot?.deployment.filter((item) => item.configured).length || 0,
    [snapshot]
  );
  const isDirty = useMemo(
    () => Boolean(snapshot && JSON.stringify(form) !== JSON.stringify(formFromSnapshot(snapshot))),
    [form, snapshot]
  );

  useEffect(() => {
    if (!isDirty) return;
    const protectUnsavedSettings = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectUnsavedSettings);
    return () => window.removeEventListener('beforeunload', protectUnsavedSettings);
  }, [isDirty]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setNotice('');
  }

  function payload(): RuntimeSettingsInput {
    return { ...form };
  }

  function requestReload() {
    if (isDirty) {
      setReloadConfirmationOpen(true);
      return;
    }
    void load();
  }

  async function save() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const next = await saveRuntimeSettings(payload());
      setSnapshot(next);
      setForm(formFromSnapshot(next));
      setNotice(next.restartRequired ? '设置已保存。知识检索运行参数将在服务重启后全部生效。' : '设置已保存并生效。');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '运行设置保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function testAi() {
    setTesting(true);
    setError('');
    setNotice('');
    try {
      const result = await testRuntimeAi(payload());
      const tested = result.testedProviders?.map(item => item.displayName).join('、') || result.displayName;
      setNotice(`${tested}连接正常，耗时 ${result.latencyMs}ms。`);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'AI 连接测试失败');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1380px] space-y-4">
      <PageHeader
        title="系统设置"
        description="配置 AI、知识检索与部署环境。"
        actions={(
          <>
          <Button onClick={requestReload} disabled={loading || saving} icon={<RefreshCw size={15} className={loading ? 'animate-spin' : ''} />}>
            刷新
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={loading || saving || !isDirty} icon={saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}>
            {saving ? '保存中' : '保存设置'}
          </Button>
          </>
        )}
      />

      {error ? (
        <InlineNotice tone="danger">{error}</InlineNotice>
      ) : null}
      {notice ? (
        <InlineNotice tone="success">{notice}</InlineNotice>
      ) : null}
      {snapshot?.restartRequired ? (
        <InlineNotice tone="warning">已保存的知识检索设置与当前进程不同，需要重启 API 服务。</InlineNotice>
      ) : null}

      <FadePanel className="sticky top-0 z-20 flex flex-col gap-3 rounded-panel border border-line bg-white/95 p-2 shadow-panel backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          value={section}
          options={setupSections}
          onChange={setSection}
          ariaLabel="设置工作区"
          className="w-full overflow-x-auto sm:w-fit"
        />
        <StatusBadge tone={isDirty ? 'amber' : 'green'}>{isDirty ? '有未保存修改' : '设置已同步'}</StatusBadge>
      </FadePanel>

      <div className="min-w-0">
        {section === 'ai' ? (
        <FadePanel className="min-w-0">
          <Panel elevated>
          <PanelBody className="space-y-5 md:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sky-50 text-sky-700">
              <Bot size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">AI 助手</h2>
              <div className="mt-0.5 text-xs text-muted">AI 工作台即时切换</div>
            </div>
          </div>

          <SegmentedControl<AiProvider>
            value={form.aiProvider}
            onChange={(value) => update('aiProvider', value)}
            ariaLabel="AI 提供商"
            options={[
              { value: 'auto', label: '智能路由' },
              { value: 'deepseek', label: 'DeepSeek' },
              { value: 'kimi', label: 'Kimi 开放平台' },
            ]}
            className="w-fit max-w-full overflow-x-auto"
          />

          {activeProvider === 'auto' ? (
            <InlineNotice tone="info">
              普通对话默认使用 DeepSeek；图片原图、PDF、Excel/CSV 和文本附件自动使用 Kimi K3。Kimi 不可用时回退到 DeepSeek 与本地解析/OCR。
            </InlineNotice>
          ) : null}

          {activeProvider !== 'kimi' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="DeepSeek 模型">
                <Input value={form.deepseekModel} onChange={(event) => update('deepseekModel', event.target.value)} />
              </Field>
              <Field label="DeepSeek 服务地址">
                <Input value={form.deepseekBaseUrl} onChange={(event) => update('deepseekBaseUrl', event.target.value)} />
              </Field>
              <Field
                className="md:col-span-2"
                label={(
                  <span className="flex items-center justify-between gap-3">
                  <span>DeepSeek API Key</span>
                  <SecretStatus configured={Boolean(snapshot?.secrets.deepseekApiKey.configured)} source={snapshot?.secrets.deepseekApiKey.source || 'none'} />
                  </span>
                )}
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.deepseekApiKey}
                  onChange={(event) => update('deepseekApiKey', event.target.value)}
                  placeholder={snapshot?.secrets.deepseekApiKey.configured ? '留空保持当前密钥' : '输入 DeepSeek API Key'}
                />
              </Field>
            </div>
          ) : null}

          {activeProvider !== 'deepseek' ? (
            <div className={`space-y-4 ${activeProvider === 'auto' ? 'border-t border-line pt-4' : ''}`}>
              <InlineNotice tone="warning">
                {activeProvider === 'auto' ? 'Kimi K3 处理图片原图和文件。' : ''}Kimi Coding 订阅凭证不能用于业务助手；此处只接受 Kimi 开放平台 API Key。
              </InlineNotice>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="模型">
                  <Input value={form.kimiModel} onChange={(event) => update('kimiModel', event.target.value)} />
                </Field>
                <Field label="服务地址">
                  <Input value={form.kimiBaseUrl} onChange={(event) => update('kimiBaseUrl', event.target.value)} />
                </Field>
                <Field label="K3 推理强度">
                  <Select
                    value={form.kimiReasoningEffort}
                    onChange={(event) => update('kimiReasoningEffort', event.target.value as FormState['kimiReasoningEffort'])}
                  >
                    <option value="low">low（推荐，文件识别更快）</option>
                    <option value="high">high</option>
                    <option value="max">max</option>
                  </Select>
                </Field>
                <Field
                  className="md:col-span-2"
                  label={(
                    <span className="flex items-center justify-between gap-3">
                    <span>Kimi 开放平台 API Key</span>
                    <SecretStatus configured={Boolean(snapshot?.secrets.kimiApiKey.configured)} source={snapshot?.secrets.kimiApiKey.source || 'none'} />
                    </span>
                  )}
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={form.kimiApiKey}
                    onChange={(event) => update('kimiApiKey', event.target.value)}
                    placeholder={snapshot?.secrets.kimiApiKey.configured ? '留空保持当前密钥' : '输入开放平台 API Key'}
                  />
                </Field>
              </div>
              <ToggleRow checked={form.aiVisionEnabled} onChange={(value) => update('aiVisionEnabled', value)} label="K3 图片与文件输入" />
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <div className="text-xs text-muted">
              当前：{activeProvider === 'auto'
                ? `${form.deepseekModel} 默认 · 图片和文件使用 ${form.kimiModel}`
                : activeProvider === 'deepseek'
                  ? form.deepseekModel
                  : form.kimiModel}
            </div>
            <Button onClick={() => void testAi()} disabled={!canTest || testing} icon={testing ? <RefreshCw size={15} className="animate-spin" /> : <TestTube2 size={15} />}>
              {testing ? '测试中' : '测试连接'}
            </Button>
          </div>
          </PanelBody>
          </Panel>
        </FadePanel>
        ) : null}

        {section === 'knowledge' ? (
        <FadePanel delay={0.03} className="min-w-0">
          <Panel elevated>
          <PanelBody className="md:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <Database size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">知识检索</h2>
              <div className="mt-0.5 text-xs text-muted">同步、FTS 与向量检索</div>
            </div>
          </div>
          <div className="mt-4">
            <ToggleRow checked={form.knowledgeAutoSyncEnabled} onChange={(value) => update('knowledgeAutoSyncEnabled', value)} label="知识自动同步" restart />
            <ToggleRow checked={form.knowledgeVectorEnabled} onChange={(value) => update('knowledgeVectorEnabled', value)} label="向量能力" restart />
            <ToggleRow checked={form.knowledgeVectorAutoSyncEnabled} onChange={(value) => update('knowledgeVectorAutoSyncEnabled', value)} label="向量自动生成" restart />
            <ToggleRow checked={form.knowledgeHybridSearchEnabled} onChange={(value) => update('knowledgeHybridSearchEnabled', value)} label="混合检索" />
            <ToggleRow checked={form.knowledgeModelOffline} onChange={(value) => update('knowledgeModelOffline', value)} label="仅使用本地模型" restart />
          </div>
          <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <Field label="Embedding 模型" className="sm:col-span-2">
              <Input value={form.knowledgeEmbeddingModel} onChange={(event) => update('knowledgeEmbeddingModel', event.target.value)} />
            </Field>
            <Field label="向量维度">
              <Input type="number" min="1" max="4096" value={form.knowledgeEmbeddingDimensions} onChange={(event) => update('knowledgeEmbeddingDimensions', Number(event.target.value))} selectOnFirstFocus />
            </Field>
            <Field label="批量大小">
              <Input type="number" min="1" max="64" value={form.knowledgeVectorBatchSize} onChange={(event) => update('knowledgeVectorBatchSize', Number(event.target.value))} selectOnFirstFocus />
            </Field>
            <Field label="计算精度">
              <Select value={form.knowledgeEmbeddingDtype} onChange={(event) => update('knowledgeEmbeddingDtype', event.target.value as FormState['knowledgeEmbeddingDtype'])}>
                <option value="q8">q8</option>
                <option value="fp16">fp16</option>
                <option value="fp32">fp32</option>
              </Select>
            </Field>
            <Field label="模型缓存目录">
              <Input value={form.knowledgeModelCacheDir} onChange={(event) => update('knowledgeModelCacheDir', event.target.value)} placeholder="默认用户缓存目录" />
            </Field>
          </div>
          </PanelBody>
          </Panel>
        </FadePanel>
        ) : null}
      </div>

      {section === 'deployment' ? (
      <FadePanel delay={0.06}>
        <Panel elevated>
        <PanelBody className="md:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-700">
              <ServerCog size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">部署环境</h2>
              <div className="mt-0.5 text-xs text-muted">安全与启动参数只读</div>
            </div>
          </div>
          <StatusBadge tone={snapshot && deploymentReady === snapshot.deployment.length ? 'green' : 'amber'}>
            {deploymentReady}/{snapshot?.deployment.length || 0} 已配置
          </StatusBadge>
        </div>
        <div className="mt-4 grid gap-x-6 border-t border-line pt-2 sm:grid-cols-2 lg:grid-cols-3">
          {snapshot?.deployment.map((item) => (
            <div key={item.key} className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{item.label}</div>
                {item.value ? <div className="mt-0.5 truncate text-xs text-muted">{item.value}</div> : null}
              </div>
              {item.configured ? <ShieldCheck size={17} className="shrink-0 text-emerald-600" /> : <CircleAlert size={17} className="shrink-0 text-amber-600" />}
            </div>
          ))}
        </div>
        </PanelBody>
        </Panel>
      </FadePanel>
      ) : null}
      <ConfirmDialog
        open={reloadConfirmationOpen}
        title="放弃未保存的系统设置？"
        description="重新加载会丢弃 AI、知识检索和部署环境中所有尚未保存的修改，并恢复为服务器当前配置。"
        confirmLabel="放弃修改并刷新"
        confirmVariant="danger"
        busy={loading}
        onClose={() => setReloadConfirmationOpen(false)}
        onConfirm={() => {
          setReloadConfirmationOpen(false);
          void load();
        }}
      />
    </div>
  );
}
