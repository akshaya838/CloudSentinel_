import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ReactElement } from 'react';

import * as api from '../services/api';
import { Dashboard } from '../pages/Dashboard';
import { Explorer } from '../pages/Explorer';
import { CveDetail } from '../pages/CveDetail';
import { SeverityAnalysis } from '../pages/SeverityAnalysis';
import { DataPipeline } from '../pages/DataPipeline';
import { AppShell } from '../components/layout/AppShell';
import { WithAuth } from './helpers';
import type { Role } from '../types/api';

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() };
});

const apiGet = vi.mocked(api.apiGet);
const apiPost = vi.mocked(api.apiPost);

const CVE = {
  cve_id: 'CVE-2021-44228',
  description: 'Apache Log4j2 JNDI features allow remote code execution.',
  cvss_base_score: 10,
  cvss_severity: 'CRITICAL',
  cwe_ids: 'CWE-502',
  description_length: 9,
  cwe_count: 1,
  primary_cwe: 'CWE-502',
  business_impact: 'Availability;Confidentiality;Integrity',
};

const GET_FIXTURES: Record<string, unknown> = {
  '/health': {
    database: 'offline', ml_pipeline: 'operational', vector_database: 'operational',
    llm: 'operational', translation_model: 'operational', speech_services: 'operational',
  },
  '/api/v1/dashboard': {
    kpis: { total_cves: 38, critical_cves: 17, high_cves: 11, affected_products: null, cwes_detected: 24, duplicate_reports: null },
    top_products: [],
  },
  '/api/v1/cves/stats': {
    total_records: 38,
    severity_breakdown: { LOW: 4, MEDIUM: 6, HIGH: 11, CRITICAL: 17 },
    avg_cvss_score: 8.13, avg_description_length: 31.3, unique_cwe_types: 24, charts: [],
  },
  '/api/v1/cves': { total: 1, page: 1, page_size: 10, records: [CVE] },
  '/api/v1/cves/CVE-2021-44228': CVE,
  '/api/v1/pipeline/status': {
    stages: [{ stage: 'Raw Data', status: 'complete' }, { stage: 'Vector Indexing', status: 'pending' }],
  },
};

function renderAt(ui: ReactElement, path = '/', role: Role = 'admin') {
  return render(
    <WithAuth role={role}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </WithAuth>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  apiGet.mockImplementation(async (path: string) => {
    if (path in GET_FIXTURES) return GET_FIXTURES[path] as never;
    throw new api.ApiError('NOT_FOUND', `no fixture for ${path}`, 404);
  });
  apiPost.mockImplementation(async (path: string) => {
    if (path === '/api/v1/entities/link') {
      return { cves: [{ id: 'CVE-2021-44228', kb: 'NVD', url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-44228' }], cwes: [] } as never;
    }
    throw new api.ApiError('NOT_FOUND', `no fixture for ${path}`, 404);
  });
});

describe('page rendering against backend-shaped data', () => {
  it('Dashboard renders KPIs and shows null KPIs as a dash, not a fake number', async () => {
    renderAt(<Dashboard />);
    expect(await screen.findByText('Security Intelligence Dashboard')).toBeInTheDocument();
    expect(screen.getByText('38', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBe(2); // affected_products + duplicate_reports
  });

  it('Dashboard shows an error state with Retry when the backend is down', async () => {
    apiGet.mockRejectedValue(new api.ApiError('NETWORK_ERROR', 'Could not reach the backend API.', 0));
    renderAt(<Dashboard />);
    expect(await screen.findByText(/Could not reach the backend API/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('Explorer lists CVEs from the API', async () => {
    renderAt(<Explorer />, '/explorer');
    expect(await screen.findByText('CVE-2021-44228')).toBeInTheDocument();
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
  });

  it('CVE detail page shows description and official reference link', async () => {
    renderAt(
      <Routes><Route path="/explorer/:cveId" element={<CveDetail />} /></Routes>,
      '/explorer/CVE-2021-44228',
    );
    expect(await screen.findByText(/JNDI features allow remote code execution/)).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /CVE-2021-44228/ });
    expect(link).toHaveAttribute('href', 'https://nvd.nist.gov/vuln/detail/CVE-2021-44228');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('Data Pipeline shows real stage status and keeps Run disabled (backend returns 501)', async () => {
    renderAt(<DataPipeline />);
    expect(await screen.findByText('Raw Data')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Pipeline' })).toBeDisabled();
  });

  it('Sidebar exposes every navigation entry to an admin', async () => {
    renderAt(<AppShell><div /></AppShell>);
    for (const label of [
      'Dashboard', 'Vulnerability Explorer', 'Semantic Search', 'Voice Assistant', 'Entity Intelligence',
      'Severity Analysis', 'Topic Discovery', 'Duplicate Detection', 'Reports', 'Data Pipeline', 'Admin',
      'API Documentation', 'Settings',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });
});

describe('interactive flows', () => {
  it('Severity Analysis renders prediction, confidence and LIME features', async () => {
    apiPost.mockResolvedValueOnce({
      text: 't', entities: [{ text: 'CWE-502', label: 'CWE_ID' }],
      severity_prediction: { predicted_severity: 'CRITICAL', confidence: 0.924, contributing_words: [{ word: 'execution', weight: 0.31 }, { word: 'local', weight: -0.1 }] },
      business_impact: ['Integrity'],
    } as never);
    renderAt(<SeverityAnalysis />);
    fireEvent.change(screen.getByPlaceholderText(/Paste a CVE description/), { target: { value: 'remote code execution' } });
    fireEvent.click(screen.getByRole('button', { name: 'Classify' }));
    await waitFor(() => expect(screen.getByText('92.4% confidence')).toBeInTheDocument());
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
    expect(screen.getByText(/CWE-502/)).toBeInTheDocument();
  });
});
