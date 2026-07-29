PROGRESSION
===========

One app, two disciplines. A landing screen picks between them; each then
runs its own independent flow and keeps its own data.

  index.html        Landing + both views in one document
  styles.css        Shared tokens, then .landing / .pl / .bb scoped blocks
  shell.js          View routing, storage, Supabase session
  powerlifting.js   10-week block generator, chart, session logging
  bodybuilding.js   Split selector and session builder

Moving between disciplines
--------------------------
A fixed switcher sits at the bottom of both disciplines: two segments, the
active one marked, the other one tap away. Switching is direct — it never
routes back through the landing. The barbell button on its left returns to
the chooser if you want it.

The switcher is a single element outside both views. Which segment is active
is derived from the router's data-view attribute in CSS, so there is no state
to keep in sync. The shell also remembers each view's scroll position and
restores it on return, which matters on the long powerlifting page.

How the pieces relate
---------------------
The two disciplines never talk to each other. Each registers with the shell,
reads and writes its own namespace, and is otherwise self-contained.

  localStorage["progression-v1"] = {
    schemaVersion: 1,
    powerlifting: { ... },   // profile, section, programs
    bodybuilding: { ... }    // profile, split, sessions, programme
  }

Data saved by the two apps before they were merged (under the old keys
"powerlifting-progress-v1" and "bodybuilding-programme-v1") is adopted
automatically on first run. The old keys are left in place.

Accounts
--------
One account covers both disciplines. The session, the sign-in modal and every
trigger live in the shell, not in either view, so signing in works the same
from powerlifting or bodybuilding. Reachable from three places: the account
button in the discipline bar, and the powerlifting nav's desktop and mobile
buttons. Any element marked [data-auth-open] opens it; [data-auth-label] and
[data-auth-label-short] elements are kept in step with the session.

Signing in syncs the whole record — both namespaces — to Supabase. Cloud rows
written before the merge are read as powerlifting data and upgraded in place.

Signing out ends the session and leaves local data alone. The pre-merge app
cleared powerlifting data on sign-out; that is deliberately not carried over,
because anything that had not reached the cloud would be gone. To restore the
old behaviour, call PROGRESSION.clear() for each namespace in the SIGNED_OUT
branch of shell.js.

Why the CSS is scoped
---------------------
The two apps grew up separately and collide on class names (.eyebrow,
.status-pill, .modal, .setup-top) and on bare element selectors (input,
label, svg, dd). Every rule is namespaced under .landing, .pl or .bb so
neither can restyle the other. Shared tokens live once, at the top.

Running it
----------
  node serve.mjs      then open http://localhost:3020

Deploying
---------
netlify.toml publishes this folder as-is; index.html is the entry point.
