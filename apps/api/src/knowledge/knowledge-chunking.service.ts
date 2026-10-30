import { Injectable } from "@nestjs/common";
import type { ExtractedDocument } from "./document-extraction.service";

export const KNOWLEDGE_CHUNK_WORDS = 250;
export const KNOWLEDGE_CHUNK_OVERLAP_WORDS = 50;

export interface KnowledgeChunk {
  chunkIndex: number;
  text: string;
  wordCount: number;
  /** Deterministic estimate (ceil(words × 1.33)); not tokenizer output. */
  tokenEstimate: number;
  pageNumbers?: number[];
}

@Injectable()
export class KnowledgeChunkingService {
  chunk(document: ExtractedDocument): KnowledgeChunk[] {
    const pages = document.pages?.length ? document.pages : undefined;
    const words: Array<{ value: string; pageNumber?: number }> = pages
      ? pages.flatMap((page) => page.text.trim().split(/\s+/u).filter(Boolean).map((value) => ({ value, pageNumber: page.pageNumber })))
      : document.text.trim().split(/\s+/u).filter(Boolean).map((value) => ({ value }));
    if (!words.length) return [];

    const chunks: KnowledgeChunk[] = [];
    const stride = KNOWLEDGE_CHUNK_WORDS - KNOWLEDGE_CHUNK_OVERLAP_WORDS;
    for (let start = 0; start < words.length; start += stride) {
      const part = words.slice(start, start + KNOWLEDGE_CHUNK_WORDS);
      const pageNumbers = [...new Set(part.flatMap((word) => word.pageNumber === undefined ? [] : [word.pageNumber]))];
      chunks.push({
        chunkIndex: chunks.length,
        text: part.map((word) => word.value).join(" "),
        wordCount: part.length,
        tokenEstimate: Math.ceil(part.length * 1.33),
        ...(pageNumbers.length ? { pageNumbers } : {}),
      });
      if (start + KNOWLEDGE_CHUNK_WORDS >= words.length) break;
    }
    return chunks;
  }
}
