import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { DOMParser } from "@xmldom/xmldom";
import * as mammoth from "mammoth";
import { inflateRawSync } from "node:zlib";
import { FormatError, InvalidPDFException, PDFParse, PasswordException } from "pdf-parse";

export interface ExtractedDocument {
  /** Full text, retaining the source library's whitespace and page separators. */
  text: string;
  /** Per-page text when the format and parser expose it (PDF only). */
  pages?: Array<{ pageNumber: number; text: string }>;
  /** Number of pages for paginated formats (PDF only). */
  pageCount?: number;
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_XML_ENTRIES = ["[Content_Types].xml", "_rels/.rels", "word/document.xml"];
const DOCX_DOCUMENT_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);
const MAX_DOCX_XML_PART_BYTES = 100 * 1024 * 1024;
const MAX_DOCX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

@Injectable()
export class DocumentExtractionService {
  async extractPdf(buffer: Buffer): Promise<ExtractedDocument> {
    let parser: PDFParse | undefined;
    let result: Awaited<ReturnType<PDFParse["getText"]>> | undefined;
    let parseError: unknown;

    try {
      parser = new PDFParse({ data: buffer });
      // Page boundaries are represented structurally in `pages`, not as
      // parser-generated marker text that would contaminate chunk content.
      result = await parser.getText({ pageJoiner: "" });
    } catch (error) {
      parseError = error;
    }

    if (parser) {
      try {
        await parser.destroy();
      } catch {
        if (parseError === undefined) {
          throw this.internalExtractionError();
        }
      }
    }

    if (parseError !== undefined) {
      if (parseError instanceof PasswordException) {
        throw new UnsupportedMediaTypeException({
          code: "KNOWLEDGE_FILE_PASSWORD_REQUIRED",
          message: "The PDF is password-protected and cannot be processed.",
        });
      }
      if (parseError instanceof InvalidPDFException || parseError instanceof FormatError) {
        throw this.corruptDocumentError("PDF");
      }
      throw this.internalExtractionError();
    }

    if (!result) throw this.internalExtractionError();
    const pages = result.pages.map((page) => ({ pageNumber: page.num, text: page.text }));
    return {
      // pdf-parse adds a visible placeholder for pages with no text; join
      // the authoritative page strings ourselves to keep empty pages empty.
      text: pages.map((page) => page.text).join("\n"),
      pageCount: result.total,
      pages,
    };
  }

  async extractDocx(buffer: Buffer): Promise<ExtractedDocument> {
    const xmlParts = readDocxXmlParts(buffer);
    if (!xmlParts) throw this.corruptDocumentError("DOCX");
    if (!xmlParts.every((xml) => isWellFormedXml(xml))) throw this.corruptDocumentError("DOCX");

    const documentXml = xmlParts[2];
    if (!documentXml || !hasWordDocumentRoot(documentXml)) throw this.corruptDocumentError("DOCX");

    try {
      const result = await this.extractDocxRawText(buffer);
      if (result.messages.some((message) => message.type === "error")) {
        throw this.corruptDocumentError("DOCX");
      }
      return { text: result.value, pageCount: undefined, pages: undefined };
    } catch (error) {
      if (error instanceof UnsupportedMediaTypeException) throw error;
      throw this.internalExtractionError();
    }
  }

  async extractTxt(buffer: Buffer): Promise<ExtractedDocument> {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      return { text, pageCount: undefined, pages: undefined };
    } catch {
      throw new BadRequestException({
        code: "KNOWLEDGE_FILE_ENCODING_INVALID",
        message: "The text file must contain valid UTF-8 encoding.",
      });
    }
  }

  /** Small parser boundary kept overridable for focused failure-path tests. */
  protected extractDocxRawText(buffer: Buffer): ReturnType<typeof mammoth.extractRawText> {
    return mammoth.extractRawText({ buffer });
  }

  async extract(buffer: Buffer, mimeType: string): Promise<ExtractedDocument> {
    switch (mimeType) {
      case "application/pdf":
        return this.extractPdf(buffer);
      case DOCX_MIME:
        return this.extractDocx(buffer);
      case "text/plain":
        return this.extractTxt(buffer);
      default:
        throw new UnsupportedMediaTypeException({
          code: "KNOWLEDGE_FILE_TYPE_UNSUPPORTED",
          message: "Unsupported file type for extraction.",
        });
    }
  }

  private corruptDocumentError(format: "PDF" | "DOCX"): UnsupportedMediaTypeException {
    return new UnsupportedMediaTypeException({
      code: "KNOWLEDGE_FILE_CORRUPT",
      message: `The ${format} file is invalid or corrupted.`,
    });
  }

  private internalExtractionError(): InternalServerErrorException {
    return new InternalServerErrorException({
      code: "KNOWLEDGE_EXTRACTION_ERROR",
      message: "The document could not be processed. Please try again.",
    });
  }
}

