import type { PhotoView } from '@campus-walk/shared';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { describeError } from '../api/client';
import { uploadPhoto, type UploadStage } from '../api/photos';

const STAGE_LABEL: Record<UploadStage, string> = {
  resizing: 'Preparing photo…',
  uploading: 'Uploading…',
  analyzing: 'Asking Claude what this is…',
};

interface PhotoSectionProps {
  photos: PhotoView[];
  /** What a new photo is of: an existing asset, the room itself, or nothing yet (asset still a draft). */
  subject: { assetId: string } | { roomId: string } | null;
  onAdded: (photo: PhotoView) => void;
  onRemove?: (photo: PhotoView) => void;
  /** Where a tap on a thumbnail goes; without it the image opens in a new tab. */
  linkTo?: (photo: PhotoView) => string;
}

/**
 * Add-photo tile plus thumbnails. The file input has no `capture` attribute on purpose: iOS and
 * Android then offer the camera and the photo library, which is what the walker asked for.
 */
export function PhotoSection({ photos, subject, onAdded, onRemove, linkTo }: PhotoSectionProps) {
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      onAdded(await uploadPhoto(file, subject, setStage));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setStage(null);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="photo-grid">
        {photos.map((p) => (
          <div key={p.id} className="photo">
            {linkTo ? (
              <Link to={linkTo(p)}>
                <img src={p.url} alt="Photo" />
              </Link>
            ) : (
              <a href={p.url} target="_blank" rel="noreferrer">
                <img src={p.url} alt="Photo" />
              </a>
            )}
            {onRemove && (
              <button type="button" className="x" aria-label="Remove photo" onClick={() => onRemove(p)}>
                ×
              </button>
            )}
          </div>
        ))}
        <label className="photo-btn">
          {stage ? <span className="spinner" /> : <span style={{ fontSize: '1.6rem' }}>📷</span>}
          <span className="small">{stage ? STAGE_LABEL[stage] : 'Add photo'}</span>
          <input ref={input} type="file" accept="image/*" disabled={!!stage}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
      </div>
      {error && <div className="notice error">{error}</div>}
    </div>
  );
}
