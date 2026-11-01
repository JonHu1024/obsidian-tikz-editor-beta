import { get } from "svelte/store";
import { editor } from "../EditorController";
import {
  vimMode, commandBuffer, selectedId, arrowFlow, colorPickerOpen, shapePickerOpen,
  activePanel, insertState, statusMessage, focusNodesSearch, arrowTipPickerOpen, helpOpen,
} from "../state";
import type { TikZObject } from "../core/types";
import { DEFAULT_KEYS, keyMatches } from "./keybindings";

export type Mode = "NORMAL" | "INSERT" | "ARROW_EDITING";

// Test hook: lets the harness override keybindings without a plugin instance.
const testKeybninds: Record<string, string> = {};

/** Test hook: adds keybinding overrides (mainly for `npm test`). */
export function setTestKeybinds(o: Record<string, string>): void {
  Object.assign(testKeybninds, o);
}

interface CommandDef {
  id: string;
  run: () => void;
  needsSelection?: boolean;
}

const DIRS: Record<string, { dx: number; dy: number }> = {
  "1": { dx: -1, dy: -1 }, "2": { dx: 0, dy: -1 }, "3": { dx: 1, dy: -1 },
  "4": { dx: -1, dy: 0 }, "6": { dx: 1, dy: 0 },
  "7": { dx: -1, dy: 1 }, "8": { dx: 0, dy: 1 }, "9": { dx: 1, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 }, ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: 1 }, ArrowDown: { dx: 0, dy: -1 },
};

export class VimController {
  private commands: CommandDef[] = [];
  private flowInsertMode = false;
  private pendingOP = false;

  constructor() {
    this.registerCommands();
  }

  /** Resolve the current key string for a binding id (settings override wins). */
  private kb(id: string): string {
    const s = editor.plugin?.settings?.keybinds;
    return testKeybninds[id] ?? s?.[id] ?? DEFAULT_KEYS[id] ?? "";
  }

  /** Single-key aliases of a binding (char keys fire instantly; named keys too). */
  private singleKeys(id: string): string[] {
    const out: string[] = [];
    for (const a of this.kb(id).split(",")) {
      const t = a.trim();
      if (t && (t.length === 1 || /^(Enter|Tab|Backspace|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(t))) out.push(t);
    }
    return out;
  }

  /** True when `e.key` is the first char of a multi-char sequence binding. */
  private seqStart(id: string, e: KeyboardEvent): boolean {
    for (const a of this.kb(id).split(",")) {
      const t = a.trim();
      if (t.length > 1 && t[0] === e.key) return true;
    }
    return false;
  }

  private registerCommands(): void {
    this.commands = [
      { id: "normal.undo", run: () => editor.undo() },
      { id: "normal.redo", run: () => editor.redo() },
      { id: "normal.edit", run: () => this.startInsertOnSelection(), needsSelection: true },
      { id: "normal.delete", run: () => editor.deleteSelected(), needsSelection: true },
      { id: "normal.color", run: () => this.openColorPicker(), needsSelection: true },
      { id: "normal.createText", run: () => editor.createText(false) },
      { id: "normal.createTextInsert", run: () => editor.createText(true) },
      { id: "normal.createShape", run: () => shapePickerOpen.set(true) },
      { id: "normal.createShapeInsert", run: () => this.shapeAndInsert() },
      { id: "normal.createArrow", run: () => editor.beginArrowFlow(false) },
      { id: "normal.createArrowInsert", run: () => editor.beginArrowFlow(true) },
      { id: "normal.createFunction", run: () => editor.createFunction() },
      { id: "normal.toggleEnv", run: () => editor.toggleEnv() },
      { id: "normal.insertNote", run: () => void editor.insertToNote() },
      { id: "normal.help", run: () => helpOpen.set(true) },
      { id: "normal.zoomToFit", run: () => editor.zoomToFit() },
    ];
  }

  private shapeAndInsert(): void {
    shapePickerOpen.set(true);
    (window as unknown as { __teInsertAfterShape?: boolean }).__teInsertAfterShape = true;
  }

  private startInsertOnSelection(): void {
    const sel = editor.getSelected();
    if (!sel) {
      statusMessage.set("Nothing selected");
      return;
    }
    editor.startInsert(sel.id, "text");
  }

  private openColorPicker(): void {
    if (!editor.getSelected()) {
      statusMessage.set("Nothing selected");
      return;
    }
    colorPickerOpen.set(true);
  }

  keydown(e: KeyboardEvent): void {
    if (e.isComposing) return;
    const mode = get(vimMode);

    // a color/shape/tip picker or the help overlay is open: it handles all
    // keys itself
    if (get(colorPickerOpen) || get(shapePickerOpen) || get(arrowTipPickerOpen) || get(helpOpen)) {
      return;
    }

    // Alt+E: one-key switch back to the editor / NORMAL MODE from anywhere
    // (exit INSERT, leave pickers/props, focus the canvas)
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "e" || e.key === "E")) {
      this.handled(e);
      if (get(insertState)) this.exitInsert();
      activePanel.set("preview");
      vimMode.set("NORMAL");
      statusMessage.set("NORMAL MODE");
      return;
    }

