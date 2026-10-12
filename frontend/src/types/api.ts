export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface HealthStatus {
  database: string;
  ml_pipeline: string;
  vector_database: string;
  llm: string;
  translation_model: string;
  speech_services: string;
}

export interface DashboardKpis {
  total_cves: number;
  critical_cves: number;
  high_cves: number;
  affected_products: number | null;
  cwes_detected: number;
  duplicate_reports: number | null;
}

export interface DashboardData {
  kpis: DashboardKpis;
  top_products: { product: string; count: number }[];
}

export interface CveStats {
  total_records: number;
  severity_breakdown: Record<string, number>;
  avg_cvss_score: number;
  avg_description_length: number;
  unique_cwe_types: number;
  charts: string[];
}

export interface CveRecord {
  cve_id: string;
  description: string;
  cvss_base_score: number;
  cvss_severity: Severity;
  cwe_ids: string;
  description_length: number;
  cwe_count: number;
  primary_cwe: string;
  business_impact: string;
}

export interface Entity {
  text: string;
  label: string;
}

export interface LimeFeature {
  word: string;
  weight: number;
}

export interface SeverityPrediction {
  predicted_severity: Severity;
  confidence: number;
  contributing_words: LimeFeature[];
}

export interface ClassificationResult {
  text: string;
  entities: Entity[];
  severity_prediction: SeverityPrediction;
  business_impact: string[];
}

export interface LinkedRef {
  id: string;
  kb: string;
  url: string;
  name?: string | null;
}

export interface LinkedEntities {
  cves: LinkedRef[];
  cwes: LinkedRef[];
}

export interface SearchHit {
  text: string;
  text_en?: string;
  distance: number;
  metadata: Record<string, string>;
}

export interface SearchResult {
  query: string;
  results: SearchHit[];
}

export interface AssistantResult {
  question: string;
  question_en?: string;
  detected_language: string;
  response_language: string;
  /** 'en' | 'ta' | 'hi': the language `answer` is actually in (English if translation failed). */
  response_lang_code?: 'en' | 'ta' | 'hi';
  answer: string | null;
  answer_mode?: 'llm' | 'extractive' | null;
  generation_note: string | null;
  sources: string[];
  results: SearchHit[];
  timings_ms?: Record<string, number>;
}

export interface WarmupStatus {
  steps: Record<string, 'pending' | 'loading' | 'ready' | 'failed' | 'skipped'>;
  ready: boolean;
}

export interface TopicInfo {
  top_terms: string[];
  size: number;
  example_cves: string[];
}

export interface TopicsResult {
  k: number;
  topics: Record<string, TopicInfo>;
}

export interface DuplicatePair {
  cve_a: string;
  cve_b: string;
  similarity: number;
}

export interface DuplicatesResult {
  threshold: number;
  total_records: number;
  near_duplicate_pairs: DuplicatePair[];
}

export interface BriefingItem {
  cve_id: string;
  description: string;
  centrality_score: number;
}

export interface BriefingResult {
  severity_filter: string | null;
  total_candidates: number;
  briefing_size?: number;
  briefing: BriefingItem[];
}

export interface PipelineStage {
  stage: string;
  status: 'complete' | 'pending';
}

export interface PipelineStatus {
  stages: PipelineStage[];
}

export type Role = 'admin' | 'analyst' | 'viewer';

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  is_active?: boolean;
  created_at?: string | null;
  last_login_at?: string | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface AuditLogEntry {
  id: number;
  created_at: string;
  event: string;
  user_email: string | null;
  ip: string | null;
  detail: string | null;
}

export interface TranscribeResult {
  text: string;
  detected_language: string | null;
  language_probability: number;
}

export interface TranslateResult {
  source_lang: string;
  target_lang: string;
  source_text: string;
  translated_text: string;
}
