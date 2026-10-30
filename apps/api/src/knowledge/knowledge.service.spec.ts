import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { KnowledgeStorageService } from "./knowledge-storage.service";
import { KnowledgeService } from "./knowledge.service";

describe("KnowledgeService", () => {
  let service: KnowledgeService;
  let prisma: PrismaService;
  let workspaces: jest.Mocked<WorkspacesService>;
  let storage: jest.Mocked<KnowledgeStorageService>;

  const mockWorkspace = { id: "ws1", ownerId: "user1" };
  const mockFile = {
    id: "file1",
    workspaceId: "ws1",
    ownerId: "user1",
    originalName: "test.pdf",
    storageKey: "abc-123.pdf",
    mimeType: "application/pdf",
    fileSize: 1024,
    checksum: "abc123",
    status: "UPLOADED",
    chunkCount: null,
    failureReason: null,
    createdAt: new Date("2026-09-03T14:00:00Z"),
    updatedAt: new Date("2026-09-03T14:00:00Z"),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        {
          provide: PrismaService,
          useValue: {
            knowledgeFile: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: WorkspacesService,
          useValue: {
            getById: jest.fn(),
          },
        },
        {
          provide: KnowledgeStorageService,
          useValue: {
            save: jest.fn(),
            read: jest.fn(),
            delete: jest.fn(),
            sanitizeFilename: jest.fn((name) => name),
            markCommitted: jest.fn(),
            releasePending: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(KnowledgeService);
    prisma = module.get(PrismaService);
    workspaces = module.get(WorkspacesService) as jest.Mocked<WorkspacesService>;
    storage = module.get(KnowledgeStorageService) as jest.Mocked<KnowledgeStorageService>;
  });

  describe("upload", () => {
    it("uploads a file and creates a database record", async () => {
      workspaces.getById.mockResolvedValue(mockWorkspace as never);
      storage.save.mockResolvedValue({
        storageKey: "abc-123.pdf",
        checksum: "abc123",
        fileSize: 1024,
      });
      (prisma.knowledgeFile.create as jest.Mock).mockResolvedValue(mockFile);

      const result = await service.upload("user1", "ws1", {
        buffer: Buffer.from("test"),
        originalname: "test.pdf",
        mimetype: "application/pdf",
        size: 1024,
      });

      expect(workspaces.getById).toHaveBeenCalledWith("user1", "ws1");
      expect(storage.save).toHaveBeenCalled();
      expect(prisma.knowledgeFile.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: "ws1",
          ownerId: "user1",
          originalName: "test.pdf",
          storageKey: "abc-123.pdf",
          mimeType: "application/pdf",
          fileSize: 1024,
          checksum: "abc123",
          status: "UPLOADED",
        }),
      });
      expect(result.file.id).toBe("file1");
      expect(storage.markCommitted).toHaveBeenCalledWith("abc-123.pdf");
    });

    it("releases an uploaded blob for delayed cleanup when metadata persistence fails", async () => {
      workspaces.getById.mockResolvedValue(mockWorkspace as never);
      storage.save.mockResolvedValue({ storageKey: "abc-123.pdf", checksum: "abc123", fileSize: 4 });
      (prisma.knowledgeFile.create as jest.Mock).mockRejectedValue(new Error("database unavailable"));

      await expect(service.upload("user1", "ws1", {
        buffer: Buffer.from("test"), originalname: "test.pdf", mimetype: "application/pdf", size: 4,
      })).rejects.toThrow("database unavailable");
      expect(storage.releasePending).toHaveBeenCalledWith("abc-123.pdf");
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it("throws NotFoundException if workspace doesn't belong to user", async () => {
      workspaces.getById.mockRejectedValue(new NotFoundException());

      await expect(
        service.upload("user1", "ws1", {
          buffer: Buffer.from("test"),
          originalname: "test.pdf",
          mimetype: "application/pdf",
          size: 1024,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(storage.save).not.toHaveBeenCalled();
      expect(prisma.knowledgeFile.create).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("lists all files in a workspace", async () => {
      workspaces.getById.mockResolvedValue(mockWorkspace as never);
      (prisma.knowledgeFile.findMany as jest.Mock).mockResolvedValue([mockFile]);

      const result = await service.list("user1", "ws1");

      expect(workspaces.getById).toHaveBeenCalledWith("user1", "ws1");
      expect(prisma.knowledgeFile.findMany).toHaveBeenCalledWith({
        where: { workspaceId: "ws1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.id).toBe("file1");
    });

    it("throws NotFoundException if workspace doesn't belong to user", async () => {
      workspaces.getById.mockRejectedValue(new NotFoundException());

      await expect(service.list("user1", "ws1")).rejects.toThrow(NotFoundException);
      expect(prisma.knowledgeFile.findMany).not.toHaveBeenCalled();
    });
  });

  describe("getById", () => {
    it("returns a file if it belongs to the workspace", async () => {
      workspaces.getById.mockResolvedValue(mockWorkspace as never);
      (prisma.knowledgeFile.findUnique as jest.Mock).mockResolvedValue(mockFile);

      const result = await service.getById("user1", "ws1", "file1");

      expect(workspaces.getById).toHaveBeenCalledWith("user1", "ws1");
      expect(prisma.knowledgeFile.findUnique).toHaveBeenCalledWith({
        where: { id: "file1" },
      });
      expect(result.file.id).toBe("file1");
    });

    it("throws NotFoundException if file doesn't exist", async () => {
      workspaces.getById.mockResolvedValue(mockWorkspace as never);
      (prisma.knowledgeFile.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getById("user1", "ws1", "file1")).rejects.toMatchObject({
        response: { code: "KNOWLEDGE_FILE_NOT_FOUND" },
      });
    });

    it("throws NotFoundException if file belongs to different workspace (no enumeration)", async () => {
      workspaces.getById.mockResolvedValue(mockWorkspace as never);
      (prisma.knowledgeFile.findUnique as jest.Mock).mockResolvedValue({
        ...mockFile,
        workspaceId: "ws2",
      });

      await expect(service.getById("user1", "ws1", "file1")).rejects.toMatchObject({
        response: { code: "KNOWLEDGE_FILE_NOT_FOUND" },
      });
    });

    it("throws NotFoundException if workspace doesn't belong to user", async () => {
      workspaces.getById.mockRejectedValue(new NotFoundException());

      await expect(service.getById("user1", "ws1", "file1")).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.knowledgeFile.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("deletes a file and its storage", async () => {
      workspaces.getById.mockResolvedValue(mockWorkspace as never);
      (prisma.knowledgeFile.findUnique as jest.Mock).mockResolvedValue(mockFile);
      (prisma.knowledgeFile.delete as jest.Mock).mockResolvedValue(mockFile);
      storage.delete.mockResolvedValue(undefined);

      const result = await service.delete("user1", "ws1", "file1");

      expect(workspaces.getById).toHaveBeenCalledWith("user1", "ws1");
      expect(storage.delete).toHaveBeenCalledWith("abc-123.pdf");
      expect(prisma.knowledgeFile.delete).toHaveBeenCalledWith({ where: { id: "file1" } });
      expect((prisma.knowledgeFile.delete as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        (storage.delete as jest.Mock).mock.invocationCallOrder[0] as number,
      );
      expect(result.deleted).toBe(true);
    });

    it("throws NotFoundException if file doesn't exist", async () => {
      workspaces.getById.mockResolvedValue(mockWorkspace as never);
      (prisma.knowledgeFile.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.delete("user1", "ws1", "file1")).rejects.toMatchObject({
        response: { code: "KNOWLEDGE_FILE_NOT_FOUND" },
      });
      expect(storage.delete).not.toHaveBeenCalled();
      expect(prisma.knowledgeFile.delete).not.toHaveBeenCalled();
    });

    it("throws NotFoundException if file belongs to different workspace", async () => {
      workspaces.getById.mockResolvedValue(mockWorkspace as never);
      (prisma.knowledgeFile.findUnique as jest.Mock).mockResolvedValue({
        ...mockFile,
        workspaceId: "ws2",
      });

      await expect(service.delete("user1", "ws1", "file1")).rejects.toMatchObject({
        response: { code: "KNOWLEDGE_FILE_NOT_FOUND" },
      });
      expect(storage.delete).not.toHaveBeenCalled();
      expect(prisma.knowledgeFile.delete).not.toHaveBeenCalled();
    });
  });

  describe("readFile", () => {
    it("reads a file's content", async () => {
      const buffer = Buffer.from("test content");
      workspaces.getById.mockResolvedValue(mockWorkspace as never);
      (prisma.knowledgeFile.findUnique as jest.Mock).mockResolvedValue(mockFile);
      storage.read.mockResolvedValue(buffer);

      const result = await service.readFile("user1", "ws1", "file1");

      expect(storage.read).toHaveBeenCalledWith("abc-123.pdf");
      expect(result.buffer.equals(buffer)).toBe(true);
      expect(result.originalName).toBe("test.pdf");
      expect(result.mimeType).toBe("application/pdf");
    });

    it("throws NotFoundException if file doesn't exist", async () => {
      workspaces.getById.mockResolvedValue(mockWorkspace as never);
      (prisma.knowledgeFile.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.readFile("user1", "ws1", "file1")).rejects.toMatchObject({
        response: { code: "KNOWLEDGE_FILE_NOT_FOUND" },
      });
      expect(storage.read).not.toHaveBeenCalled();
    });

    it("throws NotFoundException if file belongs to different workspace", async () => {
      workspaces.getById.mockResolvedValue(mockWorkspace as never);
      (prisma.knowledgeFile.findUnique as jest.Mock).mockResolvedValue({
        ...mockFile,
        workspaceId: "ws2",
      });

      await expect(service.readFile("user1", "ws1", "file1")).rejects.toMatchObject({
        response: { code: "KNOWLEDGE_FILE_NOT_FOUND" },
      });
      expect(storage.read).not.toHaveBeenCalled();
    });
  });
});
