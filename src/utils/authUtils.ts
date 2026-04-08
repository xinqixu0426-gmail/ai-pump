/**
 * 认证工具函数
 * 所有请求都使用 credentials: 'include' 以自动携带 HttpOnly Cookie
 */

const API_BASE = '/api/auth';

/**
 * 登录 — 发送密码验证
 */
export async function login(password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { success: false, error: data.error || '登录失败' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: '网络连接失败，请检查后端服务' };
  }
}

/**
 * 登出 — 清除身份 Cookie
 */
export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}

/**
 * 检查当前登录状态
 */
export async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/check`, {
      credentials: 'include',
    });

    if (!res.ok) return false;

    const data = await res.json();
    return data.authenticated === true;
  } catch {
    return false;
  }
}
