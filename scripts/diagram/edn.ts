export type EdnMap = { [key: string]: EdnValue };

export type EdnValue = null | boolean | number | string | EdnValue[] | EdnMap;

const delimiters = new Set(["(", ")", "[", "]", "{", "}", '"', ";", ","]);

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === ",";
}

class Reader {
  private index = 0;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  read(): EdnValue {
    this.skipIgnored();
    const char = this.peek();
    if (char === undefined) throw new Error("Unexpected end of EDN");
    if (char === '"') return this.readString();
    if (char === ":") return this.readKeyword();
    if (char === "{") return this.readMap();
    if (char === "[") return this.readSequence("]");
    if (char === "(") return this.readSequence(")");
    if (char === "#") return this.readDispatch();
    return this.readToken();
  }

  private peek(offset = 0): string | undefined {
    return this.source[this.index + offset];
  }

  private next(): string {
    const char = this.source[this.index];
    if (char === undefined) throw new Error("Unexpected end of EDN");
    this.index += 1;
    return char;
  }

  private skipIgnored(): void {
    while (this.index < this.source.length) {
      const char = this.next();
      if (isWhitespace(char)) continue;
      if (char === ";") {
        while (this.index < this.source.length && this.next() !== "\n") continue;
        continue;
      }
      this.index -= 1;
      return;
    }
  }

  private readString(): string {
    this.next();
    let value = "";
    while (this.index < this.source.length) {
      const char = this.next();
      if (char === '"') return value;
      if (char !== "\\") {
        value += char;
        continue;
      }
      value += this.readEscape();
    }
    throw new Error("Unterminated EDN string");
  }

  private readEscape(): string {
    const char = this.next();
    if (char === "n") return "\n";
    if (char === "t") return "\t";
    if (char === "r") return "\r";
    if (char === "b") return "\b";
    if (char === "f") return "\f";
    if (char === "u") {
      const hex = this.source.slice(this.index, this.index + 4);
      this.index += 4;
      return String.fromCharCode(Number.parseInt(hex, 16));
    }
    return char;
  }

  private readKeyword(): string {
    this.next();
    return this.readTokenText();
  }

  private readSequence(close: string): EdnValue[] {
    this.next();
    const values: EdnValue[] = [];
    while (this.index < this.source.length) {
      this.skipIgnored();
      if (this.peek() === close) {
        this.next();
        return values;
      }
      values.push(this.read());
    }
    throw new Error(`Unterminated EDN sequence, expected ${close}`);
  }

  private readMap(): EdnMap {
    this.next();
    const map: EdnMap = {};
    while (this.index < this.source.length) {
      this.skipIgnored();
      if (this.peek() === "}") {
        this.next();
        return map;
      }
      const key = this.read();
      if (typeof key !== "string") throw new Error("EDN map keys must be strings or keywords");
      this.skipIgnored();
      map[key] = this.read();
    }
    throw new Error("Unterminated EDN map");
  }

  private readDispatch(): EdnValue {
    this.next();
    if (this.peek() === "_") {
      this.next();
      this.read();
      return this.read();
    }
    if (this.peek() === "{") return this.readSequence("}");
    throw new Error("Unsupported EDN dispatch");
  }

  private readToken(): EdnValue {
    const token = this.readTokenText();
    if (token === "nil") return null;
    if (token === "true") return true;
    if (token === "false") return false;
    if (token !== "" && !Number.isNaN(Number(token))) return Number(token);
    return token;
  }

  private readTokenText(): string {
    let value = "";
    while (this.index < this.source.length) {
      const char = this.peek();
      if (char === undefined || isWhitespace(char) || delimiters.has(char)) break;
      value += this.next();
    }
    return value;
  }
}

export function parseEdn(source: string): EdnValue {
  return new Reader(source).read();
}

export function asMap(value: EdnValue | undefined): EdnMap | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value;
}

export function asString(value: EdnValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: EdnValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function asBoolean(value: EdnValue | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function asArray(value: EdnValue | undefined): EdnValue[] {
  return Array.isArray(value) ? value : [];
}

export function asStrings(value: EdnValue | undefined): string[] {
  return asArray(value)
    .map((item) => asString(item))
    .filter((item): item is string => item !== undefined);
}
