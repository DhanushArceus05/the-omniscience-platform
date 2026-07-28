import { anyInputSchema, predicateSchema, stringSchema } from "./tool.interface";

describe("tool schema helpers", () => {
  describe("predicateSchema", () => {
    it("succeeds and narrows the type when the predicate passes", () => {
      const isEven = predicateSchema((value): value is number => typeof value === "number" && value % 2 === 0, "Expected an even number.");

      const result = isEven.safeParse(4);

      expect(result).toEqual({ success: true, data: 4 });
    });

    it("fails with the given message when the predicate rejects", () => {
      const isEven = predicateSchema((value): value is number => typeof value === "number" && value % 2 === 0, "Expected an even number.");

      const result = isEven.safeParse(3);

      expect(result.success).toBe(false);
      expect(result.success === false && result.error.issues[0]?.message).toBe("Expected an even number.");
    });
  });

  describe("anyInputSchema", () => {
    it("always succeeds, echoing back whatever value it was given", () => {
      expect(anyInputSchema.safeParse(42)).toEqual({ success: true, data: 42 });
      expect(anyInputSchema.safeParse(undefined)).toEqual({ success: true, data: undefined });
      expect(anyInputSchema.safeParse({ nested: true })).toEqual({ success: true, data: { nested: true } });
    });
  });

  describe("stringSchema", () => {
    it("succeeds for a string", () => {
      expect(stringSchema.safeParse("hello")).toEqual({ success: true, data: "hello" });
    });

    it("fails for a non-string", () => {
      expect(stringSchema.safeParse(42).success).toBe(false);
      expect(stringSchema.safeParse(undefined).success).toBe(false);
      expect(stringSchema.safeParse({}).success).toBe(false);
    });
  });
});
