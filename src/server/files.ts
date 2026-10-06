import type { Request } from "express";
import multer from "multer";
import type { AppConfig } from "./config.js";

const ALLOWED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".pdf",
  ".docx", ".xlsx", ".xls", ".csv", ".txt", ".md", ".rtf",
]);
const ALLOWED_MIME = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp",
  "application/pdf", "text/plain", "text/markdown", "text/csv", "application/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/rtf", "text/rtf",
]);

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
      callback(new Error("Unsupported file type. Upload an image (PNG, JPEG, WebP, GIF, BMP), a PDF, or a document (DOCX, XLSX, CSV, TXT, MD, RTF)."));
    },
  });
}
