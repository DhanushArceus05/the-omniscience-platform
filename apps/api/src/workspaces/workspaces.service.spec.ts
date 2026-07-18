import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "./workspaces.service";

describe("WorkspacesService", () => {
  const prisma = {
    workspace: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  } as unknown as PrismaService;

  const buildWorkspace = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: "workspace_1",
    name: "Research",
    description: null,
    ownerId: "user_1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  });

  let service: WorkspacesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorkspacesService(prisma);
  });

  describe("create", () => {
    it("creates a workspace owned by the caller and returns it", async () => {
      (prisma.workspace.create as jest.Mock).mockResolvedValue(buildWorkspace());

      const result = await service.create("user_1", "Research", "Deep-dive projects");

      expect(prisma.workspace.create).toHaveBeenCalledWith({
        data: { ownerId: "user_1", name: "Research", description: "Deep-dive projects" },
      });
      expect(result).toEqual({
        id: "workspace_1",
        name: "Research",
        description: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    it("stores a null description when none is given", async () => {
      (prisma.workspace.create as jest.Mock).mockResolvedValue(buildWorkspace());

      await service.create("user_1", "Research");

      expect(prisma.workspace.create).toHaveBeenCalledWith({
        data: { ownerId: "user_1", name: "Research", description: null },
      });
    });
  });

  describe("listForOwner", () => {
    it("scopes the query to the caller's own workspaces, newest-first, with a bounded take", async () => {
      (prisma.workspace.findMany as jest.Mock).mockResolvedValue([buildWorkspace()]);

      const result = await service.listForOwner("user_1", {});

      expect(prisma.workspace.findMany).toHaveBeenCalledWith({
        where: { ownerId: "user_1" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 21, // default limit (20) + 1, to detect a next page
      });
      expect(result.workspaces).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it("honors an explicit limit and reports a nextCursor when there are more rows", async () => {
      const rows = [
        buildWorkspace({ id: "workspace_2", createdAt: new Date("2026-01-02T00:00:00.000Z") }),
        buildWorkspace({ id: "workspace_1", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
      ];
      (prisma.workspace.findMany as jest.Mock).mockResolvedValue(rows);

      const result = await service.listForOwner("user_1", { limit: 1 });

      expect(prisma.workspace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: "user_1" }, take: 2 }),
      );
      expect(result.workspaces).toHaveLength(1);
      expect(result.workspaces[0]?.id).toBe("workspace_2");
      expect(result.nextCursor).not.toBeNull();
    });

    it("decodes a cursor into a keyset WHERE clause scoped to the caller", async () => {
      (prisma.workspace.findMany as jest.Mock).mockResolvedValue([]);
      const cursor = Buffer.from(
        JSON.stringify({ createdAt: "2026-01-01T00:00:00.000Z", id: "workspace_1" }),
        "utf8",
      ).toString("base64url");

      await service.listForOwner("user_1", { cursor });

      expect(prisma.workspace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ownerId: "user_1",
            OR: [
              { createdAt: { lt: new Date("2026-01-01T00:00:00.000Z") } },
              { createdAt: new Date("2026-01-01T00:00:00.000Z"), id: { lt: "workspace_1" } },
            ],
          },
        }),
      );
    });

    it("rejects a malformed cursor with a 400, never reaching Prisma", async () => {
      await expect(service.listForOwner("user_1", { cursor: "not-base64-json" })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.workspace.findMany).not.toHaveBeenCalled();
    });
  });

  describe("getById", () => {
    it("returns the caller's own workspace", async () => {
      (prisma.workspace.findUnique as jest.Mock).mockResolvedValue(buildWorkspace());

      const result = await service.getById("user_1", "workspace_1");

      expect(prisma.workspace.findUnique).toHaveBeenCalledWith({ where: { id: "workspace_1" } });
      expect(result.id).toBe("workspace_1");
    });

    it("throws WORKSPACE_NOT_FOUND for a nonexistent id", async () => {
      (prisma.workspace.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getById("user_1", "does-not-exist")).rejects.toMatchObject({
        response: { code: "WORKSPACE_NOT_FOUND" },
      });
    });

    it("throws the identical WORKSPACE_NOT_FOUND for another owner's workspace", async () => {
      (prisma.workspace.findUnique as jest.Mock).mockResolvedValue(
        buildWorkspace({ ownerId: "someone-else" }),
      );

      await expect(service.getById("user_1", "workspace_1")).rejects.toMatchObject({
        response: { code: "WORKSPACE_NOT_FOUND" },
      });
    });

    it("throws NotFoundException as the exception type in both cases", async () => {
      (prisma.workspace.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getById("user_1", "does-not-exist")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
