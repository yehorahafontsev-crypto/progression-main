/* =========================================================================
   PROGRESSION — application shell.

   Owns the three things the two disciplines share and nothing else:
     · which view is on screen
     · one localStorage record, namespaced per discipline
     · the Supabase session, so signing in syncs both disciplines

   Powerlifting and bodybuilding never talk to each other. They register
   here, read and write their own namespace, and are otherwise independent.
   ========================================================================= */
window.PROGRESSION = (function () {
  "use strict";

  const STORAGE_KEY = "progression-v1";
  const SCHEMA_VERSION = 1;

  // The two apps used to ship separately. Anything already saved under the
  // old keys is adopted on first run; the old keys are left untouched so a
  // rollback still finds them.
  const LEGACY_KEYS = {
    powerlifting: "powerlifting-progress-v1",
    bodybuilding: "bodybuilding-programme-v1",
  };

  const VIEWS = ["landing", "powerlifting", "bodybuilding"];
  const modules = {};
  const mounted = {};

  let store = { schemaVersion: SCHEMA_VERSION, powerlifting: null, bodybuilding: null };

  /* ---------------- storage ---------------- */

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
      console.error("Could not save:", error);
    }
    if (remote.user) remote.push();
  }

  function migrateLegacy() {
    let adopted = false;
    Object.entries(LEGACY_KEYS).forEach(([namespace, key]) => {
      if (store[namespace]) return;
      const raw = localStorage.getItem(key);
      if (!raw) return;
      try {
        store[namespace] = JSON.parse(raw);
        adopted = true;
      } catch (error) {
        /* unreadable legacy data is simply skipped */
      }
    });
    return adopted;
  }

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.schemaVersion === SCHEMA_VERSION) store = parsed;
      } catch (error) {
        /* fall through to a fresh store */
      }
    }
    if (migrateLegacy()) persist();
  }

  function read(namespace) {
    return store[namespace] || null;
  }

  function write(namespace, payload) {
    store[namespace] = payload;
    persist();
  }

  function clear(namespace) {
    store[namespace] = null;
    persist();
  }

  /* ---------------- view routing ---------------- */

  // Where the user had scrolled to in each view, so switching back and forth
  // does not throw away their place on the long powerlifting page.
  const scrollMemory = {};

  function goTo(view) {
    if (!VIEWS.includes(view)) return;

    const leaving = document.documentElement.dataset.view;
    if (leaving) scrollMemory[leaving] = window.scrollY;
    if (leaving === view) return;

    document.documentElement.dataset.view = view;

    // Mark the active side of the discipline switcher for assistive tech; the
    // visible state comes from CSS on the same attribute.
    document.querySelectorAll("[data-for]").forEach((el) => {
      if (el.dataset.for === view) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });

    // Reveal animations and canvas sizing need layout, so a discipline is
    // only fully wired the first time it is actually shown.
    const module = modules[view];
    if (module && module.mount && !mounted[view]) {
      mounted[view] = true;
      try {
        module.mount();
      } catch (error) {
        console.error(`Failed to mount ${view}:`, error);
      }
    }

    // Restore after the swap has been laid out, otherwise the target scroll
    // offset does not exist yet and the call is discarded.
    const target = scrollMemory[view] || 0;
    requestAnimationFrame(() => window.scrollTo({ top: target, behavior: "auto" }));
  }

  function register(view, module) {
    modules[view] = module;
  }

  /* ---------------- supabase ---------------- */

  const SUPABASE_URL = "https://dhepsduetqcvxsxnesbb.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_elUEnbP_8glju36vywuhbg_qk0ilLon";

  const remote = {
    client:
      SUPABASE_URL.includes("YOUR-PROJECT-REF") || !window.supabase
        ? null
        : window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY),
    user: null,
    listeners: [],

    onChange(fn) {
      this.listeners.push(fn);
    },

    notify() {
      this.listeners.forEach((fn) => fn(this.user));
    },

    async push() {
      if (!this.client || !this.user) return;
      const { error } = await this.client
        .from("user_data")
        .upsert({ user_id: this.user.id, data: store, updated_at: new Date().toISOString() });
      if (error) console.error("Supabase save failed:", error.message);
    },

    async pull() {
      if (!this.client || !this.user) return;
      const { data, error } = await this.client
        .from("user_data")
        .select("data")
        .eq("user_id", this.user.id)
        .maybeSingle();
      if (error) {
        console.error("Supabase load failed:", error.message);
        return;
      }
      if (data && data.data) {
        const incoming = data.data;
        // Records written before the merge hold only the powerlifting shape.
        store = incoming.schemaVersion === SCHEMA_VERSION
          ? incoming
          : { schemaVersion: SCHEMA_VERSION, powerlifting: incoming, bodybuilding: store.bodybuilding };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        VIEWS.forEach((view) => {
          const module = modules[view];
          if (module && module.reload) module.reload();
        });
      } else {
        await this.push();
      }
    },

    async init() {
      if (!this.client) return;
      const {
        data: { session },
      } = await this.client.auth.getSession();
      this.user = session ? session.user : null;
      this.notify();
      if (this.user) await this.pull();

      this.client.auth.onAuthStateChange((event, session) => {
        this.user = session ? session.user : null;
        this.notify();
        if (event === "SIGNED_IN") this.pull();
        else if (event === "SIGNED_OUT") {
          // The session ends, the data stays. Wiping local work on sign-out
          // risks losing anything that never reached the cloud.
          VIEWS.forEach((view) => {
            const module = modules[view];
            if (module && module.reload) module.reload();
          });
        }
      });
    },
  };


  /* ---------------- account ----------------
     The session is shell-level, so the sign-in UI is too: one account covers
     both disciplines and is reachable from either. Triggers are any element
     marked [data-auth-open]; labels are any [data-auth-label] /
     [data-auth-label-short]. */

  const authUI = {
    mode: "signin",

    el(id) {
      return document.getElementById(id);
    },

    shortEmail(email) {
      return email.length > 18 ? email.slice(0, 16) + "…" : email;
    },

    setMode(mode) {
      this.mode = mode;
      const signin = mode === "signin";
      this.el("authTabSignin").classList.toggle("is-on", signin);
      this.el("authTabSignup").classList.toggle("is-on", !signin);
      this.el("authModalTitle").textContent = signin ? "Sign in" : "Create account";
      this.el("authSubmit").textContent = signin ? "Sign in" : "Create account";
      this.el("authPassword").setAttribute("autocomplete", signin ? "current-password" : "new-password");
      this.el("authError").textContent = "";
    },

    open() {
      if (!remote.client) {
        window.alert("Supabase is not configured yet — add SUPABASE_URL and SUPABASE_ANON_KEY in shell.js.");
        return;
      }
      const signedIn = Boolean(remote.user);
      this.el("authForm").classList.toggle("hidden", signedIn);
      this.el("authTabs").classList.toggle("hidden", signedIn);
      this.el("authSignedIn").classList.toggle("hidden", !signedIn);

      if (signedIn) {
        this.el("authModalTitle").textContent = "Your account";
        this.el("authWho").textContent = remote.user.email;
      } else {
        this.el("authForm").reset();
        this.setMode("signin");
      }
      this.el("authOverlay").classList.remove("hidden");
    },

    close() {
      this.el("authOverlay").classList.add("hidden");
    },

    // Every trigger reflects the current session, in both disciplines.
    refresh(user) {
      document.querySelectorAll("[data-auth-label]").forEach((el) => {
        el.textContent = user ? `${this.shortEmail(user.email)} · Account` : "Sign in";
      });
      document.querySelectorAll("[data-auth-label-short]").forEach((el) => {
        const text = el.querySelector(".dn-account-text");
        if (text) text.textContent = user ? this.shortEmail(user.email) : "Sign in";
        el.classList.toggle("is-signed-in", Boolean(user));
        const label = user ? `Account — signed in as ${user.email}` : "Sign in";
        el.setAttribute("aria-label", label);
        el.setAttribute("title", label);
      });
    },

    async submit(event) {
      event.preventDefault();
      const error = this.el("authError");
      const submit = this.el("authSubmit");
      error.textContent = "";
      const email = this.el("authEmail").value.trim();
      const password = this.el("authPassword").value;
      submit.disabled = true;
      try {
        if (this.mode === "signin") {
          const { error: err } = await remote.client.auth.signInWithPassword({ email, password });
          if (err) throw err;
        } else {
          const { data, error: err } = await remote.client.auth.signUp({ email, password });
          if (err) throw err;
          if (!data.session) {
            const { error: err2 } = await remote.client.auth.signInWithPassword({ email, password });
            if (err2) throw err2;
          }
        }
        this.close();
      } catch (err) {
        error.textContent = err.message || "Something went wrong.";
      } finally {
        submit.disabled = false;
      }
    },

    wire() {
      document.querySelectorAll("[data-auth-open]").forEach((el) => {
        el.addEventListener("click", () => this.open());
      });
      this.el("authModalClose").addEventListener("click", () => this.close());
      this.el("authOverlay").addEventListener("click", (event) => {
        if (event.target === this.el("authOverlay")) this.close();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !this.el("authOverlay").classList.contains("hidden")) this.close();
      });
      this.el("authTabSignin").addEventListener("click", () => this.setMode("signin"));
      this.el("authTabSignup").addEventListener("click", () => this.setMode("signup"));
      this.el("authForm").addEventListener("submit", (event) => this.submit(event));
      this.el("authSignOut").addEventListener("click", async () => {
        this.close();
        await remote.client.auth.signOut();
      });
      remote.onChange((user) => this.refresh(user));
      this.refresh(remote.user);
    },
  };

  /* ---------------- boot ---------------- */

  let started = false;

  function start() {
    if (started) return;   // auto-start and any explicit call must not both boot
    started = true;
    load();

    document.querySelectorAll("[data-goto]").forEach((el) => {
      el.addEventListener("click", () => goTo(el.dataset.goto));
    });

    authUI.wire();

    // Every discipline boots its data layer immediately — reminders and
    // saved state should not depend on which view happens to be open.
    VIEWS.forEach((view) => {
      const module = modules[view];
      if (module && module.boot) {
        try {
          module.boot();
        } catch (error) {
          console.error(`Failed to boot ${view}:`, error);
        }
      }
    });

    goTo("landing");
    remote.init();
  }

  // Self-start. shell.js is loaded before the discipline modules, so booting
  // has to wait until they have all had a chance to register — which is what
  // DOMContentLoaded guarantees for synchronous scripts at the end of <body>.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    setTimeout(start, 0);
  }

  return { read, write, clear, goTo, register, remote, auth: authUI, start, STORAGE_KEY };
})();
