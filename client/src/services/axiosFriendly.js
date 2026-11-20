// Pages that call the API with axios directly get the same plain-language
// errors as services/api.js: err.message and err.response.data.error become
// the customer sentence; the raw text stays in err.detail.
import axios from 'axios';
import { errorText, friendlyMessage } from '../utils/friendlyError.js';

export function installFriendlyAxiosErrors(instance = axios) {
  return instance.interceptors.response.use(undefined, (error) => {
    if (axios.isCancel?.(error)) return Promise.reject(error);
    try {
      const res = error?.response;
      const data = res?.data && typeof res.data === 'object' && !(res.data instanceof Blob) ? res.data : null;
      const raw = data?.error ?? data?.message ?? (typeof res?.data === 'string' ? res.data : error?.message);
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const message = res
        ? friendlyMessage({ status: res.status, data: data || {}, message: typeof res.data === 'string' ? res.data : undefined })
        : errorText(error?.code === 'ECONNABORTED' ? 'timeout' : offline ? 'offline' : 'network');
      if (import.meta.env.DEV) console.warn('[API] axios request failed', res?.status ?? '', raw);
      error.detail = raw;
      error.userMessage = message;
      error.message = message;
      if (data) res.data = { ...data, error: message };
    } catch { /* keep the original error */ }
    return Promise.reject(error);
  });
}
