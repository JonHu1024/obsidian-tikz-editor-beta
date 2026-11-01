import { TikZEngine } from "../src/core/TikZEngine";
import { defaultGraph } from "../src/core/types";
import { generateTikZ } from "../src/core/TikZGenerator";

declare global {
  interface Window {
    __tz: { render: (name: string, code: string) => Promise<string>; ptPerCm: () => number };
  }
}

const engine = new TikZEngine();
const log: string[] = [];

const samples: Record<string, string> = {
  officialDemo: "\\begin{tikzpicture}\n\\draw (0,0) circle (1in);\n\\end{tikzpicture}",
  simpleGrid: "\\begin{tikzpicture}\n\\draw[gray!30, step=1cm] (0,0) grid (10,8);\n\\end{tikzpicture}",
  simpleArrow: "\\begin{tikzpicture}\n\\draw[->, thick] (0,4) -- (10.4,4);\n\\end{tikzpicture}",
  defaultTemplate: generateTikZ(defaultGraph(10, 8)),
  withText: (() => {
    const g = defaultGraph(10, 8);
    g.objects.push({ id: "o1", type: "text", x: 5, y: 4, color: "red", text: "Hello $x^2$", width: 3 });
    return generateTikZ(g);
  })(),
  chineseText: (() => {
    const g = defaultGraph(10, 8);
    g.objects.push({ id: "o1", type: "text", x: 5, y: 4, color: "red", text: "你好世界", width: 3 });
    return generateTikZ(g);
  })(),
  shapes: (() => {
    const g = defaultGraph(10, 8);
    g.objects.push({ id: "o1", type: "rectangle", x: 2, y: 2, color: "blue", text: "box", w: 2, h: 1.4 });
    g.objects.push({ id: "o2", type: "circle", x: 5, y: 4, color: "black", text: "", r: 0.9 });
    g.objects.push({ id: "o3", type: "diamond", x: 8, y: 6, color: "purple", text: "dia", size: 1.6 });
    g.objects.push({ id: "o4", type: "ellipse", x: 8, y: 2, color: "teal", text: "ell", rx: 1.2, ry: 0.8 });
    g.objects.push({ id: "o5", type: "arrow", x: 1, y: 1, color: "black", text: "label", textBelow: "under", x1: 0, y1: 0, x2: 2, y2: 2, startId: null, endId: null });
    g.objects.push({ id: "o6", type: "function", x: 0, y: 0, color: "green", text: "", expression: "sin(x) + 0.5*x", domain: [0, 9], offsetX: 0.5, offsetY: -0.2 });
    return generateTikZ(g);
  })(),
};

window.__tz = {
  samples,
  editor: engine,
  async download(): Promise<string> {
    const t0 = Date.now();
    try {
      await engine.downloadCore();
      return `downloaded in ${((Date.now() - t0) / 1000).toFixed(1)}s, ready=${engine.isCoreReady()}`;
    } catch (e) {
      return `download FAILED: ${String(e).slice(0, 200)}`;
    }
  },
  async render(name: string, code: string): Promise<string> {
    const div = document.createElement("div");
    div.style.cssText = "position:fixed;left:-100000px;top:0;width:0;height:0;overflow:hidden;";
    document.body.appendChild(div);
    const t0 = Date.now();
    let res: string;
    try {
      const err = await engine.renderIntoPublic(code, div);
      const svg = div.querySelector("svg");
      const ms = Date.now() - t0;
      if (!err && svg) {
        res = `${name}: OK ${ms}ms bbox=${svg.getBBox().width.toFixed(1)}x${svg.getBBox().height.toFixed(1)}`;
      } else {
        res = `${name}: FAILED (${ms}ms) ${JSON.stringify((err ?? div.textContent ?? "").slice(0, 600))}`;
      }
    } catch (e) {
      res = `${name}: THREW ${String(e).slice(0, 200)} STACK:${String((e as any).stack ?? '').split('\n').slice(0, 4).join('|')}`;
    }
    div.remove();
    return res;
  },
  ptPerCm() {
    return engine.ptPerCm;
  },
};

export {};
