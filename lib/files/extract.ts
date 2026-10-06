// Turn an uploaded document into searchable passages that keep their page numbers.
// PDF → one entry per page (page refs) · DOCX/TXT/MD → numbered parts · images → no text (sent to vision models).

export const DOC_TYPES: Record<string, "pdf" | "docx" | "text"> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "text",
  "text/markdown": "text",
};
export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export const MAX_DOC_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // the strictest provider limit (Anthropic)
export const MAX_PAGES = 400;

/** Browsers sometimes send an empty or generic type; fall back to the file extension. */
export function detectMime(name: string, type: string): string {
  if (type && (DOC_TYPES[type] || IMAGE_TYPES.has(type))) return type;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (
    {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      txt: "text/plain",
      md: "text/markdown",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
    } as Record<string, string>
  )[ext] ?? type;
}

export interface Extracted {
  status: "ready" | "needs_ocr";
  pageCount: number | null;
  chunks: { page: number | null; chunkIndex: number; content: string }[];
  charCount: number;
}

export async function extractDocument(bytes: Uint8Array, mime: string): Promise<Extracted> {
  const type = DOC_TYPES[mime];
  if (type === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    if (totalPages > MAX_PAGES) throw new Error(`too_many_pages`);
    const pages = (text as string[]).map((t, i) => ({ page: i + 1, text: clean(t) }));
    const chars = pages.reduce((n, p) => n + p.text.length, 0);
    // Scanned PDFs are pictures of text: almost nothing to extract. Say so instead of silently missing it.
    const status = totalPages > 0 && chars / totalPages < 40 ? "needs_ocr" : "ready";
    return { status, pageCount: totalPages, chunks: chunkPages(pages), charCount: chars };
  }
  if (type === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    const text = clean(value);
    return { status: "ready", pageCount: null, chunks: chunkPages([{ page: null, text }]), charCount: text.length };
  }
  if (type === "text") {
    const text = clean(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
    return { status: "ready", pageCount: null, chunks: chunkPages([{ page: null, text }]), charCount: text.length };
  }
  throw new Error("unsupported_type");
}

function clean(t: string): string {
  return t.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const TARGET = 1400; // characters per passage (~350 tokens)

/** Split each page into passages of ~TARGET chars at paragraph/sentence breaks. Passages never cross pages. */
export function chunkPages(pages: { page: number | null; text: string }[]) {
  const out: { page: number | null; chunkIndex: number; content: string }[] = [];
  for (const { page, text } of pages) {
    if (!text) continue;
    let rest = text;
    while (rest.length > 0) {
      if (rest.length <= TARGET * 1.3) {
        out.push({ page, chunkIndex: out.length, content: rest });
        break;
      }
      const window = rest.slice(0, TARGET);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("\n"));
      const at = cut > TARGET * 0.5 ? cut + 1 : TARGET;
      out.push({ page, chunkIndex: out.length, content: rest.slice(0, at).trim() });
      rest = rest.slice(at).trim();
    }
  }
  return out;
}

/** "lecture3.pdf, p. 4" or "notes.docx, part 2" — what students see next to an answer. */
export function referenceLabel(fileName: string, page: number | null, chunkIndex: number): string {
  return page != null ? `${fileName}, p. ${page}` : `${fileName}, part ${chunkIndex + 1}`;
}
