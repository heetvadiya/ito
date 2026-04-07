import { createHash } from 'crypto';

export function computeHash(buffer: ArrayBuffer): string {
  return createHash('md5').update(Buffer.from(buffer)).digest('hex');
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0 && secs > 0) return `${mins} min ${secs} sec`;
  if (mins > 0) return `${mins} min`;
  return `${secs} sec`;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function chunkMarkdown(content: string): string[] {
  const MAX_CHUNK_CHARS = 6_000;
  const MIN_CHUNK_CHARS = 100;
  const MAX_CHUNKS = 20;

  // Split at heading boundaries (## and ###)
  const headingSplit = content.split(/(?=^#{2,3} )/m).filter(Boolean);

  const chunks: string[] = [];
  for (const section of headingSplit) {
    if (section.length <= MAX_CHUNK_CHARS) {
      chunks.push(section);
    } else {
      // Further split oversized sections at double newlines
      const paragraphs = section.split(/\n\n+/).filter(Boolean);
      let current = '';
      for (const para of paragraphs) {
        if ((current + '\n\n' + para).length > MAX_CHUNK_CHARS && current.length > 0) {
          chunks.push(current);
          current = para;
        } else {
          current = current ? current + '\n\n' + para : para;
        }
      }
      if (current) chunks.push(current);
    }
  }

  const filtered = chunks.filter(c => c.trim().length >= MIN_CHUNK_CHARS);

  // If all chunks were filtered out but the content itself is non-empty,
  // embed the whole content as a single chunk so short notes still get indexed
  if (filtered.length === 0 && content.trim().length > 0) {
    return [content.trim()];
  }

  return filtered.slice(0, MAX_CHUNKS);
}

export function extractExcerpt(content: string, maxLength = 120): string {
  const clean = content
    .replace(/!\[.*?\]\(.*?\)/g, '')   // images
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // links → text
    .replace(/#{1,6} /g, '')           // headings
    .replace(/[*_`~]{1,2}/g, '')       // bold, italic, code, strikethrough
    .replace(/\n+/g, ' ')
    .trim();

  if (clean.length <= maxLength) return clean;

  const trimmed = clean.slice(0, maxLength);
  const lastSpace = trimmed.lastIndexOf(' ');
  return lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
