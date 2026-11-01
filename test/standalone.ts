// Standalone browser build of the TikZ Editor (real TikZJax engine).
// Open test/standalone.html in Chrome; click "Download TeX core" once,
// then the full editor runs with the real TeX renderer — 1:1 with Obsidian.
import App from "../src/components/App.svelte";
import { editor } from "../src/EditorController";
import { defaultGraph, makeId } from "../src/core/types";
import type { TikZGraph } from "../src/core/types";

declare global {
  interface Window {
    __te: Record<string, unknown>;
  }
}

function sampleGraph(): TikZGraph {
  const g = defaultGraph(12, 8);
  g.axis.enabled = false;
  g.grid.enabled = false;
  g.objects.push(
    { id: makeId(g), type: "text", x: 3, y: 6.5, color: "red", text: "$x^2 + 1$", width: 2 },
    { id: makeId(g), type: "rectangle", x: 3, y: 3, color: "blue", text: "box", w: 2, h: 1.4 },
    { id: makeId(g), type: "circle", x: 8, y: 6.5, color: "black", text: "", r: 0.8 },
    { id: makeId(g), type: "ellipse", x: 8, y: 3, color: "teal", text: "ell", rx: 1.2, ry: 0.8 },
    { id: makeId(g), type: "arrow", x: 3, y: 1, color: "black", text: "up", textBelow: "", x1: 3, y1: 0.8, x2: 3, y2: 2.2, startId: null, endId: null }
  );
  return g;
}

const root = document.getElementById("root") as HTMLElement;
new App({ target: root });

window.__te = {
  editor,
  getState: () => {
    const read = <T,>(store: { subscribe: (cb: (v: T) => void) => () => void }): T => {
      let v: T;
      store.subscribe((x) => {
        v = x;
      })();
      return v;
    };
    // dynamic import to keep the bundle small
    void read;
  },
};

editor.loadGraph(sampleGraph());
export {};
