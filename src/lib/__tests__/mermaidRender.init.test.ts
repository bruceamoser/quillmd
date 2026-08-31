// @vitest-environment jsdom
// Mermaid render service init contract (plan 11 task 11.2, issue #101):
// lazy import (mermaid loads only on the first render), initialize-once
// with strict security, re-init only when the theme changes, a unique
// render id per call, and an offscreen container that is always removed.
// mermaid is mocked so the logic is asserted deterministically; the real
// package is covered in mermaidRender.test.ts.
import { describe, expect, it, vi } from "vitest";

const mockInitialize = vi.fn((..._args: unknown[]) => {});
const mockRender = vi.fn(
  async (..._args: unknown[]): Promise<{ svg: string }> => ({
    svg: "<svg></svg>",
  }),
);

vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => mockInitialize(...args),
    render: (...args: unknown[]) => mockRender(...args),
  },
}));

// A fresh service module per test (its lazy-load + init caches are
// module-level); the mock functions persist and are cleared.
async function freshService(): Promise<typeof import("../mermaidRender")> {
  vi.resetModules();
  mockInitialize.mockClear();
  mockRender.mockClear();
  return import("../mermaidRender");
}

const SOURCE = "graph TD\n  A[Start] --> B[End]\n";

describe("lazy init (issue #101)", () => {
  it("imports and initializes mermaid only on the first render", async () => {
    const svc = await freshService();
    // Importing the service module alone must not touch mermaid.
    expect(mockInitialize).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();

    await svc.renderMermaid(SOURCE, "quill");
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledTimes(1);
  });

  it("initializes once with strict security and the mapped theme", async () => {
    const svc = await freshService();
    await svc.renderMermaid(SOURCE, "dark");
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockInitialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "dark",
    });
  });

  it("does not re-initialize while the theme is unchanged", async () => {
    const svc = await freshService();
    await svc.renderMermaid(SOURCE, "quill");
    await svc.renderMermaid(SOURCE, "quill");
    await svc.renderMermaid(SOURCE, "quill");
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledTimes(3);
  });

  it("re-initializes when the theme changes, staying strict", async () => {
    const svc = await freshService();
    await svc.renderMermaid(SOURCE, "quill");
    await svc.renderMermaid(SOURCE, "dark");
    await svc.renderMermaid(SOURCE, "high-contrast");
    expect(mockInitialize).toHaveBeenCalledTimes(2);
    for (const call of mockInitialize.mock.calls) {
      expect(call[0]).toMatchObject({ securityLevel: "strict" });
    }
    // quill -> default, then dark -> dark; high-contrast is already dark.
    expect(mockInitialize.mock.calls[0][0]).toMatchObject({ theme: "default" });
    expect(mockInitialize.mock.calls[1][0]).toMatchObject({ theme: "dark" });
  });
});

describe("render id + offscreen container (issue #101)", () => {
  it("passes a unique id per render call", async () => {
    const svc = await freshService();
    await svc.renderMermaid(SOURCE, "quill");
    await svc.renderMermaid(SOURCE, "quill");
    const ids = mockRender.mock.calls.map((c) => c[0] as string);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    // The id is namespaced so it cannot collide with document ids.
    expect(ids[0]).toMatch(/^quillmd-mermaid-\d+$/);
    expect(ids[1]).toMatch(/^quillmd-mermaid-\d+$/);
  });

  it("renders into an offscreen container that is removed afterwards", async () => {
    const svc = await freshService();
    await svc.renderMermaid(SOURCE, "quill");
    const container = mockRender.mock.calls[0][2] as HTMLElement;
    expect(container).toBeInstanceOf(HTMLDivElement);
    // Detached again once the render settles.
    expect(container.parentNode).toBeNull();
    // And never part of the visible document.
    expect(document.body.contains(container)).toBe(false);
  });

  it("removes the container even when the render fails", async () => {
    const svc = await freshService();
    const captured: { container: HTMLElement | null } = { container: null };
    mockRender.mockImplementationOnce(async (...args: unknown[]) => {
      captured.container = args[2] as HTMLElement;
      throw new Error("Parse error on line 1");
    });
    const result = await svc.renderMermaid(SOURCE, "quill");
    expect(result.svg).toBeNull();
    expect(result.error).toContain("Parse error");
    expect(captured.container).toBeInstanceOf(HTMLDivElement);
    expect(captured.container!.parentNode).toBeNull();
  });
});

describe("render/error API with a mocked renderer (issue #101)", () => {
  it("surfaces the render error message, never rejects", async () => {
    const svc = await freshService();
    mockRender.mockRejectedValueOnce(
      new Error("Parse error on line 3:\nfoo\n---^\ngot 'EOF'"),
    );
    const result = await svc.renderMermaid(SOURCE, "quill");
    expect(result.svg).toBeNull();
    expect(result.error).toContain("Parse error on line 3");
  });

  it("normalizes { str, hash } rejections to their message", async () => {
    const svc = await freshService();
    mockRender.mockRejectedValueOnce({ str: "Legacy error text", hash: {} });
    const result = await svc.renderMermaid(SOURCE, "quill");
    expect(result.svg).toBeNull();
    expect(result.error).toBe("Legacy error text");
  });
});
