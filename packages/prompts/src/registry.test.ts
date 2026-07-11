import { describe, expect, it } from "vitest";
import { PromptRegistry } from "./registry";

function makeTemplate(id: string, version = "1.0.0") {
  return {
    id,
    version,
    description: "test template",
    render: (vars: Record<string, string>) => `hello ${vars["name"] ?? "world"}`,
  };
}

describe("PromptRegistry", () => {
  it("registers and retrieves a template", () => {
    const registry = new PromptRegistry();
    registry.register(makeTemplate("greeting"));
    const template = registry.get("greeting", "1.0.0");
    expect(template.render({ name: "Dhanush" })).toBe("hello Dhanush");
  });

  it("throws when registering a duplicate id+version", () => {
    const registry = new PromptRegistry();
    registry.register(makeTemplate("greeting"));
    expect(() => registry.register(makeTemplate("greeting"))).toThrow(/already registered/);
  });

  it("throws when retrieving an unknown template", () => {
    const registry = new PromptRegistry();
    expect(() => registry.get("missing", "1.0.0")).toThrow(/not found/);
  });

  it("lists all registered templates", () => {
    const registry = new PromptRegistry();
    registry.register(makeTemplate("a"));
    registry.register(makeTemplate("b"));
    expect(registry.list()).toHaveLength(2);
  });
});
