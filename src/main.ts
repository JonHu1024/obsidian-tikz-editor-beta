import { Plugin, MarkdownView, Notice } from "obsidian";
import type { Editor, TFile } from "obsidian";
import { DEFAULT_SETTINGS, TikZEditorSettingTab, type TikZEditorSettings } from "./settings";
import { TikZEditorModal } from "./TikZEditorModal";
import { editor } from "./EditorController";
import { generateTikZ } from "./core/TikZGenerator";
import { defaultGraph, makeId } from "./core/types";
import type { TikZGraph } from "./core/types";
import type { InsertNoteResult } from "./EditorController";
import { get } from "svelte/store";
import { parseFailed } from "./state";

export interface EditContext {
  blockStartLine: number;
  blockEndLine: number;
  code: string;
  file: TFile | null;
}

interface Draft {
  key: string;
  code: string;
  savedAt: number;
}

export default class TikZEditorPlugin extends Plugin {
  settings: TikZEditorSettings = DEFAULT_SETTINGS;
  private editContext: EditContext | null = null;
  private modal: TikZEditorModal | null = null;
  /** Generated code of the graph as it was when the current session loaded
   *  (canonical form). The Esc auto-save compares against this so it only
   *  writes when the user actually changed something, and a manual Insert
   *  rebases it to prevent a duplicate write on close. */
  sessionInitialCode = "";
  /** Unsaved editing sessions, keyed by "<file path>#<block start line>".
   *  Populated when the modal closes with un-inserted changes and offered
   *  back on the next open of the same block. */
  private drafts = new Map<string, Draft>();

  async onload(): Promise<void> {
    await this.loadSettings();
    editor.attach(this);
    // Notice bridge for modules that must not import "obsidian" directly
    // (the cd/Preact subtree is also unit-tested outside Obsidian).
    (window as unknown as { __teNotice?: (m: string, e: boolean) => void }).__teNotice =
      (msg: string, isError: boolean) => new Notice(msg, isError ? 8000 : 3000);

    this.addRibbonIcon("git-pull-request-create", "Open TikZ Editor", () => this.openEditor());

    this.addCommand({
      id: "open-tikz-editor",
      name: "Open TikZ Editor",
      callback: () => this.openEditor(),
    });

    this.addSettingTab(new TikZEditorSettingTab(this.app, this));
  }

  onunload(): void {
    // Close the modal if open: destroys the Svelte app (window key listeners)
    // and resets the stores. Also detach so stale calls cannot touch a dead
    // plugin instance after hot-reload.
    try {
      this.modal?.close();
    } catch (e) {
      console.error("TikZ Editor: close on unload failed", e);
    }
    this.modal = null;
    editor.attach(null);
    delete (window as unknown as { __teNotice?: unknown }).__teNotice;
    document.getElementById("te-katex-css")?.remove();
  }

  /** Remember an un-inserted session (called from the modal's onClose). */
  saveDraft(key: string, code: string): void {
    if (!key || !code.trim()) return;
    this.drafts.set(key, { key, code, savedAt: Date.now() });
    // keep the cache bounded — drafts are a convenience, not storage
    if (this.drafts.size > 20) {
      const oldest = [...this.drafts.values()].sort((a, b) => a.savedAt - b.savedAt)[0];
      if (oldest) this.drafts.delete(oldest.key);
    }
  }

  /** Save the CURRENT editing session as a draft when its model differs from
   *  the code it was opened from. Used by the modal's onClose AND when
   *  openEditor switches to another block while the editor is already open —
   *  otherwise that switch silently destroyed the ongoing edits. */
  stashSessionDraft(): void {
    try {
      const ctx = this.editContext;
      if (!ctx || !ctx.file) return;
      const cur = editor.getCurrentGraph();
      const code = cur ? generateTikZ(cur) : "";
      const key = ctx.file.path + "#" + ctx.blockStartLine;
      if (code && code.trim() !== ctx.code.trim()) {
        this.saveDraft(key, code);
      }
    } catch (e) {
      console.error("TikZ Editor: draft save failed", e);
    }
  }

