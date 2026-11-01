import { tfmData } from 'dvi2html';
import { Buffer } from 'buffer';
import filesystem from './filesystem.json';

// Fake-filesystem glue matching the ABI of the deployed TeX wasm
// (transcribed from the deployed tikzjax bundle, kept byte-for-byte
// compatible: same function names, same argument conventions).

var files: any[] = [];
var memory: ArrayBuffer | undefined;
var inputBuffer: string | undefined;
var callback: (() => void) | undefined;
var wasmExports: any;
var view: Uint32Array | undefined;

export function deleteEverything(): void {
  files = [];
}

export function writeFileSync(filename: string, buffer: any): void {
  (filesystem as Record<string, string>)[filename] = btoa(buffer);
}

export function readFileSync(filename: string): Uint8Array {
  for (const f of files) {
    if (f.filename === filename) return f.buffer.slice(0, f.position);
  }
  throw Error(`Could not find file ${filename}`);
}

function openSync(filename: string, mode: string): number {
  let buffer = new Uint8Array();
  if ((filesystem as Record<string, string>)[filename]) {
    buffer = Uint8Array.from(Buffer.from((filesystem as Record<string, string>)[filename], 'base64'));
  }
  if (filename.match(/\.tfm$/)) {
    buffer = Uint8Array.from(tfmData(filename.replace(/\.tfm$/, '')));
  }
  if (filename === 'sample.tex') {
  
  }
  files.push({
    filename,
    position: 0,
    position2: 0,
    erstat: 0,
    eoln: false,
    descriptor: files.length,
    content: Buffer.from(buffer),
    buffer,
  });
  return files.length - 1;
}

function writeSync(file: any, buffer: Uint8Array, pointer?: number, length?: number): void {
  if (pointer === undefined) pointer = 0;
  if (length === undefined) length = buffer.length - pointer;
  while (length > file.buffer.length - file.position) {
    const b = new Uint8Array(1 + 2 * file.buffer.length);
    b.set(file.buffer);
    file.buffer = b;
  }
  file.buffer.subarray(file.position).set(buffer.subarray(pointer, pointer + length));
  file.position += length;
}

var consoleBuffer = '';
const stdoutSink = {
  stdout: {
    write(x: string): void {
      consoleBuffer += x;
      if (consoleBuffer.indexOf('\n') >= 0) {
        const lines = consoleBuffer.split('\n');
        consoleBuffer = lines.pop() as string;
        for (const line of lines) console.log(line);
      }
    },
  },
};

export function setMemory(m: ArrayBuffer): void {
  memory = m;
}

export function setWasmExports(e: any): void {
  wasmExports = e;
}

export function setInput(input: string, cb?: () => void): void {
  inputBuffer = input;
  if (cb) callback = cb;
}

// Asyncify helpers (only used around evaljs; harmless otherwise)
let b = 157286400;
let I = 163840000;
let unwindCount = 0;

export function startUnwind(): void {
  if (view) {
    view[b >> 2] = b + 8;
    view[(b >> 2) + 1] = I;
  }
  wasmExports.asyncify_start_unwind(b);
  unwindCount += 1;
}

export function startRewind(): void {
  wasmExports.asyncify_start_rewind(b);
  wasmExports.main();
}

export function stopRewind(): void {
  unwindCount -= 1;
  wasmExports.asyncify_stop_rewind();
}

export function getCurrentMinutes(): number {
  const d = new Date();
  return 60 * d.getHours() + d.getMinutes();
}

export function getCurrentDay(): number {
  return new Date().getDate();
}

export function getCurrentMonth(): number {
  return new Date().getMonth() + 1;
}

export function getCurrentYear(): number {
  return new Date().getFullYear();
}

export function printString(descriptor: number, x: number): void {
  const file = descriptor < 0 ? { stdout: true } : files[descriptor];
  const length = new Uint8Array(memory as ArrayBuffer, x, 1)[0];
  const buffer = new Uint8Array(memory as ArrayBuffer, x + 1, length);
  const str = String.fromCharCode.apply(null, buffer as unknown as number[]);
  if (file.stdout) {
    stdoutSink.stdout.write(str);
    return;
  }
  writeSync(file, Buffer.from(str));
}

export function printBoolean(descriptor: number, x: number): void {
  const file = descriptor < 0 ? { stdout: true } : files[descriptor];
  const result = x ? 'TRUE' : 'FALSE';
  if (file.stdout) {
    stdoutSink.stdout.write(result);
    return;
  }
  writeSync(file, Buffer.from(result));
}

export function printChar(descriptor: number, x: number): void {
  const file = descriptor < 0 ? { stdout: true } : files[descriptor];
  if (file.stdout) {
    stdoutSink.stdout.write(String.fromCharCode(x));
    return;
  }
  const bb = Buffer.alloc(1);
  bb[0] = x;
  writeSync(file, bb);
}

export function printInteger(descriptor: number, x: number): void {
  const file = descriptor < 0 ? { stdout: true } : files[descriptor];
  if (file.stdout) {
    stdoutSink.stdout.write(x.toString());
    return;
  }
  writeSync(file, Buffer.from(x.toString()));
}

export function printFloat(descriptor: number, x: number): void {
  const file = descriptor < 0 ? { stdout: true } : files[descriptor];
  if (file.stdout) {
    stdoutSink.stdout.write(x.toString());
    return;
  }
  writeSync(file, Buffer.from(x.toString()));
}

export function printNewline(descriptor: number, x: number): void {
  const file = descriptor < 0 ? { stdout: true } : files[descriptor];
  if (file.stdout) {
    stdoutSink.stdout.write('\n');
    return;
  }
  writeSync(file, Buffer.from('\n'));
}

