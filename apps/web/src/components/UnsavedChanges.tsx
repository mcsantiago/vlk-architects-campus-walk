import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useBlocker, type BlockerFunction } from 'react-router';
import { useConfirm } from './Confirm';

export interface UnsavedChanges {
  /** True while the form differs from what was loaded. */
  dirty: boolean;
  /** Extra sentence for the discard dialog, e.g. that photo changes are already saved. */
  note?: string;
}

interface GuardOptions extends UnsavedChanges {
  /**
   * True while a save is in flight. Navigation is then held without a dialog: the save is
   * about to either navigate on its own or fail and leave the form editable, and asking
   * "discard?" about changes that may already be saved would be wrong either way.
   */
  busy?: RefObject<boolean>;
}

/**
 * What the walker would lose, read by the walker switch in the header. Only one form is on
 * screen at a time, so one module-level slot is enough.
 */
let current: (UnsavedChanges & { busy?: RefObject<boolean> }) | null = null;
/** Unsaved edits that leaving would lose; none while a save is in flight (it is about to land). */
export const unsavedChanges = (): UnsavedChanges | null => (current?.dirty && !current.busy?.current ? current : null);

export const DISCARD_TITLE = 'Discard unsaved changes?';
export const discardDetail = (note?: string) =>
  `You have changes to this asset that haven't been saved. Leaving will discard those changes.${note ? ` ${note}` : ''}`;

/**
 * Guards a form against losing edits:
 *   - in-app navigation (links, the header back arrow, navigate(), browser back/forward) is
 *     held by React Router's blocker and released only if the walker confirms;
 *   - refresh and tab close get the browser's own beforeunload prompt;
 *   - the walker switch in the header asks via unsavedChanges().
 *
 * Returns `allowNextNavigation`, to call right before navigating after a successful save so the
 * stale "dirty" from before the save cannot block it. State is read through refs so the blocker
 * never acts on a dirty flag from an earlier render.
 */
export function useUnsavedChangesGuard({ dirty, note, busy }: GuardOptions) {
  const confirm = useConfirm();
  const dirtyRef = useRef(dirty);
  const noteRef = useRef(note);
  const bypass = useRef(false);
  dirtyRef.current = dirty;
  noteRef.current = note;

  useEffect(() => {
    current = { dirty, note, busy };
    return () => {
      current = null;
    };
  }, [dirty, note, busy]);

  // A dialog can outlive the page (a 401 signs the walker out underneath it); its answer must
  // then do nothing, since the blocker it would release is gone.
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => {
      if (bypass.current) return false;
      if (currentLocation.pathname === nextLocation.pathname && currentLocation.search === nextLocation.search) return false;
      return !!busy?.current || dirtyRef.current;
    },
    [busy],
  );
  const blocker = useBlocker(shouldBlock);
  // The blocker object is replaced on every router update; act on the latest one, not the one
  // captured when the dialog opened.
  const latest = useRef(blocker);
  latest.current = blocker;

  // One dialog per blocked navigation, even if the effect re-runs.
  const asking = useRef<string | null>(null);
  useEffect(() => {
    if (blocker.state !== 'blocked') {
      asking.current = null;
      return;
    }
    if (busy?.current) {
      blocker.reset(); // saving: hold the navigation quietly
      return;
    }
    const key = blocker.location.key;
    if (asking.current === key) return;
    asking.current = key;
    void confirm({ title: DISCARD_TITLE, detail: discardDetail(noteRef.current), confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true }).then((ok) => {
      const now = latest.current;
      if (gone.current || now.state !== 'blocked' || now.location.key !== key) return;
      if (ok) now.proceed();
      else now.reset();
    });
  }, [blocker, confirm, busy]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypass.current) return;
      e.preventDefault();
      // Older Safari and Chrome still need returnValue set to show the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return {
    allowNextNavigation: () => {
      bypass.current = true;
    },
  };
}
