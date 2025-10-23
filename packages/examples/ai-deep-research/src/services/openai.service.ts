import OpenAI from 'openai';

import type { AnalysisSummary, ExtractedContent, ResearchReport } from '../types/research.js';

interface AnalysisResponse {
  summary: string;
  keyFindings: string[];
  sources: { title: string; url: string }[];
  followUpQueries?: string[];
}

interface ReportResponse {
  title: string;
  overview: string;
  sections: { title: string; content: string }[];
  keyTakeaways: string[];
  sources: { title: string; url: string }[];
  originalQuery: string;
  metadata: { depthUsed: number; completedAt: string };
}

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export class OpenAIService {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey = process.env.OPENAI_API_KEY, model = DEFAULT_MODEL) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required to run the research pipeline');
    }

    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generateQueries(topic: string, count: number): Promise<string[]> {
    const systemPrompt = `You are a research strategist. Generate ${count} distinct web search queries to explore the topic comprehensively.
Return ONLY valid JSON: {"queries": ["..."]}`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: topic }
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('OpenAI returned no content for query generation');
    }

    const parsed = JSON.parse(content) as { queries?: string[] };
    const queries = Array.isArray(parsed.queries) ? parsed.queries : [];

    if (queries.length === 0) {
      throw new Error('OpenAI returned an empty query list');
    }

    return queries.slice(0, count);
  }

  async analyzeContent(
    originalQuery: string,
    contents: ExtractedContent[],
    depth: number,
    maxDepth: number
  ): Promise<AnalysisSummary> {
    const prepared = this.prepareContentSnippet(contents);
    const systemPrompt = `You analyze multi-source research material for the topic "${originalQuery}".
Summarize, extract key findings, and cite sources. If deeper research is warranted (current depth ${depth + 1} of ${maxDepth}), propose follow up queries.
Return ONLY valid JSON with shape {"summary":"...","keyFindings":[],"sources":[{"title":"","url":""}],"followUpQueries":[]}`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prepared }
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('OpenAI returned no content for analysis');
    }

    const parsed = JSON.parse(content) as AnalysisResponse;
    const followUps = (parsed.followUpQueries ?? []).filter(Boolean);

    const summary: AnalysisSummary = {
      depth,
      summary: parsed.summary,
      keyFindings: parsed.keyFindings ?? [],
      sources: parsed.sources ?? []
    };

    if (followUps.length > 0) {
      summary.followUpQueries = followUps;
    }

    return summary;
  }

  async compileReport(originalQuery: string, analyses: AnalysisSummary[]): Promise<ResearchReport> {
    const analysesPayload = JSON.stringify(analyses, null, 2);
    const systemPrompt = `You synthesize layered research analyses into a cohesive report.
Return ONLY valid JSON with keys {"title","overview","sections","keyTakeaways","sources","originalQuery","metadata"} where metadata.depthUsed is the deepest depth index + 1.`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: analysesPayload }
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('OpenAI returned no content for report compilation');
    }

    const parsed = JSON.parse(content) as ReportResponse;
    const depthUsed = parsed.metadata?.depthUsed ?? analyses.length;

    return {
      title: parsed.title,
      overview: parsed.overview,
      sections: parsed.sections ?? [],
      keyTakeaways: parsed.keyTakeaways ?? [],
      sources: parsed.sources ?? [],
      originalQuery,
      metadata: {
        depthUsed,
        completedAt: new Date().toISOString()
      }
    };
  }

  private prepareContentSnippet(contents: ExtractedContent[]): string {
    const MAX_SNIPPET_LENGTH = 5000;
    const MAX_BODY_LENGTH = 100_000;
    const joined = contents.map((item) => {
      const snippet = item.content.slice(0, MAX_SNIPPET_LENGTH);
      return `SOURCE: ${item.title}\nURL: ${item.url}\nQUERY: ${item.query}\nCONTENT:\n${snippet}`;
    }).join('\n\n');

    return joined.length > MAX_BODY_LENGTH ? `${joined.slice(0, MAX_BODY_LENGTH)}\n... (trimmed)` : joined;
  }
}