export function reset(length: number, pointer: number): number {
  const buffer = new Uint8Array(memory as ArrayBuffer, pointer, length);
  let filename = String.fromCharCode.apply(null, buffer as unknown as number[]);
  filename = filename.replace(/ +$/g, '').replace(/^\*/, '').replace(/^TeXfonts:/, '');
  if (filename === 'TeXformats:TEX.POOL') filename = 'tex.pool';
  if (filename === 'TTY:') {
    files.push({ filename: 'stdin', stdin: true, position: 0, position2: 0, erstat: 0, eoln: false, content: Buffer.from(inputBuffer ?? '') });
    return files.length - 1;
  }
  return openSync(filename, 'r');
}

export function rewrite(length: number, pointer: number): number {
  const buffer = new Uint8Array(memory as ArrayBuffer, pointer, length);
  let filename = String.fromCharCode.apply(null, buffer as unknown as number[]);
  filename = filename.replace(/ +$/g, '');
  if (filename === 'TTY:') {
    files.push({ filename: 'stdout', stdout: true, erstat: 0 });
    return files.length - 1;
  }
  return openSync(filename, 'w');
}

export function getfilesize(descriptor: number, pointer: number): number {
  return 0;
}

export function snapshot(): number {
  return 1;
}

export function close(descriptor: number): void {
  const file = files[descriptor];
  if (file.descriptor) file.descriptor;
}

export function eof(descriptor: number): number {
  return files[descriptor].eof ? 1 : 0;
}

export function erstat(descriptor: number): number {
  return files[descriptor].erstat;
}

export function eoln(descriptor: number): number {
  return files[descriptor].eoln ? 1 : 0;
}

export function inputln(
  descriptor: number,
  pointer: number,
  length: number,
  bufferPtr: number,
  startPtr: number,
  endPtr: number,
  maxLen: number
): boolean {
  const file = files[descriptor];
  // Buffer VIEW over the wasm memory (a copy would not reach the wasm)
  const buf = Buffer.from(memory as ArrayBuffer, length, maxLen);
  const startArr = new Uint32Array(memory as ArrayBuffer, bufferPtr, 1);
  const endArr = new Uint32Array(memory as ArrayBuffer, startPtr, 1);
  new Uint32Array(memory as ArrayBuffer, endPtr, 1);
  endArr[0] = startArr[0];
  if (file.eof || (file.eoln && (file.position2 = file.position2 + 1))) {
    // no-op per deployed behavior
  }
  let l = file.content.indexOf(10, file.position2);
  if (l < 0) l = file.content.length;
  if (file.position2 >= file.content.length) {
    if (file.stdin && callback) callback();
    file.eof = true;
    return false;
  }
  const copied = file.content.copy(buf, startArr[0] === 1 && buf[0] === 0 ? 0 : startArr[0], file.position2, l);
  endArr[0] = startArr[0] + copied;
  while (32 === buf[endArr[0] - 1]) endArr[0] = endArr[0] - 1;
  file.position2 = l;
  file.eoln = true;
  return true;
}

export function evaljs(
  a: number, b2: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number
): void {
  const countArr = new Uint32Array(memory as ArrayBuffer, g, b2 + 1);
  const posArr = new Uint32Array(memory as ArrayBuffer, d, 1);
  const strBuf = new Uint8Array(memory as ArrayBuffer, b2, c + 1);
  const len = countArr[e + 1] - countArr[e];
  const code = new Uint8Array(memory as ArrayBuffer, b2 + countArr[e], len);
  const src = new TextDecoder('ascii').decode(code);
  const outBuf = new Uint32Array(memory as ArrayBuffer, h + 8 * (i - f), 512);
  const cb = {
    print(pr: string): void {
      const enc = new TextEncoder('ascii').encode(pr);
      const bb = Buffer.from(enc);
      strBuf.set(bb, posArr[0]);
      posArr[0] += enc.length;
    },
    count: new Proxy(outBuf, {
      get(t: any, prop: any): any {
        return t[2 * prop];
      },
      set(t: any, prop: any, val: any): boolean {
        t[2 * prop] = val;
        return true;
      },
    }),
  };
  // eslint-disable-next-line no-new-func
  new Function('tex', 'window', src)(cb, window);
}

export function get(descriptor: number, pointer: number, length: number): void {
  const file = files[descriptor];
  const buffer = new Uint8Array(memory as ArrayBuffer);
  new Uint8Array(memory as ArrayBuffer)[pointer] = inputBuffer!.charCodeAt(file.position);
  if (file.stdin) {
    if (file.position >= inputBuffer!.length) {
      buffer[pointer] = 13;
      file.eof = true;
      file.eoln = true;
      if (callback) callback();
    } else {
      buffer[pointer] = inputBuffer!.charCodeAt(file.position);
    }
  } else {
    if (!file.descriptor) {
      file.eof = true;
      file.eoln = true;
      return;
    }
    const read = readSync(file, buffer, pointer, length, file.position);
    if (read === 0) {
      buffer[pointer] = 0;
      file.eof = true;
      file.eoln = true;
      return;
    }
  }
  file.eoln = false;
  if (buffer[pointer] === 10) file.eoln = true;
  if (buffer[pointer] === 13) file.eoln = true;
  file.position = file.position + length;
}

function readSync(file: any, buffer: Uint8Array, pointer: number, length: number, seek: number): number {
  if (pointer === undefined) pointer = 0;
  if (length === undefined) length = buffer.length - pointer;
  if (length > file.buffer.length - seek) length = file.buffer.length - seek;
  buffer.subarray(pointer).set(file.buffer.subarray(seek, seek + length));
  return length;
}

export function put(descriptor: number, pointer: number, length: number): void {
  writeSync(files[descriptor], new Uint8Array(memory as ArrayBuffer), pointer, length);
}
