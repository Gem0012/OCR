import { useEffect, useState } from "react";
import { api, type Profile } from "./api";
import { Chip, storageLabel } from "./ui";

export default function ProfilesPage({ onEdit, onPlay }: { onEdit: (id: string | null) => void; onPlay: (id: string) => void }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState("");

  function load() {
    api.profiles().then(setProfiles).catch((caught) => setError(caught instanceof Error ? caught.message : "Failed to load profiles."));
  }

  useEffect(load, []);

  async function remove(profile: Profile) {
    if (!window.confirm(`Delete profile "${profile.name}" (${profile.id})? This cannot be undone.`)) return;
    try {
      await api.deleteProfile(profile.id);
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delete failed.");
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>App profiles</h2>
        <span className="spacer" />
        <button onClick={() => onEdit(null)}>New profile</button>
      </div>
      {error && <div className="error-note">{error}</div>}
      {!profiles ? (
        <div className="muted">Loading profiles...</div>
      ) : profiles.length === 0 ? (
        <div className="muted">
          No profiles yet. A profile tells the service which fields to pull out of a document — one per form of
          each of your apps.
        </div>
      ) : (
        <div className="cards">
          {profiles.map((profile) => (
            <div className="card" key={profile.id}>
              <h3>{profile.name}</h3>
              <div className="cid">{profile.id}</div>
              <div className="chips">
                <Chip>{profile.fields.length} field{profile.fields.length === 1 ? "" : "s"}</Chip>
                <Chip tone={profile.storage === "none" ? undefined : "accent"}>{storageLabel(profile.storage)}</Chip>
                <Chip>{profile.model || "default model"}</Chip>
                {profile.has_api_key && <Chip tone="warn">API key</Chip>}
              </div>
              <div className="actions">
                <button className="quiet" onClick={() => onEdit(profile.id)}>Edit</button>
                <button className="quiet" onClick={() => onPlay(profile.id)}>Playground</button>
                <button className="quiet danger" onClick={() => remove(profile)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
