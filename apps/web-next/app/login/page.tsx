'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Lock, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loginWithPassword } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPassword = password.trim();
    if (!trimmedPassword || loading) return;

    setError('');
    setLoading(true);

    try {
      const result = await loginWithPassword(trimmedPassword);
      if (!result.success) {
        setError(result.error || '登录失败');
        setLoading(false);
        return;
      }

      router.replace('/orders');
      router.refresh();
    } catch {
      setError('网络连接失败，请检查后端服务');
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-panel border border-line bg-white p-6 shadow-panel"
      >
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-md bg-ink text-white">
            <Lock size={22} aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-ink">水泵工厂管理系统</h1>
          <p className="mt-1 text-sm text-muted">请输入访问密码</p>
        </div>

        {error ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <label className="block text-sm font-medium text-ink" htmlFor="login-password">
          访问密码
        </label>
        <div className="mt-2 flex h-10 items-center rounded-md border border-line bg-white focus-within:border-ink">
          <input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setError('');
            }}
            autoFocus
            disabled={loading}
            className="min-w-0 flex-1 bg-transparent px-3 text-sm text-ink outline-none disabled:cursor-not-allowed"
          />
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center text-muted transition-colors hover:text-ink"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
            title={showPassword ? '隐藏密码' : '显示密码'}
            disabled={loading}
          >
            {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>

        <Button
          id="login-submit"
          type="submit"
          variant="primary"
          icon={<LogIn size={17} aria-hidden="true" />}
          disabled={!password.trim() || loading}
          className="mt-5 w-full"
        >
          {loading ? '验证中...' : '进入系统'}
        </Button>
      </form>
    </main>
  );
}