    // Alt replaces ESC for cancel/exit/deselect: pressing ESC in Obsidian
    // closes the modal, so it must never be consumed by the editor.
    // This runs before the INSERT-mode return so it always works,
    // even if the INSERT textarea lost focus.
    if (e.key === "Alt" && !e.ctrlKey && !e.metaKey) {
      const flow = get(arrowFlow);
      if (flow) {
        this.handled(e);
        editor.cancelArrowFlow();
        return;
      }
      if (get(insertState)) {
        this.handled(e);
        this.exitInsert();
        return;
      }
      const sel = editor.getSelected();
      if (mode === "ARROW_EDITING") {
        this.handled(e);
        vimMode.set("NORMAL");
        return;
      }
      if (sel) {
        this.handled(e);
        selectedId.set(null);
        return;
      }
      // nothing to do: let the event bubble
      return;
    }
    if (mode === "INSERT") return;
    if (get(activePanel) !== "preview") {
      const side = this.focusSide(e);
      if (side) {
        this.handled(e);
        activePanel.set(side);
        if (side === "preview") (document.activeElement as HTMLElement | null)?.blur();
      }
      return;
    }

    const target = e.target as HTMLElement;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
      const side = this.focusSide(e);
      if (side) {
        this.handled(e);
        activePanel.set(side);
        (document.activeElement as HTMLElement | null)?.blur();
      }
      return;
    }

    const side = this.focusSide(e);
    if (side) {
      this.handled(e);
      activePanel.set(side);
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      if ((e.key === "f" || e.key === "F") && !e.altKey) {
        this.handled(e);
        focusNodesSearch.update((n) => n + 1);
        return;
      }
      // Undo/redo honour the plugin's undoKey/redoKey settings (comma
      // separated aliases, default mod+z / mod+y). Ctrl+Shift+Z stays a
      // permanent redo alias; the shift guard keeps it from matching
      // mod+z as an undo.
      const s = editor.plugin?.settings;
      const undoKeys = (s?.undoKey ?? "mod+z").split(",").map((t) => t.trim()).filter(Boolean);
      const redoKeys = (s?.redoKey ?? "mod+y").split(",").map((t) => t.trim()).filter(Boolean);
      if (!e.shiftKey && undoKeys.some((k) => keyMatches(k, e))) {
        this.handled(e);
        editor.undo();
      } else if (redoKeys.some((k) => keyMatches(k, e)) || ((e.key === "z" || e.key === "Z") && e.shiftKey)) {
        this.handled(e);
        editor.redo();
      } else if (e.key === "-" || e.key === "_") {
        this.handled(e);
        editor.zoomBy(1 / 1.2);
      } else if (e.key === "=" || e.key === "+") {
        this.handled(e);
        editor.zoomBy(1.2);
      } else if (this.isArrowKey(e.key)) {
        this.handled(e);
        const amt = 1.2;
        const sel = editor.getSelected();
        if (sel && sel.type === "arrow") {
          editor.moveArrow(sel.id, DIRS[e.key].dx * amt, DIRS[e.key].dy * amt);
        } else {
          editor.moveSelected(DIRS[e.key].dx * amt, DIRS[e.key].dy * amt);
        }
      }
      return;
    }

    const flow = get(arrowFlow);

    if (flow?.kind === "dir") {
      if (DIRS[e.key]) {
        this.handled(e);
        editor.createArrow(DIRS[e.key], false);
      }
      return;
    }

    if (flow?.kind === "pick") {
      if (e.key === "n" || e.key === "N") {
        this.handled(e);
        editor.arrowFreeEndpoint();
        return;
      }
      if (e.key === "Enter") {
        this.handled(e);
        editor.confirmPick();
        return;
      }
      if (e.key === "Tab") {
        this.handled(e);
        editor.cycleSelection();
        return;
      }
      return;
    }

    // arrow-specific selection keys: arrow keys translate the whole arrow,
    // h/l shorten/lengthen it (works in NORMAL and ARROW EDITING)
    const selAny = editor.getSelected();
    if (selAny && selAny.type === "arrow") {
      if (this.isArrowKey(e.key)) {
        this.handled(e);
        editor.moveArrow(selAny.id, DIRS[e.key].dx * 0.2, DIRS[e.key].dy * 0.2);
        return;
      }
      if (e.key === "h" || e.key === "l") {
        this.handled(e);
        editor.resizeArrow(selAny.id, e.key === "l" ? 0.2 : -0.2);
        return;
      }
    }

    if (mode === "ARROW_EDITING") {
      if (this.seqStart("cdarrow.swap", e)) {
        this.handled(e);
        this.pendingOP = true;
        return;
      }
      if (this.pendingOP) {
        this.pendingOP = false;
        if (e.key === "p" || e.key === "P") {
          this.handled(e);
          const sel = editor.getSelected();
          if (sel && sel.type === "arrow") {
            editor.swapArrow(sel.id);
            statusMessage.set(`Arrow endpoints swapped (${this.kb("cdarrow.swap")})`);
          }
          return;
        }
        if (e.key === "k" || e.key === "K") {
          // "ok" — the leading o was consumed by the op-swap sequence guard,
          // so the insert-to-note command has to be completed here; otherwise
          // `ok` would be unreachable while an arrow is selected.
          this.handled(e);
          commandBuffer.set("");
          void editor.insertToNote();
          return;
        }
        // any other key: the pending op is abandoned and the key falls
        // through to the regular handling below
      }
      if (keyMatches(this.kb("cdarrow.tipPicker"), e)) {
        this.handled(e);
        const sel = editor.getSelected();
        if (sel && sel.type === "arrow") arrowTipPickerOpen.set(true);
        else statusMessage.set("Select an arrow first");
        return;
      }
      if (keyMatches(this.kb("cdarrow.rebindStart"), e)) {
        this.handled(e);
        editor.beginArrowFlow(true);
        return;
      }
      if (keyMatches(this.kb("cdarrow.rebindEnd"), e)) {
        this.handled(e);
        const sel = editor.getSelected();
        if (sel && sel.type === "arrow") {
          arrowFlow.set({ kind: "pick", target: "end", startId: null, startPoint: null, targetArrowId: sel.id });
          statusMessage.set("Pick arrow end: click / Tab+Enter / n, Alt=cancel");
        }
        return;
      }
    }

    // ---- NORMAL mode command buffer ----
    if (e.key === "Tab") {
      this.handled(e);
      editor.cycleSelection();
      return;
    }

    if (this.isArrowKey(e.key)) {
      const sel = editor.getSelected();
      if (!sel) return;
      this.handled(e);
      editor.moveSelected(DIRS[e.key].dx * 0.2, DIRS[e.key].dy * 0.2);
      return;
    }

    if (e.key === "Backspace") {
      const buf = get(commandBuffer);
      if (buf.length > 0) {
        this.handled(e);
        commandBuffer.set(buf.slice(0, -1));
      }
      return;
    }

    if (e.key === "Enter") {
      const buf = get(commandBuffer);
      if (buf.length > 0) {
        this.handled(e);
        this.executeBestMatch(buf);
        commandBuffer.set("");
      }
      return;
    }

    if (e.key.length === 1 && !e.altKey) {
      const buf = get(commandBuffer) + e.key;
      const matches = this.commands.filter((c) => this.kb(c.id).split(",").map((s) => s.trim()).filter(Boolean).some((a) => a.length > 0 && a[0] === buf[0] && a.startsWith(buf)));
      const exact = matches.find((c) => this.kb(c.id).split(",").map((s) => s.trim()).filter(Boolean).some((a) => a === buf));

      if (exact && matches.length === 1) {
        commandBuffer.set("");
        this.runCommand(exact);
        this.handled(e);
        return;
      }
      if (matches.length > 0) {
        commandBuffer.set(buf);
        this.handled(e);
        return;
      }
      // no match: reset and try single key
      if (buf.length > 1) {
        commandBuffer.set("");
        const retry = this.commands.filter((c) => this.kb(c.id).split(",").map((s) => s.trim()).filter(Boolean).some((a) => a === e.key));
        if (retry.length === 1) {
          this.runCommand(retry[0]);
          this.handled(e);
        }
        return;
      }
      commandBuffer.set("");
    }
  }

  private handled(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
  }

  private exitInsert(): void {
    insertState.set(null);
    vimMode.set("NORMAL");
  }

  private executeBestMatch(buf: string): void {
    const exact = this.commands.find((c) => this.kb(c.id).split(",").map((s) => s.trim()).filter(Boolean).some((a) => a === buf));
    if (exact) {
      this.runCommand(exact);
      return;
    }
    const single = this.commands.find((c) => this.kb(c.id).split(",").map((s) => s.trim()).filter(Boolean).some((a) => a === buf[0] && a.length === 1));
    if (single) this.runCommand(single);
  }

  private runCommand(c: CommandDef): void {
    if (c.needsSelection && !editor.getSelected()) {
      statusMessage.set("Nothing selected");
      return;
    }
    c.run();
  }

  private isFocusShortcut(e: KeyboardEvent): boolean {
    return this.focusSide(e) !== null;
  }

  /** Which panel the focus shortcut points at.
   *
   *  "focusLeft" is the CANVAS (the canvas is the left column) and
   *  "focusRight" is the PROPERTIES panel. The old implementation decided
   *  by the literal key ("h" -> props), which inverted both shortcuts:
   *  Ctrl+H (focus the canvas) switched to the properties and Ctrl+L
   *  switched back to the canvas. The binding is resolved from the
   *  settings instead, so a rebound key works too. */
  private focusSide(e: KeyboardEvent): "preview" | "props" | null {
    const s = editor.plugin?.settings;
    const left = s?.focusLeft ?? "mod+h";
    const right = s?.focusRight ?? "mod+l";
    if (keyMatches(left, e)) return "preview";
    if (keyMatches(right, e)) return "props";
    return null;
  }

  private isArrowKey(k: string): boolean {
    return k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight";
  }
}

export const vim = new VimController();
