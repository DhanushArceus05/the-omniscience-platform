import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { PasswordHasherService } from "../auth/password-hasher.service";
import { RefreshTokenStore } from "../auth/refresh-token.store";
import { AvatarStorageService } from "../avatar/avatar-storage.service";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "./users.service";

describe("UsersService", () => {
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
  } as unknown as PrismaService;

  const passwordHasher = {
    hash: jest.fn(),
    verify: jest.fn(),
    assertDiffersFromCurrent: jest.fn(),
  } as unknown as PasswordHasherService;

  const refreshTokens = {
    revokeAllForUser: jest.fn(),
  } as unknown as RefreshTokenStore;

  const avatarStorage = {
    save: jest.fn(),
    delete: jest.fn(),
    buildPublicUrl: jest.fn((key: string) => `http://localhost:4000/uploads/avatars/${key}`),
    getMaxUploadBytes: jest.fn(() => 5 * 1024 * 1024),
  } as unknown as AvatarStorageService;

  const buildUser = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: "user_1",
    email: "user@example.com",
    passwordHash: "hashed-current-password",
    name: "Ada Lovelace",
    emailVerifiedAt: new Date(),
    avatarStorageKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(prisma, passwordHasher, refreshTokens, avatarStorage);
  });

  describe("updateProfile", () => {
    it("updates and returns the caller's own profile, with a null avatarUrl when no avatar is set", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser());
      (prisma.user.update as jest.Mock).mockResolvedValue(
        buildUser({ name: "Ada, Countess of Lovelace" }),
      );

      const result = await service.updateProfile("user_1", "Ada, Countess of Lovelace");

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: "user_1" } });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user_1" },
        data: { name: "Ada, Countess of Lovelace" },
      });
      expect(result).toEqual({
        id: "user_1",
        email: "user@example.com",
        name: "Ada, Countess of Lovelace",
        avatarUrl: null,
      });
    });

    it("derives avatarUrl from avatarStorageKey when the user already has an avatar", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser());
      (prisma.user.update as jest.Mock).mockResolvedValue(
        buildUser({ avatarStorageKey: "existing.jpg" }),
      );

      const result = await service.updateProfile("user_1", "Ada Lovelace");

      expect(result.avatarUrl).toBe("http://localhost:4000/uploads/avatars/existing.jpg");
      expect(avatarStorage.buildPublicUrl).toHaveBeenCalledWith("existing.jpg");
    });

    it("throws UnauthorizedException when the user no longer exists", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.updateProfile("user_1", "New Name")).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe("uploadAvatar", () => {
    const uploadInput = { buffer: Buffer.from("fake-image"), mimetype: "image/jpeg", size: 10 };

    it("saves the file, updates the user's avatarStorageKey, and returns the new public URL", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser());
      (avatarStorage.save as jest.Mock).mockResolvedValue({
        storageKey: "new-key.jpg",
        publicUrl: "http://localhost:4000/uploads/avatars/new-key.jpg",
      });

      const result = await service.uploadAvatar("user_1", uploadInput);

      expect(avatarStorage.save).toHaveBeenCalledWith(uploadInput);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user_1" },
        data: { avatarStorageKey: "new-key.jpg" },
      });
      expect(result).toEqual({ avatarUrl: "http://localhost:4000/uploads/avatars/new-key.jpg" });
    });

    it("deletes the previous avatar after the new one is saved and the row updated", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(
        buildUser({ avatarStorageKey: "old-key.jpg" }),
      );
      (avatarStorage.save as jest.Mock).mockResolvedValue({
        storageKey: "new-key.jpg",
        publicUrl: "http://localhost:4000/uploads/avatars/new-key.jpg",
      });

      const callOrder: string[] = [];
      (prisma.user.update as jest.Mock).mockImplementation(async () => {
        callOrder.push("update");
        return buildUser();
      });
      (avatarStorage.delete as jest.Mock).mockImplementation(async () => {
        callOrder.push("delete-old");
      });

      await service.uploadAvatar("user_1", uploadInput);

      expect(avatarStorage.delete).toHaveBeenCalledWith("old-key.jpg");
      expect(callOrder).toEqual(["update", "delete-old"]);
    });

    it("does not attempt to delete anything when there was no previous avatar", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser({ avatarStorageKey: null }));
      (avatarStorage.save as jest.Mock).mockResolvedValue({
        storageKey: "new-key.jpg",
        publicUrl: "http://localhost:4000/uploads/avatars/new-key.jpg",
      });

      await service.uploadAvatar("user_1", uploadInput);

      expect(avatarStorage.delete).not.toHaveBeenCalled();
    });

    it("propagates a validation failure from AvatarStorageService.save without touching the database", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser());
      (avatarStorage.save as jest.Mock).mockRejectedValue(
        new BadRequestException({ code: "AVATAR_TYPE_UNSUPPORTED", message: "nope" }),
      );

      await expect(service.uploadAvatar("user_1", uploadInput)).rejects.toMatchObject({
        response: { code: "AVATAR_TYPE_UNSUPPORTED" },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("throws UnauthorizedException when the user no longer exists", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.uploadAvatar("user_1", uploadInput)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(avatarStorage.save).not.toHaveBeenCalled();
    });
  });

  describe("deleteAvatar", () => {
    it("clears avatarStorageKey and deletes the stored file when an avatar exists", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(
        buildUser({ avatarStorageKey: "existing.jpg" }),
      );

      const result = await service.deleteAvatar("user_1");

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user_1" },
        data: { avatarStorageKey: null },
      });
      expect(avatarStorage.delete).toHaveBeenCalledWith("existing.jpg");
      expect(result).toEqual({ avatarUrl: null });
    });

    it("is a no-op (no update, no delete call) when there was no avatar", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser({ avatarStorageKey: null }));

      const result = await service.deleteAvatar("user_1");

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(avatarStorage.delete).not.toHaveBeenCalled();
      expect(result).toEqual({ avatarUrl: null });
    });

    it("throws UnauthorizedException when the user no longer exists", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteAvatar("user_1")).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("changePassword", () => {
    it("verifies the current password, hashes the new one, and updates it", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser());
      (passwordHasher.verify as jest.Mock).mockResolvedValue(true);
      (passwordHasher.hash as jest.Mock).mockResolvedValue("new-hashed-password");

      const result = await service.changePassword(
        "user_1",
        "OldPassw0rd!",
        "N3wSup3r$ecretPassw0rd!",
      );

      expect(passwordHasher.verify).toHaveBeenCalledWith(
        "hashed-current-password",
        "OldPassw0rd!",
      );
      expect(passwordHasher.assertDiffersFromCurrent).toHaveBeenCalledWith(
        "hashed-current-password",
        "N3wSup3r$ecretPassw0rd!",
      );
      expect(passwordHasher.hash).toHaveBeenCalledWith("N3wSup3r$ecretPassw0rd!");
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user_1" },
        data: { passwordHash: "new-hashed-password" },
      });
      expect(result).toEqual({ email: "user@example.com" });
    });

    it("throws BadRequestException when the current password is wrong, without updating anything", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser());
      (passwordHasher.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword("user_1", "WrongPassword!", "N3wSup3r$ecretPassw0rd!"),
      ).rejects.toThrow(BadRequestException);
      expect(passwordHasher.hash).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("propagates NEW_PASSWORD_MUST_DIFFER and does not update anything when the new password matches the current one", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser());
      (passwordHasher.verify as jest.Mock).mockResolvedValue(true);
      (passwordHasher.assertDiffersFromCurrent as jest.Mock).mockRejectedValue(
        new BadRequestException({
          code: "NEW_PASSWORD_MUST_DIFFER",
          message: "New password must be different from your current password.",
        }),
      );

      const promise = service.changePassword("user_1", "CurrentPassw0rd!", "CurrentPassw0rd!");

      await expect(promise).rejects.toThrow(BadRequestException);
      await expect(promise).rejects.toMatchObject({
        response: expect.objectContaining({ code: "NEW_PASSWORD_MUST_DIFFER" }),
      });
      expect(passwordHasher.assertDiffersFromCurrent).toHaveBeenCalledWith(
        "hashed-current-password",
        "CurrentPassw0rd!",
      );
      expect(passwordHasher.hash).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("throws UnauthorizedException when the user no longer exists", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.changePassword("user_1", "OldPassw0rd!", "N3wSup3r$ecretPassw0rd!"),
      ).rejects.toThrow(UnauthorizedException);
      expect(passwordHasher.verify).not.toHaveBeenCalled();
    });
  });

  describe("deleteAccount", () => {
    it("verifies the password, deletes the user row, revokes every session, and cleans up the avatar file", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(
        buildUser({ avatarStorageKey: "existing.jpg" }),
      );
      (passwordHasher.verify as jest.Mock).mockResolvedValue(true);
      (prisma.user.delete as jest.Mock).mockResolvedValue(buildUser());
      (refreshTokens.revokeAllForUser as jest.Mock).mockResolvedValue(2);

      const result = await service.deleteAccount("user_1", "CorrectPassw0rd!");

      expect(passwordHasher.verify).toHaveBeenCalledWith(
        "hashed-current-password",
        "CorrectPassw0rd!",
      );
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "user_1" } });
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith("user_1");
      expect(avatarStorage.delete).toHaveBeenCalledWith("existing.jpg");
      expect(result).toEqual({ deleted: true });
    });

    it("calls avatarStorage.delete with null (a safe no-op) when there was no avatar", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser({ avatarStorageKey: null }));
      (passwordHasher.verify as jest.Mock).mockResolvedValue(true);
      (prisma.user.delete as jest.Mock).mockResolvedValue(buildUser());

      await service.deleteAccount("user_1", "CorrectPassw0rd!");

      expect(avatarStorage.delete).toHaveBeenCalledWith(null);
    });

    it("deletes the user row before revoking sessions", async () => {
      const callOrder: string[] = [];
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser());
      (passwordHasher.verify as jest.Mock).mockResolvedValue(true);
      (prisma.user.delete as jest.Mock).mockImplementation(async () => {
        callOrder.push("delete");
        return buildUser();
      });
      (refreshTokens.revokeAllForUser as jest.Mock).mockImplementation(async () => {
        callOrder.push("revokeAllForUser");
        return 0;
      });

      await service.deleteAccount("user_1", "CorrectPassw0rd!");

      expect(callOrder).toEqual(["delete", "revokeAllForUser"]);
    });

    it("throws BadRequestException when the password is wrong, deleting nothing and revoking nothing", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser());
      (passwordHasher.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.deleteAccount("user_1", "WrongPassword!")).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
      expect(avatarStorage.delete).not.toHaveBeenCalled();
    });

    it("throws UnauthorizedException when the user no longer exists", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteAccount("user_1", "CorrectPassw0rd!")).rejects.toThrow(
        UnauthorizedException,
      );
      expect(passwordHasher.verify).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});
