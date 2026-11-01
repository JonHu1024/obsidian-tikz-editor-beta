import { get } from "svelte/store";
import App from "../src/components/App.svelte";
import { editor } from "../src/EditorController";
import { graph, vimMode, selectedId, insertState, activeTab, commandBuffer, renderError, canvasInfo, activePanel, graphVersion, arrowFlow } from "../src/state";
import { setTestKeybinds } from "../src/vim/VimController";

import { defaultGraph } from "../src/core/types";
import { generateTikZ } from "../src/core/TikZGenerator";
import { parseTikZ } from "../src/core/TikZParser";
import { MathExpr } from "../src/utils/math";
import { colorHex } from "../src/utils/colors";
import { DEFAULT_KEYS } from "../src/vim/keybindings";
import { buildMultiPlotTemplate } from "../src/core/multiPlot";
import type { TikZGraph } from "../src/core/types";

declare global {
  interface Window {
    __te: Record<string, unknown>;
  }
}

const root = document.getElementById("root") as HTMLElement;
new App({ target: root });

window.__te = {
  open(g?: TikZGraph) {
    editor.loadGraph(g ?? defaultGraph(10, 8));
  },
  editor,
  generateCode: (g: TikZGraph) => generateTikZ(g),
  parseCode: (code: string) => parseTikZ(code, defaultGraph(10, 8)),
  parseCodeCd: (code: string) => parseTikZ(code, defaultGraph(10, 8, "cd")),
  mathEval: (expr: string, x = 0) => new MathExpr(expr).evaluate(x),
  colorHex: (name: string) => colorHex(name),
  keys: DEFAULT_KEYS,
  getState: () => {
    const read = <T,>(store: { subscribe: (cb: (v: T) => void) => () => void }): T => {
      let v: T;
      store.subscribe((x) => {
        v = x;
      })();
      return v;
    };
    return {
      mode: read(vimMode),
      buffer: read(commandBuffer),
      selected: read(selectedId),
      insert: read(insertState),
      tab: read(activeTab),
      error: read(renderError),
      graph: read(graph),
      canvas: read(canvasInfo),
      panel: read(activePanel),
      flow: read(arrowFlow),
    };
  },
  setKeybinds: setTestKeybinds,
  buildMultiPlotTemplate,
  graphVersionValue: () => get(graphVersion),
  setActivePanel: (p: "preview" | "props") => activePanel.set(p),
};

// open with a default graph so the app has content immediately
(window.__te.open as (g?: TikZGraph) => void)();

export {};
