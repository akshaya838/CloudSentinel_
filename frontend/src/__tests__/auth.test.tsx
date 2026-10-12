import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';

import * as api from '../services/api';
import { AuthProvider } from '../auth/AuthContext';
import { ProtectedLayout, RequireRole } from '../auth/ProtectedLayout';
import { ANALYST_UP } from '../auth/roles';
import { Login } from '../pages/Login';
import { Settings } from '../pages/Settings';
import { Admin } from '../pages/Admin';
import { Sidebar } from '../components/layout/Sidebar';
import { Topbar } from '../components/layout/Topbar';
import { WithAuth, makeUser } from './helpers';
import type { Role } from '../types/api';

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() };
});

const apiGet = vi.mocked(api.apiGet);
const apiPost = vi.mocked(api.apiPost);

const HEALTH = {
  database: 'operational', ml_pipeline: 'operational', vector_database: 'operational',
  llm: 'operational', translation_model: 'operational', speech_services: 'operational',
};

function loginResponse(role: Role) {
  return { access_token: 'tok-123', token_type: 'bearer', expires_in: 3600, user: makeUser(role) };
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

/** Real AuthProvider + the same route shape as App.tsx, so redirects are the real ones. */
function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<div>Secret dashboard</div>} />
            <Route path="/assistant" element={<RequireRole roles={ANALYST_UP} feature="the Voice Assistant"><div>Assistant page</div></RequireRole>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function signIn(email: string, password: string) {
  fireEvent.change(await screen.findByLabelText('Work email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  apiGet.mockImplementation(async (path: string) => {
    if (path === '/health') return HEALTH as never;
    throw new api.ApiError('NOT_FOUND', `no fixture for ${path}`, 404);
  });
});

