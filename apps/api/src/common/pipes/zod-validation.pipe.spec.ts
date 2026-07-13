import type { ArgumentMetadata } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { emailSchema } from "@omniscience/schemas";
import { ZodValidationPipe } from "./zod-validation.pipe";

const metadata = {} as unknown as ArgumentMetadata;

describe("ZodValidationPipe", () => {
  it("returns the parsed (normalized) value when input is valid", () => {
    const pipe = new ZodValidationPipe(emailSchema);

    expect(pipe.transform("  User@Example.com  ", metadata)).toBe("user@example.com");
  });

  it("throws a structured BadRequestException on invalid input", () => {
    const pipe = new ZodValidationPipe(emailSchema);

    expect(() => pipe.transform("not-an-email", metadata)).toThrow(BadRequestException);
  });

  it("never leaks the offending value in the error details", () => {
    const pipe = new ZodValidationPipe(emailSchema);

    try {
      pipe.transform("not-an-email", metadata);
      throw new Error("expected transform to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: Array<{ path: string; message: string }>;
      };
      expect(response.code).toBe("VALIDATION_ERROR");
      expect(response.details.length).toBeGreaterThan(0);
      expect(JSON.stringify(response)).not.toContain("not-an-email");
    }
  });
});
