import { get } from "svelte/store";
import { graph, selectedId, vimMode, activeTab, activeSection, activePanel, arrowFlow, insertState, statusMessage, renderError, commandBuffer, colorPickerOpen, shapePickerOpen, arrowTipPickerOpen, helpOpen, canvasInfo, graphVersion } from "./state";
import type { TikZGraph, TikZObject, ArrowObject } from "./core/types";
import { makeId, cloneGraph, objectBounds, exactObjectBounds, textAutoWidth } from "./core/types";
import type { Bounds } from "./core/types";
import { HistoryManager } from "./core/HistoryManager";
import { generateTikZ } from "./core/TikZGenerator";
import { localToCm } from "./utils/geometry";
import type TikZEditorPlugin from "./main";

export interface InsertNoteResult {
  inserted: boolean;
  message: string;
}

export class EditorController {
  history: HistoryManager | null = null;
  plugin: TikZEditorPlugin | null = null;
  private lastMergeCommit = 0;
  /** counter for INSERT editing sessions (see startInsert) */
  private insertSession = 0;

  attach(plugin: TikZEditorPlugin | null): void {
    this.plugin = plugin;
  }

  /** Replace the whole model (used by the Code tab's Run): resets undo
   *  history to the parsed graph so a later Ctrl+Z cannot silently revert
   *  to a pre-Run state, and drops selections pointing at removed objects. */
  replaceGraph(g: TikZGraph): void {
    this.history = new HistoryManager(cloneGraph(g));
    graph.set(g);
    graphVersion.update((n) => n + 1);
    const sel = get(selectedId);
    if (sel && !g.objects.some((o) => o.id === sel)) selectedId.set(null);
    vimMode.set("NORMAL");
    insertState.set(null);
    arrowFlow.set(null);
  }

  loadGraph(g: TikZGraph): void {
    this.history = new HistoryManager(g);
    graph.set(cloneGraph(g));
    graphVersion.update((n) => n + 1);
    selectedId.set(null);
    vimMode.set("NORMAL");
    activeTab.set("props");
    activeSection.set("graph");
    activePanel.set("preview");
    renderError.set(null);
    insertState.set(null);
    arrowFlow.set(null);
    commandBuffer.set("");
    statusMessage.set("");
    canvasInfo.update((c) => ({
      ...c,
      zoom: this.plugin?.settings.defaultZoom ?? 1.5,
      panX: 40,
      panY: 40,
    }));
  }

