import { createRequire } from "node:module";
import type { Request } from "express";
import multer from "multer";
import { createCanvas } from "@napi-rs/canvas";
import type { AppConfig } from "./config.js";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs") as typeof import("pdfjs-dist/legacy/build/pdf.mjs");

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".pdf"]);
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

export type UploadRequest = Request & { file?: Express.Multer.File };

export function createUpload(config: AppConfig) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
    fileFilter: (_request, file, callback) => {
      const extension = file.originalname.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
      if (ALLOWED_MIME.has(file.mimetype) || (extension && ALLOWED_EXTENSIONS.has(extension))) {
        callback(null, true);
        return;
      }
      callback(new Error("Unsupported file type. Upload a PNG, JPEG, WebP image, or a PDF."));
    },
  });
}

function extensionOf(filename: string): string {
  return filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || "";
}

export async function imageDataUrls(buffer: Buffer, filename: string, mimetype: string, maxPdfPages: number): Promise<string[]> {
  const extension = extensionOf(filename);
  if (mimetype !== "application/pdf" && extension !== ".pdf") {
    const mime = mimetype.startsWith("image/") ? mimetype
      : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
      : extension === ".webp" ? "image/webp" : "image/png";
    return [`data:${mime};base64,${buffer.toString("base64")}`];
  }
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const urls: string[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, maxPdfPages); pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({ canvas: canvas as never, canvasContext: canvas.getContext("2d") as never, viewport }).promise;
    urls.push(`data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`);
  }
  return urls;
}
