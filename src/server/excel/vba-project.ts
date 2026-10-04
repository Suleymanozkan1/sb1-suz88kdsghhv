/**
 * vbaProject.bin writer — implementation of [MS-OVBA] (Office VBA File Format Structure).
 *
 *  - 2.4.1  compression (CompressedContainer / chunks / token sequences)
 *  - 2.3.4.2 `dir` stream (PROJECTINFORMATION, PROJECTREFERENCES, PROJECTMODULES)
 *  - 2.3.1  PROJECT stream (text) incl. CMG/DPB/GC values encrypted per 2.4.3
 *  - 2.3.3  PROJECTwm stream
 *  - 2.3.4.1 _VBA_PROJECT stream with Version 0xFFFF: no performance cache, so the host
 *    (Excel) compiles the modules from their source text on first load.
 *
 * Module sources must be ASCII (code page 1252 project); non-ASCII UI text is built with ChrW().
 */
import { randomBytes, randomUUID } from "node:crypto";
import CFB from "cfb";

// ───────────────────────── 2.4.1 Compression ─────────────────────────

function copyTokenHelp(difference: number) {
  let bitCount = 4;
  while (1 << bitCount < difference) bitCount++;
  const lengthMask = 0xffff >> bitCount;
  return { bitCount, lengthMask, maximumLength: lengthMask + 3 };
}

export function compress(data: Uint8Array): Buffer {
  const out: number[] = [0x01];
  for (let chunkStart = 0; chunkStart < data.length; chunkStart += 4096) {
    const chunkEnd = Math.min(chunkStart + 4096, data.length);
    const body: number[] = [];
    let pos = chunkStart;
    while (pos < chunkEnd) {
      const flagIndex = body.length;
      body.push(0);
      let flag = 0;
      for (let bit = 0; bit < 8 && pos < chunkEnd; bit++) {
        const difference = pos - chunkStart;
        let bestLen = 0;
        let bestOff = 0;
        if (difference > 0) {
          const { maximumLength } = copyTokenHelp(difference);
          const maxLen = Math.min(maximumLength, chunkEnd - pos);
          for (let cand = pos - 1; cand >= chunkStart; cand--) {
            let len = 0;
            while (len < maxLen && data[cand + len] === data[pos + len]) len++;
            if (len > bestLen) {
              bestLen = len;
              bestOff = pos - cand;
              if (len === maxLen) break;
            }
          }
        }
        if (bestLen >= 3) {
          const { bitCount } = copyTokenHelp(difference);
          const token = ((bestOff - 1) << (16 - bitCount)) | (bestLen - 3);
          body.push(token & 0xff, (token >> 8) & 0xff);
          flag |= 1 << bit;
          pos += bestLen;
        } else {
          body.push(data[pos]!);
          pos++;
        }
      }
      body[flagIndex] = flag;
    }
    if (body.length + 2 <= 4098 && body.length > 0) {
      const header = ((body.length + 2 - 3) & 0x0fff) | (0b011 << 12) | 0x8000;
      out.push(header & 0xff, (header >> 8) & 0xff, ...body);
    } else {
      // raw (uncompressed) chunk: only valid for a full 4096-byte chunk
      if (chunkEnd - chunkStart !== 4096) throw new Error("Incompressible partial chunk cannot be encoded (MS-OVBA raw chunks are 4096 bytes)");
      const header = (4096 + 2 - 3) | (0b011 << 12);
      out.push(header & 0xff, (header >> 8) & 0xff);
      for (let i = 0; i < 4096; i++) out.push(data[chunkStart + i]!);
    }
  }
  return Buffer.from(out);
}