  /** Content extent in cm (min canvas = the graph area). */
  computeContentExtent(gg: TikZGraph): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = 0;
    let minY = 0;
    let maxX = gg.width;
    let maxY = gg.height;
    for (const o of gg.objects) {
      const b = exactObjectBounds(o);
      minX = Math.min(minX, b.left);
      maxX = Math.max(maxX, b.right);
      minY = Math.min(minY, b.bottom);
      maxY = Math.max(maxY, b.top);
    }
    return { minX, minY, maxX, maxY };
  }

  /** Content extent for the CURRENT graph, stored into canvasInfo (infinite canvas). */
  refreshCanvasExtent(): void {
    const g = get(graph);
    const e = this.computeContentExtent(g);
    canvasInfo.update((c) => ({
      ...c,
      contentMinX: e.minX,
      contentMinY: e.minY,
      contentMaxX: e.maxX,
      contentMaxY: e.maxY,
    }));
  }

  mutate(fn: (g: TikZGraph) => void, merge = false): void {
    const g = cloneGraph(get(graph));
    fn(g);
    graph.set(g);
    if (!merge) {
      // Discrete operations are always recorded. The write also resets the
      // merge window so a following merge=true call cannot piggyback on an
      // unrelated push made just before it.
      this.history?.push(g);
      this.lastMergeCommit = 0;
      return;
    }
    const now = Date.now();
    if (now - this.lastMergeCommit >= 500) {
      this.history?.push(g);
      this.lastMergeCommit = now;
    }
  }

  select(id: string | null): void {
    selectedId.set(id);
  }

  /** Select an object and pan the canvas so it is centered. */
  selectAndCenter(id: string): void {
    const o = get(graph).objects.find((x) => x.id === id);
    if (!o) return;
    selectedId.set(id);
    this.syncArrowMode(o);
    if (o.type === "arrow") {
      const cx = (o.x1 + o.x2) / 2;
      const cy = (o.y1 + o.y2) / 2;
      this.centerOnCm(cx, cy);
    } else {
      this.centerOnCm(o.x, o.y);
    }
  }

  centerOnCm(cx: number, cy: number): void {
    const info = get(canvasInfo);
    const viewport = document.querySelector(".te-viewport");
    const vw = viewport ? viewport.clientWidth : 800;
    const vh = viewport ? viewport.clientHeight : 600;
    const lx = (cx - info.contentMinX + 1.5) * info.ptPerCm;
    const ly = (info.contentMaxY + 1.5 - cy) * info.ptPerCm;
    // panX/panY are offsets INSIDE the scrolled content, so the viewport
    // centre sits at content offset scrollX + vw/2. Without the scroll
    // term the target landed outside the visible band as soon as the user
    // had scrolled the canvas.
    canvasInfo.update((c) => ({
      ...c,
      panX: c.scrollX + vw / 2 - lx * c.zoom,
      panY: c.scrollY + vh / 2 - ly * c.zoom,
    }));
  }

  /** Center of the visible viewport in cm (where new nodes are created). */
  screenCenterCm(): { x: number; y: number } {
    const info = get(canvasInfo);
    const g = get(graph);
    const viewport = document.querySelector(".te-viewport");
    const vw = viewport ? viewport.clientWidth : 800;
    const vh = viewport ? viewport.clientHeight : 600;
    const lx = (info.scrollX + vw / 2 - info.panX) / info.zoom;
    const ly = (info.scrollY + vh / 2 - info.panY) / info.zoom;
    return localToCm(lx, ly, g.height, info);
  }

  /** Zoom the canvas around the viewport center (Ctrl +/-). */
  zoomBy(factor: number): void {
    const info = get(canvasInfo);
    const viewport = document.querySelector(".te-viewport");
    const vw = viewport ? viewport.clientWidth : 800;
    const vh = viewport ? viewport.clientHeight : 600;
    this.zoomAt(vw / 2, vh / 2, factor);
  }

  /** Zoom around a viewport point (mouse position for wheel zoom). */
  zoomAt(mx: number, my: number, factor: number): void {
    const info = get(canvasInfo);
    const nz = Math.min(8, Math.max(0.3, info.zoom * factor));
    canvasInfo.update((c) => {
      const k = nz / c.zoom;
      return {
        ...c,
        zoom: nz,
        panX: mx - (mx - c.panX) * k,
        panY: my - (my - c.panY) * k,
      };
    });
  }

  /** Pan minimally so the selected object stays inside the viewport. */
  ensureVisible(id: string | null): void {
    if (!id) return;
    const o = get(graph).objects.find((x) => x.id === id);
    if (!o) return;
    const info = get(canvasInfo);
    const viewport = document.querySelector(".te-viewport");
    if (!viewport) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const b = exactObjectBounds(o);
    const lx1 = (b.left - info.contentMinX + 1.5) * info.ptPerCm;
    const lx2 = (b.right - info.contentMinX + 1.5) * info.ptPerCm;
    const ly1 = (info.contentMaxY + 1.5 - b.top) * info.ptPerCm;
    const ly2 = (info.contentMaxY + 1.5 - b.bottom) * info.ptPerCm;
    const m = 30;
    let dx = 0;
    let dy = 0;
    // panX/panY are content offsets: the visible band starts at scrollX
    const sx1 = info.panX + lx1 * info.zoom;
    const sx2 = info.panX + lx2 * info.zoom;
    const left = info.scrollX + m;
    const right = info.scrollX + vw - m;
    if (sx1 < left) dx = left - sx1;
    else if (sx2 > right) dx = right - sx2;
    const sy1 = info.panY + ly1 * info.zoom;
    const sy2 = info.panY + ly2 * info.zoom;
    const top = info.scrollY + m;
    const bottom = info.scrollY + vh - m;
    if (sy1 < top) dy = top - sy1;
    else if (sy2 > bottom) dy = bottom - sy2;
    if (dx !== 0 || dy !== 0) {
      canvasInfo.update((c) => ({ ...c, panX: c.panX + dx, panY: c.panY + dy }));
    }
  }

  /** Pan the camera so the center of all nodes sits at the viewport center. */
  centerOnContent(): void {
    const g = get(graph);
    if (g.objects.length === 0) {
      // fall back to the graph area center so the canvas looks stable
      this.centerOnCm(g.width / 2, g.height / 2);
      return;
    }
    const e = this.computeContentExtent(g);
    this.centerOnCm((e.minX + e.maxX) / 2, (e.minY + e.maxY) / 2);
  }

  /** Zoom (and pan) so that the whole drawing fits into the viewport. */
  zoomToFit(): void {
    const g = get(graph);
    const info = get(canvasInfo);
    const viewport = document.querySelector(".te-viewport");
    const vw = viewport ? viewport.clientWidth : 800;
    const vh = viewport ? viewport.clientHeight : 600;
    const e = this.computeContentExtent(g);
    const margin = 1.5;
    const wCm = Math.max(0.5, e.maxX - e.minX) + margin * 2;
    const hCm = Math.max(0.5, e.maxY - e.minY) + margin * 2;
    const zx = vw / (wCm * info.ptPerCm);
    const zy = vh / (hCm * info.ptPerCm);
    const zoom = Math.min(8, Math.max(0.3, Math.min(zx, zy)));
    const cx = (e.minX + e.maxX) / 2;
    const cy = (e.minY + e.maxY) / 2;
    // the extent used for the layout is the CURRENT one; recompute it with
    // the target zoom so the centring maths matches what is on screen
    const lx = (cx - e.minX + margin) * info.ptPerCm;
    const ly = (e.maxY + margin - cy) * info.ptPerCm;
    canvasInfo.update((c) => ({
      ...c,
      zoom,
      panX: vw / 2 - lx * zoom,
      panY: vh / 2 - ly * zoom,
    }));
  }

  getSelected(): TikZObject | null {
    const id = get(selectedId);
    if (!id) return null;
    return get(graph).objects.find((o) => o.id === id) ?? null;
  }

  /** Drop selection / pick-flow / insert state that points at objects which
   *  no longer exist after an undo/redo (or delete). Otherwise the editor can
   *  keep a stale selection while stuck in ARROW_EDITING. */
  private reconcileSelection(): void {
    const g = get(graph);
    const selId = get(selectedId);
    if (selId) {
      const still = g.objects.some((o) => o.id === selId);
      if (!still) {
        selectedId.set(null);
        if (get(vimMode) === "ARROW_EDITING") vimMode.set("NORMAL");
      }
    }
    const flow = get(arrowFlow);
    if (flow?.kind === "pick") {
      const staleStart = flow.startId && !g.objects.some((o) => o.id === flow.startId);
      const staleTarget = flow.targetArrowId && !g.objects.some((o) => o.id === flow.targetArrowId);
      if (staleStart || staleTarget) arrowFlow.set(null);
    }
    const ins = get(insertState);
    if (ins && !g.objects.some((o) => o.id === ins.id)) {
      insertState.set(null);
      vimMode.set("NORMAL");
    }
  }

  undo(): void {
    const g = this.history?.undo();
    if (g) {
      graph.set(g);
      graphVersion.update((n) => n + 1);
      this.clearBuffer();
      this.reconcileSelection();
      statusMessage.set("Undo");
    }
  }

  redo(): void {
    const g = this.history?.redo();
    if (g) {
      graph.set(g);
      graphVersion.update((n) => n + 1);
      this.clearBuffer();
      this.reconcileSelection();
      statusMessage.set("Redo");
    }
  }

  clearBuffer(): void {
    commandBuffer.set("");
  }

  deleteSelected(): void {
    const sel = this.getSelected();
    if (!sel) {
      statusMessage.set("Nothing selected");
      return;
    }
    this.mutate((g) => {
      g.objects = g.objects.filter((o) => o.id !== sel.id);
      g.objects = g.objects.map((o) => {
        if (o.type === "arrow") {
          if (o.startId === sel.id) o.startId = null;
          if (o.endId === sel.id) o.endId = null;
        }
        return o;
      });
    });
    selectedId.set(null);
    statusMessage.set("Deleted");
  }

  moveSelected(dx: number, dy: number): void {
    const sel = this.getSelected();
    if (!sel) return;
    this.dragObject(sel.id, dx, dy);
  }

  dragObject(id: string, dx: number, dy: number): void {
    this.mutate((g) => {
      const o = g.objects.find((x) => x.id === id);
      if (!o) return;
      switch (o.type) {
        case "function":
          o.offsetX += dx;
          o.offsetY += dy;
          break;
        case "arrow": {
          const anchoredStart = !!o.startId;
          const anchoredEnd = !!o.endId;
          if (anchoredStart && !anchoredEnd) {
            o.x2 += dx; o.y2 += dy;
          } else if (!anchoredStart && anchoredEnd) {
            o.x1 += dx; o.y1 += dy;
          } else {
            o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy;
          }
          o.x = (o.x1 + o.x2) / 2; o.y = (o.y1 + o.y2) / 2;
          break;
        }
        default:
          o.x += dx;
          o.y += dy;
          // arrows bound to this node follow it
          for (const a of g.objects) {
            if (a.type !== "arrow") continue;
            let touched = false;
            if (a.startId === id) { a.x1 += dx; a.y1 += dy; touched = true; }
            if (a.endId === id) { a.x2 += dx; a.y2 += dy; touched = true; }
            if (touched) { a.x = (a.x1 + a.x2) / 2; a.y = (a.y1 + a.y2) / 2; }
          }
      }
    }, true);
  }

  /** Swap the arrow's start and end (direction, endpoints and bindings). */
  swapArrow(id: string): void {
    this.mutate((g) => {
      const o = g.objects.find((x) => x.id === id);
      if (!o || o.type !== "arrow") return;
      const t1 = o.x1; o.x1 = o.x2; o.x2 = t1;
      const t2 = o.y1; o.y1 = o.y2; o.y2 = t2;
      const ts = o.startId; o.startId = o.endId; o.endId = ts;
    });
  }

  /** After a shape resize, re-anchor the arrow endpoints bound to it onto its edge. */
  reanchorArrowEndpoints(id: string): void {
    this.mutate((g) => {
      this.reanchorArrowEndpointsIn(g, id);
    });
  }

  /** Re-anchor the arrows bound to `id` onto the shape's edge — IN PLACE.
   *  Used by the canvas resize handler so that the resize and the
   *  re-anchoring end up in a SINGLE history entry. Doing them as two
   *  separate mutations produced one undo step per mousemove (the second
   *  mutation also reset the merge window, so every drag frame was
   *  recorded) — undoing a resize needed a dozen key presses. */
  reanchorArrowEndpointsIn(g: TikZGraph, id: string): void {
    const shape = g.objects.find((x) => x.id === id);
    if (!shape) return;
    for (const a of g.objects) {
      if (a.type !== "arrow") continue;
      if (a.startId === id) {
        const e = this.edgePointShape(shape, a.x2, a.y2);
        a.x1 = e.x; a.y1 = e.y;
        a.x = (a.x1 + a.x2) / 2; a.y = (a.y1 + a.y2) / 2;
      }
      if (a.endId === id) {
        const e = this.edgePointShape(shape, a.x1, a.y1);
        a.x2 = e.x; a.y2 = e.y;
        a.x = (a.x1 + a.x2) / 2; a.y = (a.y1 + a.y2) / 2;
      }
    }
  }

  private edgePointShape(shape: TikZObject, tx: number, ty: number): { x: number; y: number } {
    const dx = tx - shape.x;
    const dy = ty - shape.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { x: shape.x, y: shape.y };
    const ux = dx / len;
    const uy = dy / len;
    if (shape.type === "circle") {
      return { x: shape.x + ux * shape.r, y: shape.y + uy * shape.r };
    }
    const b = objectBounds(shape);
    const hw = (b.right - b.left) / 2;
    const hh = (b.top - b.bottom) / 2;
    let t = Infinity;
    if (Math.abs(ux) > 1e-6) t = Math.min(t, hw / Math.abs(ux));
    if (Math.abs(uy) > 1e-6) t = Math.min(t, hh / Math.abs(uy));
    if (!isFinite(t)) return { x: shape.x, y: shape.y };
    return { x: shape.x + ux * t, y: shape.y + uy * t };
  }

  cycleSelection(): void {
    const g = get(graph);
    const objects = [...g.objects].sort((a, b) => a.x - b.x || b.y - a.y);
    if (objects.length === 0) return;
    const cur = get(selectedId);
    const idx = objects.findIndex((o) => o.id === cur);
    const next = objects[(idx + 1) % objects.length];
    selectedId.set(next.id);
    this.syncArrowMode(next);
  }

  private syncArrowMode(o: TikZObject): void {
    if (o.type === "arrow") {
      vimMode.set("ARROW_EDITING");
    } else if (get(vimMode) === "ARROW_EDITING" && !get(arrowFlow)) {
      vimMode.set("NORMAL");
    }
  }

  selectByClick(id: string | null): void {
    selectedId.set(id);
    if (id) {
      const o = get(graph).objects.find((x) => x.id === id);
      if (o) this.syncArrowMode(o);
    }
  }

  // ---------- Creation ----------

  private defSizes() {
    const st = this.plugin?.settings;
    return {
      textWidth: st?.defaultTextWidth ?? 3,
      shapeScale: st?.defaultShapeSize ?? 1,
      arrowLen: st?.defaultArrowLength ?? 3,
    };
  }

  defaultFormula(): string {
    return this.plugin?.settings.defaultTextFormula ?? "$$";
  }

  createText(enterInsert = false): void {
    const pos = this.freePosition();
    const id = makeId(get(graph));
    this.mutate((g) => {
      g.objects.push({
        id, type: "text", x: pos.x, y: pos.y, color: "black",
        text: this.defaultFormula(),
        width: this.defSizes().textWidth,
      });
    });
    this.select(id);
    this.centerOnCm(pos.x, pos.y);
    if (enterInsert) this.startInsert(id, "text");
    else statusMessage.set("Text created (i to edit)");
  }

  createShape(shape: string, enterInsert = false): void {
    const pos = this.freePosition();
    const id = makeId(get(graph));
    const color = "black";
    const s = this.defSizes().shapeScale;
    this.mutate((g) => {
      switch (shape) {
        case "rectangle":
          g.objects.push({ id, type: "rectangle", x: pos.x, y: pos.y, color, text: "", w: 2 * s, h: 1.4 * s });
          break;
        case "square":
          g.objects.push({ id, type: "square", x: pos.x, y: pos.y, color, text: "", size: 1.5 * s });
          break;
        case "circle":
          g.objects.push({ id, type: "circle", x: pos.x, y: pos.y, color, text: "", r: 0.9 * s });
          break;
        case "diamond":
          g.objects.push({ id, type: "diamond", x: pos.x, y: pos.y, color, text: "", size: 1.6 * s });
          break;
        case "ellipse":
          g.objects.push({ id, type: "ellipse", x: pos.x, y: pos.y, color, text: "", rx: 1.2 * s, ry: 0.8 * s });
          break;
      }
    });
    this.select(id);
    this.centerOnCm(pos.x, pos.y);
    if (enterInsert) this.startInsert(id, "text");
    else statusMessage.set("Shape created (i to edit)");
  }

  createFunction(): void {
    const g = get(graph);
    const id = makeId(g);
    const domain: [number, number] = [0, Math.max(1, g.width - 1)];
    this.mutate((gg) => {
      gg.objects.push({
        id, type: "function", x: 0, y: 0, color: "blue", text: "",
        expression: "sin(x)",
        domain, offsetX: 0, offsetY: 0,
      });
    });
    this.select(id);
    this.centerOnCm(domain[1] / 2, 0);
    activeTab.set("props");
    activeSection.set("functions");
    statusMessage.set("Function added - edit expression in Functions panel");
  }

  createArrow(dir: { dx: number; dy: number }, insertMode?: boolean): void {
    const sel = this.getSelected();
    if (!sel || sel.type === "arrow") return;
    const g = get(graph);
    const start = this.edgePoint(sel, sel.x + dir.dx, sel.y + dir.dy);
    const len = this.defSizes().arrowLen;
    const end = {
      x: start.x + dir.dx * len,
      y: start.y + dir.dy * len,
    };
    const id = makeId(g);
    this.mutate((gg) => {
      gg.objects.push({
        id, type: "arrow", x: (start.x + end.x) / 2, y: (start.y + end.y) / 2,
        color: "black", text: "", textBelow: "",
        x1: start.x, y1: start.y, x2: end.x, y2: end.y,
        startId: sel.id, endId: null,
        head: "end", tip: "arrow", dash: "solid",
      });
    });
    this.select(id);
    this.centerOnCm((start.x + end.x) / 2, (start.y + end.y) / 2);
    arrowFlow.set(null);
    vimMode.set("ARROW_EDITING");
    if (insertMode ?? this.flowInsertMode) this.startInsert(id, "text");
    else statusMessage.set("Arrow created (b/e to rebind endpoints)");
  }

  /** Point on the object's edge toward (tx, ty) from its center. */
  private edgePoint(o: TikZObject, tx: number, ty: number): { x: number; y: number } {
    const dx = tx - o.x;
    const dy = ty - o.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { x: o.x, y: o.y };
    const ux = dx / len;
    const uy = dy / len;
    if (o.type === "circle") {
      return { x: o.x + ux * o.r, y: o.y + uy * o.r };
    }
    const b = objectBounds(o);
    const hw = (b.right - b.left) / 2;
    const hh = (b.top - b.bottom) / 2;
    let t = Infinity;
    if (Math.abs(ux) > 1e-6) t = Math.min(t, hw / Math.abs(ux));
    if (Math.abs(uy) > 1e-6) t = Math.min(t, hh / Math.abs(uy));
    if (!isFinite(t)) return { x: o.x, y: o.y };
    return { x: o.x + ux * t, y: o.y + uy * t };
  }

  /** Toggle the environment (tikzpicture <-> tikzcd) on an empty canvas. */
  toggleEnv(): void {
    const g = get(graph);
    if (g.objects.length > 0) {
      statusMessage.set("Clear the canvas before switching environment (empty canvas only)");
      return;
    }
    const next: "picture" | "cd" = g.env === "cd" ? "picture" : "cd";
    this.mutate((gg) => { gg.env = next; });
    this.refreshCanvasExtent();
    statusMessage.set(`Environment → ${next === "cd" ? "tikzcd" : "tikzpicture"}`);
  }

  /** Set the style (arrowhead + line) of an arrow. */
  setArrowStyle(id: string, head: "end" | "start" | "both" | "none", tip: "arrow" | "latex" | "stealth" | "to" | "triangle" | "angle" | "o" | "star" | "bar" | "diamond" | "twoheads" | "harpoon" | "harpoonalt", dash: ArrowObject["dash"]): void {
    this.mutate((g) => {
      const o = g.objects.find((x) => x.id === id);
      if (o && o.type === "arrow") {
        o.head = head;
        o.tip = tip;
        o.dash = dash;
      }
    });
  }

  setArrowTip(id: string, tip: "arrow" | "latex" | "stealth" | "to" | "triangle" | "angle" | "o" | "star" | "bar" | "diamond"): void {
    this.mutate((g) => {
      const o = g.objects.find((x) => x.id === id);
      if (o && o.type === "arrow") o.tip = tip;
    });
  }

  /** ARROW_EDITING: arrow keys translate the whole arrow. */
  moveArrow(id: string, dx: number, dy: number): void {
    this.mutate((g) => {
      const o = g.objects.find((x) => x.id === id);
      if (o && o.type === "arrow") {
        o.x1 += dx;
        o.y1 += dy;
        o.x2 += dx;
        o.y2 += dy;
        o.x = (o.x1 + o.x2) / 2;
        o.y = (o.y1 + o.y2) / 2;
      }
    }, true);
  }

  /** ARROW_EDITING: h/l shorten/lengthen the arrow along its axis. */
  resizeArrow(id: string, delta: number): void {
    this.mutate((g) => {
      const o = g.objects.find((x) => x.id === id);
      if (!o || o.type !== "arrow") return;
      const dx = o.x2 - o.x1;
      const dy = o.y2 - o.y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      if (!o.endId) {
        o.x2 += ux * delta;
        o.y2 += uy * delta;
      } else if (!o.startId) {
        o.x1 -= ux * delta;
        o.y1 -= uy * delta;
      } else {
        o.x2 += ux * delta;
        o.y2 += uy * delta;
      }
      o.x = (o.x1 + o.x2) / 2;
      o.y = (o.y1 + o.y2) / 2;
    }, true);
  }

  // ---------- Arrow pick flow ----------

  beginArrowFlow(insertMode: boolean): void {
    const sel = this.getSelected();
    this.flowInsertMode = insertMode;
    if (sel && sel.type === "arrow") {
      arrowFlow.set({ kind: "pick", target: "start", startId: null, startPoint: null, targetArrowId: sel.id });
      vimMode.set("ARROW_EDITING");
      statusMessage.set("Pick arrow start: click object / Tab+Enter / n=free, Alt=cancel");
      return;
    }
    if (sel) {
      arrowFlow.set({ kind: "dir" });
      statusMessage.set("Arrow direction: arrow keys or 1-9, Alt=cancel");
      return;
    }
    arrowFlow.set({ kind: "pick", target: "start", startId: null, startPoint: null, targetArrowId: null });
    statusMessage.set("Pick arrow start: click object / Tab+Enter / n=free, Alt=cancel");
  }

  private flowInsertMode = false;

  onPick(id: string | null, point: { x: number; y: number } | null): void {
    const flow = get(arrowFlow);
    if (!flow || flow.kind !== "pick") return;
    if (flow.target === "start") {
      const startId = id;
      const startPoint = id === null ? point : null;
      if (flow.targetArrowId) {
        // rebinding existing arrow
        const targetArrowId = flow.targetArrowId;
        this.mutate((g) => {
          const a = g.objects.find((o) => o.id === targetArrowId);
          if (a && a.type === "arrow") {
            if (startId) {
              a.startId = startId;
              const s = g.objects.find((o) => o.id === startId);
              const p = s ? this.edgePoint(s, a.x2, a.y2) : null;
              if (p) { a.x1 = p.x; a.y1 = p.y; }
            } else if (startPoint) {
              a.startId = null;
              a.x1 = startPoint.x; a.y1 = startPoint.y;
            }
            a.x = (a.x1 + a.x2) / 2; a.y = (a.y1 + a.y2) / 2;
          }
        });
        arrowFlow.set({ kind: "pick", target: "end", startId: startId ?? (startPoint ? "FREE" : null), startPoint: null, targetArrowId });
        statusMessage.set("Pick arrow end: click object / Tab+Enter / n=free, Alt=cancel");
      } else {
        arrowFlow.set({ kind: "pick", target: "end", startId, startPoint, targetArrowId: null });
        statusMessage.set("Pick arrow end: click object / Tab+Enter / n=free, Alt=cancel");
      }
      return;
    }
    // target === 'end'
    const endId = id;
    const endPoint = id === null ? point : null;
    if (flow.targetArrowId) {
      const targetArrowId = flow.targetArrowId;
      this.mutate((g) => {
        const a = g.objects.find((o) => o.id === targetArrowId);
        if (a && a.type === "arrow") {
          if (endId) {
            a.endId = endId;
            const e = g.objects.find((o) => o.id === endId);
            const p = e ? this.edgePoint(e, a.x1, a.y1) : null;
            if (p) { a.x2 = p.x; a.y2 = p.y; }
          } else if (endPoint) {
            a.endId = null;
            a.x2 = endPoint.x; a.y2 = endPoint.y;
          }
          a.x = (a.x1 + a.x2) / 2; a.y = (a.y1 + a.y2) / 2;
        }
      });
      this.finishArrow(targetArrowId);
    } else {
      const g = get(graph);
      const startId = flow.startId;
      const startPoint = flow.startPoint;
      if (!startId && !startPoint) {
        statusMessage.set("Arrow start not set yet");
        return;
      }
      const id = makeId(g);
      // target point for the anchored start's edge computation
      let tgtX = 1, tgtY = 0;
      if (endId) {
        const e = g.objects.find((o) => o.id === endId);
        if (e) { tgtX = e.x; tgtY = e.y; }
      } else if (endPoint) {
        tgtX = endPoint.x; tgtY = endPoint.y;
      }
      let x1: number, y1: number, x2: number, y2: number;
      if (startId) {
        const s = g.objects.find((o) => o.id === startId);
        const p = s ? this.edgePoint(s, tgtX, tgtY) : { x: 0, y: 0 };
        x1 = p.x; y1 = p.y;
      } else if (startPoint) {
        x1 = startPoint.x; y1 = startPoint.y;
      } else {
        return;
      }
      if (endId) {
        const e = g.objects.find((o) => o.id === endId);
        const p = e ? this.edgePoint(e, x1, y1) : { x: x1 + 1, y: y1 };
        x2 = p.x; y2 = p.y;
      } else if (endPoint) {
        x2 = endPoint.x; y2 = endPoint.y;
      } else {
        return;
      }
      this.mutate((gg) => {
        gg.objects.push({
          id, type: "arrow",
          x: (x1 + x2) / 2, y: (y1 + y2) / 2,
          color: "black", text: "", textBelow: "",
          x1, y1, x2, y2,
          startId, endId,
          head: "end", tip: "arrow", dash: "solid",
        });
      });
      if (this.flowInsertMode) {
        this.select(id);
        this.startInsert(id, "text");
        arrowFlow.set(null);
      } else {
        this.finishArrow(id);
      }
    }
  }

  /** 'n' pressed: detach (rebind) or mark free endpoint (create) */
  arrowFreeEndpoint(): void {
    const flow = get(arrowFlow);
    if (!flow || flow.kind !== "pick") return;
    if (flow.target === "start") {
      if (flow.targetArrowId) {
        const targetArrowId = flow.targetArrowId;
        this.mutate((g) => {
          const a = g.objects.find((o) => o.id === targetArrowId);
          if (a && a.type === "arrow") a.startId = null;
        });
      }
      arrowFlow.set({ kind: "pick", target: "end", startId: null, startPoint: null, targetArrowId: flow.targetArrowId });
      statusMessage.set("Free start - Pick arrow end: click / Tab+Enter / n, Alt=cancel");
    } else {
      if (flow.targetArrowId) {
        const targetArrowId = flow.targetArrowId;
        this.mutate((g) => {
          const a = g.objects.find((o) => o.id === targetArrowId);
          if (a && a.type === "arrow") a.endId = null;
        });
      }
      if (flow.targetArrowId) {
        this.finishArrow(flow.targetArrowId);
      } else {
        const g = get(graph);
        const id = makeId(g);
        // The start may be a picked OBJECT (startId) or a free point
        // (startPoint). Using only startPoint dropped the picked object on
        // the floor: the arrow was created at the canvas centre, unbound.
        let x1: number, y1: number;
        if (flow.startId) {
          const s = g.objects.find((o) => o.id === flow.startId);
          // anchor on the edge the free arrow points away from (to the right)
          const p = s ? this.edgePoint(s, s.x + 1, s.y) : { x: g.width / 2, y: g.height / 2 };
          x1 = p.x; y1 = p.y;
        } else if (flow.startPoint) {
          x1 = flow.startPoint.x; y1 = flow.startPoint.y;
        } else {
          x1 = g.width / 2; y1 = g.height / 2;
        }
        this.mutate((gg) => {
          gg.objects.push({
            id, type: "arrow", x: x1 + 1, y: y1, color: "black", text: "", textBelow: "",
            x1, y1, x2: x1 + 2, y2: y1,
            startId: flow.startId ?? null, endId: null,
            head: "end", tip: "arrow", dash: "solid",
          });
        });
        if (this.flowInsertMode) {
          this.select(id);
          this.startInsert(id, "text");
          arrowFlow.set(null);
        } else {
          this.finishArrow(id);
        }
      }
    }
  }

  private finishArrow(arrowId: string): void {
    this.select(arrowId);
    arrowFlow.set(null);
    vimMode.set("ARROW_EDITING");
    statusMessage.set("Arrow endpoints set (Alt to exit ARROW EDITING)");
  }

  cancelArrowFlow(): void {
    arrowFlow.set(null);
    const sel = this.getSelected();
    if (sel && sel.type === "arrow") vimMode.set("ARROW_EDITING");
    else vimMode.set("NORMAL");
  }

  /** Tab during arrow creation flow: confirm current selection as the pick */
  confirmPick(): void {
    const flow = get(arrowFlow);
    if (!flow || flow.kind !== "pick") return;
    const sel = this.getSelected();
    if (sel) this.onPick(sel.id, null);
    else statusMessage.set("Tab to select an object first");
  }

  /** Where to put a newly created object.
   *
   *  The old implementation jittered the position with Math.random(), so
   *  every new object landed somewhere different and the user had to hunt
   *  for it. The placement is now deterministic: the viewport centre
   *  first, then a growing spiral around it until a free spot is found. */
  private freePosition(): { x: number; y: number } {
    const g = get(graph);
    const sel = this.getSelected();
    if (sel && sel.type !== "arrow") {
      const b = objectBounds(sel);
      return { x: (b.left + b.right) / 2, y: b.bottom - 0.8 };
    }
    if (sel && sel.type === "arrow") {
      const dir = { x: sel.x2 - sel.x1, y: sel.y2 - sel.y1 };
      const len = Math.hypot(dir.x, dir.y) || 1;
      return { x: sel.x2 + (dir.x / len) * 1.2, y: sel.y2 + (dir.y / len) * 1.2 };
    }
    const sc = this.screenCenterCm();
    const free = (x: number, y: number): boolean =>
      !g.objects.some((o) => {
        const b = objectBounds(o);
        return x > b.left - 0.4 && x < b.right + 0.4 && y > b.bottom - 0.4 && y < b.top + 0.4;
      });
    if (free(sc.x, sc.y)) return { x: sc.x, y: sc.y };
    // deterministic spiral outwards
    const step = 0.9;
    for (let ring = 1; ring <= 12; ring++) {
      const r = ring * step;
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const x = sc.x + Math.cos(ang) * r;
        const y = sc.y + Math.sin(ang) * r;
        if (free(x, y)) return { x, y };
      }
    }
    return { x: sc.x, y: sc.y };
  }

  /** Open the inline editor for an object.
   *  `fresh` = true opens a NEW editing session (the caret is placed inside
   *  the $...$ pair); `fresh` = false switches to the other label box of the
   *  SAME object and must not move the caret. */
  startInsert(id: string, field: "text" | "textBelow" | "expression", fresh = true): void {
    const o = get(graph).objects.find((x) => x.id === id);
    if (!o) return;
    // pre-fill empty text boxes with the default formula
    if (o.type === "text" && o.text === "" && field === "text") {
      this.mutate((g) => {
        const t = g.objects.find((x) => x.id === id);
        if (t && t.type === "text") t.text = this.defaultFormula();
      });
    }
    const prev = get(insertState);
    const session = fresh ? this.insertSession + 1 : prev?.session ?? this.insertSession;
    if (fresh) this.insertSession = session;
    insertState.set({ id, field, session });
    vimMode.set("INSERT");
  }

  finishInsert(id: string, field: "text" | "textBelow" | "expression", value: string): void {
    this.mutate((g) => {
      const o = g.objects.find((x) => x.id === id);
      if (!o) return;
      if (field === "textBelow" && o.type === "arrow") o.textBelow = value;
      else if (field === "expression" && o.type === "function") o.expression = value;
      else o.text = value;
      // text boxes auto-size to their content (see textAutoWidth)
      if (o.type === "text") {
        o.width = textAutoWidth(value);
      }
    }, true);
  }

  cleanup(): void {
    selectedId.set(null);
    insertState.set(null);
    arrowFlow.set(null);
    colorPickerOpen.set(false);
    shapePickerOpen.set(false);
    arrowTipPickerOpen.set(false);
    helpOpen.set(false);
    commandBuffer.set("");
    statusMessage.set("");
    // the "insert right after picking a shape" intent lives on `window`;
    // clear it so it cannot leak into the next editing session
    (window as unknown as { __teInsertAfterShape?: boolean }).__teInsertAfterShape = false;
  }

  async insertToNote(): Promise<InsertNoteResult> {
    const plugin = this.plugin;
    if (!plugin) return { inserted: false, message: "Plugin not attached" };
    const r = await plugin.insertCodeBlock();
    if (r.inserted) {
      this.afterInserted();
    }
    return r;
  }

  /** Insert a custom code block into the note (multi-function template etc.). */
  async insertToNoteWithCode(code: string): Promise<InsertNoteResult> {
    const plugin = this.plugin;
    if (!plugin) return { inserted: false, message: "Plugin not attached" };
    const r = await plugin.insertCodeBlockWithCode(code);
    if (r.inserted) {
      this.afterInserted();
    }
    return r;
  }

  /** Hook: called after a successful insert (the plugin closes the modal). */
  afterInserted(): void {
    this.plugin?.onInserted?.();
  }

  getCurrentCode(): string {
    return generateTikZ(get(graph));
  }

  getCurrentGraph(): TikZGraph {
    return get(graph);
  }
}

export const editor = new EditorController();
