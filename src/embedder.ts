import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  EmbedPayload,
  EmbeddingDimension,
  ItoAuthError,
  ItoFileTooLargeError,
  ItoNetworkError,
  ItoQuotaError,
} from './types';

const MODEL_NAME = 'gemini-embedding-exp-03-07';

export class ItoEmbedder {
  private client: GoogleGenerativeAI;

  constructor(
    private apiKey: string,
    private dimension: EmbeddingDimension,
  ) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async embed(payload: EmbedPayload): Promise<number[]> {
    try {
      const model = this.client.getGenerativeModel({ model: MODEL_NAME });

      const request = payload.type === 'text'
        ? {
            content: { parts: [{ text: payload.content }], role: 'user' },
            taskType: 'RETRIEVAL_DOCUMENT' as const,
            outputDimensionality: this.dimension,
          }
        : {
            content: {
              parts: [{
                inlineData: {
                  mimeType: payload.mimeType,
                  data: payload.base64,
                },
              }],
              role: 'user',
            },
            taskType: 'RETRIEVAL_DOCUMENT' as const,
            outputDimensionality: this.dimension,
          };

      const result = await model.embedContent(request);
      return result.embedding.values;

    } catch (err: unknown) {
      throw this.classify(err);
    }
  }

  updateApiKey(newKey: string): void {
    this.apiKey = newKey;
    this.client = new GoogleGenerativeAI(newKey);
  }

  updateDimension(newDim: EmbeddingDimension): void {
    this.dimension = newDim;
  }

  private classify(err: unknown): Error {
    if (!(err instanceof Error)) return new Error(String(err));

    const msg = err.message.toLowerCase();

    if (msg.includes('api_key_invalid') || msg.includes('401') || msg.includes('api key')) {
      return new ItoAuthError();
    }
    if (msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted')) {
      return new ItoQuotaError();
    }
    if (msg.includes('file too large') || msg.includes('request_too_large') || msg.includes('413')) {
      return new ItoFileTooLargeError('');
    }
    if (
      msg.includes('network') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('fetch failed')
    ) {
      return new ItoNetworkError();
    }

    return err;
  }
}
