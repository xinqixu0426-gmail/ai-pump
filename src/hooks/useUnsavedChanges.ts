import { useEffect, useRef } from 'react';

/**
 * 表单离开保护 Hook（兼容 BrowserRouter）
 * - 浏览器关闭/刷新：beforeunload
 * - 浏览器后退/前进：popstate
 * - 应用内导航（pushState/replaceState）：拦截 history 写入
 *
 * @param isDirty - 是否有未保存的更改
 * @param message - 提示文案
 */
export function useUnsavedChanges(isDirty: boolean, message = '你有未保存的内容，确定要离开吗？') {
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    if (!isDirty) return;

    // 1. 浏览器关闭/刷新拦截
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault();
        e.returnValue = message;
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // 2. 浏览器后退/前进拦截
    const onPopState = (_e: PopStateEvent) => {
      if (isDirtyRef.current && !window.confirm(message)) {
        // 阻止后退：把当前 URL 重新 push 回去
        window.history.pushState(null, '', window.location.href);
      }
    };
    window.addEventListener('popstate', onPopState);

    // 3. 应用内导航拦截（pushState / replaceState）
    const originPush = window.history.pushState.bind(window.history);
    const originReplace = window.history.replaceState.bind(window.history);

    window.history.pushState = function (...args) {
      if (isDirtyRef.current && !window.confirm(message)) {
        throw new DOMException('Navigation blocked', 'AbortError');
      }
      return originPush(...args);
    };

    window.history.replaceState = function (...args) {
      if (isDirtyRef.current && !window.confirm(message)) {
        throw new DOMException('Navigation blocked', 'AbortError');
      }
      return originReplace(...args);
    };

    // 恢复
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPopState);
      window.history.pushState = originPush;
      window.history.replaceState = originReplace;
    };
  }, [isDirty, message]);
}
