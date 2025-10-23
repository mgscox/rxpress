import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ClientUnaryCall, Metadata, ServiceError, ChannelCredentials } from '@grpc/grpc-js';
import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const protoPath = resolve(__dirname, '../../proto/sentiment.proto');

const packageDefinition = protoLoader.loadSync(protoPath, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const grpcObject = loadPackageDefinition(packageDefinition) as unknown as {
  sentiment: {
    SentimentService: new (host: string, credentials: ChannelCredentials) => SentimentGrpcClient;
  };
};

type AnalyseRequest = {
  text: string;
  languageHint?: string;
};

type SentimentBreakdown = {
  sentence: string;
  score: number;
};

type AnalyseResponse = {
  detectedLanguage: string;
  polarity: number;
  confidence: number;
  breakdown: SentimentBreakdown[];
  provider: string;
};

type SentimentGrpcClient = {
  Analyse(request: AnalyseRequest, callback: (error: ServiceError | null, response: AnalyseResponse) => void): ClientUnaryCall;
  Analyse(request: AnalyseRequest, metadata: Metadata, callback: (error: ServiceError | null, response: AnalyseResponse) => void): ClientUnaryCall;
};

let client: SentimentGrpcClient | null = null;

function getClient(): SentimentGrpcClient {
  if (client) {
    return client;
  }

  const host = process.env.GRPC_HOST || '127.0.0.1';
  const port = process.env.GRPC_PORT || '50055';
  const target = `${host}:${port}`;
  const constructor = grpcObject.sentiment.SentimentService as unknown as new (
    host: string,
    creds: ChannelCredentials,
  ) => SentimentGrpcClient;
  client = new constructor(target, credentials.createInsecure());
  return client;
}

export async function analyseSentiment(text: string, languageHint?: string): Promise<AnalyseResponse> {
  return new Promise<AnalyseResponse>((resolvePromise, rejectPromise) => {
    const request: AnalyseRequest = { text };

    if (languageHint) {
      request.languageHint = languageHint;
    }

    getClient().Analyse(request, (error, response) => {
      if (error) {
        rejectPromise(error);
        return;
      }

      resolvePromise(response);
    });
  });
}
