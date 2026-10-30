import { BadRequestException, InternalServerErrorException, UnsupportedMediaTypeException } from "@nestjs/common";
import { deflateRawSync } from "node:zlib";
import { FormatError, PDFParse, PasswordException } from "pdf-parse";
import { DocumentExtractionService } from "./document-extraction.service";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("DocumentExtractionService", () => {
  let service: DocumentExtractionService;

  beforeEach(() => {
    service = new DocumentExtractionService();
  });

  describe("PDF extraction", () => {
    it("extracts real text and page metadata from a valid one-page PDF", async () => {
      const result = await service.extractPdf(makePdf(["Known PDF fixture text."]));

      expect(result.text).toContain("Known PDF fixture text.");
      expect(result.pageCount).toBe(1);
      expect(result.pages).toEqual([{ pageNumber: 1, text: expect.stringContaining("Known PDF fixture text.") }]);
    });

    it("extracts text and page numbers from a real multi-page PDF", async () => {
      const result = await service.extractPdf(makePdf(["First page marker.", "Second page marker."]));

      expect(result.pageCount).toBe(2);
      expect(result.pages).toEqual([
        { pageNumber: 1, text: expect.stringContaining("First page marker.") },
        { pageNumber: 2, text: expect.stringContaining("Second page marker.") },
      ]);
      expect(result.text).toContain("First page marker.");
      expect(result.text).toContain("Second page marker.");
    });

    it("returns empty page text for a valid PDF page with no text", async () => {
      const result = await service.extractPdf(makePdf([""]));
      expect(result.pageCount).toBe(1);
      expect(result.pages).toEqual([{ pageNumber: 1, text: "" }]);
      expect(result.text).toBe("");
    });

    it.each([Buffer.from("not a pdf"), Buffer.from("%PDF-1.4\n1 0 obj")])(
      "reports malformed or truncated PDFs as invalid user documents",
      async (buffer) => {
        await expect(service.extractPdf(buffer)).rejects.toMatchObject({
          response: expect.objectContaining({ code: "KNOWLEDGE_FILE_CORRUPT" }),
        });
      },
    );

    it("reports encrypted PDFs as requiring a password and always releases parser resources", async () => {
      const getText = jest.spyOn(PDFParse.prototype, "getText").mockRejectedValue(new PasswordException());
      const destroy = jest.spyOn(PDFParse.prototype, "destroy").mockResolvedValue();
      try {
        await expect(service.extractPdf(makePdf(["encrypted"]))).rejects.toMatchObject({
          response: expect.objectContaining({ code: "KNOWLEDGE_FILE_PASSWORD_REQUIRED" }),
        });
        expect(destroy).toHaveBeenCalledTimes(1);
      } finally {
        getText.mockRestore();
        destroy.mockRestore();
      }
    });

    it("maps parser format failures to corrupt input but unexpected failures to a safe 500", async () => {
      const getText = jest.spyOn(PDFParse.prototype, "getText");
      const destroy = jest.spyOn(PDFParse.prototype, "destroy").mockResolvedValue();
      try {
        getText.mockRejectedValueOnce(new FormatError("bad xref"));
        await expect(service.extractPdf(makePdf(["fixture"]))).rejects.toThrow(UnsupportedMediaTypeException);

        getText.mockRejectedValueOnce(new Error("secret internal detail"));
        await expect(service.extractPdf(makePdf(["fixture"]))).rejects.toMatchObject({
          response: expect.objectContaining({
            code: "KNOWLEDGE_EXTRACTION_ERROR",
            message: "The document could not be processed. Please try again.",
          }),
        });
        expect(destroy).toHaveBeenCalledTimes(2);
      } finally {
        getText.mockRestore();
        destroy.mockRestore();
      }
    });

    it("maps parser cleanup failures to a safe internal error", async () => {
      const destroy = jest.spyOn(PDFParse.prototype, "destroy").mockRejectedValue(new Error("private detail"));
      try {
        await expect(service.extractPdf(makePdf(["fixture"]))).rejects.toThrow(InternalServerErrorException);
      } finally {
        destroy.mockRestore();
      }
    });
  });

  describe("DOCX extraction", () => {
    it("extracts known text from a genuine minimal DOCX ZIP package", async () => {
      const result = await service.extractDocx(makeDocx("Known DOCX fixture text."));
      expect(result.text).toContain("Known DOCX fixture text.");
      expect(result.pageCount).toBeUndefined();
      expect(result.pages).toBeUndefined();
    });

    it("handles a valid empty DOCX", async () => {
      const result = await service.extractDocx(makeDocx(""));
      expect(result.text).toBe("");
    });

    it.each([Buffer.from("not a docx"), Buffer.from("PK\x03\x04")])(
      "rejects corrupt or incomplete DOCX ZIP data",
      async (buffer) => {
        await expect(service.extractDocx(buffer)).rejects.toMatchObject({
          response: expect.objectContaining({ code: "KNOWLEDGE_FILE_CORRUPT" }),
        });
      },
    );

    it("rejects a valid ZIP archive that lacks the required DOCX parts", async () => {
      await expect(service.extractDocx(makeZip({ "unrelated.txt": "not a document" }))).rejects.toThrow(
        UnsupportedMediaTypeException,
      );
    });

    it("classifies malformed XML inside a structurally valid DOCX as corrupt user input", async () => {
      const malformed = makeZip({
        "[Content_Types].xml": "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>",
        "_rels/.rels": "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"/>",
        "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body></w:document>",
      });
      await expect(service.extractDocx(malformed)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "KNOWLEDGE_FILE_CORRUPT" }),
      });
    });

    it("classifies corrupt compressed DOCX XML data as corrupt user input", async () => {
      const damaged = corruptZipEntry(makeDocx("compressed marker"), "word/document.xml");
      await expect(service.extractDocx(damaged)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "KNOWLEDGE_FILE_CORRUPT" }),
      });
    });

    it("does not mislabel unexpected Mammoth failures as corrupt user files", async () => {
      class FailingDocxService extends DocumentExtractionService {
        protected override extractDocxRawText(_buffer: Buffer) {
          return Promise.reject(new Error("secret internal detail"));
        }
      }
      await expect(new FailingDocxService().extractDocx(makeDocx("valid structure"))).rejects.toMatchObject({
          response: expect.objectContaining({
            code: "KNOWLEDGE_EXTRACTION_ERROR",
            message: "The document could not be processed. Please try again.",
          }),
        });
    });
  });

  describe("TXT extraction", () => {
    it("preserves ordinary UTF-8, multiline content, Unicode, and meaningful whitespace", async () => {
      const text = "  First line\n\nUnicode: café, 中文, 🎉\n  last line  ";
      await expect(service.extractTxt(Buffer.from(text, "utf8"))).resolves.toMatchObject({ text });
    });

    it("returns an empty string for an empty file", async () => {
      await expect(service.extractTxt(Buffer.alloc(0))).resolves.toMatchObject({ text: "" });
    });

    it("rejects malformed UTF-8 instead of replacing invalid byte sequences", async () => {
      await expect(service.extractTxt(Buffer.from([0x61, 0xc3, 0x28]))).rejects.toMatchObject({
        response: expect.objectContaining({ code: "KNOWLEDGE_FILE_ENCODING_INVALID" }),
      });
      await expect(service.extractTxt(Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0xff]))).rejects.toThrow(
        BadRequestException,
      );
    });

    it("decodes large UTF-8 files without altering their content", async () => {
      const text = "large text 🧪\n".repeat(10_000);
      await expect(service.extractTxt(Buffer.from(text, "utf8"))).resolves.toMatchObject({ text });
    });
  });

  describe("format routing", () => {
    it("routes supported MIME types to their extractors", async () => {
      expect((await service.extract(makePdf(["route pdf"]), "application/pdf")).text).toContain("route pdf");
      expect((await service.extract(makeDocx("route docx"), DOCX_MIME)).text).toContain("route docx");
      await expect(service.extract(Buffer.from("route txt"), "text/plain")).resolves.toMatchObject({
        text: "route txt",
      });
    });

    it("rejects unsupported MIME types with the shared stable code", async () => {
      await expect(service.extract(Buffer.from("data"), "application/json")).rejects.toMatchObject({
        response: expect.objectContaining({ code: "KNOWLEDGE_FILE_TYPE_UNSUPPORTED" }),
      });
    });
  });
});