export function decompress(buf: Uint8Array): Buffer {
  if (buf[0] !== 0x01) throw new Error("Invalid compressed container signature");
  const out: number[] = [];
  let p = 1;
  while (p < buf.length) {
    const header = buf[p]! | (buf[p + 1]! << 8);
    const size = (header & 0x0fff) + 3;
    const compressed = (header & 0x8000) !== 0;
    if (((header >> 12) & 0b111) !== 0b011) throw new Error("Invalid chunk signature");
    const end = p + size;
    p += 2;
    const chunkStart = out.length;
    if (!compressed) {
      for (let i = 0; i < 4096; i++) out.push(buf[p + i]!);
      p = end;
      continue;
    }
    while (p < end) {
      const flag = buf[p++]!;
      for (let bit = 0; bit < 8 && p < end; bit++) {
        if ((flag & (1 << bit)) === 0) out.push(buf[p++]!);
        else {
          const token = buf[p]! | (buf[p + 1]! << 8);
          p += 2;
          const { bitCount, lengthMask } = copyTokenHelp(out.length - chunkStart);
          const length = (token & lengthMask) + 3;
          const offset = (token >> (16 - bitCount)) + 1;
          const from = out.length - offset;
          for (let i = 0; i < length; i++) out.push(out[from + i]!);
        }
      }
    }
  }
  return Buffer.from(out);
}

// ───────────────────────── 2.4.3 Data encryption ─────────────────────────

export function encryptData(projectId: string, data: Uint8Array, seed = randomBytes(1)[0]!): string {
  const version = 2;
  const projectKey = [...Buffer.from(projectId, "latin1")].reduce((a, b) => (a + b) & 0xff, 0);
  const out: number[] = [seed, seed ^ version, seed ^ projectKey];
  let unencryptedByte1 = projectKey;
  let encryptedByte1 = seed ^ projectKey;
  let encryptedByte2 = seed ^ version;
  const push = (b: number) => {
    const enc = b ^ ((encryptedByte2 + unencryptedByte1) & 0xff);
    out.push(enc);
    encryptedByte2 = encryptedByte1;
    encryptedByte1 = enc;
    unencryptedByte1 = b;
  };
  const ignoredLength = (seed & 6) / 2;
  for (let i = 0; i < ignoredLength; i++) push(0x07);
  const len = data.length;
  for (const b of [len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff]) push(b);
  for (const b of data) push(b);
  return Buffer.from(out).toString("hex").toUpperCase();
}

export function decryptData(hex: string): Buffer {
  const d = Buffer.from(hex, "hex");
  const seed = d[0]!;
  const versionEnc = d[1]!;
  const projectKeyEnc = d[2]!;
  if ((seed ^ versionEnc) !== 2) throw new Error("Unsupported encryption version");
  const projectKey = seed ^ projectKeyEnc;
  let unencryptedByte1 = projectKey;
  let encryptedByte1 = projectKeyEnc;
  let encryptedByte2 = versionEnc;
  let p = 3;
  const next = () => {
    const enc = d[p++]!;
    const b = enc ^ ((encryptedByte2 + unencryptedByte1) & 0xff);
    encryptedByte2 = encryptedByte1;
    encryptedByte1 = enc;
    unencryptedByte1 = b;
    return b;
  };
  const ignoredLength = (seed & 6) / 2;
  for (let i = 0; i < ignoredLength; i++) next();
  const len = next() | (next() << 8) | (next() << 16) | (next() << 24);
  const out: number[] = [];
  for (let i = 0; i < len; i++) out.push(next());
  return Buffer.from(out);
}

// ───────────────────────── dir stream ─────────────────────────

class W {
  parts: Buffer[] = [];
  u16(v: number) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v);
    this.parts.push(b);
    return this;
  }
  u32(v: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0);
    this.parts.push(b);
    return this;
  }
  bytes(b: Buffer) {
    this.parts.push(b);
    return this;
  }
  rec(id: number, data: Buffer) {
    return this.u16(id).u32(data.length).bytes(data);
  }
  buf() {
    return Buffer.concat(this.parts);
  }
}
const a = (s: string) => Buffer.from(s, "latin1");
const u = (s: string) => Buffer.from(s, "utf16le");
const u32b = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
};
const u16b = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};

