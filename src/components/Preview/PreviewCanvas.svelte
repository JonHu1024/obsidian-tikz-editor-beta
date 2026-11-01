<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { editor } from "../../EditorController";
  import { graph, selectedId, canvasInfo, arrowFlow, CANVAS_MARGIN } from "../../state";
  import type { TikZObject, TikZGraph } from "../../core/types";
  import { exactObjectBounds, objectBounds } from "../../core/types";
  import { cmToLocal, localToCm, localToCmFixed, currentExtent, eventToLocal, type Pt, type Extent } from "../../utils/geometry";
  import { sampleFunction } from "../../utils/math";
  import { renderMathText } from "../../utils/mathText";
  import { colorHex } from "../../utils/colors";

  // ---------------- pseudo-render: each object IS a drawn element -------------
  // The left editor canvas draws every object directly from the model, so the
  // visible drawing, the hit areas and the edit input box are the same thing —
  // misalignment is impossible by construction.
  // (tikzcd mode replaces this whole canvas with the Preact CdPanel, so no
  // cd-specific rendering lives here.)

  let viewport: HTMLDivElement;
  let wrap: HTMLDivElement;

  let info = $canvasInfo;
  let g = $graph;
  let sel = $selectedId;
  let flow = $arrowFlow;
  let unsubs: (() => void)[] = [];

  interface DragState {
    type: "pan" | "move" | "resize";
    startLocal: Pt;
    panX0: number;
    panY0: number;
    id?: string;
    handle?: string;
    prevCm?: Pt;
    moved: boolean;
    /** canvas extent frozen at drag start — see localToCmFixed() */
    extent: Extent;
  }
  let drag: DragState | null = null;

  $: info = $canvasInfo;
  $: g = $graph;
  $: sel = $selectedId;
  $: flow = $arrowFlow;

  onMount(() => {
    unsubs.push(
      graph.subscribe((gg) => {
        g = gg;
        editor.refreshCanvasExtent();
      })
    );
    unsubs.push(canvasInfo.subscribe((c) => (info = c)));
    unsubs.push(
      selectedId.subscribe((id) => {
        if (id && id !== lastSelId) {
          lastSelId = id;
          editor.ensureVisible(id);
        } else if (!id) {
          lastSelId = null;
        }
      })
    );
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      unsubs.forEach((u) => u());
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      viewport.removeEventListener("wheel", onWheel);
    };
  });

  let lastSelId: string | null = null;

  function onWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    editor.zoomAt(e.clientX - r.left, e.clientY - r.top, factor);
  }

  // ---------------- geometry helpers ----------------

  function loc(o: TikZObject, x: number, y: number): Pt {
    return cmToLocal(x, y, g.height, info);
  }

  function locPt(x: number, y: number): Pt {
    return cmToLocal(x, y, g.height, info);
  }

  function toLocal(e: PointerEvent): Pt {
    return eventToLocal(e, wrap, info);
  }

  function toCm(local: Pt): Pt {
    return localToCm(local.x, local.y, g.height, info);
  }

  /** cm position of a pointer during a drag — uses the extent frozen at
   *  drag start so that the auto-growing canvas cannot make the object
   *  drift away from the cursor. */
  function toCmDrag(local: Pt, ext: Extent): Pt {
    return localToCmFixed(local.x, local.y, ext, info);
  }

  function hitId(e: PointerEvent): string | null {
    const t = e.target as Element;
    const el = t.closest?.("[data-id]");
    return el ? el.getAttribute("data-id") : null;
  }

  function handleOf(e: PointerEvent): string | null {
    const t = e.target as Element;
    const el = t.closest?.("[data-handle]");
    return el ? el.getAttribute("data-handle") : null;
  }

  // ---------------- drawn geometry ----------------

  /** SVG attributes for a shape/arrow drawn from the model. */
  function drawAttrs(o: TikZObject): { tag: string; attrs: Record<string, string> } | null {
    switch (o.type) {
      case "rectangle":
      case "square": {
        const b = exactObjectBounds(o);
        const p1 = loc(o, b.left, b.bottom);
        const p2 = loc(o, b.right, b.top);
        return {
          tag: "rect",
          attrs: {
            x: String(p1.x), y: String(p2.y),
            width: String(Math.max(0, p2.x - p1.x)), height: String(Math.max(0, p1.y - p2.y)),
          },
        };
      }
      case "circle": {
        const p = loc(o, o.x, o.y);
        return { tag: "circle", attrs: { cx: String(p.x), cy: String(p.y), r: String(o.r * info.ptPerCm) } };
      }
      case "diamond": {
        const h = o.size / 2;
        const a = loc(o, o.x, o.y - h);
        const b2 = loc(o, o.x + h, o.y);
        const c = loc(o, o.x, o.y + h);
        const d = loc(o, o.x - h, o.y);
        return {
          tag: "polygon",
          attrs: { points: `${a.x},${a.y} ${b2.x},${b2.y} ${c.x},${c.y} ${d.x},${d.y}` },
        };
      }
      case "ellipse": {
        const p = loc(o, o.x, o.y);
        return {
          tag: "ellipse",
          attrs: {
            cx: String(p.x), cy: String(p.y),
            rx: String(o.rx * info.ptPerCm), ry: String(o.ry * info.ptPerCm),
          },
        };
      }
      case "arrow": {
        const s = loc(o, o.x1, o.y1);
        const t = loc(o, o.x2, o.y2);
        return { tag: "line", attrs: { x1: String(s.x), y1: String(s.y), x2: String(t.x), y2: String(t.y) } };
      }
      case "function": {
        // an expression math.ts cannot evaluate (e.g. pgf's `sin(\x r)` —
        // the "r" radian suffix merges into an unknown identifier) used to
        // THROW during render and take the WHOLE canvas down; draw nothing
        // for that curve instead
        try {
          const pts = sampleFunction(o.expression, [o.domain[0], o.domain[1]], Math.max(40, Math.min(200, g.width * 20)))
            .map((p) => {
              const q = loc(o, p.x + o.offsetX, p.y + o.offsetY);
              return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
            })
            .join(" ");
          return pts ? { tag: "polyline", attrs: { points: pts } } : null;
        } catch {
          return null;
        }
      }
      default:
        return null;
    }
  }

  /** Arrowhead shapes per tip style: polygons (points) or circles. */
  function arrowHeads(o: Extract<TikZObject, { type: "arrow" }>): { kind: "polygon"; points: string }[] | { kind: "circle"; x: number; y: number; r: number; fill: boolean }[] {
    const a = loc(o, o.x1, o.y1);
    const b2 = loc(o, o.x2, o.y2);
    const ang = Math.atan2(b2.y - a.y, b2.x - a.x);
    const tri = (cx: number, cy: number, dir: number, len: number, half: number): string => {
      const p1 = { x: cx + Math.cos(dir) * len, y: cy + Math.sin(dir) * len };
      const p2 = { x: cx + Math.cos(dir + Math.PI - Math.atan2(half, len)) * Math.hypot(len, half), y: cy + Math.sin(dir + Math.PI - Math.atan2(half, len)) * Math.hypot(len, half) };
      const p3 = { x: cx + Math.cos(dir - Math.PI + Math.atan2(half, len)) * Math.hypot(len, half), y: cy + Math.sin(dir - Math.PI + Math.atan2(half, len)) * Math.hypot(len, half) };
      return `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
    };
    const diamond = (cx: number, cy: number, dir: number): string => {
      const c = Math.cos(dir), s2 = Math.sin(dir);
      const p1 = { x: cx + c * 8, y: cy + s2 * 8 };
      const p2 = { x: cx + c * 4 - s2 * 4, y: cy + s2 * 4 + c * 4 };
      const p3 = { x: cx - c * 8, y: cy - s2 * 8 };
      const p4 = { x: cx + c * 4 + s2 * 4, y: cy + s2 * 4 - c * 4 };
      return `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`;
    };
    const bar = (cx: number, cy: number, dir: number): string => {
      const c = Math.cos(dir), s2 = Math.sin(dir);
      const p1 = { x: cx - s2 * 4, y: cy + c * 4 };
      const p2 = { x: cx + s2 * 4, y: cy - c * 4 };
      const p3 = { x: cx + c * 7 - s2 * 4, y: cy + s2 * 7 + c * 4 };
      const p4 = { x: cx + c * 7 + s2 * 4, y: cy + s2 * 7 - c * 4 };
      return `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`;
    };
    const circle = (cx: number, cy: number, r: number): { kind: "circle"; x: number; y: number; r: number; fill: boolean } => ({ kind: "circle", x: cx, y: cy, r, fill: false });
    const filledCircle = (cx: number, cy: number, r: number): { kind: "circle"; x: number; y: number; r: number; fill: boolean } => ({ kind: "circle", x: cx, y: cy, r, fill: true });

    const shape = (cx: number, cy: number, dir: number): { kind: "polygon"; points: string } | { kind: "circle"; x: number; y: number; r: number; fill: boolean } => {
      switch (o.tip) {
        case "latex": return { kind: "polygon", points: tri(cx, cy, dir, 13, 3.2) };
        case "stealth": return { kind: "polygon", points: tri(cx, cy, dir, 12, 2.7) };
        case "to": return { kind: "polygon", points: tri(cx, cy, dir, 9.5, 3.1) };
        case "triangle": return { kind: "polygon", points: tri(cx, cy, dir, 11, 5) };
        case "angle": return { kind: "polygon", points: tri(cx, cy, dir, 10, 1.7) };
        case "o": return circle(cx, cy, 4);
        case "star": return filledCircle(cx, cy, 3.2);
        case "bar": return { kind: "polygon", points: bar(cx, cy, dir) };
        case "diamond": return { kind: "polygon", points: diamond(cx, cy, dir) };
        default: return { kind: "polygon", points: tri(cx, cy, dir, 9, 3.4) };
      }
    };

    const heads: ReturnType<typeof arrowHeads> = [];
    if (o.head === "end" || o.head === "both") heads.push(shape(b2.x, b2.y, ang));
    if (o.head === "start" || o.head === "both") heads.push(shape(a.x, a.y, ang + Math.PI));
    return heads;
  }

  function arrowDashAttr(o: Extract<TikZObject, { type: "arrow" }>): string | undefined {
    if (o.dash === "dashed") return "7 4";
    if (o.dash === "dotted") return "2 4";
    return undefined;
  }

  // ---------------- grid / axis (mimic TeX) ----------------

  /** Grid lines in cm space. Horizontal and vertical lines both carry their
   *  real endpoints — the previous encoding stored a horizontal line's y in
   *  the `x` field and the renderer only swapped one axis back, which drew
   *  every horizontal line as a duplicate vertical.
   *
   *  The reactive values are passed in as arguments on purpose: a template
   *  expression like `{#if axisGeom()}` gives Svelte no dependency it can
   *  track (the function body is opaque to it), so the block was created
   *  once at mount and never updated — the axis was NEVER drawn, no matter
   *  what the user selected. */
  function gridLines(gg: TikZGraph = g): { key: string; x1: number; y1: number; x2: number; y2: number }[] {
    const lines: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    if (!gg.grid.enabled) return lines;
    const step = gg.grid.step || 1;
    const ext = pictureExtent(gg);
    const maxX = ext.w;
    const maxY = ext.h;
    for (let i = 0; i <= maxX; i += step) {
      lines.push({ key: "v" + i.toFixed(3), x1: i, y1: 0, x2: i, y2: maxY });
    }
    for (let i = 0; i <= maxY; i += step) {
      lines.push({ key: "h" + i.toFixed(3), x1: 0, y1: i, x2: maxX, y2: i });
    }
    return lines;
  }

  /** The extent the GENERATOR uses for the picture (objectBounds, which
   *  pads circles) — the preview must agree with it, otherwise the grid /
   *  axis in the note is longer than the one on screen. */
  function pictureExtent(gg: TikZGraph = g): { w: number; h: number } {
    let maxX = gg.width;
    let maxY = gg.height;
    for (const o of gg.objects) {
      const b = objectBounds(o);
      if (b.right > maxX) maxX = b.right;
      if (b.top > maxY) maxY = b.top;
    }
    return { w: Math.max(1, maxX), h: Math.max(1, maxY) };
  }

  /** Cartesian axis geometry.
   *  The "box" style draws the full frame the generator emits — it used to
   *  fall through to the plain origin axes, so the preview showed two
   *  lines where the note got a framed box. */
  function axisGeom(gg: TikZGraph = g) {
    if (!gg.axis.enabled || gg.axis.type !== "cartesian") return null;
    const { w: maxX, h: maxY } = pictureExtent(gg);
    if (gg.axis.style === "middle") {
      return {
        kind: "middle" as const,
        x1: 0, y1: maxY / 2, x2: maxX + 0.4, y2: maxY / 2,
        vx1: maxX / 2, vy1: 0, vx2: maxX / 2, vy2: maxY + 0.4,
        frame: null as null | { x1: number; y1: number; x2: number; y2: number }[],
      };
    }
    if (gg.axis.style === "box") {
      const W = maxX + 0.4;
      const H = maxY + 0.4;
      return {
        kind: "box" as const,
        x1: 0, y1: 0, x2: W, y2: 0,
        vx1: 0, vy1: 0, vx2: 0, vy2: H,
        frame: [
          { x1: 0, y1: 0, x2: W, y2: 0 },
          { x1: 0, y1: 0, x2: 0, y2: H },
          { x1: W, y1: 0, x2: W, y2: H },
          { x1: 0, y1: H, x2: W, y2: H },
        ],
      };
    }
    return {
      kind: "axes" as const,
      x1: 0, y1: 0, x2: maxX + 0.4, y2: 0,
      vx1: 0, vy1: 0, vx2: 0, vy2: maxY + 0.4,
      frame: null as null | { x1: number; y1: number; x2: number; y2: number }[],
    };
  }

  /** Polar axis geometry — the generator emits a circle, two radial arrows
   *  and four 45° spokes. The preview drew NOTHING for a polar axis, so
   *  the canvas and the generated note disagreed completely. */
  function polarGeom(gg: TikZGraph = g) {
    if (!gg.axis.enabled || gg.axis.type !== "polar") return null;
    const { w, h } = pictureExtent(gg);
    const r = Math.min(w, h) / 2;
    const cx = w / 2;
    const cy = h / 2;
    const spokes: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 4 + Math.PI / 4;
      spokes.push({
        key: "sp" + i,
        x1: cx, y1: cy,
        x2: cx + r * Math.cos(a), y2: cy + r * Math.sin(a),
      });
    }
    return {
      circle: { cx, cy, r },
      hArrow: { x1: cx, y1: cy, x2: cx + r + 0.4, y2: cy },
      vArrow: { x1: cx, y1: cy, x2: cx, y2: cy + r + 0.4 },
      spokes,
    };
  }

  // ---------------- interactions ----------------

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const local = toLocal(e);
    const handle = handleOf(e);
    const id = hitId(e);
    const ext = currentExtent(info);

    if (id && handle) {
      const o = g.objects.find((x) => x.id === id);
      if (!o) return;
      e.preventDefault();
      editor.select(id);
      drag = { type: "resize", startLocal: local, panX0: 0, panY0: 0, id, handle, moved: false, extent: ext };
      return;
    }

    if (id) {
      if (flow) {
        editor.onPick(id, null);
        return;
      }
      e.preventDefault();
      editor.selectByClick(id);
      drag = {
        type: "move", startLocal: local, panX0: 0, panY0: 0, id,
        prevCm: toCmDrag(local, ext), moved: false, extent: ext,
      };
      return;
    }

    if (flow) {
      editor.onPick(null, toCm(local));
      return;
    }

    e.preventDefault();
    editor.selectByClick(null);
    drag = { type: "pan", startLocal: local, panX0: info.panX, panY0: info.panY, moved: false, extent: ext };
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const local = toLocal(e);
    const dx = local.x - drag.startLocal.x;
    const dy = local.y - drag.startLocal.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;

    if (drag.type === "pan") {
      canvasInfo.update((c) => ({ ...c, panX: drag.panX0 + dx, panY: drag.panY0 + dy }));
    } else if (drag.type === "move" && drag.id) {
      const cur = toCmDrag(local, drag.extent);
      const prev = drag.prevCm ?? cur;
      editor.dragObject(drag.id, cur.x - prev.x, cur.y - prev.y);
      drag.prevCm = cur;
    } else if (drag.type === "resize" && drag.id && drag.handle) {
      const current = toCmDrag(local, drag.extent);
      resizeObject(drag.id, drag.handle, current);
    }
  }

  function onPointerUp() {
    drag = null;
  }

  function resizeObject(id: string, handle: string, c: Pt) {
    editor.mutate((gg) => {
      const o = gg.objects.find((x) => x.id === id);
      if (!o) return;
      const h = handle as string;
      const min = 0.25;
      switch (o.type) {
        case "rectangle": {
          const b = exactObjectBounds(o);
          const L = b.left, R = b.right, B = b.bottom, T = b.top;
          let w = o.w, x = o.x, hh = o.h, y = o.y;
          if (h === "e") { w = Math.max(min, c.x - L); x = L + w / 2; }
          else if (h === "w") { w = Math.max(min, R - c.x); x = R - w / 2; }
          else if (h === "n") { hh = Math.max(min, c.y - B); y = B + hh / 2; }
          else if (h === "s") { hh = Math.max(min, T - c.y); y = T - hh / 2; }
          else if (h === "ne") { w = Math.max(min, c.x - L); hh = Math.max(min, c.y - B); x = L + w / 2; y = B + hh / 2; }
          else if (h === "nw") { w = Math.max(min, R - c.x); hh = Math.max(min, c.y - B); x = R - w / 2; y = B + hh / 2; }
          else if (h === "se") { w = Math.max(min, c.x - L); hh = Math.max(min, T - c.y); x = L + w / 2; y = T - hh / 2; }
          else if (h === "sw") { w = Math.max(min, R - c.x); hh = Math.max(min, T - c.y); x = R - w / 2; y = T - hh / 2; }
          o.w = w; o.x = x; o.h = hh; o.y = y;
          break;
        }
        case "ellipse": {
          const b = exactObjectBounds(o);
          const L = b.left, R = b.right, B = b.bottom, T = b.top;
          let rx = o.rx, ry = o.ry;
          if (h === "e") rx = Math.max(min, c.x - L);
          else if (h === "w") rx = Math.max(min, R - c.x);
          else if (h === "n") ry = Math.max(min, c.y - B);
          else if (h === "s") ry = Math.max(min, T - c.y);
          else if (h === "ne") { rx = Math.max(min, c.x - L); ry = Math.max(min, c.y - B); }
          else if (h === "nw") { rx = Math.max(min, R - c.x); ry = Math.max(min, c.y - B); }
          else if (h === "se") { rx = Math.max(min, c.x - L); ry = Math.max(min, T - c.y); }
          else if (h === "sw") { rx = Math.max(min, R - c.x); ry = Math.max(min, T - c.y); }
          o.rx = rx; o.ry = ry;
          break;
        }
        case "square":
        case "diamond": {
          if (h === "e" || h === "w") o.size = Math.max(min, 2 * Math.abs(c.x - o.x));
          else if (h === "n" || h === "s") o.size = Math.max(min, 2 * Math.abs(c.y - o.y));
          else o.size = Math.max(min, 2 * Math.max(Math.abs(c.x - o.x), Math.abs(c.y - o.y)));
          break;
        }
        case "circle": {
          o.r = Math.max(min, Math.hypot(c.x - o.x, c.y - o.y));
          break;
        }
        case "text": {
          if (h === "e" || h === "w") o.width = Math.max(0.5, Math.abs(c.x - o.x) * 2);
          break;
        }
        case "arrow": {
          if (h === "e") { o.x2 = c.x; o.y2 = c.y; }
          else if (h === "w") { o.x1 = c.x; o.y1 = c.y; }
          o.x = (o.x1 + o.x2) / 2; o.y = (o.y1 + o.y2) / 2;
          break;
        }
        case "function":
          break;
      }
      // re-anchor the arrows bound to the resized shape INSIDE the same
      // mutation — a second mutate() would add another history entry and
      // reset the merge window (one undo step per mousemove)
      editor.reanchorArrowEndpointsIn(gg, id);
    }, true);
  }

  function handleFor(o: TikZObject): string[] {
    switch (o.type) {
      case "rectangle":
      case "ellipse":
      case "diamond":
        return ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
      case "square":
        return ["nw", "ne", "se", "sw"];
      case "circle":
        return ["n", "e", "s", "w"];
      case "text":
        return ["w", "e"];
      case "arrow":
        return ["w", "e"];
      default:
        return [];
    }
  }

  function handlePos(o: TikZObject, h: string): Pt {
    // arrows: one handle at the tail (x1,y1), one at the head (x2,y2)
    if (o.type === "arrow") {
      return h === "e" ? loc(o, o.x2, o.y2) : loc(o, o.x1, o.y1);
    }
    const b = exactObjectBounds(o);
    const cx = (b.left + b.right) / 2;
    const cy = (b.bottom + b.top) / 2;
    const hw = (b.right - b.left) / 2;
    const hh = (b.top - b.bottom) / 2;
    const x = h.includes("e") ? cx + hw : h.includes("w") ? cx - hw : cx;
    const y = h.includes("n") ? cy + hh : h.includes("s") ? cy - hh : cy;
    return loc(o, x, y);
  }

  function handleCursor(h: string): string {
    switch (h) {
      case "n": case "s": return "ns-resize";
      case "e": case "w": return "ew-resize";
      case "ne": case "sw": return "nesw-resize";
      default: return "nwse-resize";
    }
  }

  function dblclickObject(o: TikZObject) {
    if (o.type === "function") return;
    editor.startInsert(o.id, "text");
  }
</script>

<div class="te-viewport" bind:this={viewport} on:pointerdown={onPointerDown} on:scroll={() => {
    if (!viewport) return;
    canvasInfo.update((c) => ({ ...c, scrollX: viewport.scrollLeft, scrollY: viewport.scrollTop }));
  }}>
  <div
    class="te-wrap"
    bind:this={wrap}
    style="transform: translate({info.panX}px, {info.panY}px) scale({info.zoom}); width: {(info.contentMaxX - info.contentMinX + 2 * CANVAS_MARGIN) * info.ptPerCm}px; height: {(info.contentMaxY - info.contentMinY + 2 * CANVAS_MARGIN) * info.ptPerCm}px;"
  >
    <svg
      class="te-scene"
      width={(info.contentMaxX - info.contentMinX + 2 * CANVAS_MARGIN) * info.ptPerCm}
      height={(info.contentMaxY - info.contentMinY + 2 * CANVAS_MARGIN) * info.ptPerCm}
    >
      <!-- grid -->
      {#if g.grid.enabled}
        <g class="te-grid">
          {#each gridLines(g) as l (l.key)}
            {@const p1 = locPt(l.x1, l.y1)}
            {@const p2 = locPt(l.x2, l.y2)}
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={g.grid.color}
              stroke-width="0.5"
              stroke-dasharray={g.grid.dashed ? "4 3" : undefined}
            />
          {/each}
        </g>
      {/if}
      <!-- axis -->
      {#if axisGeom(g)}
        {@const ax = axisGeom(g)}
        <g class="te-axis">
          {#if ax.frame}
            {#each ax.frame as f, i (i)}
              <line x1={locPt(f.x1, f.y1).x} y1={locPt(f.x1, f.y1).y} x2={locPt(f.x2, f.y2).x} y2={locPt(f.x2, f.y2).y} stroke="var(--text-normal)" stroke-width="1.5" />
            {/each}
          {/if}
          <line x1={locPt( ax.x1, ax.y1).x} y1={locPt( ax.x1, ax.y1).y} x2={locPt( ax.x2, ax.y2).x} y2={locPt( ax.x2, ax.y2).y} stroke="var(--text-normal)" stroke-width="1.5" />
          <line x1={locPt( ax.vx1, ax.vy1).x} y1={locPt( ax.vx1, ax.vy1).y} x2={locPt( ax.vx2, ax.vy2).x} y2={locPt( ax.vx2, ax.vy2).y} stroke="var(--text-normal)" stroke-width="1.5" />
          <text x={locPt( ax.x2 + 0.1, ax.y2).x} y={locPt( ax.x2 + 0.1, ax.y2).y} font-size="10" fill="var(--text-muted)">{g.axis.xLabel || "x"}</text>
          <text x={locPt( ax.vx2, ax.vy2 + 0.1).x} y={locPt( ax.vx2, ax.vy2 + 0.1).y} font-size="10" fill="var(--text-muted)">{g.axis.yLabel || "y"}</text>
        </g>
      {/if}
      <!-- polar axis -->
      {#if polarGeom(g)}
        {@const pg = polarGeom(g)}
        <g class="te-axis">
          <circle cx={locPt(pg.circle.cx, pg.circle.cy).x} cy={locPt(pg.circle.cx, pg.circle.cy).y} r={pg.circle.r * info.ptPerCm} fill="none" stroke="var(--text-normal)" stroke-width="1.5" />
          {#each pg.spokes as s (s.key)}
            <line x1={locPt(s.x1, s.y1).x} y1={locPt(s.x1, s.y1).y} x2={locPt(s.x2, s.y2).x} y2={locPt(s.x2, s.y2).y} stroke="var(--text-faint)" stroke-width="1" />
          {/each}
          <line x1={locPt(pg.hArrow.x1, pg.hArrow.y1).x} y1={locPt(pg.hArrow.x1, pg.hArrow.y1).y} x2={locPt(pg.hArrow.x2, pg.hArrow.y2).x} y2={locPt(pg.hArrow.x2, pg.hArrow.y2).y} stroke="var(--text-normal)" stroke-width="1.5" />
          <line x1={locPt(pg.vArrow.x1, pg.vArrow.y1).x} y1={locPt(pg.vArrow.x1, pg.vArrow.y1).y} x2={locPt(pg.vArrow.x2, pg.vArrow.y2).x} y2={locPt(pg.vArrow.x2, pg.vArrow.y2).y} stroke="var(--text-normal)" stroke-width="1.5" />
          <text x={locPt(pg.vArrow.x2, pg.vArrow.y2 + 0.1).x} y={locPt(pg.vArrow.x2, pg.vArrow.y2 + 0.1).y} font-size="10" fill="var(--text-muted)">{g.axis.yLabel || "θ"}</text>
          <text x={locPt(pg.hArrow.x2 + 0.1, pg.hArrow.y2).x} y={locPt(pg.hArrow.x2 + 0.1, pg.hArrow.y2).y} font-size="10" fill="var(--text-muted)">{g.axis.xLabel || "r"}</text>
        </g>
      {/if}
      <!-- drawn objects (non-text): visible layer (pointer-events none) + fat invisible hit layer -->
      {#each g.objects.filter((o) => o.type !== "text") as o (o.id)}
        {@const d = drawAttrs(o)}
        {#if d}
          <g class="te-drawn te-drawn-hit" data-id={o.id} on:dblclick={() => dblclickObject(o)}>
            <!-- closed shapes are filled TRANSPARENTLY (not "none") so that
                 clicking INSIDE a rectangle/circle selects it — with
                 fill="none" only the outline was clickable, which made
                 small shapes nearly impossible to grab -->
            <svelte:element
              this={d.tag}
              {...d.attrs}
              stroke="transparent"
              stroke-width="11"
              fill={d.tag === "line" || d.tag === "polyline" ? "none" : "transparent"}
              stroke-dasharray={o.type === "arrow" ? arrowDashAttr(o) : undefined}
            />
            {#if o.type === "arrow"}
              {#each arrowHeads(o) as hp}
                {#if hp.kind === "circle"}
                  <circle cx={hp.x} cy={hp.y} r={Math.max(hp.r + 3, 6)} fill="transparent" stroke="transparent" stroke-width="11" />
                {:else}
                  <polygon points={hp.points} fill="transparent" stroke="transparent" stroke-width="11" />
                {/if}
              {/each}
            {/if}
          </g>
          <g class="te-drawn te-drawn-vis {sel === o.id ? 'te-drawn-selected' : ''}" data-id={o.id}>
            <svelte:element this={d.tag} {...d.attrs} stroke={o.color} stroke-width="1.6" fill="none" stroke-dasharray={o.type === "arrow" ? arrowDashAttr(o) : undefined} />
            {#if o.type === "arrow"}
              {#each arrowHeads(o) as hp}
                {#if hp.kind === "circle"}
                  <circle cx={hp.x} cy={hp.y} r={hp.r} fill={hp.fill ? o.color : "none"} stroke={o.color} stroke-width="1.4" />
                {:else}
                  <polygon points={hp.points} fill={o.color} stroke={o.color} stroke-width="1" />
                {/if}
              {/each}
            {/if}
          </g>
        {/if}
      {/each}
      <!-- selection handles -->
      {#if sel}
        {@const so = g.objects.find((o) => o.id === sel)}
        {#if so && so.type !== "function" && handleFor(so).length > 0}
          {#each handleFor(so) as h}
            {@const hp = handlePos(so, h)}
            {@const hs = 11 / info.zoom}
            <rect
              data-id={so.id}
              data-handle={h}
              class="te-handle"
              style="cursor: {handleCursor(h)};"
              x={hp.x - hs / 2}
              y={hp.y - hs / 2}
              width={hs}
              height={hs}
              rx={3 / info.zoom}
            />
          {/each}
        {/if}
      {/if}
    </svg>
    <!-- shape labels: HTML divs with KaTeX centered in the shape -->
    {#each g.objects.filter((o) => o.type !== "text" && o.type !== "arrow" && o.type !== "function" && (o.text || o.textBelow)) as o (o.id + "lbl")}
      {@const p = loc(o, o.x, o.y)}
      <div
        class="te-text-node te-shape-label {sel === o.id ? 'te-text-selected' : ''}"
        style="left: {p.x}px; top: {p.y}px; color: {colorHex(o.color)};"
        data-id={o.id}
        on:dblclick={() => dblclickObject(o)}
      >{@html renderMathText(o.text)}</div>
    {/each}
    <!-- text objects: HTML divs with KaTeX (auto-sized) -->
    {#each g.objects.filter((o) => o.type === "text") as o (o.id)}
      {@const p = loc(o, o.x, o.y)}
      <div
        class="te-text-node {sel === o.id ? 'te-text-selected' : ''}"
        style="left: {p.x}px; top: {p.y}px; color: {colorHex(o.color)};"
        data-id={o.id}
        on:dblclick={() => dblclickObject(o)}
      >{@html renderMathText(o.text)}</div>
    {/each}
    <!-- arrow labels: text above / textBelow below; vertical arrows get left/right placement -->
    {#each g.objects.filter((o) => o.type === "arrow" && (o.text || o.textBelow)) as o (o.id + "l")}
      {@const p = loc(o, (o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2)}
      {@const vertical = Math.abs(o.y2 - o.y1) > Math.abs(o.x2 - o.x1)}
      {@const ta = vertical ? { x: p.x - 9, y: p.y } : { x: p.x, y: p.y - 9 }}
      {@const tb = vertical ? { x: p.x + 9, y: p.y } : { x: p.x, y: p.y + 9 }}
      <div class="te-text-node te-arrow-label" style="left: {ta.x}px; top: {ta.y}px; color: {colorHex(o.color)};" data-id={o.id} on:dblclick={() => editor.startInsert(o.id, "text")}>{@html renderMathText(o.text)}</div>
      {#if o.textBelow}
        <div class="te-text-node te-arrow-label" style="left: {tb.x}px; top: {tb.y}px; color: {colorHex(o.color)};" data-id={o.id} on:dblclick={() => editor.startInsert(o.id, "textBelow")}>{@html renderMathText(o.textBelow)}</div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .te-viewport {
    position: absolute;
    inset: 0;
    overflow: auto;
    background: var(--background-secondary);
    cursor: grab;
  }
  .te-wrap {
    position: relative;
    transform-origin: 0 0;
    overflow: visible;
  }
  .te-scene {
    position: absolute;
    inset: 0;
    overflow: visible;
  }
  :global(.te-drawn-hit) {
    /* "all" (not "stroke") so that the INTERIOR of a closed shape is
       clickable — with "stroke" only the outline could be grabbed, which
       made small shapes nearly impossible to select. Lines and polylines
       have no fill area, so they still respond to the stroke only. */
    pointer-events: all;
    cursor: pointer;
  }
  :global(.te-drawn-hit:hover + .te-drawn-vis) {
    stroke-width: 2.4;
  }
  :global(.te-drawn-vis) {
    pointer-events: none;
  }
  :global(.te-drawn-selected) {
    stroke-width: 2.6;
    filter: drop-shadow(0 0 3px var(--interactive-accent));
  }
  :global(.te-handle) {
    pointer-events: all;
    fill: var(--background-primary);
    stroke: var(--interactive-accent);
    stroke-width: 1.5;
  }
  .te-text-node {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 5;
    cursor: pointer;
    padding: 1px 3px;
    border-radius: 3px;
    line-height: 1.25;
    max-width: 420px;
    white-space: pre;
    font-size: 10px;
  }
  :global(.katex) {
    font-size: 1.05em;
  }
  .te-shape-label {
    z-index: 4;
    font-size: 9px;
  }
  .te-text-node:hover {
    outline: 1px solid rgba(124, 140, 255, 0.4);
  }
  .te-text-selected {
    outline: 1.5px solid var(--interactive-accent);
  }
  .te-arrow-label {
    pointer-events: all;
  }
</style>
