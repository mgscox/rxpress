export type ResearchJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ResearchRequest {
  query: string;
  breadth: number;
  depth: number;
}

export interface SearchResultItem {
  url: string;
  title: string;
  snippet: string;
}

export interface SearchResultsByQuery {
  query: string;
  results: SearchResultItem[];
}

export interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  query: string;
}

export interface AnalysisSummary {
  depth: number;
  summary: string;
  keyFindings: string[];
  sources: { title: string; url: string }[];
  followUpQueries?: string[];
}

export interface ResearchReportSection {
  title: string;
  content: string;
}

export interface ResearchReport {
  title: string;
  overview: string;
  sections: ResearchReportSection[];
  keyTakeaways: string[];
  sources: { title: string; url: string }[];
  originalQuery: string;
  metadata: {
    depthUsed: number;
    completedAt: string;
  };
}

export interface ResearchProgress {
  currentDepth: number;
  totalDepth: number;
  percentComplete: number;
}

export interface ResearchJob extends ResearchRequest {
  id: string;
  status: ResearchJobStatus;
  createdAt: string;
  updatedAt: string;
  currentDepth: number;
  analyses: Record<number, AnalysisSummary>;
  report?: ResearchReport;
  error?: string;
}

export interface ResearchJobSnapshot extends ResearchJob {
  progress: ResearchProgress;
}

export const INITIAL_DEPTH = 0;
