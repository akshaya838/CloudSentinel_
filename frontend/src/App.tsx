import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedLayout, RequireRole } from './auth/ProtectedLayout';
import { ADMIN_ONLY, ANALYST_UP } from './auth/roles';
import type { Role } from './types/api';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Explorer } from './pages/Explorer';
import { CveDetail } from './pages/CveDetail';
import { SemanticSearch } from './pages/SemanticSearch';
import { Assistant } from './pages/Assistant';
import { EntityIntelligence } from './pages/EntityIntelligence';
import { SeverityAnalysis } from './pages/SeverityAnalysis';
import { TopicDiscovery } from './pages/TopicDiscovery';
import { DuplicateDetection } from './pages/DuplicateDetection';
import { Reports } from './pages/Reports';
import { DataPipeline } from './pages/DataPipeline';
import { Admin } from './pages/Admin';
import { ApiDocs } from './pages/ApiDocs';
import { Settings } from './pages/Settings';

function Guard({ roles, feature, children }: { roles: Role[]; feature: string; children: ReactNode }) {
  return (
    <RequireRole roles={roles} feature={feature}>
      {children}
    </RequireRole>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/explorer" element={<Explorer />} />
            <Route path="/explorer/:cveId" element={<CveDetail />} />
            <Route path="/search" element={<Guard roles={ANALYST_UP} feature="Semantic Search"><SemanticSearch /></Guard>} />
            <Route path="/assistant" element={<Guard roles={ANALYST_UP} feature="the Voice Assistant"><Assistant /></Guard>} />
            <Route path="/entities" element={<Guard roles={ANALYST_UP} feature="Entity Intelligence"><EntityIntelligence /></Guard>} />
            <Route path="/severity" element={<Guard roles={ANALYST_UP} feature="Severity Analysis"><SeverityAnalysis /></Guard>} />
            <Route path="/topics" element={<Guard roles={ANALYST_UP} feature="Topic Discovery"><TopicDiscovery /></Guard>} />
            <Route path="/duplicates" element={<Guard roles={ANALYST_UP} feature="Duplicate Detection"><DuplicateDetection /></Guard>} />
            <Route path="/reports" element={<Guard roles={ANALYST_UP} feature="Reports"><Reports /></Guard>} />
            <Route path="/pipeline" element={<Guard roles={ADMIN_ONLY} feature="the Data Pipeline"><DataPipeline /></Guard>} />
            <Route path="/admin" element={<Guard roles={ADMIN_ONLY} feature="Admin"><Admin /></Guard>} />
            <Route path="/docs" element={<ApiDocs />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
