import { describe, expect, it } from "vitest";
import {
  createWorkspaceRequestSchema,
  listWorkspacesQuerySchema,
  workspaceIdParamSchema,
} from "./workspaces";

describe("createWorkspaceRequestSchema", () => {
  it("accepts a valid payload, trimming name and description", () => {
    expect(
      createWorkspaceRequestSchema.parse({
        name: "  Research  ",
        description: "  Deep-dive projects  ",
      }),
    ).toEqual({ name: "Research", description: "Deep-dive projects" });
  });

  it("accepts a payload with no description", () => {
    expect(createWorkspaceRequestSchema.parse({ name: "Research" })).toEqual({
      name: "Research",
    });
  });

  it("rejects a missing name", () => {
    expect(() => createWorkspaceRequestSchema.parse({})).toThrow();
  });

  it("rejects a name that is empty after trimming", () => {
    expect(() => createWorkspaceRequestSchema.parse({ name: "   " })).toThrow();
  });

  it("rejects a name longer than 100 characters", () => {
    expect(() => createWorkspaceRequestSchema.parse({ name: "a".repeat(101) })).toThrow();
  });

  it("rejects a description longer than 500 characters", () => {
    expect(() =>
      createWorkspaceRequestSchema.parse({ name: "Research", description: "a".repeat(501) }),
    ).toThrow();
  });

  it("rejects unknown fields", () => {
    expect(() =>
      createWorkspaceRequestSchema.parse({ name: "Research", ownerId: "someone-else" }),
    ).toThrow();
  });
});

describe("listWorkspacesQuerySchema", () => {
  it("accepts an empty query, leaving limit/cursor undefined", () => {
    expect(listWorkspacesQuerySchema.parse({})).toEqual({});
  });

  it("coerces a string limit (as query params always arrive) to a number", () => {
    expect(listWorkspacesQuerySchema.parse({ limit: "10" })).toEqual({ limit: 10 });
  });

  it("accepts a cursor string", () => {
    expect(listWorkspacesQuerySchema.parse({ cursor: "opaque-cursor-value" })).toEqual({
      cursor: "opaque-cursor-value",
    });
  });

  it("rejects a limit above the safe maximum", () => {
    expect(() => listWorkspacesQuerySchema.parse({ limit: "51" })).toThrow();
  });

  it("rejects a limit below 1", () => {
    expect(() => listWorkspacesQuerySchema.parse({ limit: "0" })).toThrow();
  });

  it("rejects a non-numeric limit", () => {
    expect(() => listWorkspacesQuerySchema.parse({ limit: "not-a-number" })).toThrow();
  });

  it("rejects unknown query fields", () => {
    expect(() => listWorkspacesQuerySchema.parse({ sort: "oldest" })).toThrow();
  });
});

describe("workspaceIdParamSchema", () => {
  it("accepts a non-empty id", () => {
    expect(workspaceIdParamSchema.parse("workspace_1")).toBe("workspace_1");
  });

  it("rejects an empty id", () => {
    expect(() => workspaceIdParamSchema.parse("")).toThrow();
  });
});
