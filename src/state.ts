import { writable } from "svelte/store";
import type { TikZGraph } from "./core/types";
import { defaultGraph } from "./core/types";

export type VimMode = "NORMAL" | "INSERT" | "ARROW_EDITING";
/** Sections of the properties panel. Keep in sync with the NAV list in
 *  PropertiesPanel.svelte — "arrow" and "nodes" were missing, which forced
 *  the panel to cast ids through `as never`. */
export type SectionId =
  | "graph"
  | "axis"
  | "grid"
  | "functions"
  | "arrow"
  | "reference"
  | "nodes"
  | "code";
export type PanelId = "preview" | "props";

export type ArrowFlowPhase =
  | { kind: "dir" }
  | {
      kind: "pick";
      target: "start" | "end";
      startId: string | null;
      startPoint: { x: number; y: number } | null;
      targetArrowId: string | null;
    };

export interface InsertState {
  id: string;
  field: "text" | "textBelow" | "expression";
  /** Incremented every time the editor is OPENED for an object. It lets the
   *  overlay tell "the user opened the label for editing" (place the caret
   *  inside the $...$ pair) from "the user switched to the other label box"
   *  (keep the caret where it was clicked). */
  session: number;
}

export interface CanvasInfo {
  ptPerCm: number;
  zoom: number;
  panX: number;
  panY: number;
  scrollX: number;
  scrollY: number;
  /** content extent in cm (auto-grown "infinite" canvas) */
  contentMinX: number;
  contentMinY: number;
  contentMaxX: number;
  contentMaxY: number;
}

export const graph = writable<TikZGraph>(defaultGraph());
/** Bumped by editor.loadGraph() — used as a Svelte {#key} so the cd editor
 *  (Preact) remounts from the store whenever the plugin is re-opened on a
 *  different code block (fixes stale-content-on-reopen). */
export const graphVersion = writable(0);
/** Command sequence being typed in the cd (Preact) editor (ok/cp/dd or the
 *  arrow-style sequences dt/ds/op/...); shown in the status bar like the
 *  picture-mode vim command buffer. */
export const cdCommandBuffer = writable("");
export const selectedId = writable<string | null>(null);
export const vimMode = writable<VimMode>("NORMAL");
export const commandBuffer = writable("");
export const activeTab = writable<"props" | "code">("props");
export const activeSection = writable<SectionId>("graph");
export const activePanel = writable<PanelId>("preview");
export const renderError = writable<string | null>(null);
/** True when the last loadFromContext failed to parse the note's block and a
 *  blank graph was loaded instead. While set, replacing the original code
 *  block is blocked so a broken parse can never destroy note content. */
export const parseFailed = writable(false);
export const arrowFlow = writable<ArrowFlowPhase | null>(null);
export const insertState = writable<InsertState | null>(null);
export const colorPickerOpen = writable(false);
export const shapePickerOpen = writable(false);
export const arrowTipPickerOpen = writable(false);
/** Keyboard shortcut cheat-sheet overlay (? / toolbar button). */
export const helpOpen = writable(false);
export const statusMessage = writable("");
export const canvasInfo = writable<CanvasInfo>({ ptPerCm: 28.3465, zoom: 1.5, panX: 40, panY: 40, scrollX: 0, scrollY: 0, contentMinX: 0, contentMinY: 0, contentMaxX: 10, contentMaxY: 8 });
export const focusNodesSearch = writable(0);
export const CANVAS_MARGIN = 1.5; // cm of padding around the content
