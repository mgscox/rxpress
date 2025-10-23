import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { helpers } from 'rxpress';

import {
  attachReport,
  computeProgress,
  createJob,
  ensureJob,
  getJob,
  recordAnalysis
} from '../services/job-store.js';
import type { AnalysisSummary, ResearchReport } from '../types/research.js';

describe('job-store', () => {
  it('tracks job lifecycle and progress', async () => {
    const kv = helpers.createMemoryKv('job-store-test', false);
    const job = createJob('job-1', { query: 'test topic', breadth: 3, depth: 2 });
    await ensureJob(kv, job);

    const stored = (await getJob(kv, job.id))!;
    assert.equal(stored.status, 'queued');

    const analysis: AnalysisSummary = {
      depth: 0,
      summary: 'Summary',
      keyFindings: ['finding'],
      sources: [{ title: 'Source', url: 'https://example.com' }],
      followUpQueries: ['next']
    };

    await recordAnalysis(kv, job.id, analysis);
    const afterAnalysis = (await getJob(kv, job.id))!;
    assert.equal(afterAnalysis.currentDepth, 1);
    const depthZero = afterAnalysis.analyses[0];
    assert.ok(depthZero, 'depth 0 analysis should exist');
    assert.equal(depthZero.summary, 'Summary');

    const report: ResearchReport = {
      title: 'Report',
      overview: 'Overview',
      sections: [{ title: 'Section', content: 'Content' }],
      keyTakeaways: ['takeaway'],
      sources: [{ title: 'Source', url: 'https://example.com' }],
      originalQuery: 'test topic',
      metadata: {
        depthUsed: 1,
        completedAt: new Date().toISOString()
      }
    };

    await attachReport(kv, job.id, report);
    const completed = (await getJob(kv, job.id))!;
    assert.equal(completed.status, 'completed');
    assert.ok(completed.report);

    const progress = computeProgress(completed);
    assert.equal(progress.currentDepth, 1);
    assert.equal(progress.totalDepth, 2);
    assert.equal(progress.percentComplete, 50);
  });
});
