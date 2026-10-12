import type { SiteInfo } from '@campus-walk/shared';

/** Address and point of contact for a campus or building; renders nothing when all four are empty. */
export function SiteInfoCard({ info, children }: { info: SiteInfo; children?: React.ReactNode }) {
  const has = info.address || info.contactName || info.contactPhone || info.contactEmail;
  if (!has && !children) return null;
  return (
    <div className="card stack" style={{ gap: 6 }}>
      {children}
      {info.address && (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className="muted small" style={{ width: 64, flex: 'none' }}>
            Address
          </span>
          <a className="grow" href={`https://maps.google.com/?q=${encodeURIComponent(info.address)}`} target="_blank" rel="noreferrer">
            {info.address}
          </a>
        </div>
      )}
      {info.contactName && (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className="muted small" style={{ width: 64, flex: 'none' }}>
            Contact
          </span>
          <span className="grow">{info.contactName}</span>
        </div>
      )}
      {(info.contactPhone || info.contactEmail) && (
        <div className="btn-row" style={{ marginTop: 4 }}>
          {info.contactPhone && (
            <a className="btn sm" href={`tel:${info.contactPhone.replace(/[^\d+]/g, '')}`}>
              ☏ {info.contactPhone}
            </a>
          )}
          {info.contactEmail && (
            <a className="btn sm" href={`mailto:${info.contactEmail}`}>
              ✉ Email
            </a>
          )}
        </div>
      )}
    </div>
  );
}
