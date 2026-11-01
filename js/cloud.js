// cloud sync (optional): sign in with google and every player's profile, scores, history and ghosts are kept
// in the account, so they show up on the phone and the pc. same firebase project and method as muscle map:
// one firestore document per user (users/<uid>), pedal quest keeps its data in its own field of that document.
// without sign-in (or from file://) nothing leaves the browser.
import { all_data, apply_data, set_store_hook } from './util.js?v=26';

// web app config from the firebase console (public identifiers, not secrets; access is limited by the firestore rules)
const firebase_config = {
  apiKey: 'AIzaSyBWeN2S3PU5s6dvUXnZNo75V5MCSBfQsok',
  authDomain: 'muscle-map-b6827.firebaseapp.com',
  projectId: 'muscle-map-b6827',
  storageBucket: 'muscle-map-b6827.firebasestorage.app',
  messagingSenderId: '543826518667',
  appId: '1:543826518667:web:a7469e265b03667375aa8e',
};
const sdk = 'https://www.gstatic.com/firebasejs/12.12.0/';
const field = 'pedal_quest';

let fb = null, user = null, timer = null, state = '', just_signed_in = false;
let btn = null, on_remote = null, can_apply = () => true, pending = null;

const has_rides = (d) => Object.keys(d).some((k) => k.startsWith('pq_history') || k.startsWith('pq_stats'));

function render() {
  if (!btn) return;
  btn.hidden = !fb;
  btn.textContent = user ? `☁ ${state || 'Synced'}` : '☁ Sign in to sync';
  btn.className = `sync-btn ${!user ? 'signin' : state === 'Sync failed' ? 'fail' : 'ok'}`;
  btn.title = user ? `Synced with ${user.email}. Tap to sign out.` : 'Sign in with Google to keep players, scores and history on all your devices';
}
const set_state = (s) => { state = s; render(); };

// local changes are sent 1.5 s after the last one (a finished game writes several keys at once)
function queue() {
  if (!user) return;
  clearTimeout(timer);
  timer = setTimeout(push, 1500);
  set_state('Saving…');
}
async function push() {
  clearTimeout(timer);
  timer = null;
  try {
    // merge: muscle map keeps its own field in the same document
    await fb.setDoc(fb.doc(fb.db, 'users', user.uid), { [field]: JSON.stringify(all_data()), pq_updated: fb.serverTimestamp() }, { merge: true });
    set_state('Synced');
  } catch (e) {
    console.warn('sync failed', e);
    set_state('Sync failed');
  }
}

function apply(raw) {
  // never swap data in the middle of a game: keep it until the game is over
  if (!can_apply()) { pending = raw; return; }
  pending = null;
  apply_data(JSON.parse(raw));
  on_remote?.();
}
// call when a game ends: applies a sync that arrived while playing
export function flush() { if (pending) apply(pending); }
export const signed_in = () => !!user;

export async function init_cloud(opts) {
  ({ button: btn, on_remote, can_apply } = opts);
  set_store_hook(queue);
  render();
  if (location.protocol === 'file:') return;
  try {
    const [app, auth, fs] = await Promise.all(['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map((f) => import(sdk + f)));
    const fapp = app.initializeApp(firebase_config);
    fb = { ...auth, ...fs, auth: auth.getAuth(fapp), db: fs.getFirestore(fapp) };
  } catch (e) {
    console.warn('cloud sync unavailable', e);   // offline: the app works local-only
    return;
  }
  render();
  let unsub = null;
  fb.onAuthStateChanged(fb.auth, (u) => {
    user = u;
    if (unsub) { unsub(); unsub = null; }
    set_state('');
    if (!u) return;
    let first = true;
    // live updates: a ride finished on the phone shows up on the open pc tab and the other way round
    unsub = fb.onSnapshot(fb.doc(fb.db, 'users', u.uid), (snap) => {
      const is_first = first;
      first = false;
      if (snap.metadata.hasPendingWrites || timer) return;   // our own write, or local changes not sent yet
      const raw = snap.exists() ? snap.data()[field] : undefined;
      if (raw === undefined) { push(); return; }            // nothing saved for pedal quest yet: upload this device
      if (raw === JSON.stringify(all_data())) { set_state('Synced'); return; }
      // right after signing in on a device that already has rides, let the rider pick which copy wins
      if (is_first && just_signed_in && has_rides(all_data())
        && !confirm('Your account already has saved Pedal Quest data.\n\nOK = load it on this device (replaces the data here).\nCancel = keep this device\'s data and save it to your account.')) {
        push();
      } else {
        apply(raw);
        set_state('Synced');
      }
      just_signed_in = false;
    }, (e) => { console.warn('sync failed', e); set_state('Sync failed'); });
  });

  btn.onclick = async () => {
    if (user) {
      if (confirm(`Sign out ${user.email}? Your data stays saved in your account and on this device.`)) fb.signOut(fb.auth);
      return;
    }
    try {
      just_signed_in = true;
      await fb.signInWithPopup(fb.auth, new fb.GoogleAuthProvider());
    } catch (e) {
      just_signed_in = false;
      if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') alert(`Sign-in failed: ${e.message}`);
    }
  };
  // send pending changes right away when the phone switches apps
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer) push(); });
}
