import { KnowledgeChunkingService } from "./knowledge-chunking.service";

describe("KnowledgeChunkingService", () => {
  const service = new KnowledgeChunkingService();
  const input = (count: number, whitespace = " ") => ({
    text: Array.from({ length: count }, (_, index) => `w${index + 1}`).join(whitespace),
  });

  it("returns no chunks for empty or whitespace-only text", () => {
    expect(service.chunk({ text: " \n\t " })).toEqual([]);
  });

  it.each([249, 250, 251, 450, 451])("chunks %i words with the fixed overlap and no trailing chunk", (count) => {
    const chunks = service.chunk(input(count));
    expect(chunks.map(({ wordCount }) => wordCount)).toEqual(
      count <= 250 ? [count] : count <= 450 ? [250, count - 200] : [250, 250, count - 400],
    );
    expect(chunks.map(({ chunkIndex }) => chunkIndex)).toEqual(chunks.map((_, index) => index));
  });

  it("is deterministic, whitespace tolerant, and applies a documented token estimate", () => {
    const document = { text: "α\tβ\nγ  δ" };
    expect(service.chunk(document)).toEqual(service.chunk(document));
    expect(service.chunk(document)[0]).toMatchObject({ text: "α β γ δ", wordCount: 4, tokenEstimate: 6 });
  });

  it("tracks all source PDF page numbers spanned by a chunk", () => {
    const chunks = service.chunk({ text: "one two three", pages: [
      { pageNumber: 1, text: "one two" },
      { pageNumber: 2, text: "three" },
    ] });
    expect(chunks[0]?.pageNumbers).toEqual([1, 2]);
  });
});
