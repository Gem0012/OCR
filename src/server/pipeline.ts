import { createRequire } from "node:module";
import { createCanvas } from "@napi-rs/canvas";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs") as typeof import("pdfjs-dist/legacy/build/pdf.mjs");
const mammoth = require("mammoth") as typeof import("mammoth");
const XLSX = require("xlsx") as typeof import("xlsx");

export type Converted =
  | { pipeline: "vision"; urls: string[] }
  | { pipeline: "text"; pages: string[] };

/** A digital PDF needs at least this many extracted characters to skip the
 *  vision model; anything less is treated as a scan. */
const PDF_TEXT_THRESHOLD = 60;

function imageDataUrl(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function pdfPageTexts(buffer: Buffer, maxPages: number): Promise<string[]> {
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const texts: string[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, maxPages); pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" ").trim());
  }
  return texts;
}

async function pdfRenderUrls(buffer: Buffer, maxPages: number): Promise<string[]> {
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const urls: string[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, maxPages); pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({ canvas: canvas as never, canvasContext: canvas.getContext("2d") as never, viewport }).promise;
    urls.push(`data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`);
  }
  return urls;
}

function stripRtf(text: string): string {
  return text
    .replace(/\\'([0-9a-f]{2})/gi, " ")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Routes an upload to the vision or text pipeline:
 *  - digital PDFs (real text layer) -> text pages, skipping the slow vision encoder
 *  - scanned PDFs and images -> page images for the vision model
 *  - DOCX/XLSX/CSV/TXT/MD/RTF -> extracted text pages */
export async function convertUpload(buffer: Buffer, filename: string, mimetype: string, maxPdfPages: number): Promise<Converted> {
  const extension = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  switch (extension) {
    case ".pdf": {
      const texts = await pdfPageTexts(buffer, maxPdfPages);
      const textLength = texts.join("").length;
      if (textLength >= PDF_TEXT_THRESHOLD) return { pipeline: "text", pages: texts };
      return { pipeline: "vision", urls: await pdfRenderUrls(buffer, maxPdfPages) };
    }
    case ".docx": {
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value.trim();
      if (!text) throw new Error("The document appears to contain no readable text.");
      return { pipeline: "text", pages: [text] };
    }
    case ".xlsx":
    case ".xls": {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const pages = workbook.SheetNames
        .map((sheetName) => XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]).trim())
        .filter(Boolean);
      if (!pages.length) throw new Error("The spreadsheet has no readable data.");
      return { pipeline: "text", pages };
    }
    case ".csv":
    case ".txt":
    case ".md": {
      const text = buffer.toString("utf8").trim();
      if (!text) throw new Error("The file is empty.");
      return { pipeline: "text", pages: [text] };
    }
    case ".rtf": {
      const text = stripRtf(buffer.toString("latin1"));
      if (!text) throw new Error("The document appears to contain no readable text.");
      return { pipeline: "text", pages: [text] };
    }
    default: {
      // Images: llama.cpp's image decoder handles png/jpeg/webp/gif/bmp.
      const imageMime = mimetype.startsWith("image/") ? mimetype
        : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
        : extension === ".webp" ? "image/webp"
        : extension === ".bmp" ? "image/bmp"
        : extension === ".gif" ? "image/gif"
        : "image/png";
      return { pipeline: "vision", urls: [imageDataUrl(buffer, imageMime)] };
    }
  }
}
