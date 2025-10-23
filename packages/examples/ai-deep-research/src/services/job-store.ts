import type { KVBase } from 'rxpress';

import {
  AnalysisSummary,
  INITIAL_DEPTH,
  ResearchJob,
  ResearchJobSnapshot,
  ResearchJobStatus,
  ResearchProgress,
  ResearchReport,
  ResearchRequest
} from '../types/research.js';

const JOB_PREFIX = 'research:job:';

const now = () => new Date().toISOString();

export function createJob(id: string, input: ResearchRequest): ResearchJob {
  const timestamp = now();
  return {
    id,
    query: input.query,
    breadth: input.breadth,
    depth: input.depth,
    status: 'queued',
    createdAt: timestamp,
    updatedAt: timestamp,
    currentDepth: INITIAL_DEPTH,
    analyses: {}
  };
}

function makeKey(id: string): string {
  return `${JOB_PREFIX}${id}`;
}

export async function saveJob(kv: KVBase, job: ResearchJob): Promise<void> {
  job.updatedAt = now();
  await kv.set(makeKey(job.id), job);
}

export async function getJob(kv: KVBase, id: string): Promise<ResearchJob | undefined> {
  return (await kv.get<ResearchJob>(makeKey(id))) ?? undefined;
}

export async function upsertJob(
  kv: KVBase,
  id: string,
  update: (job: ResearchJob) => ResearchJob
): Promise<ResearchJob> {
  const existing = (await getJob(kv, id)) ?? undefined;

  if (!existing) {
    throw new Error(`Research job ${id} not found`);
  }

  const updated = update({ ...existing });
  await saveJob(kv, updated);
  return updated;
}

export async function setJobStatus(kv: KVBase, id: string, status: ResearchJobStatus, error?: string): Promise<ResearchJob> {
  return upsertJob(kv, id, (job) => {
    job.status = status;

    if (typeof error === 'undefined') {
      delete job.error;
    }
    else {
      job.error = error;
    }

    return job;
  });
}

export async function recordAnalysis(kv: KVBase, id: string, analysis: AnalysisSummary): Promise<ResearchJob> {
  return upsertJob(kv, id, (job) => {
    job.currentDepth = Math.max(job.currentDepth, analysis.depth + 1);
    job.analyses[analysis.depth] = analysis;

    return job;
  });
}

export async function attachReport(kv: KVBase, id: string, report: ResearchReport): Promise<ResearchJob> {
  return upsertJob(kv, id, (job) => {
    job.report = report;
    job.status = 'completed';
    job.currentDepth = Math.min(job.depth, Math.max(job.currentDepth, report.metadata.depthUsed));

    return job;
  });
}

export async function ensureJob(kv: KVBase, job: ResearchJob): Promise<void> {
  await kv.set(makeKey(job.id), job);
}

export function toSnapshot(job: ResearchJob): ResearchJobSnapshot {
  return {
    ...job,
    progress: computeProgress(job)
  };
}

export function computeProgress(job: ResearchJob): ResearchProgress {
  const totalDepth = job.depth;
  const safeTotal = Math.max(totalDepth, 1);
  const cappedDepth = Math.min(job.currentDepth, totalDepth);
  const percentComplete = Math.round((cappedDepth / safeTotal) * 100);
  return {
    currentDepth: cappedDepth,
    totalDepth,
    percentComplete
  };
}
