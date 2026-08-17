/**
 * Minimal ZIP reader (central-directory based) so an operator can drop the whole
 * reference archive instead of 150 individual files.
 *
 * Supports STORED (0) and DEFLATE (8) entries; deflate uses the platform
 * DecompressionStream. Anything else is reported as an unsupported entry.
 */
export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const Ctor = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!Ctor) throw new Error("deflate entries are not supported in this environment");
  const copy = new Uint8Array(bytes);
  const stream = new Blob([copy.buffer as ArrayBuffer]).stream().pipeThrough(new Ctor("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= 0 && i > bytes.byteLength - 66000; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP archive (end-of-central-directory not found)");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];

  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(offset, true) !== CDH_SIG) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = bytes.slice(dataStart, dataStart + compressedSize);
    if (method === 0) entries.push({ name, bytes: raw });
    else if (method === 8) entries.push({ name, bytes: await inflateRaw(raw) });
    else throw new Error(`unsupported ZIP compression method ${method} for ${name}`);
  }
  return entries;
}

export function isZipName(name: string): boolean {
  return /\.zip$/i.test(name);
}
