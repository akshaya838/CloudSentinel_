import axios from 'axios';
import { clearToken, getToken } from '../auth/tokenStore';

export const AUTH_EXPIRED_EVENT = 'auth:expired';

export const apiClient = axios.create({
  baseURL: '/',
  timeout: 60000,
});

apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// A 401 on any call except the login attempt itself means the session is no longer valid.
apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      clearToken();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    return Promise.reject(error);
  },
);

// Every backend response follows { success, data, message } or
// { success: false, error: { code, message } } — this unwraps that
// envelope once, here, so every page doesn't repeat the same logic.
export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: { code: string; message: string };
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function apiGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  try {
    const res = await apiClient.get<ApiEnvelope<T>>(path, { params });
    return res.data.data as T;
  } catch (e) {
    throw normalizeError(e);
  }
}

export interface ApiOptions {
  timeout?: number; // ms; raise for calls that may load a model on first use
}

export async function apiPost<T>(path: string, body?: unknown, options?: ApiOptions): Promise<T> {
  try {
    const res = await apiClient.post<ApiEnvelope<T>>(path, body, options?.timeout ? { timeout: options.timeout } : undefined);
    return res.data.data as T;
  } catch (e) {
    throw normalizeError(e);
  }
}

/** multipart upload (e.g. a voice recording). The browser sets the Content-Type boundary itself. */
export async function apiUpload<T>(path: string, form: FormData, options?: ApiOptions): Promise<T> {
  try {
    const res = await apiClient.post<ApiEnvelope<T>>(path, form, options?.timeout ? { timeout: options.timeout } : undefined);
    return res.data.data as T;
  } catch (e) {
    throw normalizeError(e);
  }
}

function normalizeError(e: unknown): ApiError {
  if (axios.isAxiosError(e)) {
    if (e.response) {
      const detail = e.response.data?.detail;
      const code = detail?.error?.code ?? 'UNKNOWN_ERROR';
      let message: string = e.message;
      if (detail?.error?.message) message = detail.error.message;
      else if (typeof detail === 'string') message = detail;
      else if (Array.isArray(detail)) message = detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ') || message;
      return new ApiError(code, message, e.response.status);
    }
    return new ApiError('NETWORK_ERROR', 'Could not reach the backend API. Is it running on port 8000?', 0);
  }
  return new ApiError('UNKNOWN_ERROR', String(e), 0);
}
