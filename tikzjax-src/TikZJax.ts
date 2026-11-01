import { dvi2html } from 'dvi2html';
import { Writable } from 'stream';
import * as library from './library.ts';
import { Inflate } from 'pako';
import { Buffer } from 'buffer';
import process from 'process';

(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
(globalThis as unknown as { process: unknown }).process = process;

// TikZJax renderer built from the upstream source, patched for:
//  - a programmatic API: window.__tikzjaxRender(root) -> Promise
//  - hardcoded CDN resource URLs (bundled script has no src)

const urlRoot = 'https://s3.us-east-2.amazonaws.com/tikzjax.com';
const TEX_WASM = urlRoot + '/3f69afb974a1e83f66a36f7618f88a38c254034b.wasm';
const CORE_GZ = urlRoot + '/b565ab0b474e8e557d954694b7379a57db669ac9.gz';

let pages = 2500;
let coredump: Uint8Array | undefined;
let code: ArrayBuffer | undefined;

/** The engine pre-downloads and caches the TeX core; pass it in here. */
export function setCore(wasm: ArrayBuffer, core: Uint8Array): void {
  code = wasm;
  coredump = core;
}

async function load(): Promise<void> {
  if (coredump && code) return;
  // fallback download (used only if the engine did not prepare the core)
  let tex = await fetch(TEX_WASM);
  code = await tex.arrayBuffer();

  let response = await fetch(CORE_GZ);
  const buf = new Uint8Array(await response.arrayBuffer());
  const inf = new Inflate();
  inf.push(buf, true);
  coredump = new Uint8Array(inf.result, 0, pages * 65536);
}

function copy(src: Uint8Array): Uint8Array {
  const dst = new Uint8Array(src.length);
  dst.set(src);
  return dst;
}

async function tex(input: string): Promise<Uint8Array> {
  if (input.match('\\\\begin *{document}') === null) {
    input = '\\begin{document}\n' + input;
  }
  input = input + '\n\\end{document}\n';

  library.deleteEverything();
  library.writeFileSync('sample.tex', Buffer.from(input));

  let memory = new WebAssembly.Memory({ initial: pages, maximum: pages });

  let buffer = new Uint8Array(memory.buffer, 0, pages * 65536);
  buffer.set(copy(coredump as Uint8Array));

  library.setMemory(memory.buffer);
  library.setInput(' sample.tex \n\\end\n');

  const results = await WebAssembly.instantiate(code as ArrayBuffer, {
    library,
    env: { memory },
  });
  const exports = results.instance.exports as { main: () => void };
  library.setWasmExports(exports);
  exports.main();

  return library.readFileSync('sample.dvi');
}

/** The TeX log of the last run — used to report whether the document
 *  actually compiled (the e2e test greps the console for it). */
function texLog(): string {
  try {
    return new TextDecoder().decode(library.readFileSync('sample.log'));
  } catch {
    return '';
  }
}

export async function TikZJax(root: HTMLElement): Promise<void> {
  await load();

  async function process(elt: HTMLScriptElement): Promise<void> {
    const text = elt.childNodes[0]?.nodeValue ?? '';

    console.log('TikZJax: Rendering input:', text);

    const div = document.createElement('div');

    let dvi = await tex(text);

    // report the compile result — a TeX error leaves the log without the
    // "Output written" line, which is what the e2e test looks for
    const log = texLog();
    if (/Output written on .*\.dvi/.test(log)) {
      console.log('TikZJax: Output written on input.dvi');
    } else {
      const err = (log.match(/! [^\n]*/g) || []).slice(0, 2).join(' | ');
      console.log('TikZJax: FAILED to compile' + (err ? ': ' + err : ''));
    }

    let html = '';
    const page = new Writable({
      write(chunk: Buffer, _: unknown, callback: () => void) {
        html = html + chunk.toString();
        callback();
      },
    });

    let machine = await dvi2html(Buffer.from(dvi), page);
    div.style.display = 'flex';
    div.style.width = machine.paperwidth.toString() + 'pt';
    div.style.height = machine.paperheight.toString() + 'pt';
    div.style['align-items'] = 'center';
    div.style['justify-content'] = 'center';

    div.innerHTML = html;
    let svg = div.getElementsByTagName('svg');
    if (svg[0]) {
      svg[0].setAttribute('width', machine.paperwidth.toString() + 'pt');
      svg[0].setAttribute('height', machine.paperheight.toString() + 'pt');
      svg[0].setAttribute('viewBox', `-72 -72 ${machine.paperwidth} ${machine.paperheight}`);
    }

    elt.parentNode!.replaceChild(div, elt);
  }

  const scripts = root.getElementsByTagName('script');
  const tikzScripts = Array.prototype.slice.call(scripts).filter(
    (e: HTMLScriptElement) => e.getAttribute('type') === 'text/tikz');

  await tikzScripts.reduce(async (promise: Promise<void>, element: HTMLScriptElement) => {
    await promise;
    await process(element);
  }, Promise.resolve());
}

declare global {
  interface Window {
    __tikzjaxRender: (root: HTMLElement) => Promise<void>;
    __tikzjaxSetCore: (wasm: ArrayBuffer, core: Uint8Array) => void;
  }
}

window.__tikzjaxRender = TikZJax;
window.__tikzjaxSetCore = setCore;
