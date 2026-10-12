import { conditionLabel, type AiSuggestion } from '@campus-walk/shared';

/** What the model saw in the latest photo. The form is already pre-filled; this says where that came from. */
export function SuggestionNotice({ suggestion }: { suggestion: AiSuggestion }) {
  const parts = [
    suggestion.assetTypeName ?? (suggestion.assetTypeId ? 'a known type' : null),
    suggestion.condition ? `condition ${suggestion.condition} (${conditionLabel(suggestion.condition)})` : null,
  ].filter(Boolean);
  return (
    <div className="notice ai small">
      <strong>Claude suggests</strong>
      {parts.length > 0 && <>: {parts.join(', ')}</>} · {suggestion.confidence} confidence
      {suggestion.note && <div style={{ marginTop: 4 }}>{suggestion.note}</div>}
      <div className="muted" style={{ marginTop: 4 }}>
        Pre-filled below. Change anything that is wrong; the suggestion stays on the photo for audit.
      </div>
    </div>
  );
}
