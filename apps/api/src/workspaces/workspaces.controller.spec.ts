import { Test, TestingModule } from "@nestjs/testing";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

describe("WorkspacesController", () => {
  let controller: WorkspacesController;
  const workspacesService = {
    create: jest.fn(),
    listForOwner: jest.fn(),
    getById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspacesController],
      providers: [{ provide: WorkspacesService, useValue: workspacesService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<WorkspacesController>(WorkspacesController);
  });

  it("create() delegates to WorkspacesService with the caller's own id and wraps the result", async () => {
    workspacesService.create.mockResolvedValue({
      id: "workspace_1",
      name: "Research",
      description: "Deep-dive projects",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await controller.create(
      { sub: "user_1", email: "user@example.com" },
      { name: "Research", description: "Deep-dive projects" },
    );

    expect(workspacesService.create).toHaveBeenCalledWith(
      "user_1",
      "Research",
      "Deep-dive projects",
    );
    expect(result).toEqual({
      success: true,
      data: {
        id: "workspace_1",
        name: "Research",
        description: "Deep-dive projects",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  it("list() delegates to WorkspacesService with the caller's own id and the parsed query", async () => {
    workspacesService.listForOwner.mockResolvedValue({ workspaces: [], nextCursor: null });

    const result = await controller.list({ sub: "user_1", email: "user@example.com" }, {
      limit: 10,
    });

    expect(workspacesService.listForOwner).toHaveBeenCalledWith("user_1", { limit: 10 });
    expect(result).toEqual({ success: true, data: { workspaces: [], nextCursor: null } });
  });

  it("getById() delegates to WorkspacesService with the caller's own id and the requested id", async () => {
    workspacesService.getById.mockResolvedValue({
      id: "workspace_1",
      name: "Research",
      description: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await controller.getById(
      { sub: "user_1", email: "user@example.com" },
      "workspace_1",
    );

    expect(workspacesService.getById).toHaveBeenCalledWith("user_1", "workspace_1");
    expect(result.success).toBe(true);
    expect(result.data.id).toBe("workspace_1");
  });
});
