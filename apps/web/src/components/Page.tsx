import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { setCurrentUser, useCurrentUser } from '../user';
import { describeError } from '../api/client';
import { useConfirm } from './Confirm';
import { discardDetail, unsavedChanges } from './UnsavedChanges';

interface PageProps {
  title: string;
  subtitle?: string;
  /** Where the back arrow goes. Omit on the home screen. */
  back?: string;
  /** Desktop-width content (the office summary); field screens keep the phone column. */
  wide?: boolean;
  children: ReactNode;
}

export function Page({ title, subtitle, back, wide = false, children }: PageProps) {
  const user = useCurrentUser();
  const confirm = useConfirm();
  return (
    <div className={wide ? 'shell wide' : 'shell'}>
      <header className="topbar">
        <div className="topbar-row">
          {back ? (
            <Link className="back" to={back} aria-label="Back">
              ‹
            </Link>
          ) : (
            <span style={{ width: 8 }} />
          )}
          <h1>
            {title}
            {subtitle && <span className="subtitle">{subtitle}</span>}
          </h1>
          {user && (
            <button
              className="userchip"
              title={`Switch walker: ${user.name}`}
              aria-label={`Switch walker: ${user.name}`}
              onClick={async () => {
                // One dialog either way; with unsaved edits it says they will be lost.
                const unsaved = unsavedChanges();
                const ok = await confirm(
                  unsaved
                    ? { title: `Stop walking as ${user.name} and discard changes?`, detail: discardDetail(unsaved.note), confirmLabel: 'Discard and switch', cancelLabel: 'Keep editing', danger: true }
                    : { title: `Stop walking as ${user.name}?`, confirmLabel: 'Switch walker' },
                );
                if (ok) setCurrentUser(null);
              }}
            >
              {/* Full name on wider screens; initials on a phone, where the title needs the room. */}
              <span className="full" aria-hidden="true">{user.name}</span>
              <span className="initials" aria-hidden="true">{initials(user.name)}</span>
            </button>
          )}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

/** "Matthew Santiago" → "MS", "Dana R." → "DR", "Priya" → "P"; letters only, so "(Office)" is skipped. */
export function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => Array.from(w).find((ch) => /\p{L}/u.test(ch)))
    .filter((ch): ch is string => !!ch);
  if (words.length === 0) return '?';
  const pick = words.length === 1 ? [words[0]!] : [words[0]!, words[words.length - 1]!];
  return pick.join('').toUpperCase();
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="center">
      <span className="spinner" /> {label}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="notice error row between">
      <span className="grow">{describeError(error)}</span>
      {onRetry && (
        <button className="btn sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Dates arrive as ISO strings; the field wants "today 2:14 PM", the office wants a full date. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
