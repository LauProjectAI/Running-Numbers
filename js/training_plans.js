/**
 * Module "Mes Plans 2027" — Programmes d'entraînement 2026/2027 reconstitués depuis Campus Coach & Polar TCX
 * Les allures et fréquences cardiaques cibles sont recalculées en temps réel selon la VMA, FC Max et FC Repos actives.
 */
(function () {
  "use strict";

  const STORAGE_KEY_COMPLETED = "running_numbers_plans_completed_v1";
  const STORAGE_KEY_SELECTED_PLAN = "running_numbers_selected_plan_v1";

  let selectedPlanId = "keep_fit";
  let selectedCategoryFilter = "all";
  let completedMap = {};
  let lastPhys = { vma: 12.7, fcMax: 179, fcRest: 52 };

  function loadStorage() {
    try {
      const savedDone = localStorage.getItem(STORAGE_KEY_COMPLETED);
      if (savedDone) {
        const parsed = JSON.parse(savedDone);
        if (parsed && typeof parsed === "object") completedMap = parsed;
      }
      const savedPlan = localStorage.getItem(STORAGE_KEY_SELECTED_PLAN);
      if (savedPlan && PLANS.some((p) => p.id === savedPlan)) {
        selectedPlanId = savedPlan;
      }
    } catch (e) {
      // Fallback silencieux si localStorage indisponible
    }
  }

  function saveStorage() {
    try {
      localStorage.setItem(STORAGE_KEY_COMPLETED, JSON.stringify(completedMap));
      localStorage.setItem(STORAGE_KEY_SELECTED_PLAN, selectedPlanId);
    } catch (e) {}
  }

  function formatPaceLocal(secPerKm) {
    if (window.PaceEngine && typeof window.PaceEngine.formatPace === "function") {
      return window.PaceEngine.formatPace(secPerKm);
    }
    if (!secPerKm || !isFinite(secPerKm) || secPerKm <= 0) return "--:--";
    const total = Math.round(secPerKm);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  function formatDurationLocal(totalSec) {
    if (window.PaceEngine && typeof window.PaceEngine.formatDuration === "function") {
      return window.PaceEngine.formatDuration(totalSec);
    }
    if (!totalSec || !isFinite(totalSec) || totalSec <= 0) return "--:--";
    const sec = Math.round(totalSec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return `${h}h${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
    }
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  /**
   * Calcule les 8 repères d'allures et les chronos objectifs pour la VMA / FC active
   */
  function computeZones(activePhys) {
    const vma = activePhys && activePhys.vma ? Number(activePhys.vma) : 12.7;
    const fcMax = activePhys && activePhys.fcMax ? Number(activePhys.fcMax) : 179;
    const fcRest = activePhys && activePhys.fcRest ? Number(activePhys.fcRest) : 52;
    const hrr = Math.max(40, fcMax - fcRest);

    const defs = {
      EF:      { label: "EF",         desc: "Endurance",   vMin: 0.64,  vTarg: 0.675, vMax: 0.71,  hMin: 0.60, hMax: 0.70, badge: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
      SV1:     { label: "SV1",        desc: "End. active", vMin: 0.71,  vTarg: 0.74,  vMax: 0.765, hMin: 0.70, hMax: 0.76, badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
      TEMPO:   { label: "Tempo",      desc: "Allure M",    vMin: 0.765, vTarg: 0.79,  vMax: 0.815, hMin: 0.76, hMax: 0.81, badge: "bg-lime-500/15 text-lime-400 border-lime-500/30" },
      AS21:    { label: "AS21 Semi",  desc: "Semi 21,1k",  vMin: 0.79,  vTarg: 0.805, vMax: 0.82,  hMin: 0.79, hMax: 0.84, badge: "bg-teal-500/15 text-teal-400 border-teal-500/30" },
      SEUIL60: { label: "Seuil 60/T", desc: "Seuil T",     vMin: 0.815, vTarg: 0.84,  vMax: 0.865, hMin: 0.81, hMax: 0.86, badge: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
      AS10:    { label: "AS10 / S30", desc: "Allure 10k",  vMin: 0.84,  vTarg: 0.855, vMax: 0.875, hMin: 0.84, hMax: 0.89, badge: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
      AS5:     { label: "AS5 / SV2",  desc: "Allure 5k",   vMin: 0.88,  vTarg: 0.905, vMax: 0.92,  hMin: 0.88, hMax: 0.93, badge: "bg-pink-500/15 text-pink-400 border-pink-500/30" },
      VMA:     { label: "VMA 30s",    desc: "Intervalles", vMin: 0.95,  vTarg: 1.00,  vMax: 1.05,  hMin: 0.91, hMax: 1.00, badge: "bg-rose-500/15 text-rose-400 border-rose-500/30" }
    };

    const z = { vma, fcMax, fcRest, hrr };
    Object.keys(defs).forEach((key) => {
      const d = defs[key];
      const targPaceSec = 3600.0 / (vma * d.vTarg);
      const fastPaceSec = 3600.0 / (vma * d.vMax);
      const slowPaceSec = 3600.0 / (vma * d.vMin);
      const hrLow = Math.round(fcRest + hrr * d.hMin);
      const hrHigh = Math.round(fcRest + hrr * d.hMax);

      z[key] = {
        key,
        label: d.label,
        desc: d.desc,
        badge: d.badge,
        target: formatPaceLocal(targPaceSec),
        fast: formatPaceLocal(fastPaceSec),
        slow: formatPaceLocal(slowPaceSec),
        range: `${formatPaceLocal(fastPaceSec)}–${formatPaceLocal(slowPaceSec)}/km`,
        hr: `${hrLow}–${hrHigh} bpm`,
        hrHigh: `${hrHigh} bpm`,
        hrLow: `${hrLow} bpm`
      };
    });

    const pace5k = 3600.0 / (vma * 0.905);
    const pace10k = 3600.0 / (vma * 0.855);
    const paceHm = 3600.0 / (vma * 0.805);

    z.race5k = {
      time: formatDurationLocal(pace5k * 5.0),
      pace: `${formatPaceLocal(pace5k)}/km`
    };
    z.race10k = {
      time: formatDurationLocal(pace10k * 10.0),
      pace: `${formatPaceLocal(pace10k)}/km`
    };
    z.raceHm = {
      time: formatDurationLocal(paceHm * 21.0975),
      pace: `${formatPaceLocal(paceHm)}/km`
    };

    return z;
  }

  /**
   * Catalogue des 4 programmes 2026/2027
   */
  const PLANS = [
    {
      id: "keep_fit",
      shortTitle: "Programme A • Maintien",
      title: "Programme A — Maintien de forme / Reprise foncière (8 semaines)",
      subtitle: "Idéal pour Novembre 2026 → Janvier 2027 puis en transition Mai → Juin 2027 (cycles Oct–Déc 2024 & Mai–Juil 2025)",
      periodSuggestion: "Nov 2026 – Jan 2027",
      weeksLabel: "8 semaines • 24 séances",
      accentBadge: "bg-sky-500/15 text-sky-400 border-sky-500/30",
      borderActive: "border-sky-500 ring-1 ring-sky-500/40",
      sessions: [
        { key: "S1.1", week: "S1", category: "ef", name: "Footing EF", structure: "35 min EF continu", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km (${z.EF.hr})` },
        { key: "S1.2", week: "S1", category: "quality", name: "VMA courte (30s) #1", structure: "20' EF + 6 × (30s VMA / 1'30 EF) + 10' RAC", duration: "42 min", targetFn: (z) => `VMA ${z.VMA.range} • EF ${z.EF.target}/km` },
        { key: "S1.3", week: "S1", category: "long", name: "Sortie Longue EF", structure: "45 min EF continu", duration: "45 min", targetFn: (z) => `EF ${z.EF.target}/km (${z.EF.hr})` },

        { key: "S2.1", week: "S2", category: "ef", name: "Footing EF", structure: "35 min EF continu", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km (${z.EF.hr})` },
        { key: "S2.2", week: "S2", category: "quality", name: "VMA courte (30s) #2", structure: "18' EF + 8 × (30s VMA / 1'30 EF) + 9'30 RAC", duration: "43 min 30", targetFn: (z) => `VMA ${z.VMA.range} (viser un plateau)` },
        { key: "S2.3", week: "S2", category: "long", name: "Sortie Longue EF", structure: "50 min EF continu", duration: "50 min", targetFn: (z) => `EF ${z.EF.target}/km (${z.EF.hr})` },

        { key: "S3.1", week: "S3", category: "ef", name: "Footing EF", structure: "35 min EF continu", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km (${z.EF.hr})` },
        { key: "S3.2", week: "S3", category: "quality", name: "Variations Tempo / Seuil 30", structure: "17' EF + 3 × (2' Tempo + 1' Seuil30 / 2' EF) + 10' RAC", duration: "42 min", targetFn: (z) => `Tempo ${z.TEMPO.target}/km • Seuil30 ${z.AS10.range}` },
        { key: "S3.3", week: "S3", category: "long", name: "Sortie Longue EF", structure: "55 min EF continu", duration: "55 min", targetFn: (z) => `EF ${z.EF.range} (${z.EF.hr})` },

        { key: "S4.1", week: "S4", isRecoveryWeek: true, category: "ef", name: "EF Récupération (sem. allégée)", structure: "25 min EF très souple", duration: "25 min", targetFn: (z) => `EF souple ${z.EF.slow}/km (< ${z.EF.hrHigh})` },
        { key: "S4.2", week: "S4", isRecoveryWeek: true, category: "quality", name: "EF + Lignes droites", structure: "20' EF + 5 × (20s rapide / 40s EF) + 5' RAC", duration: "30 min", targetFn: (z) => `Lignes droites ${z.VMA.range}` },
        { key: "S4.3", week: "S4", isRecoveryWeek: true, category: "long", name: "Sortie Longue Récup", structure: "35 min EF continu", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km (${z.EF.hr})` },

        { key: "S5.1", week: "S5", category: "ef", name: "Footing EF", structure: "35 min EF continu", duration: "35 min", targetFn: (z) => `EF ${z.EF.range} (${z.EF.hr})` },
        { key: "S5.2", week: "S5", category: "quality", name: "Seuil 60 court", structure: "15' EF + 2 × (6' Seuil60 / 2' EF) + 6' RAC", duration: "37 min", targetFn: (z) => `Seuil 60 ${z.SEUIL60.range} (${z.SEUIL60.hr})` },
        { key: "S5.3", week: "S5", category: "long", name: "Sortie Longue EF", structure: "55 min EF continu", duration: "55 min", targetFn: (z) => `EF ${z.EF.target}/km (${z.EF.hr})` },

        { key: "S6.1", week: "S6", category: "ef", name: "Footing EF", structure: "35 min EF continu", duration: "35 min", targetFn: (z) => `EF ${z.EF.range} (${z.EF.hr})` },
        { key: "S6.2", week: "S6", category: "quality", name: "Fractionné Seuil 60", structure: "15' EF + 5 × (2' Seuil60 / 1'30 EF) + 7'30 RAC", duration: "40 min", targetFn: (z) => `Seuil 60 ${z.SEUIL60.range} (${z.SEUIL60.hr})` },
        { key: "S6.3", week: "S6", category: "long", name: "Sortie Longue EF", structure: "60 min EF continu", duration: "60 min", targetFn: (z) => `EF ${z.EF.target}/km (${z.EF.hr})` },

        { key: "S7.1", week: "S7", category: "ef", name: "Footing EF", structure: "35 min EF continu", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km (${z.EF.hr})` },
        { key: "S7.2", week: "S7", category: "quality", name: "Intervalles Seuil 60", structure: "15' EF + 6 × (3' Seuil60 / 1'30 EF) + 5' RAC", duration: "47 min", targetFn: (z) => `Seuil 60 ${z.SEUIL60.range} (${z.SEUIL60.hr})` },
        { key: "S7.3", week: "S7", category: "long", name: "Sortie Longue EF", structure: "65 min EF continu", duration: "65 min", targetFn: (z) => `EF ${z.EF.target}/km (${z.EF.hr})` },

        { key: "S8.1", week: "S8", isRecoveryWeek: true, category: "ef", name: "EF Récupération (sem. allégée)", structure: "25 min EF très souple", duration: "25 min", targetFn: (z) => `EF souple ${z.EF.slow}/km (< ${z.EF.hrHigh})` },
        { key: "S8.2", week: "S8", isRecoveryWeek: true, category: "quality", name: "EF + Lignes droites", structure: "20' EF + 5 × (20s rapide / 40s EF) + 5' RAC", duration: "30 min", targetFn: (z) => `Lignes droites ${z.VMA.range}` },
        { key: "S8.3", week: "S8", isRecoveryWeek: true, category: "long", name: "Sortie Longue Récup", structure: "45 min EF continu", duration: "45 min", targetFn: (z) => `EF ${z.EF.target}/km (${z.EF.hr})` }
      ]
    },
    {
      id: "plan_5k",
      shortTitle: "Programme B • 5 km",
      title: "Programme B — Prépa 5 km (8 semaines + 1 sem. récup)",
      subtitle: "Reconstitué de votre prépa 5 km Décembre 2024 – Février 2025 pour développer la vitesse et tenir l'allure AS5",
      periodSuggestion: "Option Hiver / Vitesse",
      weeksLabel: "8+1 sem. • 27 séances",
      accentBadge: "bg-rose-500/15 text-rose-400 border-rose-500/30",
      borderActive: "border-rose-500 ring-1 ring-rose-500/40",
      sessions: [
        { key: "S1.1", week: "S1", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.range} (${z.EF.hr})` },
        { key: "S1.2", week: "S1", category: "quality", name: "Vitesse AS5 #1 (7×1')", structure: "15' EF + 7 × (1' AS5 / 1' EF) + 5' RAC", duration: "34 min", targetFn: (z) => `AS5 ${z.AS5.range} (${z.AS5.hr})` },
        { key: "S1.3", week: "S1", category: "long", name: "Sortie Longue + SV1", structure: "40' EF + 2 × (7' SV1 / 3' EF) + 5' RAC", duration: "65 min", targetFn: (z) => `EF ${z.EF.target} • SV1 ${z.SV1.target}/km` },

        { key: "S2.1", week: "S2", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.range} (${z.EF.hr})` },
        { key: "S2.2", week: "S2", category: "quality", name: "Vitesse AS5 #2 (6×1'30)", structure: "15' EF + 6 × (1'30 AS5 / 1'30 EF) + 5' RAC", duration: "38 min", targetFn: (z) => `AS5 ${z.AS5.range} (${z.AS5.hr})` },
        { key: "S2.3", week: "S2", category: "long", name: "Sortie Longue EF", structure: "65 min EF continu", duration: "65 min", targetFn: (z) => `EF ${z.EF.target}/km (${z.EF.hr})` },

        { key: "S3.1", week: "S3", category: "ef", name: "Footing EF", structure: "40 min EF", duration: "40 min", targetFn: (z) => `EF ${z.EF.target}/km (${z.EF.hr})` },
        { key: "S3.2", week: "S3", category: "quality", name: "Vitesse AS5 #3 (5×2')", structure: "15' EF + 5 × (2' AS5 / 1'30 EF) + 5' RAC", duration: "37 min 30", targetFn: (z) => `AS5 ${z.AS5.range} (${z.AS5.hr})` },
        { key: "S3.3", week: "S3", category: "long", name: "Sortie Longue + SV1", structure: "45' EF + 2 × (8' SV1 / 2' EF) + 5' RAC", duration: "70 min", targetFn: (z) => `EF ${z.EF.target} • SV1 ${z.SV1.target}/km` },

        { key: "S4.1", week: "S4", isRecoveryWeek: true, category: "ef", name: "EF Récupération (sem. allégée)", structure: "25 min EF souple", duration: "25 min", targetFn: (z) => `EF souple ${z.EF.slow}/km (< ${z.EF.hrHigh})` },
        { key: "S4.2", week: "S4", isRecoveryWeek: true, category: "quality", name: "EF + Lignes droites", structure: "17' EF + 4 × (20s VMA / 40s EF) + 4' RAC", duration: "25 min", targetFn: (z) => `VMA ${z.VMA.target}/km` },
        { key: "S4.3", week: "S4", isRecoveryWeek: true, category: "long", name: "Sortie Longue Récup", structure: "50 min EF continu", duration: "50 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S5.1", week: "S5", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S5.2", week: "S5", category: "quality", name: "Mixte Seuil 30 + AS5 #1", structure: "15' EF + 3 × (5' Seuil30 / 2' EF) + 3 × (3' AS5 / 2' EF) + 9' RAC", duration: "60 min", targetFn: (z) => `Seuil30 ${z.AS10.target} • AS5 ${z.AS5.range}` },
        { key: "S5.3", week: "S5", category: "long", name: "Sortie Longue EF", structure: "60 min EF continu", duration: "60 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S6.1", week: "S6", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S6.2", week: "S6", category: "quality", name: "Mixte Seuil 30 + AS5 #2", structure: "15' EF + 2 × (6' Seuil30 / 2' EF) + 4 × (3' AS5 / 2' EF) + 9'30 RAC", duration: "60 min 30", targetFn: (z) => `Seuil30 ${z.AS10.target} • AS5 ${z.AS5.range}` },
        { key: "S6.3", week: "S6", category: "long", name: "Sortie Longue EF", structure: "70 min EF continu", duration: "70 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S7.1", week: "S7", category: "ef", name: "Footing EF (Affûtage)", structure: "30 min EF", duration: "30 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S7.2", week: "S7", category: "quality", name: "Spécifique AS5 long", structure: "15' EF + 4 × (4' AS5 / 2' EF) + 3 × (30s VMA / 1'30 EF) + 12' RAC", duration: "57 min", targetFn: (z) => `AS5 ${z.AS5.range} • VMA ${z.VMA.target}/km` },
        { key: "S7.3", week: "S7", category: "long", name: "Sortie Longue Affûtage", structure: "50 min EF continu", duration: "50 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S8.1", week: "S8", category: "ef", name: "EF Légère (Sem. course)", structure: "25 min EF", duration: "25 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S8.2", week: "S8", category: "quality", name: "Rappel d'allure AS5", structure: "18' EF + 3 × (1' AS5 / 1' EF) + 6' RAC", duration: "30 min", targetFn: (z) => `AS5 ${z.AS5.target}/km (${z.AS5.hr})` },
        { key: "S8.3", week: "S8", category: "race", name: "COURSE 5 km", structure: "15' échauff. + 5 km course", duration: `~26 min`, targetFn: (z) => `Objectif ${z.race5k.time} (${z.race5k.pace}, ${z.AS5.hr})` },

        { key: "S9.1", week: "S9", isRecoveryWeek: true, category: "ef", name: "Récupération post-5 km #1", structure: "30 min EF très doux", duration: "30 min", targetFn: (z) => `Z1 souple ${z.EF.slow}/km (< ${z.EF.hrHigh})` },
        { key: "S9.2", week: "S9", isRecoveryWeek: true, category: "ef", name: "Récupération post-5 km #2", structure: "30 min Marche / Footing très doux", duration: "30 min", targetFn: (z) => `Z1 (< ${z.EF.hrHigh}, 7:15–8:30/km)` },
        { key: "S9.3", week: "S9", isRecoveryWeek: true, category: "ef", name: "Récupération post-5 km #3", structure: "30 min EF souple", duration: "30 min", targetFn: (z) => `EF ${z.EF.target}/km` }
      ]
    },
    {
      id: "plan_10k",
      shortTitle: "Programme C • 10 km",
      title: "Programme C — Prépa 10 km (12 semaines + 1 sem. récup)",
      subtitle: "Idéal pour le Printemps 2027 (Février → Avril) • Reconstitué de vos cycles Fév–Mai 2025 et Fév–Avr 2026",
      periodSuggestion: "Fév – Avr 2027",
      weeksLabel: "12+1 sem. • 38 séances",
      accentBadge: "bg-orange-500/15 text-orange-400 border-orange-500/30",
      borderActive: "border-orange-500 ring-1 ring-orange-500/40",
      sessions: [
        { key: "S1.1", week: "S1", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.range} (${z.EF.hr})` },
        { key: "S1.2", week: "S1", category: "quality", name: "Seuil 60 #1 (4×3')", structure: "15' EF + 4 × (3' Seuil60 / 1'30 EF) + 5' RAC", duration: "38 min", targetFn: (z) => `Seuil 60 ${z.SEUIL60.range} (${z.SEUIL60.hr})` },
        { key: "S1.3", week: "S1", category: "long", name: "Sortie Longue EF", structure: "60 min EF", duration: "60 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S2.1", week: "S2", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.range} (${z.EF.hr})` },
        { key: "S2.2", week: "S2", category: "quality", name: "Seuil 60 #2 (5×3')", structure: "15' EF + 5 × (3' Seuil60 / 1'30 EF) + 5' RAC", duration: "42 min 30", targetFn: (z) => `Seuil 60 ${z.SEUIL60.range} (${z.SEUIL60.hr})` },
        { key: "S2.3", week: "S2", category: "long", name: "Sortie Longue EF", structure: "65 min EF", duration: "65 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S3.1", week: "S3", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S3.2", week: "S3", category: "quality", name: "Seuil 60 #3 (6×3')", structure: "15' EF + 6 × (3' Seuil60 / 1'30 EF) + 5' RAC", duration: "47 min", targetFn: (z) => `Seuil 60 ${z.SEUIL60.range} (${z.SEUIL60.hr})` },
        { key: "S3.3", week: "S3", category: "long", name: "Sortie Longue EF", structure: "70 min EF", duration: "70 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S4.1", week: "S4", isRecoveryWeek: true, category: "ef", name: "EF Récupération (sem. allégée)", structure: "30 min EF souple", duration: "30 min", targetFn: (z) => `EF ${z.EF.slow}/km (< ${z.EF.hrHigh})` },
        { key: "S4.2", week: "S4", isRecoveryWeek: true, category: "quality", name: "EF + Lignes droites", structure: "20' EF + 5 × (20s VMA / 40s EF) + 5' RAC", duration: "30 min", targetFn: (z) => `VMA ${z.VMA.target}/km` },
        { key: "S4.3", week: "S4", isRecoveryWeek: true, category: "long", name: "Sortie Longue Récup", structure: "45 min EF", duration: "45 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S5.1", week: "S5", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S5.2", week: "S5", category: "quality", name: "Spécifique AS10 #1 (3×6')", structure: "15' EF + 3 × (6' AS10 / 2'30 EF) + 6'30 RAC", duration: "47 min", targetFn: (z) => `AS10 ${z.AS10.range} (${z.AS10.hr})` },
        { key: "S5.3", week: "S5", category: "long", name: "Sortie Longue EF", structure: "65 min EF", duration: "65 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S6.1", week: "S6", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S6.2", week: "S6", category: "quality", name: "Spécifique AS10 #2 (3×8')", structure: "15' EF + 3 × (8' AS10 / 3' EF) + 5' RAC", duration: "53 min", targetFn: (z) => `AS10 ${z.AS10.range} (${z.AS10.hr})` },
        { key: "S6.3", week: "S6", category: "long", name: "Sortie Longue EF", structure: "70 min EF", duration: "70 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S7.1", week: "S7", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S7.2", week: "S7", category: "quality", name: "Spécifique AS10 #3 (3×10')", structure: "15' EF + 3 × (10' AS10 / 3' EF) + 5' RAC", duration: "59 min", targetFn: (z) => `AS10 ${z.AS10.range} (${z.AS10.hr})` },
        { key: "S7.3", week: "S7", category: "long", name: "Sortie Longue + SV1", structure: "45' EF + 2 × (10' SV1 / 2'30 EF) + 5' RAC", duration: "75 min", targetFn: (z) => `EF ${z.EF.target} • SV1 ${z.SV1.range}` },

        { key: "S8.1", week: "S8", isRecoveryWeek: true, category: "ef", name: "EF Récupération (sem. allégée)", structure: "30 min EF souple", duration: "30 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S8.2", week: "S8", isRecoveryWeek: true, category: "quality", name: "EF + Lignes droites", structure: "20' EF + 5 × (20s VMA / 40s EF) + 5' RAC", duration: "30 min", targetFn: (z) => `VMA ${z.VMA.target}/km` },
        { key: "S8.3", week: "S8", isRecoveryWeek: true, category: "long", name: "Sortie Longue Récup", structure: "50 min EF", duration: "50 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S9.1", week: "S9", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S9.2", week: "S9", category: "quality", name: "Spécifique AS10 #4 (6×5')", structure: "15' EF + 6 × (5' AS10 / 2'30 EF) + 12' RAC", duration: "72 min", targetFn: (z) => `AS10 ${z.AS10.range} (${z.AS10.hr})` },
        { key: "S9.3", week: "S9", category: "long", name: "Sortie Longue EF", structure: "60 min EF", duration: "60 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S10.1", week: "S10", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S10.2", week: "S10", category: "quality", name: "Gros blocs AS10 #5 (2×15')", structure: "18' EF + 2 × (15' AS10 / 4' EF) + 14' RAC", duration: "70 min", targetFn: (z) => `AS10 ${z.AS10.range} (${z.AS10.hr})` },
        { key: "S10.3", week: "S10", category: "long", name: "Sortie Longue EF", structure: "60 min EF", duration: "60 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S11.1", week: "S11", category: "ef", name: "Footing EF (Affûtage)", structure: "40 min EF", duration: "40 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S11.2", week: "S11", category: "quality", name: "Rappel AS10 long (3×10')", structure: "15' EF + 3 × (10' AS10 / 3' EF) + 15' RAC", duration: "69 min", targetFn: (z) => `AS10 ${z.AS10.range} (${z.AS10.hr})` },
        { key: "S11.3", week: "S11", category: "long", name: "Sortie Longue Affûtage", structure: "45 min EF", duration: "45 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S12.1", week: "S12", category: "ef", name: "EF Légère (Sem. course)", structure: "30 min EF", duration: "30 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S12.2", week: "S12", category: "quality", name: "Rappel d'allure AS10", structure: "15' EF + 3 × (2' AS10 / 2' EF) + 5' RAC", duration: "32 min", targetFn: (z) => `AS10 ${z.AS10.target}/km` },
        { key: "S12.3", week: "S12", category: "race", name: "COURSE 10 km", structure: "15' échauff. + 10 km course", duration: "~55 min", targetFn: (z) => `Objectif ${z.race10k.time} (${z.race10k.pace}, ${z.AS10.hr})` },

        { key: "S13.1", week: "S13", isRecoveryWeek: true, category: "ef", name: "Récupération post-10 km #1", structure: "30 min Marche / Footing très doux", duration: "30 min", targetFn: (z) => `Z1 souple (< ${z.EF.hrHigh})` },
        { key: "S13.2", week: "S13", isRecoveryWeek: true, category: "ef", name: "Récupération post-10 km #2", structure: "30 min EF souple", duration: "30 min", targetFn: (z) => `EF ${z.EF.slow}/km (< ${z.EF.hrHigh})` }
      ]
    },
    {
      id: "plan_hm",
      shortTitle: "Programme D • Semi 21,1 km",
      title: "Programme D — Prépa Semi-Marathon 21,1 km (12 sem. + 2 sem. récup)",
      subtitle: "Idéal Été / Automne 2027 (Juil → Oct) • Reconstitué de vos 3 prépas Semi et des blocs exacts TCX d'Août–Sept 2026",
      periodSuggestion: "Juil – Oct 2027",
      weeksLabel: "12+2 sem. • 40 séances",
      accentBadge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      borderActive: "border-emerald-500 ring-1 ring-emerald-500/40",
      sessions: [
        { key: "S1.1", week: "S1", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.range} (${z.EF.hr})` },
        { key: "S1.2", week: "S1", category: "quality", name: "Intervalles Seuil 60 #1 (5×3')", structure: "15' EF + 5 × (3' Seuil60 / 1'30 EF) + 5' RAC", duration: "42 min 30", targetFn: (z) => `Seuil 60 ${z.SEUIL60.range} (${z.SEUIL60.hr})` },
        { key: "S1.3", week: "S1", category: "long", name: "Sortie Longue EF", structure: "60 min EF", duration: "60 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S2.1", week: "S2", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S2.2", week: "S2", category: "quality", name: "Intervalles Seuil 60 #2 (6×3')", structure: "15' EF + 6 × (3' Seuil60 / 1'30 EF) + 5' RAC", duration: "47 min", targetFn: (z) => `Seuil 60 ${z.SEUIL60.range} (${z.SEUIL60.hr})` },
        { key: "S2.3", week: "S2", category: "long", name: "Sortie Longue EF", structure: "70 min EF", duration: "70 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S3.1", week: "S3", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S3.2", week: "S3", category: "quality", name: "Intervalles Seuil 60 #3 (7×3')", structure: "15' EF + 7 × (3' Seuil60 / 1'30 EF) + 5' RAC", duration: "51 min 30", targetFn: (z) => `Seuil 60 ${z.SEUIL60.range} (${z.SEUIL60.hr})` },
        { key: "S3.3", week: "S3", category: "long", name: "Sortie Longue + Phase Active Z2", structure: "40' EF + 3 × (8' SV1 / 2' EF) + 10' RAC", duration: "80 min", targetFn: (z) => `EF ${z.EF.target} • SV1 ${z.SV1.range} (< ${z.SV1.hrHigh})` },

        { key: "S4.1", week: "S4", isRecoveryWeek: true, category: "ef", name: "EF Récupération (sem. allégée)", structure: "35 min EF souple", duration: "35 min", targetFn: (z) => `EF ${z.EF.slow}/km (< ${z.EF.hrHigh})` },
        { key: "S4.2", week: "S4", isRecoveryWeek: true, category: "quality", name: "EF + Cadence / Lignes droites", structure: "25' EF + 5 × (20s VMA / 40s EF) + 5' RAC", duration: "35 min", targetFn: (z) => `VMA ${z.VMA.target}/km (cadence 175–180 ppm)` },
        { key: "S4.3", week: "S4", isRecoveryWeek: true, category: "long", name: "Sortie Longue Récup", structure: "60 min EF continu", duration: "60 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S5.1", week: "S5", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S5.2", week: "S5", category: "quality", name: "Force & Allure Semi #1 (TCX 19/08)", structure: "15' EF + 2 × (30s VMA / 2'30 EF) + 3 × (6' AS21 / 2' EF) + 8' AS21 + 9' RAC", duration: "62 min", targetFn: (z) => `VMA ${z.VMA.range} • AS21 ${z.AS21.range}` },
        { key: "S5.3", week: "S5", category: "long", name: "Sortie Longue Active #1 (TCX 08/08)", structure: "40' EF + 10' SV1 + 3' EF + 2 × (5' SV1 + 5' AS21 + 3' EF) + 11' RAC", duration: "90 min", targetFn: (z) => `EF ${z.EF.target} • SV1 ${z.SV1.target} • AS21 ${z.AS21.range}` },

        { key: "S6.1", week: "S6", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S6.2", week: "S6", category: "quality", name: "Force & Allure Semi #2 (TCX 26/08)", structure: "15' EF + 3 × (30s VMA / 2'30 EF) + 4 × (8' AS21 / 2'30 EF) + 3' RAC", duration: "69 min", targetFn: (z) => `VMA ${z.VMA.range} • AS21 ${z.AS21.range}` },
        { key: "S6.3", week: "S6", category: "long", name: "Sortie Longue EF", structure: "85 – 90 min EF continu", duration: "85–90 min", targetFn: (z) => `EF ${z.EF.target}/km (< ${z.EF.hrHigh})` },

        { key: "S7.1", week: "S7", category: "ef", name: "Footing EF", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S7.2", week: "S7", category: "quality", name: "Force & Allure Semi #3 (TCX 02/09)", structure: "15' EF + 3 × (30s VMA / 2'30 EF) + 3 × (10' AS21 / 3' EF) + 4' RAC", duration: "67 min", targetFn: (z) => `VMA ${z.VMA.range} • AS21 ${z.AS21.range}` },
        { key: "S7.3", week: "S7", category: "long", name: "Sortie Longue Pic #1 (test gel)", structure: "60' EF + 30' SV1/Tempo (gel + eau à 55') + 10' RAC", duration: "100 min", targetFn: (z) => `EF ${z.EF.target} • SV1/Tempo ${z.TEMPO.target}–${z.SV1.target}/km` },

        { key: "S8.1", week: "S8", isRecoveryWeek: true, category: "ef", name: "EF Récupération (sem. allégée)", structure: "35 min EF souple", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S8.2", week: "S8", isRecoveryWeek: true, category: "quality", name: "Footing EF + Technique", structure: "40 min EF souple (travail foulée)", duration: "40 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S8.3", week: "S8", isRecoveryWeek: true, category: "long", name: "Sortie Longue Récup", structure: "65 min EF continu", duration: "65 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S9.1", week: "S9", category: "ef", name: "Footing EF", structure: "40 min EF", duration: "40 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S9.2", week: "S9", category: "quality", name: "Blocs AS21 longs #1 (4×10')", structure: "15' EF + 4 × (10' AS21 / 3' EF) + 5' RAC", duration: "72 min", targetFn: (z) => `AS21 ${z.AS21.range} (${z.AS21.hr})` },
        { key: "S9.3", week: "S9", category: "long", name: "Sortie Longue Active #2 (test gel)", structure: "45' EF + 2 × (15' Tempo/AS21 / 3' EF) + 9' RAC", duration: "90 min", targetFn: (z) => `EF ${z.EF.target} • Tempo/AS21 ${z.AS21.target}–${z.TEMPO.target}/km` },

        { key: "S10.1", week: "S10", category: "ef", name: "Footing EF", structure: "35 – 40 min EF", duration: "35–40 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S10.2", week: "S10", category: "quality", name: "Blocs AS21 longs #2 (3×15')", structure: "15' EF + 3 × (15' AS21 / 4' EF) + 8' RAC", duration: "80 min", targetFn: (z) => `AS21 ${z.AS21.range} (${z.AS21.hr})` },
        { key: "S10.3", week: "S10", category: "long", name: "Sortie Longue Pic #2 (test gel)", structure: "60' EF + 30' SV1/Tempo + 10' RAC", duration: "100 min", targetFn: (z) => `EF ${z.EF.target} • SV1/Tempo ${z.TEMPO.target}–${z.SV1.target}/km` },

        { key: "S11.1", week: "S11", category: "ef", name: "Footing EF (Début affûtage)", structure: "35 min EF", duration: "35 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S11.2", week: "S11", category: "quality", name: "Répétition générale AS21 (3×20')", structure: "15' EF + 3 × (20' AS21 / 3' EF) + 5' RAC", duration: "89 min", targetFn: (z) => `AS21 ${z.AS21.range} (~10 km à AS21)` },
        { key: "S11.3", week: "S11", category: "long", name: "Sortie Longue Affûtage", structure: "75 min EF continu", duration: "75 min", targetFn: (z) => `EF ${z.EF.target}/km` },

        { key: "S12.1", week: "S12", category: "ef", name: "EF Légère (Sem. course)", structure: "30 min EF", duration: "30 min", targetFn: (z) => `EF ${z.EF.target}/km` },
        { key: "S12.2", week: "S12", category: "quality", name: "Rappel AS21", structure: "15' EF + 3 × (3' AS21 / 2' EF) + 8' RAC", duration: "38 min", targetFn: (z) => `AS21 ${z.AS21.target}/km (facile, en contrôle)` },
        { key: "S12.3", week: "S12", category: "race", name: "COURSE SEMI-MARATHON (21,1 km)", structure: "21,1 km (ravitaillement 45' et 1h25)", duration: "~2h04", targetFn: (z) => `Objectif ${z.raceHm.time} (${z.raceHm.pace}, ${z.AS21.hr})` },

        { key: "S13.1", week: "S13", isRecoveryWeek: true, category: "ef", name: "Récupération post-Semi #1", structure: "30 min Marche active / Footing très doux", duration: "30 min", targetFn: (z) => `Z1 (< ${z.EF.hrHigh})` },
        { key: "S13.2", week: "S13", isRecoveryWeek: true, category: "ef", name: "Récupération post-Semi #2", structure: "30 min Marche active / Footing très doux", duration: "30 min", targetFn: (z) => `Z1 (< ${z.EF.hrHigh})` },

        { key: "S14.1", week: "S14", isRecoveryWeek: true, category: "ef", name: "Récupération post-Semi #3", structure: "30 min EF souple", duration: "30 min", targetFn: (z) => `EF souple ${z.EF.slow}/km` },
        { key: "S14.2", week: "S14", isRecoveryWeek: true, category: "long", name: "Récupération post-Semi #4", structure: "45 min EF souple", duration: "45 min", targetFn: (z) => `EF souple ${z.EF.target}/km` }
      ]
    }
  ];

  const CATEGORY_META = {
    ef:      { label: "EF / Récup",    badge: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
    quality: { label: "Qualité",       badge: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    long:    { label: "Sortie Longue", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    race:    { label: "Course",        badge: "bg-rose-500/15 text-rose-400 border-rose-500/30" }
  };

  function getActivePlan() {
    return PLANS.find((p) => p.id === selectedPlanId) || PLANS[0];
  }

  function isDone(planId, sessionKey) {
    return Boolean(completedMap[`${planId}:${sessionKey}`]);
  }

  function selectPlan(planId) {
    if (PLANS.some((p) => p.id === planId)) {
      selectedPlanId = planId;
      selectedCategoryFilter = "all";
      saveStorage();
      render(lastPhys);
    }
  }

  function selectCategoryFilter(cat) {
    selectedCategoryFilter = cat;
    render(lastPhys);
  }

  function toggleSessionDone(planId, sessionKey) {
    const k = `${planId}:${sessionKey}`;
    if (completedMap[k]) delete completedMap[k];
    else completedMap[k] = true;
    saveStorage();
    render(lastPhys);
  }

  function resetCurrentPlanProgress() {
    const plan = getActivePlan();
    if (typeof confirm === "function") {
      if (!confirm(`Réinitialiser toutes les cases cochées du ${plan.shortTitle} ?`)) {
        return;
      }
    }
    plan.sessions.forEach((s) => {
      delete completedMap[`${plan.id}:${s.key}`];
    });
    saveStorage();
    render(lastPhys);
  }

  function exportCurrentPlanCSV() {
    const plan = getActivePlan();
    const zones = computeZones(lastPhys);
    const rows = [
      ["Semaine", "Séance", "Nom de la séance", "Type", "Structure détaillée", "Durée", "Allures & FC visées", "Statut"]
    ];

    plan.sessions.forEach((s) => {
      const catLabel = (CATEGORY_META[s.category] || CATEGORY_META.ef).label;
      const doneLabel = isDone(plan.id, s.key) ? "Effectuée" : "À faire";
      const targetStr = s.targetFn(zones);
      rows.push([
        s.week + (s.isRecoveryWeek ? " (Récup)" : ""),
        s.key,
        s.name,
        catLabel,
        s.structure,
        s.duration,
        targetStr,
        doneLabel
      ]);
    });

    const csvContent =
      "\uFEFF" +
      rows
        .map((cols) =>
          cols
            .map((c) => `"${String(c).replace(/"/g, '""')}"`)
            .join(";")
        )
        .join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `RunningNumbers_${plan.id}_VMA${zones.vma.toFixed(1)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function render(activePhys) {
    if (activePhys) {
      lastPhys = {
        vma: Number(activePhys.vma) || 12.7,
        fcMax: Number(activePhys.fcMax) || 179,
        fcRest: Number(activePhys.fcRest) || 52
      };
    }

    const zones = computeZones(lastPhys);
    const plan = getActivePlan();

    // 1. Rappel VMA / FC dans l'en-tête Plans 2027
    const vmaDisplay = document.getElementById("plans-vma-value");
    const fcDisplay = document.getElementById("plans-fc-summary");
    if (vmaDisplay) vmaDisplay.textContent = zones.vma.toFixed(1);
    if (fcDisplay) {
      fcDisplay.textContent = `FC Max ${zones.fcMax} • FC Repos ${zones.fcRest} bpm • Allure 100% VMA : ${zones.VMA.target}/km`;
    }

    // 2. Grille des 8 repères d'allures dynamiques
    const zonesStrip = document.getElementById("plans-zones-strip");
    if (zonesStrip) {
      const stripKeys = ["EF", "SV1", "TEMPO", "AS21", "SEUIL60", "AS10", "AS5", "VMA"];
      zonesStrip.innerHTML = stripKeys
        .map((k) => {
          const zk = zones[k];
          return `
            <div class="bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex flex-col justify-between space-y-1">
              <div class="flex items-center justify-between gap-1">
                <span class="text-xs font-bold px-1.5 py-0.5 rounded border ${zk.badge} truncate">${zk.label}</span>
              </div>
              <div class="text-sm font-extrabold text-white font-mono">${zk.target}<span class="text-xs font-normal text-slate-400">/km</span></div>
              <div class="text-xs text-slate-400">${zk.fast}–${zk.slow}</div>
              <div class="text-xs text-slate-500">${zk.hr}</div>
            </div>
          `;
        })
        .join("");
    }

    // 3. Sélecteur des 4 Programmes
    const selector = document.getElementById("plans-selector");
    if (selector) {
      selector.innerHTML = PLANS.map((p) => {
        const isActive = p.id === plan.id;
        const doneCount = p.sessions.filter((s) => isDone(p.id, s.key)).length;
        const totalCount = p.sessions.length;
        const cardStyle = isActive
          ? `bg-slate-900 border-2 ${p.borderActive} shadow-md`
          : "bg-slate-950/70 border border-slate-800 hover:border-slate-700 hover:bg-slate-900/70";

        return `
          <button onclick="window.TrainingPlans.selectPlan('${p.id}')" class="${cardStyle} rounded-xl p-3.5 text-left transition flex flex-col justify-between space-y-2 cursor-pointer">
            <div class="flex items-center justify-between gap-2 w-full">
              <span class="text-xs font-bold px-2 py-0.5 rounded-full border ${p.accentBadge}">${p.periodSuggestion}</span>
              <span class="text-xs font-mono text-slate-400">${doneCount}/${totalCount}</span>
            </div>
            <div>
              <div class="text-sm font-bold text-white">${p.shortTitle}</div>
              <div class="text-xs text-slate-400 mt-0.5">${p.weeksLabel}</div>
            </div>
          </button>
        `;
      }).join("");
    }

    // 4. En-tête & Progression du plan actif
    const activeTitle = document.getElementById("plans-active-title");
    const activeSubtitle = document.getElementById("plans-active-subtitle");
    const progText = document.getElementById("plans-progress-text");
    const progBar = document.getElementById("plans-progress-bar");

    const totalSessions = plan.sessions.length;
    const doneSessions = plan.sessions.filter((s) => isDone(plan.id, s.key)).length;
    const pct = totalSessions > 0 ? Math.round((doneSessions / totalSessions) * 100) : 0;

    if (activeTitle) activeTitle.textContent = plan.title;
    if (activeSubtitle) activeSubtitle.textContent = plan.subtitle;
    if (progText) progText.textContent = `${doneSessions} / ${totalSessions} séances (${pct}%)`;
    if (progBar) progBar.style.width = `${pct}%`;

    // 5. Filtres par catégorie
    const catContainer = document.getElementById("plans-category-filters");
    if (catContainer) {
      const filters = [
        { id: "all", label: `Toutes (${totalSessions})` },
        { id: "ef", label: "EF / Récup" },
        { id: "quality", label: "Qualité" },
        { id: "long", label: "Sortie Longue" },
        { id: "race", label: "Course" }
      ];
      catContainer.innerHTML = filters
        .map((f) => {
          const active = selectedCategoryFilter === f.id;
          const cls = active
            ? "px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 text-white shadow-sm transition cursor-pointer"
            : "px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-950 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer";
          return `<button onclick="window.TrainingPlans.selectCategoryFilter('${f.id}')" class="${cls}">${f.label}</button>`;
        })
        .join("");
    }

    const filteredSessions =
      selectedCategoryFilter === "all"
        ? plan.sessions
        : plan.sessions.filter((s) => s.category === selectedCategoryFilter);

    // 6. Vue Mobile (Cartes < md)
    const mobileList = document.getElementById("plans-mobile-list");
    if (mobileList) {
      if (filteredSessions.length === 0) {
        mobileList.innerHTML = `<div class="text-xs text-slate-400 text-center py-6 bg-slate-950 rounded-xl border border-slate-800">Aucune séance dans cette catégorie pour ce programme.</div>`;
      } else {
        mobileList.innerHTML = filteredSessions
          .map((s) => {
            const done = isDone(plan.id, s.key);
            const cat = CATEGORY_META[s.category] || CATEGORY_META.ef;
            const targetStr = s.targetFn(zones);
            const rowBg = s.isRecoveryWeek
              ? "bg-slate-900/60 border-slate-800"
              : "bg-slate-950 border-slate-800";

            return `
              <div class="${rowBg} border rounded-xl p-3.5 space-y-2 ${done ? "opacity-60" : ""}">
                <div class="flex items-center justify-between gap-2">
                  <label class="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" ${done ? "checked" : ""} onchange="window.TrainingPlans.toggleSessionDone('${plan.id}', '${s.key}')" class="w-4 h-4 rounded accent-emerald-500" />
                    <span class="font-mono text-xs font-bold text-white">${s.key}</span>
                    ${s.isRecoveryWeek ? '<span class="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">Récup</span>' : ""}
                  </label>
                  <div class="flex items-center gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full border font-medium ${cat.badge}">${cat.label}</span>
                    <span class="text-xs font-bold text-white">${s.duration}</span>
                  </div>
                </div>
                <div class="text-sm font-bold text-white ${done ? "line-through text-slate-400" : ""}">${s.name}</div>
                <div class="text-xs text-slate-300 font-mono leading-relaxed bg-slate-900/70 rounded-lg p-2 border border-slate-800/80">${s.structure}</div>
                <div class="text-xs font-semibold text-emerald-400 pt-1">${targetStr}</div>
              </div>
            `;
          })
          .join("");
      }
    }

    // 7. Vue Desktop (Tableau md+)
    const tbody = document.getElementById("plans-table-body");
    if (tbody) {
      if (filteredSessions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-6 px-4 text-center text-xs text-slate-400">Aucune séance dans cette catégorie pour ce programme.</td></tr>`;
      } else {
        tbody.innerHTML = filteredSessions
          .map((s) => {
            const done = isDone(plan.id, s.key);
            const cat = CATEGORY_META[s.category] || CATEGORY_META.ef;
            const targetStr = s.targetFn(zones);
            const recBg = s.isRecoveryWeek ? "bg-slate-900/40" : "";

            return `
              <tr class="border-b border-slate-800/70 hover:bg-slate-900/60 transition ${recBg} ${done ? "opacity-55" : ""}">
                <td class="py-3 px-4">
                  <input type="checkbox" ${done ? "checked" : ""} onchange="window.TrainingPlans.toggleSessionDone('${plan.id}', '${s.key}')" class="w-4 h-4 rounded accent-emerald-500 cursor-pointer" title="Marquer la séance comme effectuée" />
                </td>
                <td class="py-3 px-4 font-mono text-xs text-slate-300 whitespace-nowrap">
                  ${s.week}${s.isRecoveryWeek ? ' <span class="text-slate-500">(Récup)</span>' : ""}
                </td>
                <td class="py-3 px-4 font-mono text-xs font-bold text-white whitespace-nowrap">${s.key}</td>
                <td class="py-3 px-4">
                  <div class="font-semibold text-white text-xs sm:text-sm ${done ? "line-through text-slate-400" : ""}">${s.name}</div>
                  <span class="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cat.badge}">${cat.label}</span>
                </td>
                <td class="py-3 px-4 font-mono text-xs text-slate-200 max-w-md">${s.structure}</td>
                <td class="py-3 px-4 font-semibold text-white whitespace-nowrap text-xs">${s.duration}</td>
                <td class="py-3 px-4 font-semibold text-emerald-400 text-xs">${targetStr}</td>
              </tr>
            `;
          })
          .join("");
      }
    }
  }

  loadStorage();

  window.TrainingPlans = {
    PLANS,
    computeZones,
    getActivePlan,
    selectPlan,
    selectCategoryFilter,
    toggleSessionDone,
    resetCurrentPlanProgress,
    exportCurrentPlanCSV,
    render
  };
})();
