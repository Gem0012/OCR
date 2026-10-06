import { useEffect, useState } from "react";
import PlaygroundPage from "./dashboard/PlaygroundPage";
import ProfileEditor from "./dashboard/ProfileEditor";
import ProfilesPage from "./dashboard/ProfilesPage";
import RecordsPage from "./dashboard/RecordsPage";
import SettingsPage from "./dashboard/SettingsPage";

type Page =
  | { kind: "profiles" }
  | { kind: "editor"; id: string | null }
  | { kind: "records" }
  | { kind: "playground"; profileId?: string }
  | { kind: "settings" };

const NAV: Array<{ kind: Page["kind"]; label: string }> = [
  { kind: "profiles", label: "Profiles" },
  { kind: "records", label: "Records" },
  { kind: "playground", label: "Playground" },
  { kind: "settings", label: "Settings" },
];

export default function App() {
  const [page, setPage] = useState<Page>({ kind: "profiles" });

  useEffect(() => {
    document.title = "OCR Service";
  }, []);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>OCR Service</strong>
          <span>document extraction for your apps</span>
        </div>
        {NAV.map((item) => (
          <button
            key={item.kind}
            className={`nav-item ${page.kind === item.kind || (page.kind === "editor" && item.kind === "profiles") ? "active" : ""}`}
            onClick={() => setPage({ kind: item.kind } as Page)}
          >
            {item.label}
          </button>
        ))}
        <div className="sidebar-foot">local · llama.cpp · your data</div>
      </aside>
      <div className="content">
        {page.kind === "profiles" && (
          <ProfilesPage
            onEdit={(id) => setPage({ kind: "editor", id })}
            onPlay={(id) => setPage({ kind: "playground", profileId: id })}
          />
        )}
        {page.kind === "editor" && <ProfileEditor id={page.id} onDone={() => setPage({ kind: "profiles" })} />}
        {page.kind === "records" && <RecordsPage />}
        {page.kind === "playground" && <PlaygroundPage key={page.profileId ?? "manual"} initialProfileId={page.profileId} />}
        {page.kind === "settings" && <SettingsPage />}
      </div>
    </div>
  );
}