export interface VbaModule {
  name: string;
  type: "standard" | "document";
  /** source WITHOUT Attribute lines for standard modules is fine; attributes are prepended here */
  code: string;
  /** VB_Base GUID for document modules (workbook / worksheet) */
  base?: "workbook" | "worksheet";
}

const WORKBOOK_BASE = "0{00020819-0000-0000-C000-000000000046}";
const WORKSHEET_BASE = "0{00020820-0000-0000-C000-000000000046}";

export function moduleSource(m: VbaModule): string {
  const attrs =
    m.type === "standard"
      ? [`Attribute VB_Name = "${m.name}"`]
      : [
          `Attribute VB_Name = "${m.name}"`,
          `Attribute VB_Base = "${m.base === "workbook" ? WORKBOOK_BASE : WORKSHEET_BASE}"`,
          "Attribute VB_GlobalNameSpace = False",
          "Attribute VB_Creatable = False",
          "Attribute VB_PredeclaredId = True",
          "Attribute VB_Exposed = True",
          "Attribute VB_TemplateDerived = False",
          "Attribute VB_Customizable = True",
        ];
  const body = m.code.replace(/\r?\n/g, "\r\n").replace(/^(Attribute VB_[^\r\n]*\r\n)+/, "");
  return `${attrs.join("\r\n")}\r\n${body}${body.endsWith("\r\n") ? "" : "\r\n"}`;
}

function assertAscii(name: string, s: string) {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7e && s.charCodeAt(i) !== 0x09) {
      throw new Error(`VBA module ${name} contains non-ASCII character at ${i} (${JSON.stringify(s.slice(Math.max(0, i - 20), i + 5))}); use ChrW()`);
    }
  }
}

function dirStream(projectName: string, modules: VbaModule[]): Buffer {
  const w = new W();
  w.rec(0x0001, u32b(0x00000001)); // SYSKIND win32
  w.rec(0x0002, u32b(0x0409)); // LCID
  w.rec(0x0014, u32b(0x0409)); // LCIDINVOKE
  w.rec(0x0003, u16b(1252)); // CODEPAGE
  w.rec(0x0004, a(projectName)); // NAME
  w.rec(0x0005, Buffer.alloc(0)).rec(0x0040, Buffer.alloc(0)); // DOCSTRING + unicode
  w.rec(0x0006, Buffer.alloc(0)).rec(0x003d, Buffer.alloc(0)); // HELPFILEPATH 1/2
  w.rec(0x0007, u32b(0)); // HELPCONTEXT
  w.rec(0x0008, u32b(0)); // LIBFLAGS
  w.u16(0x0009).u32(0x00000004).u32(1).u16(0); // VERSION (major 1, minor 0)
  w.rec(0x000c, Buffer.alloc(0)).rec(0x003c, Buffer.alloc(0)); // CONSTANTS + unicode
  // REFERENCES (registered type libraries; Excel resolves them by GUID + version, the path is a hint)
  const refs: Array<[string, string]> = [
    ["VBA", "*\\G{000204EF-0000-0000-C000-000000000046}#4.2#9#C:\\PROGRA~1\\COMMON~1\\MICROS~1\\VBA\\VBA7.1\\VBE7.DLL#Visual Basic For Applications"],
    ["Excel", "*\\G{00020813-0000-0000-C000-000000000046}#1.9#0#C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE#Microsoft Excel 16.0 Object Library"],
    ["stdole", "*\\G{00020430-0000-0000-C000-000000000046}#2.0#0#C:\\Windows\\System32\\stdole2.tlb#OLE Automation"],
  ];
  for (const [name, id] of refs) {
    const libid = a(id);
    w.rec(0x0016, a(name)).rec(0x003e, u(name));
    w.rec(0x000d, Buffer.concat([u32b(libid.length), libid, u32b(0), u16b(0)]));
  }
  // MODULES
  w.rec(0x000f, u16b(modules.length));
  w.rec(0x0013, u16b(0xffff));
  for (const m of modules) {
    w.rec(0x0019, a(m.name));
    w.rec(0x0047, u(m.name));
    w.rec(0x001a, a(m.name)).rec(0x0032, u(m.name));
    w.rec(0x001c, Buffer.alloc(0)).rec(0x0048, Buffer.alloc(0));
    w.rec(0x0031, u32b(0)); // MODULEOFFSET: source starts at 0 (no performance cache)
    w.rec(0x001e, u32b(0)); // HELPCONTEXT
    w.rec(0x002c, u16b(0xffff)); // COOKIE
    w.u16(m.type === "standard" ? 0x0021 : 0x0022).u32(0); // TYPE
    w.u16(0x002b).u32(0); // TERMINATOR
  }
  w.u16(0x0010).u32(0); // dir terminator
  return w.buf();
}

