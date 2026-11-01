import { Modal, Notice } from "obsidian";
import type { App as ObsidianApp } from "obsidian";
import type TikZEditorPlugin from "./main";
import type { EditContext } from "./main";
import App from "./components/App.svelte";
import { editor } from "./EditorController";
import { parseTikZ } from "./core/TikZParser";
import { generateTikZ } from "./core/TikZGenerator";
import { parseFailed } from "./state";

export class TikZEditorModal extends Modal {
  private appComponent: App | null = null;
  private openFlag = false;

  constructor(app: ObsidianApp, private plugin: TikZEditorPlugin) {
    super(app);
    this.modalEl.addClass("te-modal");
  }

  isOpen(): boolean {
    return this.openFlag;
  }

  onOpen(): void {
    this.openFlag = true;
    this.contentEl.empty();
    this.appComponent = new App({
      target: this.contentEl,
    });
  }

  onClose(): void {
    this.openFlag = false;
    // Esc auto-save: write un-inserted changes back to the note. The method
    // captures the graph synchronously before cleanup() and falls back to
    // the draft mechanism whenever writing is not safe (no/wrong active
    // note, original block moved, original block unparseable).
    void this.plugin.autoSaveOnClose();
    editor.cleanup();
    this.appComponent?.$destroy();
    this.appComponent = null;
  }

  loadFromContext(ctx: EditContext | null): void {
    if (ctx) {
      try {
        const g = parseTikZ(ctx.code, editor.getCurrentGraph());
        editor.loadGraph(g);
        parseFailed.set(false);
        // canonical baseline for the Esc auto-save comparison: a mere
        // open+close without edits must not rewrite the note. Generation
        // must never be able to blank the canvas here — fall back to the
        // raw block when it fails.
        try {
          this.plugin.sessionInitialCode = generateTikZ(g);
        } catch (e) {
          console.error("TikZ Editor: baseline generation failed", e);
          this.plugin.sessionInitialCode = ctx.code;
        }
        return;
      } catch (e) {
        console.error("TikZ Editor: failed to parse block", e);
        new Notice(
          "TikZ Editor: 无法解析该代码块，已打开空白画布。\n" +
          "原代码块受保护：Insert 不会覆盖它（可在 Code 页 Ctrl+E→Ctrl+S 修复后再插入）。\n" +
          String(e).slice(0, 160),
          8000
        );
      }
    }
    const blank = this.plugin.createDefaultGraph();
    editor.loadGraph(blank);
    this.plugin.sessionInitialCode = generateTikZ(blank);
    // only mark failure when there WAS something to parse; a fresh blank
    // template is not an error
    parseFailed.set(!!ctx && ctx.code.trim() !== "");
  }
}
