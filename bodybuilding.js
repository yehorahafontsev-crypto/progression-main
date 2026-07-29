/* =========================================================================
   BODYBUILDING — split builder. Runs inside its own scope; the only thing
   it shares with powerlifting is the PROGRESSION shell.
   ========================================================================= */
(function () {
  "use strict";

  const STORAGE_SCHEMA_VERSION = 1;

  /* -------------------------------------------------------------------------
   * Data
   *
   * Every category carries a balance value. Push work is positive, pull work
   * negative, neutral work zero. A finished session should sum to 0.
   * ---------------------------------------------------------------------- */

  const CATEGORIES = {
    chest: { label: "Chest", value: 1, exercises: ["Bench Press", "Incline Bench", "Chest Fly", "Cable Crossover"] },
    back: { label: "Back", value: -1, exercises: ["Lat Pulldown", "Seated Row", "Deadlift", "Pull Up"] },
    triceps: { label: "Triceps", value: 0.3, exercises: ["Tricep Pushdown", "Skull Crushers", "Overhead Extension"] },
    biceps: { label: "Biceps", value: -0.3, exercises: ["Bicep Curl", "Hammer Curl", "Cable Curl"] },
    shoulders: { label: "Shoulders", value: 0, exercises: ["Lateral Raise", "Overhead Press", "Front Raise"] },
    traps: { label: "Traps", value: 0, exercises: ["Shrugs"] },
    quads: { label: "Quads", value: 0.5, exercises: ["Squat", "Leg Press", "Leg Extension"] },
    hamstrings: { label: "Hamstrings", value: -0.5, exercises: ["Romanian Deadlift", "Leg Curl"] },
    core: { label: "Core", value: 0, exercises: ["Plank", "Crunches"] },
  };

  const DAY_TYPES = {
    upperFull: {
      label: "Upper (Full)",
      required: ["chest", "back", "shoulders", "triceps", "biceps"],
      optional: ["traps"],
    },
    upperChestBack: {
      label: "Upper (Chest/Back)",
      required: ["chest", "back", "shoulders"],
      optional: ["traps"],
    },
    upperArms: {
      label: "Upper (Arms)",
      required: ["triceps", "biceps", "shoulders"],
      optional: ["traps"],
    },
    lower: {
      label: "Lower",
      required: ["quads", "hamstrings", "core"],
      optional: [],
    },
  };

  const SPLITS = {
    upperLower: {
      label: "Upper / Lower",
      blurb: "Alternates upper-body and lower-body days. The most forgiving way to hit everything twice a week.",
      daysLabel: "3 to 5 days",
      recommendedFor: [3, 4],
      built: true,
      pattern(days) {
        if (days <= 2) return ["upperFull", "lower"];
        const block = ["upperChestBack", "upperArms", "lower"];
        return Array.from({ length: days }, (_, i) => block[i % block.length]);
      },
    },
    ppl: {
      label: "Push / Pull / Legs",
      blurb: "Splits the week by movement pattern. Highest frequency option, best when you can train most days.",
      daysLabel: "5 to 7 days",
      recommendedFor: [5, 6, 7],
      built: false,
    },
    fullBody: {
      label: "Full Body",
      blurb: "Every session covers the whole body. Efficient when training time is limited to a couple of days.",
      daysLabel: "2 days",
      recommendedFor: [2],
      built: false,
    },
  };

  const LENGTH_BASE = { 30: 4, 45: 5, 60: 6, 90: 8 };
  const EXPERIENCE_MOD = { beginner: -1, intermediate: 0, advanced: 1 };
  const EXPERIENCE_LABEL = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

  // Both of these steer the recommendation engine only. Neither ever restricts
  // what the user can add — the builder always allows more.
  //
  // Suggestion length: the engine stops suggesting once a session reaches this.
  const SUGGEST_MAX_EXERCISES = 8;

  // Suggestion spread: once a muscle group holds this many exercises the engine
  // stops suggesting it, but it stays fully selectable in the picker.
  const SUGGEST_MAX_PER_GROUP = 2;

  /* -------------------------------------------------------------------------
   * State
   * ---------------------------------------------------------------------- */

  const state = {
    profile: null, // { daysPerWeek, experience, sessionLength }
    split: null, // key of SPLITS
    draftSplit: null, // selection on the split screen, before Build programme
    sessions: {}, // work in progress: { [dayIndex]: [{ name, category }] }
    declined: {}, // suggestions passed over per day: { [dayIndex]: [name] }
    programme: null, // the committed weekly programme (see saveProgramme)
    activeDay: null,
  };

  function saveState() {
    PROGRESSION.write("bodybuilding", {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      profile: state.profile,
      split: state.split,
      sessions: state.sessions,
      declined: state.declined,
      programme: state.programme,
    });
  }

  function loadState() {
    const parsed = PROGRESSION.read("bodybuilding");
    if (!parsed) return;
    try {
      if (parsed.schemaVersion !== STORAGE_SCHEMA_VERSION) {
        PROGRESSION.clear("bodybuilding");
        return;
      }
      state.profile = parsed.profile || null;
      state.split = parsed.split || null;
      state.sessions = parsed.sessions || {};
      state.declined = parsed.declined || {};
      state.programme = parsed.programme || null;
    } catch (error) {
      PROGRESSION.clear("bodybuilding");
    }
  }

  /* -------------------------------------------------------------------------
   * Programme shape
   * ---------------------------------------------------------------------- */

  function dayPlan() {
    if (!state.profile || !state.split) return [];
    const split = SPLITS[state.split];
    if (!split.built) return [];
    return split.pattern(state.profile.daysPerWeek);
  }

  function categoryPool(dayType) {
    const day = DAY_TYPES[dayType];
    return [...day.required, ...day.optional];
  }

  // Exercise count for a session: session length sets the base and experience
  // nudges it. The result is clamped to the suggestion length and to what the
  // pools supply under the per-group spread, then trimmed to the nearest count that
  // can still finish on zero — a slightly shorter session beats one that is
  // unbalanced by construction.
  function targetCount(dayType) {
    const day = DAY_TYPES[dayType];
    const solver = solverFor(dayType);
    const base = LENGTH_BASE[state.profile.sessionLength] + EXPERIENCE_MOD[state.profile.experience];
    const min = day.required.length;
    const max = Math.min(solver.totalCapacity, SUGGEST_MAX_EXERCISES);
    const nominal = Math.min(Math.max(base, min), max);

    for (let count = nominal; count >= min; count -= 1) {
      if (solver.bestFromEmpty(count) === 0) return count;
    }
    return nominal;
  }

  function chosenFor(dayIndex) {
    return state.sessions[String(dayIndex)] || [];
  }

  function declinedFor(dayIndex) {
    return state.declined[String(dayIndex)] || [];
  }

  /* -------------------------------------------------------------------------
   * The weekly programme
   *
   * `state.sessions` is the working draft, one entry per day of the plan.
   * `state.programme` is the committed week — what the user saved.
   * ---------------------------------------------------------------------- */

  // A day counts as built once its required muscle groups are covered and it has
  // reached its target length.
  function dayIsBuilt(dayType, dayIndex) {
    return analyseSession(dayType, chosenFor(dayIndex), declinedFor(dayIndex)).complete;
  }

  function programmeComplete() {
    const plan = dayPlan();
    return plan.length > 0 && plan.every((dayType, index) => dayIsBuilt(dayType, index));
  }

  // Identity of the current draft, used to spot edits made after a save.
  function draftSignature() {
    return JSON.stringify(
      dayPlan().map((dayType, index) => [dayType, chosenFor(index).map((item) => item.name)])
    );
  }

  function programmeIsStale() {
    return Boolean(state.programme) && state.programme.signature !== draftSignature();
  }

  function buildProgramme() {
    return {
      savedAt: new Date().toISOString(),
      signature: draftSignature(),
      split: state.split,
      splitLabel: SPLITS[state.split].label,
      profile: { ...state.profile },
      days: dayPlan().map((dayType, index) => ({
        day: index + 1,
        type: dayType,
        label: DAY_TYPES[dayType].label,
        exercises: chosenFor(index).map((item) => ({
          name: item.name,
          category: item.category,
          group: CATEGORIES[item.category].label,
        })),
      })),
    };
  }

  function saveProgramme() {
    state.programme = buildProgramme();
    saveState();
  }

  /* -------------------------------------------------------------------------
   * Balance engine
   *
   * Given what is already picked, work out which categories can still lead to
   * a complete session: every required category covered, the exercise count
   * met, and the balance as close to zero as the pools allow.
   *
   * Values are held in tenths so the search runs on integers.
   * ---------------------------------------------------------------------- */

  function popcount(mask) {
    let count = 0;
    let value = mask;
    while (value) {
      value &= value - 1;
      count += 1;
    }
    return count;
  }

  // One solver per day type, built once and reused. `best` returns the smallest
  // achievable |balance| (in tenths) for a completed session, or Infinity when
  // the remaining slots cannot cover what is still required.
  const solverCache = new Map();

  function solverFor(dayType) {
    if (solverCache.has(dayType)) return solverCache.get(dayType);

    const day = DAY_TYPES[dayType];
    const pool = categoryPool(dayType);
    const values = pool.map((key) => Math.round(CATEGORIES[key].value * 10));
    // The per-group spread is baked into capacity, so the engine never *plans* a
    // session leaning on three or more exercises from one group. The user is free
    // to add them by hand; this only shapes what gets suggested.
    const capacity = pool.map((key) => Math.min(CATEGORIES[key].exercises.length, SUGGEST_MAX_PER_GROUP));
    const requiredMask = day.required.reduce((mask, key) => mask | (1 << pool.indexOf(key)), 0);
    const totalCapacity = capacity.reduce((sum, count) => sum + count, 0);
    const memo = new Map();

    function best(slots, runningBalance, uncovered, capsLeft) {
      if (popcount(uncovered) > slots) return Infinity;
      if (slots === 0) return uncovered === 0 ? Math.abs(runningBalance) : Infinity;
      const key = `${slots}|${runningBalance}|${uncovered}|${capsLeft.join(",")}`;
      if (memo.has(key)) return memo.get(key);
      let result = Infinity;
      for (let i = 0; i < pool.length; i += 1) {
        if (capsLeft[i] <= 0) continue;
        const nextCaps = capsLeft.slice();
        nextCaps[i] -= 1;
        const candidate = best(slots - 1, runningBalance + values[i], uncovered & ~(1 << i), nextCaps);
        if (candidate < result) result = candidate;
        if (result === 0) break; // cannot beat a perfect balance
      }
      memo.set(key, result);
      return result;
    }

    const solver = {
      pool,
      values,
      capacity,
      requiredMask,
      totalCapacity,
      best,
      bestFromEmpty: (count) => best(count, 0, requiredMask, capacity.slice()),
    };
    solverCache.set(dayType, solver);
    return solver;
  }

  function analyseSession(dayType, chosen, declined = []) {
    const day = DAY_TYPES[dayType];
    const { pool, values, capacity, requiredMask, best } = solverFor(dayType);
    const target = targetCount(dayType);

    let balance = 0;
    let coveredMask = 0;
    const used = pool.map(() => 0);
    chosen.forEach((item) => {
      const index = pool.indexOf(item.category);
      if (index < 0) return;
      balance += values[index];
      coveredMask |= 1 << index;
      used[index] += 1;
    });

    const slotsLeft = Math.max(0, target - chosen.length);
    const capacityLeft = capacity.map((total, index) => total - used[index]);
    const uncoveredMask = requiredMask & ~coveredMask;

    const bestReachable = best(slotsLeft, balance, uncoveredMask, capacityLeft);

    // Pick the single exercise to recommend. Candidates are ranked by, in order:
    //   1. keeps a balanced, fully covered session reachable
    //   2. contributes to the balance — neutral (zero-value) groups rank last
    //   3. fills a required category that is still missing
    //   4. least represented — a group with nothing yet beats one already used
    //   5. weight — the heavier antagonist pairs lead
    //   6. leaves the running balance closest to zero
    // Ties fall back to pool order so the suggestion is stable between renders.
    //
    // Step 2 keeps Shrugs, Plank and the like out of the running until the
    // groups that actually move the balance are covered and level. They only
    // surface earlier when step 1 forces it — that is, when the balance can no
    // longer reach zero any other way.
    //
    // Step 5 is why a Chest/Back day opens on Bench Press rather than an incline
    // variation: step 1 already guarantees the session finishes level, so the
    // closest-to-zero rule alone would order the openers arbitrarily.
    //
    // Groups that have had their share drop out of the running here — but only
    // out of the suggestions, never out of the picker.
    const taken = new Set(chosen.map((item) => item.name));
    const passedOver = new Set(declined);

    // Suggestions the user passed over are not offered again, so the next tip
    // always reflects the selection actually made. If a group has nothing but
    // passed-over exercises left, it falls back to offering them rather than
    // leaving the user without a recommendation.
    function optionsFor(categoryKey) {
      const free = CATEGORIES[categoryKey].exercises.filter((name) => !taken.has(name));
      const fresh = free.filter((name) => !passedOver.has(name));
      return fresh.length ? fresh : free;
    }

    let recommendation = null;

    if (slotsLeft > 0) {
      for (let i = 0; i < pool.length; i += 1) {
        if (capacityLeft[i] <= 0) continue;
        const options = optionsFor(pool[i]);
        if (!options.length) continue;

        const nextCaps = capacityLeft.slice();
        nextCaps[i] -= 1;
        const reachable = best(slotsLeft - 1, balance + values[i], uncoveredMask & ~(1 << i), nextCaps);

        const candidate = {
          name: options[0],
          category: pool[i],
          keepsSessionReachable: reachable === bestReachable,
          movesBalance: values[i] !== 0,
          fillsRequired: Boolean(uncoveredMask & (1 << i)),
          timesUsed: used[i],
          weight: Math.abs(values[i]),
          distanceFromZero: Math.abs(balance + values[i]),
          order: i,
        };

        if (!recommendation || outranks(candidate, recommendation)) recommendation = candidate;
      }
    }

    // What is physically left to add, ignoring the suggestion caps entirely —
    // the picker offers everything the day has not already used.
    const remainingByGroup = {};
    pool.forEach((key) => {
      remainingByGroup[key] = CATEGORIES[key].exercises.filter((name) => !taken.has(name)).length;
    });

    return {
      target,
      slotsLeft,
      overTarget: Math.max(0, chosen.length - target),
      complete: chosen.length >= target && uncoveredMask === 0,
      uncovered: day.required.filter((key) => uncoveredMask & (1 << pool.indexOf(key))),
      // Groups the engine will no longer suggest. They stay fully selectable.
      restedCategories: pool.filter((key, i) => used[i] >= capacity[i]),
      remainingByGroup,
      anythingLeft: Object.values(remainingByGroup).some((n) => n > 0),
      recommendation: recommendation && { name: recommendation.name, category: recommendation.category },
    };
  }

  function outranks(a, b) {
    if (a.keepsSessionReachable !== b.keepsSessionReachable) return a.keepsSessionReachable;
    if (a.movesBalance !== b.movesBalance) return a.movesBalance;
    if (a.fillsRequired !== b.fillsRequired) return a.fillsRequired;
    if (a.timesUsed !== b.timesUsed) return a.timesUsed < b.timesUsed;
    if (a.weight !== b.weight) return a.weight > b.weight;
    if (a.distanceFromZero !== b.distanceFromZero) return a.distanceFromZero < b.distanceFromZero;
    return a.order < b.order;
  }

  /* -------------------------------------------------------------------------
   * Formatting helpers
   *
   * Balance values are internal. Nothing below ever renders them — the user
   * sees exercise names, muscle groups and a "Recommended" label only.
   * ---------------------------------------------------------------------- */

  function listCategories(keys) {
    return keys.map((key) => CATEGORIES[key].label).join(", ");
  }

  /* -------------------------------------------------------------------------
   * Screens
   * ---------------------------------------------------------------------- */

  const screens = {
    onboarding: document.getElementById("onboardingScreen"),
    split: document.getElementById("splitScreen"),
    programme: document.getElementById("programmeScreen"),
    builder: document.getElementById("builderScreen"),
    summary: document.getElementById("summaryScreen"),
  };

  function showScreen(name) {
    Object.entries(screens).forEach(([key, element]) => {
      element.classList.toggle("active", key === name);
    });
    window.scrollTo({ top: 0 });
  }

  /* --- Onboarding --- */

  const daysInput = document.getElementById("daysInput");
  const experienceInput = document.getElementById("experienceInput");
  const lengthInput = document.getElementById("lengthInput");
  const onboardingForm = document.getElementById("onboardingForm");
  const onboardingError = document.getElementById("onboardingError");

  function fillDayOptions() {
    daysInput.innerHTML = "";
    for (let days = 2; days <= 7; days += 1) {
      const option = document.createElement("option");
      option.value = String(days);
      option.textContent = `${days} days per week`;
      if (days === 4) option.selected = true;
      daysInput.append(option);
    }
  }

  onboardingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const daysPerWeek = Number(daysInput.value);
    const experience = experienceInput.value;
    const sessionLength = Number(lengthInput.value);

    if (!daysPerWeek || EXPERIENCE_MOD[experience] === undefined || !LENGTH_BASE[sessionLength]) {
      onboardingError.textContent = "Please complete every field.";
      return;
    }

    onboardingError.textContent = "";

    const changed =
      !state.profile ||
      state.profile.daysPerWeek !== daysPerWeek ||
      state.profile.experience !== experience ||
      state.profile.sessionLength !== sessionLength;

    state.profile = { daysPerWeek, experience, sessionLength };
    if (changed) {
      state.sessions = {};
      state.declined = {};
      state.programme = null;
    }

    state.draftSplit = state.split || recommendedSplit();
    saveState();
    renderSplitScreen();
    showScreen("split");
  });

  /* --- Split selection --- */

  const splitGrid = document.getElementById("splitGrid");
  const splitSummary = document.getElementById("splitSummary");
  const splitContinue = document.getElementById("splitContinue");

  function recommendedSplit() {
    const days = state.profile.daysPerWeek;
    const match = Object.keys(SPLITS).find((key) => SPLITS[key].recommendedFor.includes(days));
    return match || "upperLower";
  }

  function renderSplitScreen() {
    const { daysPerWeek, experience, sessionLength } = state.profile;
    splitSummary.textContent = `${daysPerWeek} days per week · ${EXPERIENCE_LABEL[experience]} · ${sessionLength} minute sessions`;

    const recommended = recommendedSplit();
    splitGrid.innerHTML = "";

    Object.entries(SPLITS).forEach(([key, split]) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "split-card";
      card.dataset.split = key;
      card.setAttribute("aria-pressed", String(state.draftSplit === key));
      if (state.draftSplit === key) card.classList.add("active");

      const tags = [];
      if (key === recommended) tags.push('<span class="split-tag split-tag--recommended">Recommended</span>');
      else if (!split.built) tags.push('<span class="split-tag split-tag--soon">Coming soon</span>');

      card.innerHTML = `
        ${tags.join("")}
        <strong>${split.label}</strong>
        <span class="split-days">${split.daysLabel}</span>
        <p>${split.blurb}</p>
      `;

      card.addEventListener("click", () => {
        state.draftSplit = key;
        renderSplitScreen();
      });

      splitGrid.append(card);
    });

    splitContinue.disabled = !state.draftSplit;
  }

  splitContinue.addEventListener("click", () => {
    if (!state.draftSplit) return;
    if (state.split !== state.draftSplit) {
      state.sessions = {};
      state.declined = {};
      state.programme = null;
    }
    state.split = state.draftSplit;
    saveState();
    renderProgramme();
    showScreen("programme");
  });

  document.getElementById("splitBackButton").addEventListener("click", () => {
    showScreen("onboarding");
  });

  /* --- Programme overview --- */

  const dayList = document.getElementById("dayList");
  const programmeSummary = document.getElementById("programmeSummary");
  const programmeSplitName = document.getElementById("programmeSplitName");
  const programmeStatus = document.getElementById("programmeStatus");
  const splitPlaceholder = document.getElementById("splitPlaceholder");
  const programmeActions = document.getElementById("programmeActions");
  const programmeActionsNote = document.getElementById("programmeActionsNote");
  const reviewButton = document.getElementById("reviewButton");
  const programmeFlash = document.getElementById("programmeFlash");

  // A one-shot confirmation, shown on whichever screen the user lands on.
  let flashMessage = "";

  function setFlash(message) {
    flashMessage = message;
  }

  function showFlash(element, message) {
    element.textContent = message || "";
    element.classList.toggle("hidden", !message);
  }

  function renderProgramme() {
    const split = SPLITS[state.split];
    const { daysPerWeek, experience, sessionLength } = state.profile;
    programmeSplitName.textContent = split.label;
    programmeSummary.textContent = `${daysPerWeek} days per week · ${EXPERIENCE_LABEL[experience]} · ${sessionLength} minute sessions`;

    showFlash(programmeFlash, "");

    dayList.innerHTML = "";

    if (!split.built) {
      dayList.classList.add("hidden");
      splitPlaceholder.classList.remove("hidden");
      programmeActions.classList.add("hidden");
      programmeStatus.textContent = "Not available yet";
      programmeStatus.className = "status-pill is-warn";
      return;
    }

    dayList.classList.remove("hidden");
    splitPlaceholder.classList.add("hidden");

    const plan = dayPlan();
    let completeDays = 0;

    plan.forEach((dayType, index) => {
      const chosen = chosenFor(index);
      const analysis = analyseSession(dayType, chosen, declinedFor(index));
      if (analysis.complete) completeDays += 1;

      const card = document.createElement("button");
      card.type = "button";
      card.className = "day-card";

      const detail = analysis.complete
        ? chosen.map((item) => item.name).join(" · ")
        : `${chosen.length} of ${analysis.target} exercises chosen`;

      const pillClass = analysis.complete ? "is-good" : "";
      const pillText = analysis.complete ? "Complete" : chosen.length ? "In progress" : "Empty";

      card.innerHTML = `
        <span class="day-body">
          <span class="day-index">Day ${index + 1}</span>
          <span class="day-name">${DAY_TYPES[dayType].label}</span>
          <span class="day-detail">${detail}</span>
        </span>
        <span class="status-pill ${pillClass}">${pillText}</span>
      `;

      card.addEventListener("click", () => openBuilder(index));
      dayList.append(card);
    });

    const allBuilt = completeDays === plan.length;

    if (state.programme && !programmeIsStale()) {
      programmeStatus.textContent = `Saved ${formatSavedAt(state.programme.savedAt)}`;
      programmeStatus.className = "status-pill is-good";
    } else if (allBuilt) {
      programmeStatus.textContent = state.programme ? "Edited since saving" : "Ready to save";
      programmeStatus.className = `status-pill ${state.programme ? "is-warn" : "is-good"}`;
    } else {
      programmeStatus.textContent = `${completeDays} of ${plan.length} sessions built`;
      programmeStatus.className = "status-pill";
    }

    programmeActions.classList.remove("hidden");
    reviewButton.textContent = state.programme ? "Review weekly programme" : "Review & save programme";

    if (allBuilt) {
      programmeActionsNote.textContent = programmeIsStale() ? "Sessions changed since you last saved." : "";
    } else {
      const left = plan.length - completeDays;
      programmeActionsNote.textContent = `Build ${left} more session${left === 1 ? "" : "s"} to finish your week.`;
    }
  }

  function formatSavedAt(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  document.getElementById("changeSplitButton").addEventListener("click", () => {
    state.draftSplit = state.split;
    renderSplitScreen();
    showScreen("split");
  });

  document.getElementById("resetButton").addEventListener("click", () => {
    if (!window.confirm("Reset your profile and clear every built session?")) return;
    PROGRESSION.clear("bodybuilding");
    state.profile = null;
    state.split = null;
    state.draftSplit = null;
    state.sessions = {};
    state.declined = {};
    state.programme = null;
    state.activeDay = null;
    showScreen("onboarding");
  });

  document.getElementById("switchToUpperLower").addEventListener("click", () => {
    state.split = "upperLower";
    state.draftSplit = "upperLower";
    state.sessions = {};
    state.declined = {};
    state.programme = null;
    saveState();
    renderProgramme();
  });

  reviewButton.addEventListener("click", () => {
    renderSummary();
    showScreen("summary");
  });

  /* --- Weekly programme summary --- */

  const summaryWeek = document.getElementById("summaryWeek");
  const summaryStatus = document.getElementById("summaryStatus");
  const summarySummary = document.getElementById("summarySummary");
  const summarySplitName = document.getElementById("summarySplitName");
  const summarySavedNote = document.getElementById("summarySavedNote");
  const saveProgrammeButton = document.getElementById("saveProgrammeButton");
  const summaryFlash = document.getElementById("summaryFlash");

  function renderSummary() {
    showFlash(summaryFlash, "");
    const plan = dayPlan();
    const { daysPerWeek, experience, sessionLength } = state.profile;
    const saved = Boolean(state.programme) && !programmeIsStale();

    summarySplitName.textContent = SPLITS[state.split].label;
    summarySummary.textContent = `${daysPerWeek} days per week · ${EXPERIENCE_LABEL[experience]} · ${sessionLength} minute sessions`;

    summaryStatus.textContent = saved ? "Saved" : state.programme ? "Unsaved changes" : "Not saved yet";
    summaryStatus.className = `status-pill ${saved ? "is-good" : state.programme ? "is-warn" : ""}`;

    summaryWeek.innerHTML = "";
    plan.forEach((dayType, index) => {
      const chosen = chosenFor(index);
      const block = document.createElement("article");
      block.className = "summary-day";
      block.innerHTML = `
        <div class="summary-day-head">
          <div>
            <p class="summary-day-index">Day ${index + 1}</p>
            <h3>${DAY_TYPES[dayType].label}</h3>
          </div>
          <button class="ghost-button summary-day-edit" type="button">Edit</button>
        </div>
        <ol class="summary-exercises"></ol>
      `;

      const list = block.querySelector(".summary-exercises");
      chosen.forEach((item) => {
        const row = document.createElement("li");
        row.innerHTML = `
          <span class="summary-exercise-name">${item.name}</span>
          <span class="summary-exercise-group">${CATEGORIES[item.category].label}</span>
        `;
        list.append(row);
      });

      block.querySelector(".summary-day-edit").addEventListener("click", () => openBuilder(index));
      summaryWeek.append(block);
    });

    summarySavedNote.textContent = saved
      ? `Saved ${formatSavedAt(state.programme.savedAt)} as your weekly programme.`
      : state.programme
      ? "You have changed a session since this was last saved."
      : "";

    saveProgrammeButton.textContent = state.programme ? "Update weekly programme" : "Save weekly programme";
  }

  saveProgrammeButton.addEventListener("click", () => {
    saveProgramme();
    renderSummary();
  });

  document.getElementById("summaryEditButton").addEventListener("click", () => {
    renderProgramme();
    showScreen("programme");
  });

  document.getElementById("summaryBackButton").addEventListener("click", () => {
    renderProgramme();
    showScreen("programme");
  });

  /* --- Session builder --- */

  const builderEyebrow = document.getElementById("builderEyebrow");
  const builderTitle = document.getElementById("builderTitle");
  const builderSummary = document.getElementById("builderSummary");
  const builderCount = document.getElementById("builderCount");
  const sessionPill = document.getElementById("sessionPill");
  const sessionRows = document.getElementById("sessionRows");
  const addRow = document.getElementById("addRow");
  const addRowLabel = document.getElementById("addRowLabel");
  const addRowHint = document.getElementById("addRowHint");
  const builderDone = document.getElementById("builderDone");
  const builderSaveNote = document.getElementById("builderSaveNote");
  const saveSessionButton = document.getElementById("saveSessionButton");
  const metricFocus = document.getElementById("metricFocus");
  const metricTarget = document.getElementById("metricTarget");
  const metricRequired = document.getElementById("metricRequired");

  function openBuilder(dayIndex) {
    state.activeDay = dayIndex;
    renderBuilder();
    showScreen("builder");
  }

  function renderBuilder() {
    const dayIndex = state.activeDay;
    const dayType = dayPlan()[dayIndex];
    const day = DAY_TYPES[dayType];
    const chosen = chosenFor(dayIndex);
    const analysis = analyseSession(dayType, chosen, declinedFor(dayIndex));

    builderEyebrow.textContent = `Day ${dayIndex + 1}`;
    builderTitle.textContent = day.label;
    builderSummary.textContent = `Covers ${listCategories(day.required)}`;
    builderCount.textContent = `${chosen.length} of ${analysis.target} exercises`;

    sessionPill.textContent = analysis.complete ? "Complete" : chosen.length ? "In progress" : "Empty";
    sessionPill.className = `status-pill ${analysis.complete ? "is-good" : ""}`;

    metricFocus.textContent = listCategories(day.required);
    metricTarget.textContent = `${analysis.target} exercises`;
    metricRequired.textContent = analysis.uncovered.length ? listCategories(analysis.uncovered) : "None";

    sessionRows.innerHTML = "";
    chosen.forEach((item, index) => {
      const category = CATEGORIES[item.category];
      const row = document.createElement("li");
      row.className = "session-row";
      row.innerHTML = `
        <span class="row-order">${index + 1}</span>
        <span class="row-body">
          <span class="row-name">${item.name}</span>
          <span class="row-meta">${category.label}</span>
        </span>
        <button class="row-remove" type="button" aria-label="Remove ${item.name}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      `;
      row.querySelector(".row-remove").addEventListener("click", () => {
        const next = chosenFor(dayIndex).slice();
        next.splice(index, 1);
        state.sessions[String(dayIndex)] = next;
        if (!next.length) delete state.declined[String(dayIndex)];
        saveState();
        renderBuilder();
      });
      sessionRows.append(row);
    });

    const finished = analysis.slotsLeft === 0;

    // Both caps are advisory. The row disappears only when every exercise the day
    // covers is already in the session — never because a target was reached.
    addRow.classList.toggle("hidden", !analysis.anythingLeft);
    addRow.classList.toggle("is-override", finished);
    builderDone.classList.toggle("hidden", !finished);

    addRowLabel.textContent = finished ? "Add another exercise" : "Add exercise";
    if (finished) {
      addRowHint.textContent = "Past the recommended length";
    } else {
      addRowHint.textContent = analysis.recommendation ? `Recommended: ${analysis.recommendation.name}` : "";
    }

    if (analysis.uncovered.length) {
      builderSaveNote.textContent = `Still to train: ${listCategories(analysis.uncovered)}. You can save anyway.`;
    } else if (chosen.length < analysis.target) {
      builderSaveNote.textContent = `${analysis.target - chosen.length} short of the suggested length. You can save anyway.`;
    } else {
      builderSaveNote.textContent = "";
    }

    if (finished) {
      if (analysis.uncovered.length) {
        builderDone.textContent = `Session full. Still missing ${listCategories(
          analysis.uncovered
        )} — swap an exercise out to fit it in.`;
      } else if (analysis.overTarget) {
        builderDone.textContent = `Session complete, plus ${analysis.overTarget} added by hand.`;
      } else {
        builderDone.textContent = "Session complete.";
      }
    }
  }

  function leaveBuilder() {
    const message = flashMessage;
    flashMessage = "";

    // Completing the final session drops straight into the weekly summary, which
    // is where the programme actually gets committed.
    if (programmeComplete() && (!state.programme || programmeIsStale())) {
      renderSummary();
      showFlash(summaryFlash, message);
      showScreen("summary");
      return;
    }
    renderProgramme();
    showFlash(programmeFlash, message);
    showScreen("programme");
  }

  document.getElementById("builderBackButton").addEventListener("click", leaveBuilder);

  // Every edit already writes through to storage, so this button is a deliberate
  // finish-and-close rather than the only thing standing between the user and
  // losing work. It flushes state and confirms on the way out.
  saveSessionButton.addEventListener("click", () => {
    const dayIndex = state.activeDay;
    const count = chosenFor(dayIndex).length;
    saveState();
    setFlash(
      count
        ? `Day ${dayIndex + 1} saved — ${count} exercise${count === 1 ? "" : "s"}.`
        : `Day ${dayIndex + 1} saved as empty.`
    );
    leaveBuilder();
  });

  /* --- Exercise picker --- */

  const pickerOverlay = document.getElementById("pickerOverlay");
  const pickerGroups = document.getElementById("pickerGroups");
  const pickerReason = document.getElementById("pickerReason");
  const pickerEyebrow = document.getElementById("pickerEyebrow");

  addRow.addEventListener("click", () => {
    const dayIndex = state.activeDay;
    const dayType = dayPlan()[dayIndex];
    const chosen = chosenFor(dayIndex);
    const analysis = analyseSession(dayType, chosen, declinedFor(dayIndex));
    const taken = new Set(chosen.map((item) => item.name));
    const pick = analysis.recommendation;

    // Every exercise the day covers stays selectable, whatever the caps say. The
    // recommendation is only surfaced first; it never narrows the list.
    const groups = categoryPool(dayType)
      .map((key) => ({
        key,
        category: CATEGORIES[key],
        options: CATEGORIES[key].exercises.filter((name) => !taken.has(name) && name !== (pick && pick.name)),
      }))
      .filter((group) => group.options.length);

    if (!pick && !groups.length) return;

    pickerEyebrow.textContent =
      chosen.length >= analysis.target ? "Extra exercise" : `Exercise ${chosen.length + 1} of ${analysis.target}`;

    const reasons = [];
    if (analysis.uncovered.length) {
      reasons.push(`Still to train: ${listCategories(analysis.uncovered)}.`);
    } else {
      reasons.push("Every muscle group for this session is covered.");
    }
    if (analysis.restedCategories.length) {
      reasons.push(
        `${listCategories(analysis.restedCategories)} already have a full share, so they are no longer suggested — still pick them if you want.`
      );
    }
    pickerReason.textContent = reasons.join(" ");

    function optionButton(name, categoryKey, recommended) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `picker-option${recommended ? " is-recommended" : ""}`;
      button.innerHTML = `
        <span class="picker-option-name">${name}</span>
        ${recommended ? '<span class="picker-badge">Recommended</span>' : ""}
      `;
      button.addEventListener("click", () => {
        // Choosing something other than the suggestion retires that suggestion
        // for this session, so the next tip responds to what was actually picked.
        if (pick && pick.name !== name) {
          const list = declinedFor(dayIndex).slice();
          if (!list.includes(pick.name)) list.push(pick.name);
          state.declined[String(dayIndex)] = list;
        }
        const next = chosenFor(dayIndex).slice();
        next.push({ name, category: categoryKey });
        state.sessions[String(dayIndex)] = next;
        saveState();
        closePicker();
        renderBuilder();
      });
      return button;
    }

    pickerGroups.innerHTML = "";

    if (pick) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = `
        <div class="picker-group-head">
          <strong>Suggested next</strong>
          <span>${CATEGORIES[pick.category].label}</span>
        </div>
        <div class="picker-options"></div>
      `;
      wrapper.querySelector(".picker-options").append(optionButton(pick.name, pick.category, true));
      pickerGroups.append(wrapper);
    }

    groups.forEach((group) => {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = `
        <div class="picker-group-head">
          <strong>${group.category.label}</strong>
        </div>
        <div class="picker-options"></div>
      `;
      const options = wrapper.querySelector(".picker-options");
      group.options.forEach((name) => options.append(optionButton(name, group.key, false)));
      pickerGroups.append(wrapper);
    });

    pickerOverlay.classList.remove("hidden");
  });

  function closePicker() {
    pickerOverlay.classList.add("hidden");
  }

  document.getElementById("pickerClose").addEventListener("click", closePicker);
  pickerOverlay.addEventListener("click", (event) => {
    if (event.target === pickerOverlay) closePicker();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !pickerOverlay.classList.contains("hidden")) closePicker();
  });

  /* -------------------------------------------------------------------------
   * Boot
   * ---------------------------------------------------------------------- */

  function init() {
    fillDayOptions();
    loadState();

    if (state.profile) {
      daysInput.value = String(state.profile.daysPerWeek);
      experienceInput.value = state.profile.experience;
      lengthInput.value = String(state.profile.sessionLength);
    }

    if (state.profile && state.split) {
      state.draftSplit = state.split;
      renderProgramme();
      showScreen("programme");
    } else if (state.profile) {
      state.draftSplit = recommendedSplit();
      renderSplitScreen();
      showScreen("split");
    } else {
      showScreen("onboarding");
    }
  }

  PROGRESSION.register("bodybuilding", {
    boot: init,
    reload: init,          // remote data arrived, or the session ended
  });

})();