/** Read bounded core OPC XML parts and validate ZIP compression/CRC before Mammoth parses them. */
function readDocxXmlParts(buffer: Buffer): string[] | null {
  if (buffer.length < 22) return null;
  const minimumEocd = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= minimumEocd; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      const commentLength = buffer.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === buffer.length) {
        eocd = offset;
        break;
      }
    }
  }
  if (eocd < 0) return null;

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > eocd) return null;

  const entries = new Map<string, { method: number; compressedSize: number; uncompressedSize: number; crc: number; localOffset: number }>();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== 0x02014b50) return null;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > eocd) return null;
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, {
      method: buffer.readUInt16LE(offset + 10),
      crc: buffer.readUInt32LE(offset + 16),
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      localOffset: buffer.readUInt32LE(offset + 42),
    });
    offset = end;
  }

  if (offset !== centralOffset + centralSize || DOCX_XML_ENTRIES.some((name) => !entries.has(name))) return null;

  try {
    let totalUncompressedBytes = 0;
    const xmlParts = new Map<string, string>();
    for (const [name, entry] of entries) {
      totalUncompressedBytes += entry.uncompressedSize;
      if (
        totalUncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES ||
        (DOCX_XML_ENTRIES.includes(name) && entry.uncompressedSize > MAX_DOCX_XML_PART_BYTES)
      ) throw new Error("invalid document part");
      const local = entry.localOffset;
      if (local + 30 > centralOffset || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error("invalid local header");
      const dataOffset = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const dataEnd = dataOffset + entry.compressedSize;
      if (dataOffset > centralOffset || dataEnd > centralOffset) throw new Error("invalid compressed part");
      const compressed = buffer.subarray(dataOffset, dataEnd);
      const xmlBytes = entry.method === 0
        ? compressed
        : entry.method === 8
          ? inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 })
          : null;
      if (!xmlBytes || xmlBytes.length !== entry.uncompressedSize || crc32(xmlBytes) !== entry.crc) {
        throw new Error("invalid compressed content");
      }
      if (DOCX_XML_ENTRIES.includes(name)) {
        xmlParts.set(name, new TextDecoder("utf-8", { fatal: true }).decode(xmlBytes));
      }
    }
    return DOCX_XML_ENTRIES.map((name) => xmlParts.get(name) as string);
  } catch {
    return null;
  }
}

function isWellFormedXml(xml: string): boolean {
  const errors: string[] = [];
  try {
    new DOMParser({
      errorHandler: {
        warning: (message) => errors.push(message),
        error: (message) => errors.push(message),
        fatalError: (message) => errors.push(message),
      },
    }).parseFromString(xml, "application/xml");
    return errors.length === 0;
  } catch {
    return false;
  }
}

function hasWordDocumentRoot(xml: string): boolean {
  let root: { documentElement?: { localName?: string; namespaceURI?: string | null } };
  const errors: string[] = [];
  try {
    root = new DOMParser({
      errorHandler: {
        warning: (message) => errors.push(message),
        error: (message) => errors.push(message),
        fatalError: (message) => errors.push(message),
      },
    }).parseFromString(xml, "application/xml");
  } catch {
    return false;
  }
  return errors.length === 0 && root.documentElement?.localName === "document" && DOCX_DOCUMENT_NAMESPACES.has(root.documentElement.namespaceURI ?? "");
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