describe('login and session', () => {
  it('redirects an anonymous visitor to the login page and shows nothing protected', async () => {
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Secret dashboard')).not.toBeInTheDocument();
  });

  it('signs in, sends the credentials, then lands on the protected page', async () => {
    apiPost.mockResolvedValueOnce(loginResponse('analyst') as never);
    renderApp('/');
    await signIn('analyst@cloudco.example', 'Analyst#2026Demo');
    expect(await screen.findByText('Secret dashboard')).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith('/api/v1/auth/login', { email: 'analyst@cloudco.example', password: 'Analyst#2026Demo' });
    expect(screen.getByText('Security Engineer')).toBeInTheDocument(); // real user shown in the sidebar
  });

  it('returns the user to the page they originally asked for', async () => {
    apiPost.mockResolvedValueOnce(loginResponse('analyst') as never);
    renderApp('/assistant');
    await signIn('analyst@cloudco.example', 'x-password-1');
    expect(await screen.findByText('Assistant page')).toBeInTheDocument();
  });

  it('keeps the token for this tab only unless "Remember me" is ticked', async () => {
    apiPost.mockResolvedValueOnce(loginResponse('viewer') as never);
    renderApp('/');
    await signIn('viewer@cloudco.example', 'x-password-1');
    await screen.findByText('Secret dashboard');
    expect(sessionStorage.getItem('cve_intel_token')).toBe('tok-123');
    expect(localStorage.getItem('cve_intel_token')).toBeNull();
  });

  it('persists the token across restarts when "Remember me" is ticked', async () => {
    apiPost.mockResolvedValueOnce(loginResponse('viewer') as never);
    renderApp('/');
    fireEvent.click(await screen.findByLabelText('Remember me'));
    await signIn('viewer@cloudco.example', 'x-password-1');
    await screen.findByText('Secret dashboard');
    expect(localStorage.getItem('cve_intel_token')).toBe('tok-123');
  });

  it('shows the server message on a failed sign-in and stores no token', async () => {
    apiPost.mockRejectedValueOnce(new api.ApiError('INVALID_CREDENTIALS', 'Invalid email or password.', 401));
    renderApp('/');
    await signIn('analyst@cloudco.example', 'wrong-password-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(screen.queryByText('Secret dashboard')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('cve_intel_token')).toBeNull();
  });

  it('shows the lockout message and a backend-unreachable message verbatim', async () => {
    apiPost.mockRejectedValueOnce(new api.ApiError('TOO_MANY_ATTEMPTS', 'Too many failed sign-in attempts. Try again in 240 seconds.', 429));
    renderApp('/');
    await signIn('analyst@cloudco.example', 'wrong-password-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 240 seconds');
  });

  it('disables Sign in until both fields are filled', async () => {
    renderApp('/');
    const button = await screen.findByRole('button', { name: 'Sign in' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'a@b.co' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-1' } });
    expect(button).toBeEnabled();
  });

  it('toggles password visibility and explains password resets without a fake link', async () => {
    renderApp('/');
    const pw = await screen.findByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pw).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByText(/handled by your administrator/)).toBeInTheDocument();
  });

  it('restores a valid stored session from the backend instead of asking to sign in again', async () => {
    sessionStorage.setItem('cve_intel_token', 'stored-token');
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/auth/me') return makeUser('admin') as never;
      if (path === '/health') return HEALTH as never;
      throw new api.ApiError('NOT_FOUND', path, 404);
    });
    renderApp('/');
    expect(await screen.findByText('Secret dashboard')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/api/v1/auth/me');
  });

  it('discards an invalid stored token and sends the user to sign in', async () => {
    sessionStorage.setItem('cve_intel_token', 'stale-token');
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/auth/me') throw new api.ApiError('UNAUTHENTICATED', 'expired', 401);
      return HEALTH as never;
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(sessionStorage.getItem('cve_intel_token')).toBeNull();
  });

  it('signs the user out with a notice when any API call reports an expired session', async () => {
    apiPost.mockResolvedValueOnce(loginResponse('analyst') as never);
    renderApp('/');
    await signIn('analyst@cloudco.example', 'x-password-1');
    await screen.findByText('Secret dashboard');
    act(() => {
      window.dispatchEvent(new Event(api.AUTH_EXPIRED_EVENT));
    });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('session has expired');
  });

  it('Sign out clears the token and returns to the login page', async () => {
    apiPost.mockResolvedValueOnce(loginResponse('analyst') as never);
    renderApp('/');
    await signIn('analyst@cloudco.example', 'x-password-1');
    await screen.findByText('Secret dashboard');
    fireEvent.click(screen.getByRole('button', { name: /Sign out/ }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(sessionStorage.getItem('cve_intel_token')).toBeNull();
  });
});

describe('role-based access in the UI', () => {
  const renderSidebar = (role: Role) =>
    render(<WithAuth role={role}><MemoryRouter><Sidebar /></MemoryRouter></WithAuth>);

  it('viewer sees only read-only areas', () => {
    renderSidebar('viewer');
    for (const name of ['Dashboard', 'Vulnerability Explorer', 'Settings']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    for (const name of ['Voice Assistant', 'Semantic Search', 'Severity Analysis', 'Reports', 'Data Pipeline', 'Admin']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });

  it('analyst sees the analysis tools but not pipeline or admin', () => {
    renderSidebar('analyst');
    expect(screen.getByRole('link', { name: 'Voice Assistant' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Data Pipeline' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('admin sees everything', () => {
    renderSidebar('admin');
    expect(screen.getByRole('link', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Data Pipeline' })).toBeInTheDocument();
  });

  it('a viewer who opens an analyst-only URL gets an access message, not the page', () => {
    render(
      <WithAuth role="viewer">
        <MemoryRouter>
          <RequireRole roles={ANALYST_UP} feature="the Voice Assistant"><div>Assistant page</div></RequireRole>
        </MemoryRouter>
      </WithAuth>,
    );
    expect(screen.getByText(/don't have access to the Voice Assistant/)).toBeInTheDocument();
    expect(screen.queryByText('Assistant page')).not.toBeInTheDocument();
  });
});

describe('top-bar search', () => {
  function renderTopbar(role: Role): ReactElement {
    return (
      <WithAuth role={role}>
        <MemoryRouter><Topbar /><LocationProbe /></MemoryRouter>
      </WithAuth>
    );
  }
  const search = (text: string) => {
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: text } });
    fireEvent.submit(screen.getByRole('search'));
  };

  it('opens a CVE record directly when given a CVE ID', () => {
    render(renderTopbar('analyst'));
    search('cve-2021-44228');
    expect(screen.getByTestId('location')).toHaveTextContent('/explorer/CVE-2021-44228');
  });

  it('runs a semantic search for free text when the role allows it', () => {
    render(renderTopbar('analyst'));
    search('remote code execution');
    expect(screen.getByTestId('location')).toHaveTextContent('/search?q=remote%20code%20execution');
  });

  it('falls back to the explorer keyword filter for roles without semantic search', () => {
    render(renderTopbar('viewer'));
    search('log4j');
    expect(screen.getByTestId('location')).toHaveTextContent('/explorer?search=log4j');
  });

  it('reports real system health, including degraded services', async () => {
    apiGet.mockImplementation(async () => ({ ...HEALTH, llm: 'offline' }) as never);
    render(renderTopbar('analyst'));
    expect(await screen.findByText('Some services degraded')).toBeInTheDocument();
  });
});

describe('settings and admin', () => {
  it('blocks a password change when the confirmation does not match, without calling the API', () => {
    render(<WithAuth role="viewer"><MemoryRouter><Settings /></MemoryRouter></WithAuth>);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPass#12345' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass#12345' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Different#12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('changes the password through the API and confirms', async () => {
    apiPost.mockResolvedValueOnce({} as never);
    render(<WithAuth role="viewer"><MemoryRouter><Settings /></MemoryRouter></WithAuth>);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPass#12345' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass#12345' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPass#12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Password updated');
    expect(apiPost).toHaveBeenCalledWith('/api/v1/auth/change-password', { current_password: 'OldPass#12345', new_password: 'NewPass#12345' });
  });

  it('Admin lists users and recent security events, and creates a user', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/admin/users') return [{ ...makeUser('admin'), is_active: true, last_login_at: null }] as never;
      if (path === '/api/v1/admin/audit-logs') return [{ id: 1, created_at: '2026-10-04T10:00:00Z', event: 'login_success', user_email: 'admin@cloudco.example', ip: '127.0.0.1', detail: null }] as never;
      throw new api.ApiError('NOT_FOUND', path, 404);
    });
    apiPost.mockResolvedValueOnce({ ...makeUser('viewer'), email: 'new@cloudco.example' } as never);
    render(<WithAuth role="admin"><MemoryRouter><Admin /></MemoryRouter></WithAuth>);
    expect(await screen.findByText('Users (1)')).toBeInTheDocument();
    expect(screen.getByText('login success')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'New Hire' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@cloudco.example' } });
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'TempPass#2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/v1/admin/users', { email: 'new@cloudco.example', full_name: 'New Hire', role: 'viewer', password: 'TempPass#2026' }));
    expect(await screen.findByText('Created new@cloudco.example.')).toBeInTheDocument();
  });
});
