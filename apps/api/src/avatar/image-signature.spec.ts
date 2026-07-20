import {
  ALLOWED_AVATAR_MIME_TYPES,
  detectImageType,
  extensionForImageType,
  isAllowedAvatarMimeType,
} from "./image-signature";

function bytes(...values: number[]): Buffer {
  return Buffer.from(values);
}

describe("detectImageType", () => {
  it("detects a JPEG from its magic bytes", () => {
    const buffer = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
    expect(detectImageType(buffer)).toBe("jpeg");
  });

  it("detects a PNG from its magic bytes", () => {
    const buffer = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00);
    expect(detectImageType(buffer)).toBe("png");
  });

  it("detects a WebP from its RIFF/WEBP magic bytes", () => {
    const buffer = Buffer.concat([
      bytes(0x52, 0x49, 0x46, 0x46), // "RIFF"
      bytes(0x00, 0x00, 0x00, 0x00), // file size (unused by the detector)
      bytes(0x57, 0x45, 0x42, 0x50), // "WEBP"
    ]);
    expect(detectImageType(buffer)).toBe("webp");
  });

  it("returns null for a GIF (unsupported format) despite a plausible-looking header", () => {
    const buffer = Buffer.from("GIF89a", "ascii");
    expect(detectImageType(buffer)).toBeNull();
  });

  it("returns null for an SVG/XML file, even one with an image/svg+xml claim", () => {
    const buffer = Buffer.from('<?xml version="1.0"?><svg></svg>', "utf8");
    expect(detectImageType(buffer)).toBeNull();
  });

  it("returns null for a tiny/truncated buffer that can't contain any signature", () => {
    expect(detectImageType(bytes(0xff))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });

  it("returns null for a RIFF file that isn't WEBP (e.g. a WAV file)", () => {
    const buffer = Buffer.concat([
      bytes(0x52, 0x49, 0x46, 0x46), // "RIFF"
      bytes(0x00, 0x00, 0x00, 0x00),
      Buffer.from("WAVE", "ascii"),
    ]);
    expect(detectImageType(buffer)).toBeNull();
  });

  it("rejects a file whose bytes only spoof the declared extension/mimetype, not the real signature", () => {
    // A plain text file renamed/declared as a .png/image/png upload.
    const buffer = Buffer.from("not actually an image", "utf8");
    expect(detectImageType(buffer)).toBeNull();
  });
});

describe("extensionForImageType", () => {
  it("maps jpeg to jpg", () => {
    expect(extensionForImageType("jpeg")).toBe("jpg");
  });

  it("maps png to png", () => {
    expect(extensionForImageType("png")).toBe("png");
  });

  it("maps webp to webp", () => {
    expect(extensionForImageType("webp")).toBe("webp");
  });
});

describe("isAllowedAvatarMimeType", () => {
  it("accepts the three allowed types", () => {
    for (const type of ALLOWED_AVATAR_MIME_TYPES) {
      expect(isAllowedAvatarMimeType(type)).toBe(true);
    }
  });

  it("rejects an unsupported mimetype, including image/svg+xml", () => {
    expect(isAllowedAvatarMimeType("image/svg+xml")).toBe(false);
    expect(isAllowedAvatarMimeType("image/gif")).toBe(false);
    expect(isAllowedAvatarMimeType("application/pdf")).toBe(false);
  });
});
