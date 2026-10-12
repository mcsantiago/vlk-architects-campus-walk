import { useState } from 'react';
import type { UserView } from '@campus-walk/shared';
import { api, describeError } from '../api/client';
import { useUsers } from '../api/queries';
import { readPref, setCurrentUser } from '../user';

/** First screen, once per device: who is walking. No password; the name is for the audit trail. */
export function WhoPage() {
  const users = useUsers();
  const [name, setName] = useState(() => readPref<string>('last-name', ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(n: string) {
    setBusy(true);
    setError(null);
    try {
      const user = await api<UserView>('/users', { method: 'POST', body: { name: n } });
      setCurrentUser({ id: user.id, name: user.name });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-row">
          <h1 style={{ paddingLeft: 8 }}>Campus Walk</h1>
        </div>
      </header>
      <main className="stack">
        <h2>Who's walking today?</h2>
        <p className="muted">Your name goes on every room you mark and every asset you record.</p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) choose(name);
          }}
        >
          <input
            className="input"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoFocus
          />
          <button className="btn primary block" disabled={busy || !name.trim()}>
            Start walking
          </button>
        </form>
        {error && <div className="notice error">{error}</div>}
        {users.data && users.data.length > 0 && (
          <div className="section">
            <h3>Or pick a name already on this campus</h3>
            <div className="chips">
              {users.data.map((u) => (
                <button key={u.id} className="chip" disabled={busy} onClick={() => choose(u.name)}>
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