function makePdf(pageTexts: string[]): Buffer {
  const pageIds = pageTexts.map((_, index) => 3 + index * 2);
  const fontId = 3 + pageTexts.length * 2;
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  pageTexts.forEach((text, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    const escaped = text.replace(/[\\()]/g, "\\$&");
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET` : "";
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "ascii");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

function makeDocx(text: string): Buffer {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${
    text ? `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>` : ""
  }<w:sectPr/></w:body></w:document>`;
  return makeZip({
    "[Content_Types].xml": "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>",
    "_rels/.rels": "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>",
    "word/document.xml": documentXml,
  });
}

function makeZip(files: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const raw = Buffer.from(value, "utf8");
    const compressed = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    nameBytes.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function corruptZipEntry(buffer: Buffer, entryName: string): Buffer {
  const damaged = Buffer.from(buffer);
  let eocd = damaged.length - 22;
  while (eocd >= 0 && damaged.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("Fixture ZIP has no end record");
  const entryCount = damaged.readUInt16LE(eocd + 10);
  let offset = damaged.readUInt32LE(eocd + 16);
  for (let index = 0; index < entryCount; index += 1) {
    const nameLength = damaged.readUInt16LE(offset + 28);
    const extraLength = damaged.readUInt16LE(offset + 30);
    const commentLength = damaged.readUInt16LE(offset + 32);
    const name = damaged.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (name === entryName) {
      const local = damaged.readUInt32LE(offset + 42);
      const dataOffset = local + 30 + damaged.readUInt16LE(local + 26) + damaged.readUInt16LE(local + 28);
      damaged[dataOffset] = (damaged[dataOffset] ?? 0) ^ 0xff;
      return damaged;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Fixture ZIP does not contain ${entryName}`);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