  takeDraft(key: string): string | null {
    return this.drafts.get(key)?.code ?? null;
  }

  clearDraft(key: string): void {
    this.drafts.delete(key);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private getActiveMarkdownView(): MarkdownView | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView);
  }

  private findTikZBlock(editor: Editor): { start: number; end: number; code: string } | null {
    const cursorLine = editor.getCursor().line;
    const doc = editor.getValue();
    const lines = doc.split("\n");
    let inBlock = false;
    let start = -1;
    for (let i = 0; i <= lines.length; i++) {
      const l = lines[i] ?? "";
      if (!inBlock && /^```\s*tikz\s*$/.test(l)) {
        inBlock = true;
        start = i + 1;
        continue;
      }
      if (inBlock && /^```\s*$/.test(l)) {
        if (cursorLine >= start && cursorLine <= i) {
          const code = lines.slice(start, i).join("\n");
          return { start, end: i - 1, code };
        }
        inBlock = false;
        start = -1;
      }
    }
    if (inBlock && cursorLine >= start) {
      return { start, end: lines.length - 1, code: lines.slice(start).join("\n") };
    }
    return null;
  }

  onInserted(): void {
    this.modal?.close();
  }

  openEditor(): void {
    // Switching blocks while the editor is open: preserve the ongoing edits
    // as a draft BEFORE the context is replaced (same protection as Esc).
    if (this.modal?.isOpen()) {
      this.stashSessionDraft();
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const block = view ? this.findTikZBlock(view.editor) : null;
    if (block && view && view.file) {
      let code = block.code;
      const draftKey = view.file.path + "#" + block.start;
      const draft = this.takeDraft(draftKey);
      if (draft && draft.trim() !== block.code.trim()) {
        code = draft;
        new Notice("已恢复上次未写回的编辑草稿（Esc 退出会自动写回笔记；写回成功后草稿清除）。", 6000);
      }
      this.editContext = { blockStartLine: block.start, blockEndLine: block.end, code, file: view.file };
    } else {
      this.editContext = null;
    }

    if (!this.modal) {
      this.modal = new TikZEditorModal(this.app, this);
    }
    // Load the context into the stores BEFORE the modal mounts: the cd editor
    // reads the store at mount time, so opening it on the previous graph
    // produced stale content on consecutive opens.
    this.modal.loadFromContext(this.editContext);
    if (!this.modal.isOpen()) {
      this.modal.open();
    }
  }

  getEditContext(): EditContext | null {
    return this.editContext;
  }

  clearEditContext(): void {
    this.editContext = null;
  }

  createDefaultGraph(): TikZGraph {
    return defaultGraph(this.settings.defaultWidth, this.settings.defaultHeight, this.settings.defaultEnv);
  }

  async insertCodeBlockWithCode(code: string, opts: { cursorFallback?: boolean } = {}): Promise<InsertNoteResult> {
    const view = this.getActiveMarkdownView();
    if (!view || !view.file) {
      return { inserted: false, message: "No active markdown note - click on your note first" };
    }
    const ed = view.editor;
    const fullBlock = "```tikz\n" + code + "\n```";
    return this.replaceOrInsertBlock(view, ed, fullBlock, opts);
  }

  async insertCodeBlock(): Promise<InsertNoteResult> {
    const view = this.getActiveMarkdownView();
    if (!view || !view.file) {
      return { inserted: false, message: "No active markdown note - click on your note first" };
    }
    const ed = view.editor;
    // the generator sizes the picture to the content automatically
    const code = generateTikZ(editor.getCurrentGraph());
    const fullBlock = "```tikz\n" + code + "\n```";
    return this.replaceOrInsertBlock(view, ed, fullBlock);
  }

  private replaceOrInsertBlock(view: MarkdownView, ed: Editor, fullBlock: string, opts: { cursorFallback?: boolean } = {}): InsertNoteResult {
    // cursorFallback=false (auto-save on Esc) never inserts a duplicate block
    // at the cursor when the original block has moved — it reports failure so
    // the session can fall back to the draft instead.
    const cursorFallback = opts.cursorFallback ?? true;
    const ec = this.editContext;
    if (ec && view.file && ec.file && ec.file.path === view.file.path) {
      const { blockStartLine, blockEndLine } = ec;
      // Revalidate the cached line numbers: the note may have been edited
      // while the modal was open. The lines just OUTSIDE our range must be
      // the opening/closing fences, otherwise the coordinates are stale and
      // replacing would corrupt arbitrary note text.
      const lineAt = (n: number) => (n >= 0 && n < ed.lineCount() ? ed.getLine(n) : "");
      const fencesOk =
        /^\`\`\`/.test(lineAt(blockStartLine - 1).trim()) &&
        /\`\`\`\s*$/.test(lineAt(blockEndLine + 1).trim());
      if (get(parseFailed)) {
        new Notice(
          "原代码块解析失败，为保护笔记内容未做替换。\n" +
          "请在编辑器 Code 页修正代码（Ctrl+E → Ctrl+S）后再 Insert。",
          8000
        );
        return { inserted: false, message: "Blocked: original block failed to parse — fix via the Code tab first" };
      }
      if (fencesOk && blockStartLine <= ed.lineCount()) {
        const startPos = { line: blockStartLine - 1, ch: 0 };
        const endPos = { line: blockEndLine + 2, ch: 0 };
        ed.replaceRange(fullBlock, startPos, endPos);
        const code = fullBlock.split("\n").slice(1, -1).join("\n");
        this.editContext = {
          ...ec,
          blockStartLine,
          blockEndLine: blockStartLine + fullBlock.split("\n").length - 3,
          code,
        };
        // rebase the auto-save baseline so closing right after a manual
        // Insert does not write the same block a second time
        this.sessionInitialCode = code;
        this.clearDraft(view.file.path + "#" + blockStartLine);
        return { inserted: true, message: "TikZ code block updated in the note" };
      }
      if (!cursorFallback) {
        return {
          inserted: false,
          message: "Original code block has moved in the note — the edit was kept as a draft instead",
        };
      }
      if (!fencesOk) {
        new Notice("原代码块位置已变化（行号失效），已在光标处插入新块而非覆盖。", 6000);
      }
    }

    const cursor = ed.getCursor();
    const line = ed.getLine(cursor.line);
    const needsLeadingNewline = line.length > 0;
    ed.replaceRange((needsLeadingNewline ? "\n" : "") + fullBlock + "\n", { line: cursor.line, ch: line.length });
    this.sessionInitialCode = fullBlock.split("\n").slice(1, -1).join("\n");
    return { inserted: true, message: "TikZ code block inserted into the note" };
  }

  /** Auto-save on modal close (Esc / backdrop click): when the model changed
   *  since it was loaded, write the generated code back into the note.
   *  Never writes unsafely — falls back to the in-memory draft when there is
   *  no active note, another note became active, the original block moved,
   *  or the original block failed to parse. */
  async autoSaveOnClose(): Promise<void> {
    const cur = editor.getCurrentGraph();
    if (!cur) return;
    let code: string;
    try {
      code = generateTikZ(cur);
    } catch (e) {
      console.error("TikZ Editor: auto-save generation failed", e);
      return;
    }
    if (!code.trim() || code.trim() === this.sessionInitialCode.trim()) return; // nothing changed
    const view = this.getActiveMarkdownView();
    if (!view || !view.file) {
      this.stashSessionDraft();
      return;
    }
    const ctx = this.editContext;
    if (ctx?.file && ctx.file.path !== view.file.path) {
      // another note became active while the editor was open: never write
      // into the wrong note — keep the session as a draft instead
      this.stashSessionDraft();
      new Notice("当前活动笔记已不是打开编辑器的那篇，本次修改仅存为草稿（下次打开同一代码块可恢复）。", 6000);
      return;
    }
    const r = await this.insertCodeBlockWithCode(code, { cursorFallback: false });
    if (r.inserted) {
      new Notice("已自动写回笔记（Esc 退出自动保存）。", 2500);
    } else {
      this.stashSessionDraft();
      new Notice("Esc：未能自动写回原代码块，本次修改已存为草稿。", 5000);
    }
  }
}
