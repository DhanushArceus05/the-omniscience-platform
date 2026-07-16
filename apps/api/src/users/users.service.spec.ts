import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { PasswordHasherService } from "../auth/password-hasher.service";
import { RefreshTokenStore } from "../auth/refresh-token.store";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "./users.service";

describe("UsersService", () => {
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
  } as unknown as PrismaService;

  const passwordHasher = {
    hash: jest.fn(),
    verify: jest.fn(),
  } as unknown as PasswordHasherService;

  const refreshTokens = {
    revokeAllForUser: jest.fn(),
  } as unknown as RefreshTokenStore;

  const buildUser = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: "user_1",
    email: "user@example.com",
    passwordHash: "hashed-current-password",
    name: "Ada Lovelace",
    emailVerifiedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(prisma, passwordHasher, refreshTokens);
  });

  describe("updateProfile", () => {
    it("updates and returns the caller's own profile", async () => {
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
      });
    });

    it("throws UnauthorizedException when the user no longer exists", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.updateProfile("user_1", "New Name")).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
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

    it("throws UnauthorizedException when the user no longer exists", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.changePassword("user_1", "OldPassw0rd!", "N3wSup3r$ecretPassw0rd!"),
      ).rejects.toThrow(UnauthorizedException);
      expect(passwordHasher.verify).not.toHaveBeenCalled();
    });
  });

  describe("deleteAccount", () => {
    it("verifies the password, deletes the user row, and revokes every session", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(buildUser());
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
      expect(result).toEqual({ deleted: true });
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
