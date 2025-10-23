import type { AnalysisSummary, ExtractedContent, ResearchRequest, ResearchReport, SearchResultItem } from './research.js';

export interface ResearchStartedEvent extends ResearchRequest {
  jobId: string;
}

export interface QueriesGeneratedEvent {
  jobId: string;
  depth: number;
  queries: string[];
  originalQuery: string;
}

export interface SearchCompletedEvent {
  jobId: string;
  depth: number;
  originalQuery: string;
  results: Array<{
    query: string;
    results: SearchResultItem[];
  }>;
}

export interface ContentExtractedEvent {
  jobId: string;
  depth: number;
  originalQuery: string;
  extracted: ExtractedContent[];
}

export interface AnalysisCompletedEvent {
  jobId: string;
  depth: number;
  analysis: AnalysisSummary;
  isFinal: boolean;
}

export interface FollowUpRequiredEvent {
  jobId: string;
  depth: number;
  originalQuery: string;
  queries: string[];
}

export interface ReportReadyEvent {
  jobId: string;
  report: ResearchReport;
}
