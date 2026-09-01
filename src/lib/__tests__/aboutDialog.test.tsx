// @vitest-environment jsdom
// About QuillMD (plan 10 task 10.4, issue #96): the dialog component (real
// version + build hash + pandoc/typst sidecar versions + GitHub/docs links,
// the disabled "Check for updates" with its manual-releases tooltip, and the
// keyboard model), the Tools > Clear Formatting menu item (plan §2.3: moved
// to Tools, kept in Format) + its App dispatch, and the Help > About QuillMD
// routing with the values read from Rust (e2e through the mock IPC).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import App from "../../App";
import AboutDialog, { GITHUB_URL, type SidecarVersions } from "../../components/AboutDialog";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("menu.rs Tools > Clear Formatting (issue #96)", () => {
  it("offers Clear Formatting in the Tools menu (plan §2.3 order)", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    expect(src).toContain(
      'MenuItem::with_id(app, "tools-clear-formatting", "Clear Formatting", true, None::<&str>)'
    );
    expect(src).toContain('SubmenuBuilder::new(app, "Tools")');
    expect(src).toContain(".item(&clear_formatting)");
  });

  it("keeps Format > Clear Formatting (plan §2.3: moved to Tools, kept in Format)", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    expect(src).toContain(
      'MenuItem::with_id(app, "format-clear", "Clear Formatting", true, None::<&str>)'
    );
  });

  it("keeps Help > About QuillMD", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    expect(src).toContain(
      'MenuItem::with_id(app, "help-about", "About QuillMD", true, None::<&str>)'
    );
    expect(src).toContain('SubmenuBuilder::new(app, "Help")');
  });
});

describe("App.tsx dispatch wiring (issue #96)", () => {
  it("routes tools-clear-formatting to the clearFormatting registry command", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('"tools-clear-formatting": "clearFormatting"');
    // format-clear keeps the same command (both menu ids dispatch it).
    expect(app).toContain('"format-clear": "clearFormatting"');
  });

  it("routes help-about to the About dialog and reads the sidecar versions", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('id === "help-about"');
    expect(app).toContain("setAboutDialogOpen(true)");
    expect(app).toContain('invoke<SidecarVersions>("get_sidecar_versions")');
    expect(app).toContain("build_hash");
    // The old one-line alert is gone.
    expect(app).not.toContain("window.alert(\"QuillMD - a WYSIWYG Markdown editor");
  });
});

