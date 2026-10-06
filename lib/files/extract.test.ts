import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chunkPages, detectMime, extractDocument, referenceLabel } from "./extract";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url)));

describe("extractDocument", () => {
  it("PDF: keeps page numbers", async () => {
    const r = await extractDocument(fixture("lecture.pdf"), "application/pdf");
    expect(r.status).toBe("ready");
    expect(r.pageCount).toBe(2);
    expect(r.chunks.find((c) => c.content.includes("Stratified"))?.page).toBe(1);
    expect(r.chunks.find((c) => c.content.includes("Cluster"))?.page).toBe(2);
  });

  it("PDF with no text (scanned) is flagged, not silently accepted", async () => {
    const r = await extractDocument(fixture("scanned.pdf"), "application/pdf");
    expect(r.status).toBe("needs_ocr");
  });

  it("DOCX: extracts text as numbered parts", async () => {
    const r = await extractDocument(fixture("assignment.docx"), detectMime("assignment.docx", ""));
    expect(r.chunks[0].content).toContain("95 percent");
    expect(r.chunks[0].page).toBeNull();
  });

  it("TXT", async () => {
    const r = await extractDocument(new TextEncoder().encode("hello\n\n\n\nworld"), "text/plain");
    expect(r.chunks[0].content).toBe("hello\n\nworld");
  });
});

describe("chunking + labels", () => {
  it("splits long pages without crossing pages", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i} about sampling and variance.`).join(" ");
    const chunks = chunkPages([{ page: 1, text: long }, { page: 2, text: "short" }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length <= 1400 * 1.3)).toBe(true);
    expect(chunks.at(-1)).toMatchObject({ page: 2, content: "short" });
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("labels", () => {
    expect(referenceLabel("lec.pdf", 4, 9)).toBe("lec.pdf, p. 4");
    expect(referenceLabel("a.docx", null, 1)).toBe("a.docx, part 2");
  });
});
