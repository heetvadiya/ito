import { GoogleGenAI } from '@google/genai';
import {
  EmbedPayload,
  EmbeddingDimension,
  ItoAuthError,
  ItoFileTooLargeError,
  ItoNetworkError,
  ItoQuotaError,
} from './types';

// gemini-embedding-2-preview: first multimodal embedding model in the Gemini API.
// Supports text, image (PNG/JPEG), audio (MP3/WAV), video (MP4/MOV), PDF.
// Does NOT use taskType param — instead uses task prefixes in text content.
const MODEL_NAME = 'gemini-embedding-2-preview';

// For text documents being indexed: prepend document prefix for retrieval quality
function wrapDocument(text: string): string {
  return `title: none | text: ${text}`;
}

// For text selections being queried: prepend query prefix
function wrapQuery(text: string): string {
  return `task: search result | query: ${text}`;
}

export class ItoEmbedder {
  private client: GoogleGenAI;

  constructor(
    private apiKey: string,
    private dimension: EmbeddingDimension,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async embed(payload: EmbedPayload): Promise<number[]> {
    try {
      let contents: unknown;

      if (payload.type === 'text') {
        contents = payload.role === 'query'
          ? wrapQuery(payload.content)
          : wrapDocument(payload.content);
      } else if (payload.type === 'inline') {
        contents = [{ inlineData: { mimeType: payload.mimeType, data: payload.base64 } }];
      } else {
        // Composite: text + images → one aggregated embedding
        contents = {
          parts: [
            { text: wrapDocument(payload.textContent) },
            ...payload.mediaParts.map(part => ({
              inlineData: { mimeType: part.mimeType, data: part.base64 },
            })),
          ],
        };
      }

      const response = await this.client.models.embedContent({
        model: MODEL_NAME,
        contents,
        config: { outputDimensionality: this.dimension },
      });

      const values = response.embeddings?.[0]?.values;
      if (!values || values.length === 0) throw new Error('Empty embedding response from API.');
      return values;

    } catch (err: unknown) {
      throw this.classify(err);
    }
  }

  updateApiKey(newKey: string): void {
    this.apiKey = newKey;
    this.client = new GoogleGenAI({ apiKey: newKey });
  }

  updateDimension(newDim: EmbeddingDimension): void {
    this.dimension = newDim;
  }

  private classify(err: unknown): Error {
    if (!(err instanceof Error)) return new Error(String(err));
    const msg = err.message.toLowerCase();
    if (msg.includes('api_key_invalid') || msg.includes('401') || msg.includes('api key')) return new ItoAuthError();
    if (msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted')) return new ItoQuotaError();
    if (msg.includes('file too large') || msg.includes('413') || msg.includes('request_too_large')) return new ItoFileTooLargeError('');
    if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('fetch failed')) return new ItoNetworkError();
    return err;
  }
}
