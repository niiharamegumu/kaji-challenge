import { useUserPreferences } from "../state/userPreferences";

export function UserPreferencesStatus() {
  const { writable, saving, error, refresh } = useUserPreferences();
  if (error)
    return (
      <div role="alert" className="mt-3 text-sm text-danger">
        <p>{error}</p>
        <button
          type="button"
          onClick={refresh}
          disabled={saving}
          className="mt-1 min-h-11 underline"
        >
          再取得
        </button>
      </div>
    );
  if (!writable || saving)
    return (
      <p role="status" className="mt-3 text-sm text-secondary">
        {saving ? "設定を保存中…" : "設定を読み込み中…"}
      </p>
    );
  return null;
}