describe("AboutDialog component (issue #96)", () => {
  interface Harness {
    container: HTMLDivElement;
    onClose: ReturnType<typeof vi.fn>;
    row: (label: string) => string;
    button: (text: string) => HTMLButtonElement;
    link: (label: string) => HTMLAnchorElement;
  }

  let roots: Root[] = [];

  function renderDialog(
    version: string | null,
    buildHash: string | null,
    sidecars: SidecarVersions | null,
  ): Harness {
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(
        <AboutDialog version={version} buildHash={buildHash} sidecars={sidecars} onClose={onClose} />,
      );
    });
    const dialog = container.querySelector(".quillmd-about-dialog")!;
    const labelEl = (label: string) =>
      Array.from(dialog.querySelectorAll(".quillmd-about-label")).find(
        (l) => l.textContent === label,
      );
    return {
      container,
      onClose,
      row: (label) =>
        labelEl(label)!.parentElement!.querySelector(".quillmd-about-value")!.textContent!,
      button: (text) =>
        Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
          (b) => b.textContent === text,
        )!,
      link: (label) =>
        labelEl(label)!.parentElement!.querySelector(".quillmd-about-value a")!,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    roots = [];
  });
  afterEach(() => {
    for (const r of roots) act(() => r.unmount());
    roots = [];
    vi.restoreAllMocks();
  });

  it("shows the version, build hash, and sidecar versions (AC6)", () => {
    const h = renderDialog("0.10.2", "444b672", {
      pandoc: "pandoc 3.6.4",
      typst: "typst 0.13.0",
    });
    expect(h.container.querySelector(".quillmd-about-title")!.textContent).toBe("About QuillMD");
    expect(h.row("Version")).toBe("0.10.2");
    expect(h.row("Build")).toBe("444b672");
    expect(h.row("Pandoc")).toBe("pandoc 3.6.4");
    expect(h.row("Typst")).toBe("typst 0.13.0");
  });

  it("shows 'not found' for a missing sidecar", () => {
    const h = renderDialog("0.10.2", "unknown", { pandoc: "pandoc 3.6.4", typst: null });
    expect(h.row("Pandoc")).toBe("pandoc 3.6.4");
    expect(h.row("Typst")).toBe("not found");
  });

  it("shows placeholders while the info is still loading (browser dev)", () => {
    const h = renderDialog(null, null, null);
    expect(h.row("Version")).toBe("…");
    expect(h.row("Build")).toBe("…");
    expect(h.row("Pandoc")).toBe("…");
    expect(h.row("Typst")).toBe("…");
  });

  it("links GitHub and Docs to the project (plan §2.5)", () => {
    const h = renderDialog("0.10.2", "444b672", { pandoc: null, typst: null });
    expect(h.link("GitHub").getAttribute("href")).toBe(GITHUB_URL);
    expect(h.link("Docs").getAttribute("href")).toBe(GITHUB_URL);
    expect(GITHUB_URL).toContain("github.com/bruceamoser/quillmd");
  });

  it("disables Check for Updates with the manual-releases tooltip (plan §2.5)", () => {
    const h = renderDialog("0.10.2", "444b672", { pandoc: null, typst: null });
    const updates = h.button("Check for Updates");
    expect(updates.disabled).toBe(true);
    expect(updates.getAttribute("title")).toBe("Manual releases on GitHub");
  });

  it("autofocuses the Close button; Enter closes", () => {
    const h = renderDialog("0.10.2", "444b672", { pandoc: null, typst: null });
    expect(document.activeElement).toBe(h.button("Close"));
    act(() => {
      h.container
        .querySelector(".quillmd-about-dialog")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels on Esc", () => {
    const h = renderDialog("0.10.2", "444b672", { pandoc: null, typst: null });
    act(() => {
      h.container
        .querySelector(".quillmd-about-dialog")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("a backdrop press closes; a press inside the dialog does not", () => {
    const h = renderDialog("0.10.2", "444b672", { pandoc: null, typst: null });
    act(() => {
      h.container
        .querySelector(".quillmd-about-overlay")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);

    const h2 = renderDialog("0.10.2", "444b672", { pandoc: null, typst: null });
    act(() => {
      h2.container
        .querySelector(".quillmd-about-dialog")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h2.onClose).not.toHaveBeenCalled();
  });
});

describe("App menu-event e2e: Help > About QuillMD (issue #96)", () => {
  const g = globalThis as Record<string, unknown>;
  let container: HTMLDivElement;
  let root: Root | null = null;

  const APP_INFO = {
    version: "0.10.2",
    build_hash: "444b672",
    config_dir: "/home/user/.config/quillmd",
  };
  const SIDECARS = { pandoc: "pandoc 3.6.4", typst: "typst 0.13.0" };

  beforeEach(() => {
    localStorage.clear();
    g.isTauri = true;
    mockIPC(
      (cmd) => {
        if (cmd === "get_recent_files") return [];
        if (cmd === "get_app_info") return APP_INFO;
        if (cmd === "get_sidecar_versions") return SIDECARS;
        return undefined;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Unmount before clearMocks: the App's effect cleanup unlistens through
    // the event-plugin internals the mock installed.
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    clearMocks();
    delete g.isTauri;
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderApp(): Promise<void> {
    const r = createRoot(container);
    root = r;
    await act(async () => {
      r.render(<App />);
    });
  }

  async function emitMenu(id: string): Promise<void> {
    await act(async () => {
      await emit("menu-event", id);
    });
  }

  async function waitFor(cond: () => boolean, what: string): Promise<void> {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > 4000) throw new Error(`timeout waiting for ${what}`);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
  }

  function dialog(): HTMLDivElement {
    const el = container.querySelector<HTMLDivElement>(".quillmd-about-dialog");
    expect(el, "about dialog").not.toBeNull();
    return el!;
  }

  function rowValue(label: string): string {
    const labelEl = Array.from(dialog().querySelectorAll(".quillmd-about-label")).find(
      (l) => l.textContent === label,
    );
    expect(labelEl, `row ${label}`).not.toBeNull();
    return labelEl!.parentElement!.querySelector(".quillmd-about-value")!.textContent!;
  }

  it("the menu opens the dialog with the Rust-provided version + sidecars (AC6)", async () => {
    await renderApp();
    await emitMenu("help-about");
    // The mount-time get_app_info / get_sidecar_versions invokes settle
    // asynchronously; wait for the values before asserting.
    await waitFor(() => rowValue("Version") === "0.10.2", "version row");
    expect(rowValue("Version")).toBe("0.10.2");
    expect(rowValue("Build")).toBe("444b672");
    expect(rowValue("Pandoc")).toBe("pandoc 3.6.4");
    expect(rowValue("Typst")).toBe("typst 0.13.0");
    // The disabled update check is present with its tooltip.
    const updates = Array.from(dialog().querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Check for Updates",
    )!;
    expect(updates.disabled).toBe(true);
    expect(updates.getAttribute("title")).toBe("Manual releases on GitHub");
  });

  it("Esc closes the dialog", async () => {
    await renderApp();
    await emitMenu("help-about");
    expect(dialog()).not.toBeNull();
    await act(async () => {
      dialog().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(container.querySelector(".quillmd-about-dialog")).toBeNull();
  });
});
