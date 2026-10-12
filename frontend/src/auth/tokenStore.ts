// "Remember me" keeps the token across browser restarts (localStorage);
// otherwise it lives only for this tab (sessionStorage).
// Trade-off: any script running on the page could read either store, so the
// frontend must stay free of XSS. HttpOnly cookies are the stricter alternative.
const KEY = 'cve_intel_token';

export function getToken(): string | null {
  return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
}

export function setToken(token: string, remember: boolean): void {
  clearToken();
  (remember ? localStorage : sessionStorage).setItem(KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
}