export interface VbaProjectOptions {
  projectName?: string;
  projectId?: string;
}

export function buildVbaProject(modules: VbaModule[], opts: VbaProjectOptions = {}): Buffer {
  const projectName = opts.projectName ?? "HotelCostReport";
  const projectId = opts.projectId ?? `{${randomUUID().toUpperCase()}}`;
  const names = new Set<string>();
  for (const m of modules) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(m.name)) throw new Error(`Invalid VBA module name: ${m.name}`);
    if (names.has(m.name.toLowerCase())) throw new Error(`Duplicate VBA module name: ${m.name}`);
    names.add(m.name.toLowerCase());
  }

  const lines = [`ID="${projectId}"`];
  for (const m of modules) lines.push(m.type === "document" ? `Document=${m.name}/&H00000000` : `Module=${m.name}`);
  lines.push(
    `Name="${projectName}"`,
    `HelpContextID="0"`,
    `VersionCompatible32="393222000"`,
    `CMG="${encryptData(projectId, Buffer.from([0, 0, 0, 0]))}"`,
    `DPB="${encryptData(projectId, Buffer.from([0]))}"`,
    `GC="${encryptData(projectId, Buffer.from([0xff]))}"`,
    "",
    "[Host Extender Info]",
    "&H00000001={3832D640-CF90-11CF-8E43-00A0C911005A};VBE;&H00000000",
    "",
  );
  const project = a(lines.join("\r\n") + "\r\n");

  const wm = Buffer.concat([...modules.flatMap((m) => [a(m.name), Buffer.from([0]), u(m.name), Buffer.from([0, 0])]), Buffer.from([0, 0])]);

  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, "/PROJECT", project);
  CFB.utils.cfb_add(cfb, "/PROJECTwm", wm);
  CFB.utils.cfb_add(cfb, "/VBA/_VBA_PROJECT", Buffer.from([0xcc, 0x61, 0xff, 0xff, 0x00, 0x00, 0x00]));
  CFB.utils.cfb_add(cfb, "/VBA/dir", compress(dirStream(projectName, modules)));
  for (const m of modules) {
    const src = moduleSource(m);
    assertAscii(m.name, src);
    CFB.utils.cfb_add(cfb, `/VBA/${m.name}`, compress(Buffer.from(src, "latin1")));
  }
  // SheetJS adds a placeholder stream for compatibility; it is not part of a VBA project.
  CFB.utils.cfb_del(cfb, "/\u0001Sh33tJ5");
  return Buffer.from(CFB.write(cfb, { type: "buffer", fileType: "cfb" }) as Uint8Array);
}

/** Read back module sources (used by tests to prove the container round-trips). */
export function readVbaProject(bin: Buffer): { project: string; modules: Record<string, string> } {
  const cfb = CFB.read(bin, { type: "buffer" });
  const get = (p: string) => {
    const e = CFB.find(cfb, p);
    if (!e?.content) throw new Error(`Missing stream ${p}`);
    return Buffer.from(e.content as Uint8Array);
  };
  const project = get("/PROJECT").toString("latin1");
  const modules: Record<string, string> = {};
  for (const line of project.split("\r\n")) {
    const m = /^(?:Module|Document)=([^/]+)/.exec(line);
    if (m) modules[m[1]!] = decompress(get(`/VBA/${m[1]}`)).toString("latin1");
  }
  return { project, modules };
}
