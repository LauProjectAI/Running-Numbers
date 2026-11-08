/**
 * Contrôleur principal de l'application Running Numbers (Polar Pace Analyzer)
 */
(function () {
  "use strict";

  const STORAGE_KEY_PARAMS = "running_numbers_user_params_v1";
  const STORAGE_KEY_CUSTOM_SESSIONS = "running_numbers_custom_sessions_v1";
  const STORAGE_KEY_EXCLUDED_IDS = "running_numbers_excluded_ids_v1";

  let allSessions = [];
  let defaultIds = new Set();
  let excludedIds = new Set();
  let userParams = {
    fcMax: null, // null = auto
    fcRest: null,
    vma: null
  };
  let currentChartFilter = "all";
  let lastAnalysis = null;

  function init() {
    loadSessionsFromStorage();

    try {
      const savedExcl = localStorage.getItem(STORAGE_KEY_EXCLUDED_IDS);
      if (savedExcl) {
        excludedIds = new Set(JSON.parse(savedExcl));
      } else {
        // Par défaut, isole les séances à forte dérive cardiaque (ex: 15/09 à 168 bpm moy)
        allSessions.forEach((s) => {
          if (window.PaceEngine.classifySession(s).isHighDrift) {
            excludedIds.add(s.id);
          }
        });
      }
      const savedParams = localStorage.getItem(STORAGE_KEY_PARAMS);
      if (savedParams) {
        userParams = { ...userParams, ...JSON.parse(savedParams) };
      }
    } catch (e) {
      console.warn("Erreur lecture localStorage params:", e);
    }

    setupEventListeners();
    refreshUI();
  }

  function loadSessionsFromStorage() {
    const defaults = Array.isArray(window.DEFAULT_POLAR_SESSIONS)
      ? window.DEFAULT_POLAR_SESSIONS
      : [];
    defaultIds = new Set(defaults.map((s) => s.id));

    let customSessions = [];
    try {
      const savedCustom = localStorage.getItem(STORAGE_KEY_CUSTOM_SESSIONS);
      if (savedCustom) customSessions = JSON.parse(savedCustom);
    } catch (e) {
      console.warn("Erreur lecture localStorage custom sessions:", e);
    }

    const mapById = new Map();
    defaults.forEach((s) => mapById.set(s.id, { ...s, isCustom: false }));
    customSessions.forEach((s) => mapById.set(s.id, { ...s, isCustom: true }));

    allSessions = Array.from(mapById.values()).sort((a, b) =>
      a.startTime.localeCompare(b.startTime)
    );
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY_PARAMS, JSON.stringify(userParams));
      localStorage.setItem(
        STORAGE_KEY_EXCLUDED_IDS,
        JSON.stringify(Array.from(excludedIds))
      );
    } catch (e) {
      console.warn("Impossible de sauvegarder l'état:", e);
    }
  }

  function getActiveSessions() {
    return allSessions.filter((s) => !excludedIds.has(s.id));
  }

  function triggerFilePicker() {
    const fileInput = document.getElementById("polar-file-input");
    if (fileInput) {
      fileInput.value = "";
      fileInput.click();
    }
  }

  function setupEventListeners() {
    const vmaInput = document.getElementById("input-vma");
    const fcMaxInput = document.getElementById("input-fcmax");
    const fcRestInput = document.getElementById("input-fcrest");

    if (vmaInput) {
      vmaInput.addEventListener("change", (e) => {
        const val = parseFloat(e.target.value);
        if (val >= 7.0 && val <= 26.0) {
          userParams.vma = Math.round(val * 10) / 10;
          saveState();
          refreshUI();
        }
      });
    }

    if (fcMaxInput) {
      fcMaxInput.addEventListener("change", (e) => {
        const val = parseInt(e.target.value, 10);
        if (val >= 130 && val <= 230) {
          userParams.fcMax = val;
          saveState();
          refreshUI();
        }
      });
    }

    if (fcRestInput) {
      fcRestInput.addEventListener("change", (e) => {
        const val = parseInt(e.target.value, 10);
        if (val >= 30 && val <= 100) {
          userParams.fcRest = val;
          saveState();
          refreshUI();
        }
      });
    }

    const fileInput = document.getElementById("polar-file-input");
    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleFiles(e.target.files);
        }
      });
    }

    // Glisser-déposer sur toute la fenêtre ou la drop-zone
    const dropZone = document.getElementById("drop-zone");
    window.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (dropZone) {
        dropZone.classList.add("border-red-500", "bg-red-500/10");
      }
    });
    window.addEventListener("dragleave", (e) => {
      if (e.target === document.body || e.target === dropZone) {
        if (dropZone) {
          dropZone.classList.remove("border-red-500", "bg-red-500/10");
        }
      }
    });
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dropZone) {
        dropZone.classList.remove("border-red-500", "bg-red-500/10");
      }
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    });
  }

  async function handleFiles(fileList) {
    const feedbackBanner = document.getElementById("import-feedback-banner");
    const feedbackTitle = document.getElementById("import-feedback-title");
    const feedbackDetails = document.getElementById("import-feedback-details");

    const customList = [];
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CUSTOM_SESSIONS);
      if (saved) customList.push(...JSON.parse(saved));
    } catch (e) {}

    const newlyParsed = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      try {
        const text = await file.text();
        const ext = file.name.toLowerCase();
        let parsed = null;
        if (ext.endsWith(".tcx") || text.includes("<TrainingCenterDatabase")) {
          parsed = window.PolarParser.parseTCX(text, file.name);
        } else if (ext.endsWith(".csv")) {
          parsed = window.PolarParser.parsePolarCSV(text, file.name);
        }

        if (parsed && parsed.totalDistanceM > 100) {
          parsed.isCustom = true;
          const customIdx = customList.findIndex((s) => s.id === parsed.id);
          if (customIdx !== -1) customList[customIdx] = parsed;
          else customList.push(parsed);

          // S'assure que la nouvelle séance importée est bien cochée/active
          excludedIds.delete(parsed.id);
          newlyParsed.push(parsed);
        }
      } catch (err) {
        console.error("Erreur lors de l'analyse du fichier", file.name, err);
      }
    }

    try {
      localStorage.setItem(STORAGE_KEY_CUSTOM_SESSIONS, JSON.stringify(customList));
    } catch (e) {
      console.warn("Quota localStorage atteint, conservation en mémoire vive :", e);
    }

    // Met à jour la liste en mémoire même si localStorage est plein
    const mapById = new Map();
    allSessions.forEach((s) => mapById.set(s.id, s));
    newlyParsed.forEach((s) => mapById.set(s.id, s));
    allSessions = Array.from(mapById.values()).sort((a, b) =>
      a.startTime.localeCompare(b.startTime)
    );

    saveState();
    refreshUI();

    if (feedbackBanner && newlyParsed.length > 0) {
      feedbackBanner.classList.remove("hidden");
      const last = newlyParsed[newlyParsed.length - 1];
      const distKm = (last.totalDistanceM / 1000).toFixed(2);
      const paceStr = window.PaceEngine.formatPace(3600 / last.avgSpeedKmh);
      const meta = window.PaceEngine.classifySession(last);

      if (newlyParsed.length === 1) {
        feedbackTitle.textContent = `✓ Séance "${last.fileName}" analysée et intégrée au calcul !`;
        feedbackDetails.innerHTML = `Date : <strong>${last.date}</strong> • Distance : <strong>${distKm} km</strong> @ <strong>${paceStr}/km</strong> • FC Moy : <strong>${last.avgHr} bpm</strong> (Max ${last.maxHr}) • Profil détecté : <strong>${meta.label}</strong>`;
      } else {
        feedbackTitle.textContent = `✓ ${newlyParsed.length} nouveaux fichiers Polar analysés et intégrés !`;
        feedbackDetails.innerHTML = `Dernière séance ajoutée : <strong>${last.date}</strong> (${distKm} km @ ${paceStr}/km, FC moy ${last.avgHr} bpm). Vos 6 allures et estimations ont été recalculées.`;
      }
    }
  }

  function removeCustomSession(sessionId) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CUSTOM_SESSIONS);
      if (saved) {
        const list = JSON.parse(saved).filter((s) => s.id !== sessionId);
        localStorage.setItem(STORAGE_KEY_CUSTOM_SESSIONS, JSON.stringify(list));
      }
    } catch (e) {}
    excludedIds.delete(sessionId);
    allSessions = allSessions.filter((s) => s.id !== sessionId);
    saveState();
    refreshUI();
  }

  function clearImportedSessions() {
    try {
      localStorage.removeItem(STORAGE_KEY_CUSTOM_SESSIONS);
    } catch (e) {}
    loadSessionsFromStorage();
    refreshUI();
  }

  function adjustParam(key, delta) {
    if (!lastAnalysis) return;
    const currentVal =
      userParams[key] !== null
        ? userParams[key]
        : lastAnalysis.autoPhys[key];

    if (key === "vma") {
      const next = Math.round((currentVal + delta) * 10) / 10;
      if (next >= 7.0 && next <= 26.0) userParams.vma = next;
    } else if (key === "fcMax") {
      const next = Math.round(currentVal + delta);
      if (next >= 130 && next <= 230) userParams.fcMax = next;
    } else if (key === "fcRest") {
      const next = Math.round(currentVal + delta);
      if (next >= 30 && next <= 100) userParams.fcRest = next;
    }
    saveState();
    refreshUI();
  }

  function resetPhysiologyToAuto() {
    userParams = { fcMax: null, fcRest: null, vma: null };
    saveState();
    refreshUI();
  }

  function toggleSessionSelection(sessionId) {
    if (excludedIds.has(sessionId)) {
      excludedIds.delete(sessionId);
    } else {
      if (getActiveSessions().length > 1) {
        excludedIds.add(sessionId);
      }
    }
    saveState();
    refreshUI();
  }

  let currentPeriodMode = "clean";

  function setPeriodFilter(mode) {
    currentPeriodMode = mode;
    excludedIds.clear();
    if (mode === "clean") {
      allSessions.forEach((s) => {
        const meta = window.PaceEngine.classifySession(s);
        if (meta.isHighDrift) {
          excludedIds.add(s.id);
        }
      });
    } else if (mode === "rebound") {
      allSessions.forEach((s) => {
        if (s.date < "2026-10-01") {
          excludedIds.add(s.id);
        }
      });
    }
    saveState();
    refreshUI();
  }

  function setDriftFilter(excludeHighDrift) {
    setPeriodFilter(excludeHighDrift ? "clean" : "all");
  }

  function selectZoneChart(filter) {
    currentChartFilter = filter;
    ["all", "ef", "seuil", "vma"].forEach((k) => {
      const btn = document.getElementById("tab-" + k);
      if (!btn) return;
      if (k === filter) {
        btn.className =
          "px-3 py-1 rounded-lg text-xs font-semibold bg-red-500 text-white shadow-sm transition";
      } else {
        btn.className =
          "px-3 py-1 rounded-lg text-xs font-medium bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition";
      }
    });
    renderChart();
  }

  function refreshUI() {
    const activeSessions = getActiveSessions();
    const res = window.PaceEngine.analyze(activeSessions, userParams);
    lastAnalysis = res;

    // Bouton purge imports navigateur si des séances custom existent
    const hasCustom = allSessions.some((s) => !defaultIds.has(s.id));
    const btnClearCustom = document.getElementById("btn-clear-custom");
    if (btnClearCustom) {
      if (hasCustom) btnClearCustom.classList.remove("hidden");
      else btnClearCustom.classList.add("hidden");
    }

    // 1. Mise à jour des boutons de filtre période
    const btnRebound = document.getElementById("btn-filter-rebound");
    const btnCleanSessions = document.getElementById("btn-filter-clean");
    const btnAllSessions = document.getElementById("btn-filter-all");
    const reboundCount = allSessions.filter((s) => s.date >= "2026-10-01").length;
    const cleanCount = allSessions.filter(
      (s) => !window.PaceEngine.classifySession(s).isHighDrift
    ).length;

    if (btnRebound) btnRebound.textContent = `Cycle Oct–Nov (${reboundCount})`;
    if (btnCleanSessions) btnCleanSessions.textContent = `↗ Août–Nov (${cleanCount})`;
    if (btnAllSessions) btnAllSessions.textContent = `Toutes (${allSessions.length})`;

    const activeBtnClass =
      "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-emerald-500 text-white shadow-sm";
    const inactiveBtnClass =
      "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all text-slate-400 hover:text-white";

    if (btnRebound && btnCleanSessions && btnAllSessions) {
      btnRebound.className =
        currentPeriodMode === "rebound" ? activeBtnClass : inactiveBtnClass;
      btnCleanSessions.className =
        currentPeriodMode === "clean" ? activeBtnClass : inactiveBtnClass;
      btnAllSessions.className =
        currentPeriodMode === "all"
          ? "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-red-500 text-white shadow-sm"
          : inactiveBtnClass;
    }

    // 2. Mise à jour du Bandeau de Tendance
    const banner = document.getElementById("trend-banner");
    const badge = document.getElementById("trend-badge");
    const titleEl = document.getElementById("trend-title");
    const descEl = document.getElementById("trend-desc");
    const summaryCountEl = document.getElementById("session-summary-count");

    if (summaryCountEl) {
      summaryCountEl.textContent = `• ${res.sessionCount}/${allSessions.length} séances Polar analysées (${res.totalDistKm} km)`;
    }

    const signStr = res.trendPct >= 0 ? `+${res.trendPct}%` : `${res.trendPct}%`;
    if (res.isAscending) {
      banner.className =
        "lg:col-span-2 bg-slate-900/90 border border-emerald-500/40 rounded-2xl p-5 shadow-sm flex flex-col justify-between gap-4";
      badge.className =
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
      const gainSec = Math.abs(res.deltaEfSec || res.deltaSeuilSec || 5);
      if (res.cycleInfo && res.cycleInfo.hasBreak) {
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>PHASE ASCENDANTE DE REPRISE (${signStr} depuis le 24/10)`;
        titleEl.textContent =
          "Rebond aérobie confirmé sur vos 6 sorties d'octobre–novembre";
        descEl.innerHTML = `Après la coupure du 15/09 au 24/10 (${res.cycleInfo.vsPeakPct}% vs votre pic de septembre), votre cycle actuel remonte rapidement : gain de <strong>-${gainSec} sec/km</strong> à FC égale entre fin octobre et votre sortie active de <strong>10.48 km à 6:36/km (147 bpm) le 07/11</strong>. Votre VMA actuelle s'établit à <strong>${res.activePhys.vma.toFixed(1)} km/h</strong>.`;
      } else {
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>PHASE ASCENDANTE (${signStr} d'efficacité cardio)`;
        titleEl.textContent =
          "Progression du rendement aérobie et des allures sur la période";
        descEl.innerHTML = `Sur les séances sélectionnées, à fréquence cardiaque comparable, votre allure progresse d'environ <strong>-${gainSec} sec/km</strong> (dernière sortie : 10.48 km à 6:36/km pour 147 bpm le 07/11).`;
      }
    } else {
      banner.className =
        "lg:col-span-2 bg-slate-900/90 border border-amber-500/40 rounded-2xl p-5 shadow-sm flex flex-col justify-between gap-4";
      badge.className =
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30";
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>PHASE DE REPRISE / TRANSITION (${signStr})`;
      titleEl.textContent =
        "Transition post-coupure (octobre–novembre vs pic de septembre)";
      descEl.innerHTML = `Vos allures actuelles reflètent la reprise après la coupure d'octobre, avec une excellente relance le <strong>07/11 (10.48 km @ 6:36/km, 147 bpm)</strong>.`;
    }

    // 3. Panneau Physiologique (VMA, FC Max, FC Repos)
    const vmaInput = document.getElementById("input-vma");
    const fcMaxInput = document.getElementById("input-fcmax");
    const fcRestInput = document.getElementById("input-fcrest");

    if (vmaInput) vmaInput.value = res.activePhys.vma.toFixed(1);
    if (fcMaxInput) fcMaxInput.value = res.activePhys.fcMax;
    if (fcRestInput) fcRestInput.value = res.activePhys.fcRest;

    const vmaPaceStr = window.PaceEngine.formatPace(3600 / res.activePhys.vma);
    const vmaSub = document.getElementById("vma-pace-sub");
    if (vmaSub) {
      const modeLabel = userParams.vma !== null ? "Manuel" : "Auto Polar";
      vmaSub.textContent = `Allure 100% : ${vmaPaceStr}/km (${modeLabel} : ${res.autoPhys.vma.toFixed(
        1
      )} km/h)`;
    }

    const fcMaxSub = document.getElementById("fcmax-sub");
    if (fcMaxSub) {
      fcMaxSub.textContent =
        userParams.fcMax !== null
          ? `Manuel (Auto : ${res.autoPhys.fcMax} bpm)`
          : `Détecté Auto (${res.autoPhys.fcMax} bpm)`;
    }

    const fcRestSub = document.getElementById("fcrest-sub");
    if (fcRestSub) {
      const hrr = res.activePhys.fcMax - res.activePhys.fcRest;
      fcRestSub.textContent = `FC Réserve (Karvonen) : ${hrr} bpm`;
    }

    const btnResetAuto = document.getElementById("btn-reset-auto");
    if (btnResetAuto) {
      const isCustom =
        userParams.vma !== null ||
        userParams.fcMax !== null ||
        userParams.fcRest !== null;
      btnResetAuto.className = isCustom
        ? "text-xs px-2.5 py-1 rounded-lg bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition font-medium"
        : "text-xs px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 opacity-60 cursor-default";
    }

    // 4. Barre du spectre coloré + Grille des 6 allures
    const spectrumBar = document.getElementById("spectrum-bar");
    if (spectrumBar) {
      spectrumBar.innerHTML = res.paces
        .map(
          (p) => `
          <div class="bg-slate-900/90 border ${p.border} rounded-lg px-2.5 py-2 flex flex-col justify-between">
            <div class="flex items-center justify-between gap-1">
              <span class="text-xs font-extrabold text-white truncate">${p.index}. ${p.code}</span>
              <span class="w-2.5 h-2.5 rounded-full ${p.barColor} shrink-0"></span>
            </div>
            <div class="text-sm font-extrabold text-white font-mono mt-0.5">${p.targetPace}<span class="text-xs font-normal text-slate-400">/km</span></div>
            <div class="text-xs text-slate-400">${p.hrRange}</div>
          </div>
        `
        )
        .join("");
    }

    const pacesGrid = document.getElementById("paces-grid");
    if (pacesGrid) {
      pacesGrid.innerHTML = res.paces
        .map((p) => {
          const trendColor =
            p.trendType === "up"
              ? "text-emerald-400"
              : p.trendType === "down"
              ? "text-amber-400"
              : "text-sky-400";
          return `
          <div class="bg-slate-950/80 border-2 ${p.border} rounded-xl p-4 flex flex-col justify-between space-y-3 hover:shadow-lg transition">
            <div class="space-y-1.5">
              <div class="flex items-center justify-between gap-1">
                <span class="text-xs font-bold px-2 py-0.5 rounded-md ${p.bgBadge}">
                  ${p.index}. ${p.code}
                </span>
                <span class="text-xs font-semibold ${trendColor}">
                  ${p.trend}
                </span>
              </div>
              <div class="text-xs font-semibold text-slate-200 truncate" title="${p.name}">
                ${p.name}
              </div>
              <p class="text-xs text-slate-400 leading-snug line-clamp-2">
                ${p.desc}
              </p>
            </div>

            <div class="py-2 border-y border-slate-800/90">
              <div class="text-xs text-slate-400">Allure cible</div>
              <div class="flex items-baseline gap-1.5 mt-0.5">
                <span class="text-2xl font-extrabold text-white">${p.targetPace}</span>
                <span class="text-xs font-semibold text-slate-400">/km</span>
              </div>
              <div class="text-xs text-slate-300 mt-1 font-medium">
                Plage : <span class="font-mono text-white">${p.rangePace}</span> /km
              </div>
            </div>

            <div class="space-y-1 text-xs">
              <div class="flex justify-between">
                <span class="text-slate-400">FC Polar :</span>
                <span class="font-semibold text-white">${p.hrRange}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">Zone %FCmax :</span>
                <span class="text-slate-300">${p.hrPctRange}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">Vitesse :</span>
                <span class="font-medium text-white">${p.speedKmh} <span class="text-slate-400">(${p.vmaPctRange})</span></span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">Piste 400m :</span>
                <span class="font-mono font-semibold text-slate-200">${p.lap400}</span>
              </div>
            </div>
          </div>
        `;
        })
        .join("");
    }

    // 5. Grille des 4 Prédictions
    const predGrid = document.getElementById("predictions-grid");
    if (predGrid) {
      predGrid.innerHTML = res.predictions
        .map(
          (pr) => `
        <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:border-red-500/50 transition">
          <div class="flex items-center justify-between gap-2">
            <span class="text-base font-bold text-white">${pr.distance}</span>
            <span class="text-xs px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 font-medium">
              ${pr.zoneRef}
            </span>
          </div>

          <div>
            <div class="text-xs text-slate-400">Temps estimatif</div>
            <div class="text-3xl font-extrabold tracking-tight text-white mt-0.5">
              ${pr.time}
            </div>
            <div class="text-xs font-semibold ${pr.deltaClass} mt-1">
              ${pr.delta}
            </div>
          </div>

          <div class="bg-slate-900/90 border border-slate-800 rounded-lg p-3 space-y-1.5 text-xs">
            <div class="flex justify-between">
              <span class="text-slate-400">Allure cible :</span>
              <span class="font-bold text-white">${pr.pace} <span class="font-normal text-slate-400">(${pr.speed})</span></span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">FC cible Polar :</span>
              <span class="font-medium text-slate-200">${pr.hrTarget}</span>
            </div>
            <div class="pt-1.5 mt-1 border-t border-slate-800 text-slate-400 font-mono">
              ${pr.splits}
            </div>
          </div>
        </div>
      `
        )
        .join("");
    }

    // 6. Barres de distribution du volume Polar
    const distBars = document.getElementById("distribution-bars");
    if (distBars) {
      distBars.innerHTML = res.paces
        .map(
          (p) => `
        <div class="space-y-1">
          <div class="flex justify-between text-xs">
            <span class="font-medium text-slate-200">${p.code} <span class="text-slate-400">(${p.targetPace}/km)</span></span>
            <span class="font-semibold text-white">${p.distPct}%</span>
          </div>
          <div class="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
            <div class="h-full ${p.barColor} rounded-full transition-all duration-300" style="width: ${Math.min(
            100,
            p.distPct
          )}%"></div>
          </div>
        </div>
      `
        )
        .join("");
    }

    // 7. Graphique d'évolution
    renderChart();

    // 8. Tableau des séances Polar
    renderSessionsTable();
  }

  function renderChart() {
    const svg = document.getElementById("trend-svg");
    if (!svg || !lastAnalysis) return;

    const timeline = lastAnalysis.timeline || [];
    if (timeline.length === 0) {
      svg.innerHTML = `<text x="340" y="120" text-anchor="middle" fill="#94a3b8" class="text-xs">Aucune séance sélectionnée</text>`;
      return;
    }

    const padLeft = 52;
    const padRight = 26;
    const padTop = 24;
    const padBottom = 34;
    const w = 680 - padLeft - padRight;
    const h = 250 - padTop - padBottom;

    let activeKeys = ["vmaPaceSec", "seuilPaceSec", "tempoPaceSec", "efPaceSec"];
    if (currentChartFilter === "ef") activeKeys = ["efPaceSec", "tempoPaceSec"];
    if (currentChartFilter === "seuil") activeKeys = ["seuilPaceSec", "tempoPaceSec"];
    if (currentChartFilter === "vma") activeKeys = ["vmaPaceSec", "seuilPaceSec"];

    let allVals = [];
    timeline.forEach((pt) => {
      activeKeys.forEach((k) => {
        if (pt[k] > 0) allVals.push(pt[k]);
      });
    });

    const minSec = Math.min(...allVals) - 12;
    const maxSec = Math.max(...allVals) + 12;

    const xForIdx = (i) =>
      timeline.length === 1
        ? padLeft + w / 2
        : padLeft + (i / (timeline.length - 1)) * w;
    const yForSec = (s) =>
      padTop + ((s - minSec) / Math.max(1, maxSec - minSec)) * h;

    let html = "";

    for (let i = 0; i <= 4; i++) {
      const secVal = minSec + (i / 4) * (maxSec - minSec);
      const y = yForSec(secVal);
      html += `
        <line x1="${padLeft}" y1="${y}" x2="${680 - padRight}" y2="${y}" stroke="#1e293b" stroke-dasharray="4 4" stroke-width="1" />
        <text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" fill="#94a3b8" class="text-xs font-mono">${window.PaceEngine.formatPace(
        secVal
      )}</text>
      `;
    }

    const stepLabel = timeline.length > 13 ? 2 : 1;
    timeline.forEach((pt, i) => {
      const x = xForIdx(i);
      const shortDate = pt.date.slice(8, 10) + "/" + pt.date.slice(5, 7);
      // Détection d'une coupure > 20 jours pour tracer un repère visuel
      if (i > 0) {
        const gapDays =
          (Date.parse(pt.date) - Date.parse(timeline[i - 1].date)) /
          (1000 * 3600 * 24);
        if (gapDays >= 20) {
          const midX = (xForIdx(i - 1) + x) / 2;
          html += `
            <line x1="${midX}" y1="${padTop}" x2="${midX}" y2="${250 - padBottom}" stroke="#64748b" stroke-dasharray="3 3" stroke-width="1.5" />
            <text x="${midX}" y="${padTop - 6}" text-anchor="middle" fill="#94a3b8" class="text-xs italic">Reprise Oct</text>
          `;
        }
      }
      html += `
        <line x1="${x}" y1="${padTop}" x2="${x}" y2="${250 - padBottom}" stroke="#1e293b" stroke-width="1" opacity="0.5" />
      `;
      if (i % stepLabel === 0 || i === timeline.length - 1) {
        html += `<text x="${x}" y="${250 - 8}" text-anchor="middle" fill="${
          pt.isHighDrift ? "#f87171" : "#94a3b8"
        }" class="text-xs font-mono">${shortDate}</text>`;
      }
    });

    const styles = {
      vmaPaceSec: { stroke: "#f43f5e", label: "VMA" },
      seuilPaceSec: { stroke: "#f59e0b", label: "Seuil/T" },
      tempoPaceSec: { stroke: "#84cc16", label: "Tempo" },
      efPaceSec: { stroke: "#38bdf8", label: "EF" }
    };

    activeKeys.forEach((k) => {
      const pts = timeline
        .map((pt, i) => `${xForIdx(i)},${yForSec(pt[k])}`)
        .join(" ");
      html += `<polyline fill="none" stroke="${styles[k].stroke}" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" points="${pts}" />`;

      timeline.forEach((pt, i) => {
        const cx = xForIdx(i);
        const cy = yForSec(pt[k]);
        const paceLabel = window.PaceEngine.formatPace(pt[k]);
        html += `
          <circle cx="${cx}" cy="${cy}" r="${pt.isHighDrift ? 5 : 4}" fill="${
          pt.isHighDrift ? "#ef4444" : styles[k].stroke
        }" stroke="#0f172a" stroke-width="1.5">
            <title>${pt.date} (${pt.label}) — ${styles[k].label} équiv. : ${paceLabel}/km (FC moy: ${pt.avgHr} bpm)</title>
          </circle>
        `;
        if (i === 0 || i === timeline.length - 1 || i === Math.floor(timeline.length / 2)) {
          html += `<text x="${cx}" y="${cy - 8}" text-anchor="middle" fill="${styles[k].stroke}" class="text-xs font-bold font-mono">${paceLabel}</text>`;
        }
      });
    });

    svg.innerHTML = html;
  }

  function renderSessionsTable() {
    const tbody = document.getElementById("sessions-table-body");
    const mobileCards = document.getElementById("sessions-mobile-cards");
    if (!tbody) return;

    const badgeClasses = {
      sky: "bg-sky-500/15 text-sky-400 border-sky-500/30",
      emerald: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      lime: "bg-lime-500/15 text-lime-400 border-lime-500/30",
      amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
      rose: "bg-rose-500/15 text-rose-400 border-rose-500/30"
    };

    if (mobileCards) {
      mobileCards.innerHTML = allSessions
        .map((s) => {
          const isIncluded = !excludedIds.has(s.id);
          const isCustom = !defaultIds.has(s.id);
          const meta = window.PaceEngine.classifySession(s);
          const distKm = (s.totalDistanceM / 1000).toFixed(2);
          const durStr = window.PaceEngine.formatDuration(s.totalTimeSec);
          const avgPaceStr = window.PaceEngine.formatPace(3600 / s.avgSpeedKmh);
          const bClass = badgeClasses[meta.badgeColor] || badgeClasses.sky;

          return `
          <div class="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2 ${
            isIncluded ? "" : "opacity-45"
          }">
            <div class="flex items-center justify-between gap-2">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" ${
                  isIncluded ? "checked" : ""
                } onchange="window.RunningApp.toggleSessionSelection('${
            s.id
          }')" class="w-4 h-4 rounded accent-red-500" />
                <span class="font-mono text-xs font-bold text-white">${s.date}</span>
                ${
                  isCustom
                    ? '<span class="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-semibold">Importé</span>'
                    : ""
                }
              </label>
              <span class="text-xs font-bold text-white">${distKm} km • ${avgPaceStr}/km</span>
            </div>
            <div>
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${bClass}">
                ${meta.label}
              </span>
            </div>
            <div class="flex items-center justify-between text-xs text-slate-400 pt-1.5 border-t border-slate-800/80">
              <span>Durée : <strong class="text-slate-200">${durStr}</strong> • FC : <strong class="${
            meta.isHighDrift ? "text-rose-400" : "text-white"
          }">${s.avgHr}</strong>/${s.maxHr} bpm</span>
              ${
                isCustom
                  ? `<button onclick="window.RunningApp.removeCustomSession('${s.id}')" class="text-xs text-red-400 px-2 py-0.5 rounded bg-red-500/10 border border-red-500/20">Retirer</button>`
                  : ""
              }
            </div>
          </div>
        `;
        })
        .join("");
    }

    tbody.innerHTML = allSessions
      .map((s) => {
        const isIncluded = !excludedIds.has(s.id);
        const isCustom = !defaultIds.has(s.id);
        const meta = window.PaceEngine.classifySession(s);
        const distKm = (s.totalDistanceM / 1000).toFixed(2);
        const durStr = window.PaceEngine.formatDuration(s.totalTimeSec);
        const avgPaceStr = window.PaceEngine.formatPace(3600 / s.avgSpeedKmh);
        const bClass = badgeClasses[meta.badgeColor] || badgeClasses.sky;

        return `
        <tr class="border-b border-slate-800/70 hover:bg-slate-900/60 transition ${
          isIncluded ? "" : "opacity-45"
        }">
          <td class="py-3 px-4">
            <input type="checkbox" ${isIncluded ? "checked" : ""} onchange="window.RunningApp.toggleSessionSelection('${
          s.id
        }')" class="w-4 h-4 rounded accent-red-500 cursor-pointer" title="Inclure ou exclure cette séance du calcul des allures" />
          </td>
          <td class="py-3 px-4 font-mono text-xs text-slate-200 whitespace-nowrap">
            <div class="flex items-center gap-2">
              <span>${s.date}</span>
              ${
                isCustom
                  ? '<span class="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-sans font-semibold">Importé</span>'
                  : ""
              }
            </div>
            <div class="text-slate-500">${s.fileName}</div>
          </td>
          <td class="py-3 px-4">
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${bClass}">
              ${meta.label}
            </span>
          </td>
          <td class="py-3 px-4 font-semibold text-white whitespace-nowrap">
            ${distKm} km
            <span class="text-slate-400 font-normal ml-1">(${durStr})</span>
          </td>
          <td class="py-3 px-4 font-mono text-white whitespace-nowrap">
            ${avgPaceStr} /km
            <span class="text-slate-400 text-xs block">${s.avgSpeedKmh.toFixed(2)} km/h</span>
          </td>
          <td class="py-3 px-4 whitespace-nowrap">
            <span class="font-semibold ${
              meta.isHighDrift ? "text-rose-400" : "text-white"
            }">${s.avgHr} bpm</span>
            <span class="text-slate-400 text-xs"> (max ${s.maxHr})</span>
          </td>
          <td class="py-3 px-4 font-mono text-xs text-slate-300 whitespace-nowrap">
            ${s.avgWatts ? s.avgWatts + " W" : "-"} ${
          s.avgCadence ? "• " + s.avgCadence * 2 + " ppm" : ""
        }
          </td>
          <td class="py-3 px-4 text-right whitespace-nowrap">
            ${
              isCustom
                ? `<button onclick="window.RunningApp.removeCustomSession('${s.id}')" class="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded bg-red-500/10 border border-red-500/20">Retirer</button>`
                : `<span class="text-xs text-slate-500">Dossier projet</span>`
            }
          </td>
        </tr>
      `;
      })
      .join("");
  }

  window.RunningApp = {
    init,
    triggerFilePicker,
    removeCustomSession,
    clearImportedSessions,
    adjustParam,
    resetPhysiologyToAuto,
    toggleSessionSelection,
    setDriftFilter,
    setPeriodFilter,
    selectZoneChart
  };

  document.addEventListener("DOMContentLoaded", init);
})();
