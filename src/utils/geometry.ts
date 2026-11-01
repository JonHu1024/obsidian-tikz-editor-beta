import type { CanvasInfo } from "../state";
import { CANVAS_MARGIN as MARGIN_CM } from "../state";

export const PT_PER_CM = 28.3465;

export interface Pt {
  x: number;
  y: number;
}

export function cmToLocal(xCm: number, yCm: number, graphH: number, info: CanvasInfo): Pt {
  void graphH;
  return {
    x: (xCm - info.contentMinX + MARGIN_CM) * info.ptPerCm,
    y: (info.contentMaxY + MARGIN_CM - yCm) * info.ptPerCm,
  };
}

export function localToCm(lx: number, ly: number, graphH: number, info: CanvasInfo): Pt {
  void graphH;
  return {
    x: lx / info.ptPerCm + info.contentMinX - MARGIN_CM,
    y: info.contentMaxY + MARGIN_CM - ly / info.ptPerCm,
  };
}

/** The content extent (in cm) the canvas is currently laid out against. */
export interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function currentExtent(info: CanvasInfo): Extent {
  return {
    minX: info.contentMinX,
    minY: info.contentMinY,
    maxX: info.contentMaxX,
    maxY: info.contentMaxY,
  };
}

/** Convert a viewport-local point to cm against a FIXED extent.
 *
 *  Why this exists: `localToCm` derives the cm position from the canvas
 *  extent (contentMinX / contentMaxY). The extent grows while an object is
 *  dragged (the canvas auto-grows with its content), so the same pointer
 *  position mapped to a DIFFERENT cm value on the next mousemove — the
 *  object accelerated away from the cursor as soon as it left the canvas
 *  bounds. Freezing the extent for the duration of a drag removes that
 *  feedback loop entirely. */
export function localToCmFixed(lx: number, ly: number, ext: Extent, info: CanvasInfo): Pt {
  return {
    x: lx / info.ptPerCm + ext.minX - MARGIN_CM,
    y: ext.maxY + MARGIN_CM - ly / info.ptPerCm,
  };
}

export function eventToLocal(e: MouseEvent, wrap: HTMLElement, info: CanvasInfo): Pt {
  const r = wrap.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / info.zoom,
    y: (e.clientY - r.top) / info.zoom,
  };
}
