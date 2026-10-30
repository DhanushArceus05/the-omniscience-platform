import type { Env } from "@omniscience/config";
import { OpenAiProvider } from "./openai.provider";

describe("OpenAiProvider embeddings (mocked HTTP)", () => {
  const env = { OPENAI_API_KEY: "test-secret", AI_REQUEST_TIMEOUT_MS: 1000 } as unknown as Env;
  afterEach(() => jest.restoreAllMocks());

  it("uses the required model, batches inputs, and preserves explicit response indexes", async () => {
    const vectors = [{ index: 1, embedding: [0.2] }, { index: 0, embedding: [0.1] }];
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(Response.json({ data: vectors }));
    const provider = new OpenAiProvider(env);
    const result = await provider.embedBatch("text-embedding-3-small", ["a", "b"]);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { model: string; input: string[] };
    expect(requestBody).toEqual({ model: "text-embedding-3-small", input: ["a", "b"] });
    expect(result).toEqual(vectors);
  });

  it("rejects unsupported model requests without calling the provider", async () => {
    const fetchMock = jest.spyOn(global, "fetch");
    await expect(new OpenAiProvider(env).embed("text-embedding-3-large", "text")).rejects.toMatchObject({
      response: { code: "PROVIDER_REQUEST_INVALID" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
