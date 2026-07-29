
(function(){
  "use strict";

  const root = document.getElementById('powerliftingView');

  /* =========================================================
     DECORATIVE MARKETING BEHAVIOUR (unchanged from original)
  ========================================================= */
  const burger=document.getElementById('burger'),menu=document.getElementById('mobileMenu');
  burger.addEventListener('click',()=>menu.classList.toggle('open'));
  menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>menu.classList.remove('open')));

  function countUp(el){const raw=el.getAttribute('data-count');const target=parseFloat(raw);const dec=(raw.split('.')[1]||'').length;let s=null;
    function t(ts){if(!s)s=ts;const p=Math.min((ts-s)/1400,1);const e=1-Math.pow(1-p,3);let v=target*e;
      el.textContent=dec?v.toFixed(dec):Math.round(v).toLocaleString('en-US');if(p<1)requestAnimationFrame(t);}requestAnimationFrame(t);}

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Deferred until the view is first shown: while it is display:none the
  // elements have no layout, so IntersectionObserver never fires and every
  // .reveal would stay stuck at opacity:0.
  function initReveals(){
    if(!reducedMotion){
      root.querySelectorAll('.steps .step, .feat .fcard, .stats .stat').forEach((el,i)=>el.style.transitionDelay=(i%3*0.07)+'s');
      const io=new IntersectionObserver(es=>{es.forEach(e=>{if(!e.isIntersecting)return;e.target.classList.add('in');io.unobserve(e.target);})},{threshold:.15});
      root.querySelectorAll('.reveal').forEach(el=>io.observe(el));
      root.querySelectorAll('[data-count]').forEach(el=>{const o=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){countUp(el);o.unobserve(el);}})},{threshold:.5});o.observe(el);});
    } else { root.querySelectorAll('[data-count]').forEach(el=>el.textContent=el.getAttribute('data-count')); }

    const hdr=root.querySelector('header');
    addEventListener('scroll',()=>hdr.classList.toggle('scrolled',scrollY>24),{passive:true});
  }

  /* =========================================================
     APP: progression formulas (ported 1:1 from the working app)
  ========================================================= */
  const STORAGE_KEY = "powerlifting-progress-v1";
  const STORAGE_SCHEMA_VERSION = 2;
  const DEFAULT_ROUNDING_INCREMENT = 2.5;

  /* =========================================================
     SUPABASE — replace with your project's values
     (Project Settings -> API in the Supabase dashboard)
  ========================================================= */
  // The shell owns the Supabase session; this module only reads and writes
  // its own namespace through PROGRESSION.read / .write.

  /* =========================================================
     DOM refs
  ========================================================= */
  const dom = {
    ageInput: document.getElementById('ageInput'),
    weightInput: document.getElementById('weightInput'),
    nameInput: document.getElementById('nameInput'),
    profileForm: document.getElementById('profileForm'),
    profileError: document.getElementById('profileError'),
    setupDots: document.getElementById('setupDots'),
    setupStepLabel: document.getElementById('setupStepLabel'),
    setupContinue: document.getElementById('setupContinue'),
    continueTitle: document.getElementById('continueTitle'),
    continueSummary: document.getElementById('continueSummary'),
    setupDone: document.getElementById('setupDone'),
    doneTitle: document.getElementById('doneTitle'),
    doneSummary: document.getElementById('doneSummary'),
    resetProfileBtn: document.getElementById('resetProfileBtn'),

    navLinks: document.querySelectorAll('.nav-link[data-lift]'),

    chartLabel: document.getElementById('chartLabel'),
    chartStatus: document.getElementById('chartStatus'),
    chartBody: document.getElementById('chartBody'),
    chartSvg: document.getElementById('chartSvg'),
    bars: document.getElementById('bars'),
    line: document.getElementById('line'),
    dots: document.getElementById('dots'),
    chartXr: document.getElementById('chartXr'),
    peakKg: document.getElementById('peakKg'),
    peakUnit: document.getElementById('peakUnit'),

    genPanel: document.getElementById('genPanel'),
    genDuration: document.getElementById('genDuration'),
    genTitle: document.getElementById('genTitle'),
    genDesc: document.getElementById('genDesc'),
    templateGrid: document.getElementById('templateGrid'),
    weekBars: document.getElementById('weekBars'),
    genMaxLabel: document.getElementById('genMaxLabel'),
    genMaxInput: document.getElementById('genMaxInput'),
    genRounding: document.getElementById('genRounding'),
    genError: document.getElementById('genError'),
    genSubmit: document.getElementById('genSubmit'),
    genNoGenerator: document.getElementById('genNoGenerator'),
    genPlaceholderMessage: document.getElementById('genPlaceholderMessage'),
    genRight: document.querySelector('#genPanel .right:not(#genNoGenerator)'),

    calcToggle: document.getElementById('calcToggle'),
    calc1rmBox: document.getElementById('calc1rmBox'),
    calcWeightInput: document.getElementById('calcWeightInput'),
    calcRepsInput: document.getElementById('calcRepsInput'),
    calc1rmResult: document.getElementById('calc1rmResult'),
    calcUseBtn: document.getElementById('calcUseBtn'),

    trackHint: document.getElementById('trackHint'),
    trackRows: document.getElementById('trackRows'),

    modalOverlay: document.getElementById('modalOverlay'),
    modalTitle: document.getElementById('modalTitle'),
    modalClose: document.getElementById('modalClose'),
    modalForm: document.getElementById('modalForm'),
    modalProgWeight: document.getElementById('modalProgWeight'),
    modalProgSets: document.getElementById('modalProgSets'),
    modalProgReps: document.getElementById('modalProgReps'),
    modalActualWeight: document.getElementById('modalActualWeight'),
    modalActualSets: document.getElementById('modalActualSets'),
    modalActualReps: document.getElementById('modalActualReps'),
    modalDate: document.getElementById('modalDate'),
    modalTime: document.getElementById('modalTime'),
    modalNotify: document.getElementById('modalNotify'),
    modalNotifyMinutes: document.getElementById('modalNotifyMinutes'),
    modalError: document.getElementById('modalError'),

  };

  let activeModalSession = null;
  let selectedRounding = DEFAULT_ROUNDING_INCREMENT;
  const scheduledNotificationTimers = new Map();

  const emptyPrograms = () => ({ bench: null, squat: null, deadlift: null });

  const WeightRounder = {
    round(value, increment = DEFAULT_ROUNDING_INCREMENT) {
      if (!Number.isFinite(value)) return 0;
      if (!Number.isFinite(increment) || increment <= 0) return value;
      return Math.round(value / increment) * increment;
    },
  };

  function formatWeight(weight) {
    return `${Number(weight.toFixed(1)).toLocaleString("en-GB")} kg`;
  }

  class BenchWaveGenerator {
    generate(userMax, roundingIncrement) {
      const setSequence = [2, 2, 3, 3, 2, 2, 3, 3, 5, 1];
      const program = [];

      for (let week = 1; week <= 10; week += 1) {
        if (week === 9) {
          program.push({
            session: week, week, sets: setSequence[week - 1], reps: 5,
            weight: WeightRounder.round(userMax * 0.7, roundingIncrement),
            intensityPercent: 70,
            notes: "Deload / Rest Week. Prepare for PR next week.",
          });
        } else if (week === 10) {
          const newPr = WeightRounder.round(userMax + 5, roundingIncrement);
          program.push({
            session: week, week, sets: setSequence[week - 1], reps: 1,
            weight: newPr,
            intensityPercent: Math.round((newPr / userMax) * 100),
            notes: `PR WEEK! Go for it! Target New 1RM: ${formatWeight(newPr)}.`,
          });
        } else {
          const relativeWeek = ((week - 1) % 4) + 1;
          const reps = 8 - 2 * (relativeWeek - 1);
          const monthModifier = week > 4 ? 0.03 : 0.0;
          const intensity = 0.7 * Math.pow(1.05, relativeWeek + 2) + monthModifier;
          const workingWeight = userMax * intensity + 2.5;

          program.push({
            session: week, week, sets: setSequence[week - 1], reps,
            weight: WeightRounder.round(workingWeight, roundingIncrement),
            intensityPercent: Math.round(intensity * 100),
            notes: week === 5 ? "MONTH 2: ACCELERATED INTENSITY" : "",
          });
        }
      }
      return program;
    }
  }

  class ErRxGenerator {
    constructor() {
      this.matrix = [
        [1, 1, 6, 2, 0.8, "Base volume day"],
        [2, 1, 6, 3, 0.8, "Volume progression"],
        [3, 1, 6, 2, 0.8, "Base volume day"],
        [4, 2, 6, 4, 0.8, "Volume progression"],
        [5, 2, 6, 2, 0.8, "Base volume day"],
        [6, 2, 6, 5, 0.8, "Volume progression"],
        [7, 3, 6, 2, 0.8, "Base volume day"],
        [8, 3, 6, 6, 0.8, "Peak volume"],
        [9, 3, 6, 2, 0.8, "Base volume day"],
        [10, 4, 5, 5, 0.85, "Peaking day"],
        [11, 4, 6, 2, 0.8, "Base volume day"],
        [12, 4, 4, 4, 0.9, "Peaking day"],
        [13, 5, 6, 2, 0.8, "Base volume day"],
        [14, 5, 3, 3, 0.95, "Peaking day"],
        [15, 5, 6, 2, 0.8, "Base volume day"],
        [16, 6, 2, 2, 1.0, "100% day"],
        [17, 6, 6, 2, 0.8, "Base volume day"],
        [18, 6, 1, 1, 1.05, "Final PR attempt"],
      ];
    }

    generate(userMax, roundingIncrement) {
      let oneHundredPercentWeight = null;
      return this.matrix.map(([session, week, sets, reps, intensity, notes]) => {
        let weight = WeightRounder.round(userMax * intensity, roundingIncrement);
        if (intensity === 1) oneHundredPercentWeight = weight;
        if (intensity === 1.05 && oneHundredPercentWeight !== null && weight <= oneHundredPercentWeight) {
          weight = oneHundredPercentWeight + roundingIncrement;
        }
        return { session, week, sets, reps, weight, intensityPercent: Math.round(intensity * 100), notes };
      });
    }
  }

  const programGenerators = { benchWave: new BenchWaveGenerator(), errx: new ErRxGenerator() };

  const liftSections = {
    bench: {
      label: "Bench press", generatorKey: "benchWave",
      generatorTitle: "Accelerated wave periodization",
      generatorDesc: "A proven 10-week wave — volume climbs, then intensity peaks. Each week ramps the working weight toward a new max.",
      durationLabel: "10 weeks", maxLabel: "Current bench press 1RM", maxPlaceholder: "120",
      emptyMessage: "Enter your bench press 1RM to create the first block.",
      templates: [
        { name: "Accelerated wave", description: "Ready 10-week block with corrected set sequence and PR shift.", active: true },
        { name: "Template 2", description: "Blank for later." },
        { name: "Template 3", description: "Blank for later." },
      ],
    },
    squat: {
      label: "Squat", generatorKey: "errx",
      generatorTitle: "ErRx Russian Squat Routine",
      generatorDesc: "18 sessions of base volume days and peaking days, building to a 100% day and a final 1RM attempt.",
      durationLabel: "18 sessions", maxLabel: "Current squat 1RM", maxPlaceholder: "140",
      emptyMessage: "Enter your squat 1RM to create the ErRx routine.",
      templates: [
        { name: "ErRx", description: "18-session Russian Squat Routine with rounded weights and PR guardrail.", active: true },
        { name: "Template 2", description: "Blank for later." },
        { name: "Template 3", description: "Blank for later." },
      ],
    },
    deadlift: {
      label: "Deadlift", generatorKey: "errx",
      generatorTitle: "ErRx deadlift matrix",
      generatorDesc: "The same 18-session Russian matrix, adapted to deadlift loading, ending in a final PR attempt.",
      durationLabel: "18 sessions", maxLabel: "Current deadlift 1RM", maxPlaceholder: "180",
      emptyMessage: "Enter your deadlift 1RM to create the ErRx matrix.",
      templates: [
        { name: "ErRx", description: "18-session Russian matrix adapted to deadlift loading.", active: true },
        { name: "Template 2", description: "Blank for later." },
        { name: "Template 3", description: "Blank for later." },
      ],
    },
    diet: { label: "Diet", generatorKey: null, emptyMessage: "Diet content can be added later." },
    shop: { label: "Shop", generatorKey: null, emptyMessage: "Shop content can be added later." },
  };

  /* =========================================================
     APP: state + persistence
  ========================================================= */
  const state = {
    profile: null,
    section: "bench",
    programs: emptyPrograms(),
    roundingIncrement: DEFAULT_ROUNDING_INCREMENT,
  };

  function buildStatePayload() {
    return {
      profile: state.profile, section: state.section,
      schemaVersion: STORAGE_SCHEMA_VERSION, programs: state.programs,
    };
  }

  function applyStatePayload(parsed) {
    state.profile = parsed.profile || null;
    state.section = liftSections[parsed.section] ? parsed.section : "bench";
    state.programs = parsed.schemaVersion === STORAGE_SCHEMA_VERSION
      ? { ...emptyPrograms(), ...(parsed.programs || {}) }
      : emptyPrograms();
  }

  function saveState() {
    PROGRESSION.write('powerlifting', buildStatePayload());
  }

  function loadState() {
    const saved = PROGRESSION.read('powerlifting');
    if (!saved) return;
    try { applyStatePayload(saved); }
    catch { PROGRESSION.clear('powerlifting'); }
  }

  /* =========================================================
     SUPABASE — the shell owns the session and syncs the whole
     store, so signing in here carries bodybuilding data too.
  ========================================================= */
  /* Account UI lives in the shell — one account spans both disciplines.
     See PROGRESSION.auth in shell.js. */

  function getActiveProgram() { return state.programs[state.section] || null; }
  function getLogs(program) { if (!program.logs) program.logs = {}; return program.logs; }
  function getSessionLog(section, sessionKey) {
    const program = state.programs[section];
    if (!program) return null;
    return getLogs(program)[sessionKey] || null;
  }
  function findSessionItem(section, sessionKey) {
    const sessions = state.programs[section]?.sessions || [];
    return sessions.find(item => String(item.session || item.week) === sessionKey) || null;
  }

  function validateProfile(age, weight) {
    if (Number.isNaN(age) || age < 0 || age > 99) return "Please pick a valid age.";
    if (Number.isNaN(weight) || weight < 30 || weight > 250) return "Body weight must be between 30 and 250 kg.";
    return null;
  }

  /* =========================================================
     Onboarding form
  ========================================================= */
  function populateAgeOptions() {
    const fragment = document.createDocumentFragment();
    const placeholder = document.createElement("option");
    placeholder.value = ""; placeholder.textContent = "Select age";
    fragment.appendChild(placeholder);
    for (let age = 0; age <= 99; age += 1) {
      const option = document.createElement("option");
      option.value = String(age); option.textContent = String(age);
      fragment.appendChild(option);
    }
    dom.ageInput.appendChild(fragment);
  }

  function renderSetupCard() {
    const hasProfile = Boolean(state.profile);
    const hasAnyProgram = Object.values(state.programs).some(Boolean);

    dom.profileForm.classList.toggle('hidden', hasProfile);
    dom.setupContinue.classList.toggle('hidden', !(hasProfile && !hasAnyProgram));
    dom.setupDone.classList.toggle('hidden', !(hasProfile && hasAnyProgram));

    dom.setupDots.querySelectorAll('i').forEach((dot, i) => {
      dot.classList.toggle('on', hasAnyProgram ? true : hasProfile ? i <= 1 : i === 0);
    });

    if (hasProfile && hasAnyProgram) {
      dom.setupStepLabel.textContent = "STEP 03 / 03";
      dom.doneTitle.textContent = `Welcome back, ${state.profile.name}`;
      dom.doneSummary.innerHTML = `Age <b>${state.profile.age}</b> · Body weight <b>${formatWeight(state.profile.weight)}</b>. Your blocks are saved and waiting.`;
    } else if (hasProfile) {
      dom.setupStepLabel.textContent = "STEP 02 / 03";
      dom.continueTitle.textContent = `Nice to meet you, ${state.profile.name}`;
      dom.continueSummary.innerHTML = `Age <b>${state.profile.age}</b> · Body weight <b>${formatWeight(state.profile.weight)}</b>. Pick a lift below and generate your first block.`;
    } else {
      dom.setupStepLabel.textContent = "STEP 01 / 03";
    }
  }

  dom.profileForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const age = Number(dom.ageInput.value);
    const weight = Number(dom.weightInput.value);
    const name = dom.nameInput.value.trim();

    if (!name) { dom.profileError.textContent = "Enter your name."; return; }
    const error = validateProfile(age, weight);
    if (error) { dom.profileError.textContent = error; return; }

    dom.profileError.textContent = "";
    state.profile = { name, age, weight };
    saveState();
    renderSetupCard();
  });

  function resetAppState() {
    PROGRESSION.clear('powerlifting');
    state.profile = null;
    state.programs = emptyPrograms();
    state.section = "bench";
    scheduledNotificationTimers.forEach(id => clearTimeout(id));
    scheduledNotificationTimers.clear();
    dom.profileForm.reset();
    renderSetupCard();
    setActiveLift("bench");
  }

  dom.resetProfileBtn.addEventListener('click', resetAppState);

  /* =========================================================
     Lift switching + generator panel
  ========================================================= */
  function setActiveLift(lift) {
    state.section = lift;
    saveState();

    dom.navLinks.forEach(btn => btn.classList.toggle('active', btn.dataset.lift === lift));

    const section = liftSections[lift];
    const hasGenerator = Boolean(section.generatorKey);
    const program = getActiveProgram();

    dom.genPanel.classList.toggle('hidden', false);
    dom.genRight.classList.toggle('hidden', !hasGenerator);
    dom.genNoGenerator.classList.toggle('hidden', hasGenerator);

    dom.genDuration.classList.toggle('hidden', !hasGenerator);
    dom.templateGrid.classList.toggle('hidden', !hasGenerator);
    dom.weekBars.classList.toggle('hidden', !hasGenerator);

    if (hasGenerator) {
      dom.genDuration.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c44536" stroke-width="2"><path d="M3 17l6-6 4 4 8-8"/></svg> ${section.durationLabel}`;
      dom.genTitle.textContent = section.generatorTitle;
      dom.genDesc.textContent = section.generatorDesc;
      dom.genMaxLabel.textContent = section.maxLabel;
      dom.genMaxInput.placeholder = section.maxPlaceholder;
      dom.genMaxInput.value = program ? program.baseMax : "";
      selectedRounding = program ? program.roundingIncrement : DEFAULT_ROUNDING_INCREMENT;
      dom.genRounding.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('on', Number(btn.dataset.value) === selectedRounding);
      });
      renderTemplateGrid(lift);
      renderWeekBars(program);
    } else {
      dom.genTitle.textContent = section.label;
      dom.genDesc.textContent = section.emptyMessage;
      dom.genPlaceholderMessage.textContent = section.emptyMessage;
    }

    resetCalculator();
    renderChart();
    renderTrackTable();
  }

  function renderTemplateGrid(lift) {
    const section = liftSections[lift];
    dom.templateGrid.replaceChildren(...section.templates.map((tpl, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `template-card${tpl.active ? ' active' : ''}`;
      btn.disabled = !tpl.active;
      btn.innerHTML = `<strong>${tpl.name}</strong><span>${tpl.description}</span>`;
      btn.setAttribute('aria-label', `${section.label} ${tpl.name}`);
      return btn;
    }));
  }

  function renderWeekBars(program) {
    const heights = program && program.sessions
      ? program.sessions.map(s => Math.max(10, Math.min(100, s.intensityPercent)))
      : [40, 48, 56, 44, 62, 70, 52, 78, 88, 100];
    dom.weekBars.replaceChildren();
    heights.forEach((h, i) => {
      dom.weekBars.insertAdjacentHTML('beforeend',
        `<i style="--h:${h}%"><b style="position:absolute;left:0;right:0;bottom:0;height:${h}%;background:#c44536;opacity:.85"></b><span style="position:relative;z-index:1">${i + 1}</span></i>`);
    });
    if (!reducedMotion) requestAnimationFrame(() => dom.weekBars.closest('.gen')?.classList.add('grown'));
  }

  dom.navLinks.forEach(btn => btn.addEventListener('click', () => {
    setActiveLift(btn.dataset.lift);
    menu.classList.remove('open');
  }));

  dom.genRounding.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedRounding = Number(btn.dataset.value);
      dom.genRounding.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
    });
  });

  /* =========================================================
     1RM calculator (Epley formula: e1RM = weight × (1 + reps/30))
  ========================================================= */
  function estimateOneRepMax(weight, reps) {
    return weight * (1 + reps / 30);
  }

  function resetCalculator() {
    dom.calc1rmBox.classList.add('hidden');
    dom.calcToggle.textContent = "Don't know your max? Estimate it from a set →";
    dom.calcWeightInput.value = '';
    dom.calcRepsInput.value = '';
    dom.calc1rmResult.textContent = '--';
    dom.calcUseBtn.disabled = true;
  }

  function updateCalculatorResult() {
    const weight = Number(dom.calcWeightInput.value);
    const reps = Number(dom.calcRepsInput.value);
    const valid = weight > 0 && reps > 0;
    dom.calc1rmResult.textContent = valid ? formatWeight(estimateOneRepMax(weight, reps)) : '--';
    dom.calcUseBtn.disabled = !valid;
  }

  dom.calcToggle.addEventListener('click', () => {
    const nowHidden = dom.calc1rmBox.classList.toggle('hidden');
    dom.calcToggle.textContent = nowHidden ? "Don't know your max? Estimate it from a set →" : "Hide estimator";
  });

  dom.calcWeightInput.addEventListener('input', updateCalculatorResult);
  dom.calcRepsInput.addEventListener('input', updateCalculatorResult);

  dom.calcUseBtn.addEventListener('click', () => {
    const weight = Number(dom.calcWeightInput.value);
    const reps = Number(dom.calcRepsInput.value);
    if (!(weight > 0 && reps > 0)) return;
    dom.genMaxInput.value = WeightRounder.round(estimateOneRepMax(weight, reps), selectedRounding);
    dom.genError.textContent = '';
    resetCalculator();
  });

  dom.genSubmit.addEventListener('click', () => {
    const section = liftSections[state.section];
    if (!section.generatorKey) return;

    const userMax = Number(dom.genMaxInput.value);
    if (Number.isNaN(userMax) || userMax < 20 || userMax > 500) {
      dom.genError.textContent = "Enter a 1RM between 20 and 500 kg.";
      return;
    }
    dom.genError.textContent = "";

    state.programs[state.section] = {
      section: state.section,
      generatorTitle: section.generatorTitle,
      baseMax: userMax,
      roundingIncrement: selectedRounding,
      sessions: programGenerators[section.generatorKey].generate(userMax, selectedRounding),
    };
    saveState();
    renderWeekBars(state.programs[state.section]);
    renderChart();
    renderTrackTable();
    renderSetupCard();

    document.getElementById('progress').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  });

  /* =========================================================
     Progression chart (real data, SVG bar + line + dots)
  ========================================================= */
  function renderChart() {
    const section = liftSections[state.section];
    const program = getActiveProgram();
    const sessions = program?.sessions || [];

    dom.chartLabel.textContent = section.generatorKey ? `${section.label} working weight` : `${section.label} progress`;

    if (!sessions.length) {
      dom.chartStatus.textContent = section.generatorKey ? `No ${section.label.toLowerCase()} block yet` : 'Blank for now';
      dom.peakKg.textContent = '--';
      dom.peakUnit.textContent = '';
      dom.chartBody.innerHTML = `<p class="chart-empty">${section.generatorKey ? `Generate a ${section.label.toLowerCase()} template to see this graph.` : `${section.label} content can be added later.`}</p>`;
      return;
    }

    dom.chartStatus.textContent = `${section.label} block ready`;
    dom.chartBody.innerHTML = `
      <svg viewBox="0 0 520 260" fill="none" preserveAspectRatio="none" id="chartSvg">
        <g stroke="rgba(244,241,236,.06)" stroke-width="1">
          <line x1="0" y1="60" x2="520" y2="60"/><line x1="0" y1="120" x2="520" y2="120"/><line x1="0" y1="180" x2="520" y2="180"/>
        </g>
        <g id="bars"></g>
        <polyline id="line" fill="none" stroke="var(--rust)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
        <g id="dots"></g>
      </svg>
      <div class="xr" id="chartXr"></div>`;

    const bars = document.getElementById('bars'), line = document.getElementById('line'), dots = document.getElementById('dots'), xr = document.getElementById('chartXr');
    const data = sessions.map(s => s.weight);
    const W = 520, H = 260, pad = 14;
    const minValue = Math.max(0, Math.min(...data) - 10);
    const maxValue = Math.max(...data) + 10;
    const x = i => pad + i * ((W - pad * 2) / Math.max(data.length - 1, 1));
    const y = v => H - 14 - ((v - minValue) / ((maxValue - minValue) || 1)) * (H - 40);
    const bw = data.length > 12 ? 12 : 26;

    dom.peakKg.textContent = Number(data[data.length - 1].toFixed(1)).toLocaleString('en-GB');
    dom.peakUnit.textContent = 'kg';

    let pts = '';
    sessions.forEach((s, i) => {
      const bx = x(i), by = y(s.weight);
      bars.insertAdjacentHTML('beforeend', `<rect x="${bx - bw / 2}" y="${by}" width="${bw}" height="${H - 14 - by}" rx="3" fill="rgba(244,241,236,.06)"/>`);
      pts += `${bx},${by} `;
    });
    line.setAttribute('points', pts.trim());

    sessions.forEach((s, i) => {
      const cx = x(i), cy = y(s.weight);
      const color = s.intensityPercent >= 105 ? 'var(--olive)' : s.intensityPercent >= 100 ? 'var(--brass)' : 'var(--rust)';
      dots.insertAdjacentHTML('beforeend', `<circle cx="${cx}" cy="${cy}" r="${i === sessions.length - 1 ? 5 : 3}" fill="${color}"/>`);
      const showLabel = sessions.length <= 10 || i % 2 === 0 || i === sessions.length - 1;
      if (showLabel) {
        const label = sessions.length <= 10 ? `W${s.week}` : `S${s.session}`;
        xr.insertAdjacentHTML('beforeend', `<span style="position:absolute;left:${(cx / W) * 100}%;transform:translateX(-50%)">${label}</span>`);
      }
    });
    xr.style.position = 'relative';
    xr.style.height = '14px';
    xr.style.display = 'block';

    if (!reducedMotion) {
      const L = line.getTotalLength ? line.getTotalLength() : 0;
      if (L) {
        line.style.strokeDasharray = L; line.style.strokeDashoffset = L;
        line.style.transition = 'stroke-dashoffset 1.2s ease';
        requestAnimationFrame(() => requestAnimationFrame(() => line.style.strokeDashoffset = 0));
      }
      bars.querySelectorAll('rect').forEach((r, i) => { r.style.transitionDelay = (i * 0.03) + 's'; });
      document.querySelector('.chart').classList.add('grown');
    }
  }

  /* =========================================================
     Session tracking table
  ========================================================= */
  function renderTrackTable() {
    const section = liftSections[state.section];
    const program = getActiveProgram();
    const sessions = program?.sessions || [];

    if (!sessions.length) {
      dom.trackRows.innerHTML = `<tr><td colspan="8">${section.emptyMessage}</td></tr>`;
      return;
    }

    dom.trackRows.replaceChildren(...sessions.map(item => {
      const sessionKey = String(item.session || item.week);
      const log = getSessionLog(state.section, sessionKey);
      const row = document.createElement('tr');
      row.dataset.session = sessionKey;
      row.classList.toggle('completed', Boolean(log?.completed));
      row.innerHTML = `
        <td><input type="checkbox" class="done-checkbox" ${log?.completed ? 'checked' : ''} aria-label="Mark session ${sessionKey} complete" /></td>
        <td class="hi">${item.session || item.week}</td>
        <td>${item.week}</td>
        <td>${item.sets}</td>
        <td>${item.reps}</td>
        <td class="hi">${formatWeight(item.weight)}</td>
        <td>${item.intensityPercent ? item.intensityPercent + '%' : '-'}</td>
        <td>${item.notes || '-'}</td>
      `;
      return row;
    }));
  }

  dom.trackRows.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-session]');
    if (!row) return;
    const sessionKey = row.dataset.session;

    if (event.target.matches('.done-checkbox')) {
      event.stopPropagation();
      const program = state.programs[state.section];
      if (!program) return;
      const logs = getLogs(program);
      const existing = logs[sessionKey] || {};
      logs[sessionKey] = { ...existing, completed: event.target.checked };
      saveState();
      row.classList.toggle('completed', event.target.checked);
      return;
    }

    openSessionModal(state.section, sessionKey);
  });

  /* =========================================================
     Session modal + notifications
  ========================================================= */
  function openSessionModal(section, sessionKey) {
    const item = findSessionItem(section, sessionKey);
    if (!item) return;

    activeModalSession = { section, sessionKey };
    const log = getSessionLog(section, sessionKey) || {};
    const now = new Date();

    dom.modalTitle.textContent = `${liftSections[section].label} — session ${sessionKey}`;
    dom.modalProgWeight.textContent = formatWeight(item.weight);
    dom.modalProgSets.textContent = item.sets;
    dom.modalProgReps.textContent = item.reps;

    dom.modalActualWeight.value = log.actualWeight ?? item.weight;
    dom.modalActualSets.value = log.actualSets ?? item.sets;
    dom.modalActualReps.value = log.actualReps ?? item.reps;
    dom.modalDate.value = log.date || now.toISOString().slice(0, 10);
    dom.modalTime.value = log.time || now.toTimeString().slice(0, 5);
    dom.modalNotify.checked = Boolean(log.notify);
    dom.modalNotifyMinutes.value = String(log.notifyMinutes || 15);
    dom.modalError.textContent = "";

    dom.modalOverlay.classList.remove('hidden');
  }

  function closeSessionModal() {
    dom.modalOverlay.classList.add('hidden');
    activeModalSession = null;
  }

  function scheduleNotification(section, sessionKey, log) {
    const timerKey = `${section}:${sessionKey}`;
    const existing = scheduledNotificationTimers.get(timerKey);
    if (existing) { clearTimeout(existing); scheduledNotificationTimers.delete(timerKey); }
    if (!log?.notify || !log.date || !log.time) return;

    const sessionTime = new Date(`${log.date}T${log.time}`);
    if (Number.isNaN(sessionTime.getTime())) return;

    const notifyAt = sessionTime.getTime() - Number(log.notifyMinutes || 0) * 60 * 1000;
    const delay = notifyAt - Date.now();
    if (delay <= 0) return;

    const timerId = window.setTimeout(() => {
      if (Notification.permission === 'granted') {
        new Notification(`Powerlifting session at ${log.time}`, {
          body: `${liftSections[section].label} session ${sessionKey} in ${log.notifyMinutes} min.`,
        });
      }
      scheduledNotificationTimers.delete(timerKey);
    }, delay);
    scheduledNotificationTimers.set(timerKey, timerId);
  }

  function rescheduleAllNotifications() {
    Object.entries(state.programs).forEach(([section, program]) => {
      if (!program?.logs) return;
      Object.entries(program.logs).forEach(([sessionKey, log]) => scheduleNotification(section, sessionKey, log));
    });
  }

  dom.modalClose.addEventListener('click', closeSessionModal);
  dom.modalOverlay.addEventListener('click', (event) => { if (event.target === dom.modalOverlay) closeSessionModal(); });
  dom.modalNotify.addEventListener('change', () => { dom.modalNotifyMinutes.disabled = !dom.modalNotify.checked; });

  dom.modalForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!activeModalSession) return;
    const { section, sessionKey } = activeModalSession;

    const actualWeight = Number(dom.modalActualWeight.value);
    const actualSets = Number(dom.modalActualSets.value);
    const actualReps = Number(dom.modalActualReps.value);
    if (Number.isNaN(actualWeight) || Number.isNaN(actualSets) || Number.isNaN(actualReps)) {
      dom.modalError.textContent = "Enter valid numbers for weight, sets and reps."; return;
    }
    if (!dom.modalDate.value || !dom.modalTime.value) { dom.modalError.textContent = "Pick a date and time."; return; }

    const notify = dom.modalNotify.checked;
    const finalize = () => {
      const program = state.programs[section];
      const logs = getLogs(program);
      const log = {
        completed: true, actualWeight, actualSets, actualReps,
        date: dom.modalDate.value, time: dom.modalTime.value,
        notify, notifyMinutes: Number(dom.modalNotifyMinutes.value),
      };
      logs[sessionKey] = log;
      saveState();
      scheduleNotification(section, sessionKey, log);
      if (section === state.section) renderTrackTable();
      closeSessionModal();
    };

    if (notify && Notification.permission === 'default') {
      Notification.requestPermission().finally(finalize);
    } else {
      finalize();
    }
  });

  /* =========================================================
     Registration — the shell decides when this runs
  ========================================================= */
  function boot() {
    populateAgeOptions();
    loadState();
    renderSetupCard();
    setActiveLift(state.section);
    rescheduleAllNotifications();   // reminders fire whichever view is open
  }

  function reload() {            // remote data arrived
    loadState();
    renderSetupCard();
    setActiveLift(state.section);
    rescheduleAllNotifications();
  }

  PROGRESSION.register('powerlifting', {
    boot,
    reload,
    mount: initReveals,
  });
})();
