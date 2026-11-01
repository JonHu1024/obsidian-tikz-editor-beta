export class MathError extends Error {}

type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, log: Math.log10, log2: Math.log2,
  sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, sign: Math.sign,
  deg: (x) => (x * 180) / Math.PI,
  rad: (x) => (x * Math.PI) / 180,
  mod: (x, y) => ((x % y) + y) % y,
};

export class MathExpr {
  private tokens: Tok[] = [];
  private pos = 0;
  private xv = 0;

  constructor(private src: string) {
    this.tokenize();
  }

  private tokenize(): void {
    const s = this.src.replace(/\s+/g, "");
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if ((c >= "0" && c <= "9") || c === ".") {
        let j = i;
        while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === ".")) j++;
        if (s[j] === "e" || s[j] === "E") {
          let k = j + 1;
          if (s[k] === "+" || s[k] === "-") k++;
          // fold the exponent only when a digit actually follows; otherwise
          // the letter belongs to the next token ("2e" must stay 2,e not a
          // silently-truncated 2, "2exp(x)" must not eat the e)
          if (k < s.length && s[k] >= "0" && s[k] <= "9") {
            for (j = k; j < s.length && s[j] >= "0" && s[j] <= "9"; j++);
          }
        }
        const num = parseFloat(s.slice(i, j));
        if (isNaN(num)) throw new MathError(`Invalid number: ${s.slice(i, j)}`);
        this.tokens.push({ t: "num", v: num });
        i = j;
      } else if (/[a-zA-Z]/.test(c)) {
        let j = i;
        while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
        this.tokens.push({ t: "id", v: s.slice(i, j) });
        i = j;
      } else if (c === "+" || c === "-" || c === "*" || c === "/" || c === "^") {
        this.tokens.push({ t: "op", v: c });
        i++;
      } else if (c === "(") {
        this.tokens.push({ t: "lp" });
        i++;
      } else if (c === ")") {
        this.tokens.push({ t: "rp" });
        i++;
      } else if (c === ",") {
        this.tokens.push({ t: "comma" });
        i++;
      } else {
        throw new MathError(`Unexpected character: ${c}`);
      }
    }
    this.tokens.push({ t: "rp" });
  }

  private peek(): Tok {
    return this.tokens[this.pos];
  }

  private next(): Tok {
    return this.tokens[this.pos++];
  }

  evaluate(x: number): number {
    this.pos = 0;
    this.xv = x;
    const v = this.additive();
    if (this.peek().t !== "rp") throw new MathError("Unexpected end of expression");
    if (isNaN(v) || !isFinite(v)) return NaN;
    return v;
  }

  private additive(): number {
    let v = this.multiplicative();
    while (this.peek().t === "op") {
      const op = (this.peek() as { v: string }).v;
      if (op !== "+" && op !== "-") break;
      this.next();
      const r = this.multiplicative();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  private multiplicative(): number {
    let v = this.unary();
    while (this.peek().t === "op") {
      const op = (this.peek() as { v: string }).v;
      if (op !== "*" && op !== "/") break;
      this.next();
      const r = this.power();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }

  private power(): number {
    // base binds at atom level so that "-2^2" parses as -(2^2); the
    // exponent side recurses through unary() to allow "2^-3"
    const base = this.atom();
    if (this.peek().t === "op" && (this.peek() as { v: string }).v === "^") {
      this.next();
      const exp = this.unary();
      return Math.pow(base, exp);
    }
    return base;
  }

  private unary(): number {
    if (this.peek().t === "op") {
      const op = (this.peek() as { v: string }).v;
      if (op === "-" || op === "+") {
        this.next();
        const v = this.unary();
        return op === "-" ? -v : v;
      }
    }
    return this.power();
  }

  private atom(): number {
    const tok = this.next();
    switch (tok.t) {
      case "num":
        return tok.v;
      case "id": {
        const name = tok.v;
        if (name === "x") return this.xv;
        if (name === "pi") return Math.PI;
        if (name === "e") return Math.E;
        if (name === "tau") return Math.PI * 2;
        if (Object.prototype.hasOwnProperty.call(FUNCS, name)) {
          if (this.peek().t !== "lp") throw new MathError(`Function ${name} needs parentheses`);
          this.next();
          const args: number[] = [];
          args.push(this.additive());
          while (this.peek().t === "comma") {
            this.next();
            args.push(this.additive());
          }
          if (this.peek().t !== "rp") throw new MathError(`Missing ')' in ${name}`);
          this.next();
          return FUNCS[name](...args);
        }
        throw new MathError(`Unknown identifier: ${name}`);
      }
      case "lp": {
        const v = this.additive();
        if (this.peek().t !== "rp") throw new MathError("Missing ')'");
        this.next();
        return v;
      }
      default:
        throw new MathError("Unexpected token");
    }
  }
}

export function sampleFunction(expr: string, domain: [number, number], samples: number): { x: number; y: number }[] {
  const parsed = new MathExpr(expr);
  const pts: { x: number; y: number }[] = [];
  const step = (domain[1] - domain[0]) / samples;
  for (let i = 0; i <= samples; i++) {
    const x = domain[0] + i * step;
    const y = parsed.evaluate(x);
    if (isNaN(y)) continue;
    pts.push({ x, y });
  }
  return pts;
}
