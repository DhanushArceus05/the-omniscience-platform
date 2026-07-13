import { PasswordHasherService } from "./password-hasher.service";

describe("PasswordHasherService", () => {
  const service = new PasswordHasherService();
  const password = "Sup3r$ecretPassw0rd!";

  it("produces an argon2id-encoded hash different from the plaintext password", async () => {
    const hash = await service.hash(password);

    expect(hash).not.toBe(password);
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("verifies a correct password against its hash", async () => {
    const hash = await service.hash(password);

    await expect(service.verify(hash, password)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await service.hash(password);

    await expect(service.verify(hash, "totally-wrong-password")).resolves.toBe(false);
  });

  it("produces a different hash each time for the same password (random salt)", async () => {
    const [first, second] = await Promise.all([service.hash(password), service.hash(password)]);

    expect(first).not.toBe(second);
  });

  it("returns false instead of throwing for a malformed hash", async () => {
    await expect(service.verify("not-a-real-argon2-hash", password)).resolves.toBe(false);
  });

  it("returns false instead of throwing for an empty hash", async () => {
    await expect(service.verify("", password)).resolves.toBe(false);
  });
});
