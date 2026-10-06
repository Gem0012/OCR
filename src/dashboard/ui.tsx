import { type ReactNode } from "react";

export function Chip({ children, tone }: { children: ReactNode; tone?: "accent" | "warn" }) {
  return <span className={`chip ${tone ?? ""}`}>{children}</span>;
}

export function FieldRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`form-row ${className ?? ""}`}>
      {label}
      {children}
    </label>
  );
}

export function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`status-dot ${ok ? "ok" : "bad"}`} />;
}

export function storageLabel(storage: string): string {
  return storage === "local" ? "SQLite" : storage === "supabase" ? "Supabase" : "Stateless";
}
