/**
 * Moteur d'analyse physiologique Polar & Calculateur des 6 allures et prédictions
 * EF -> SV1 -> Tempo modéré -> Seuil/T -> SV2 -> Intervalles/VMA
 */
(function () {
  "use strict";

  function speedToPaceSec(speedKmh) {
    if (!speedKmh || speedKmh <= 0) return 0;
    return 3600.0 / speedKmh;
  }

  function formatPace(secPerKm) {
    if (!secPerKm || !isFinite(secPerKm) || secPerKm <= 0) return "--:--";
    const total = Math.round(secPerKm);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  function formatDuration(totalSec) {
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
   * Détecte le type de séance et les blocs clés dans chaque fichier TCX/CSV
   */
  function classifySession(session) {
    const laps = session.laps || [];
    const distKm = session.totalDistanceM / 1000.0;

    // Recherche de répétitions courtes rapides (20s - 60s > 11.5 km/h)
    const shortFast = laps.filter(
      (l) => l.durationSec >= 20 && l.durationSec <= 65 && l.speedKmh >= 11.5
    );
    // Recherche de blocs de seuil/tempo structurés (3 min à 15 min >= 9.6 km/h)
    const thresholdBlocks = laps.filter(
      (l) => l.durationSec >= 170 && l.durationSec <= 950 && l.speedKmh >= 9.6
    );
    // Recherche de kilomètres en SV1 / Endurance active (9.0 à 9.6 km/h avec FC 144-156)
    const sv1Blocks = laps.filter(
      (l) => l.durationSec >= 300 && l.speedKmh >= 9.05 && l.avgHr >= 144 && l.avgHr <= 157
    );

    // Détection de dérive cardiaque / anomalie capteur (ex: FC moy > 162 pour allure < 9.5 km/h)
    const isHighDrift = session.avgHr >= 162 && session.avgSpeedKmh <= 9.6;

    let label = "Endurance Fondamentale (EF)";
    let badgeColor = "sky";

    if (thresholdBlocks.length >= 2) {
      const manualBlocks = thresholdBlocks.filter((l) => l.trigger === "Manual");
      if (manualBlocks.length >= 2) {
        const avgDurMin = Math.round(
          manualBlocks.reduce((a, b) => a + b.durationSec, 0) / manualBlocks.length / 60
        );
        const avgSpd =
          manualBlocks.reduce((a, b) => a + b.speedKmh, 0) / manualBlocks.length;
        label = `Seuil / Tempo (${manualBlocks.length} × ${avgDurMin} min @ ${formatPace(
          3600 / avgSpd
        )}/km)`;
        badgeColor = "amber";
      } else if (distKm >= 13.5) {
        label = `Sortie Longue (${distKm.toFixed(1)} km) + Blocs Tempo`;
        badgeColor = "lime";
      } else if (isHighDrift) {
        label = `Sortie Soutenue (Dérive FC élevée : ${session.avgHr} bpm)`;
        badgeColor = "rose";
      } else {
        label = `Tempo / Progressif (${distKm.toFixed(1)} km)`;
        badgeColor = "emerald";
      }
    } else if (sv1Blocks.length >= 4 || (session.avgSpeedKmh >= 9.0 && session.avgHr >= 145 && !isHighDrift)) {
      label = `Endurance Active / SV1 (${distKm.toFixed(1)} km @ ${formatPace(
        3600 / session.avgSpeedKmh
      )}/km)`;
      badgeColor = "emerald";
    } else if (sv1Blocks.length >= 2) {
      label = `EF + Blocs SV1 (${sv1Blocks.length} km soutenus)`;
      badgeColor = "emerald";
    } else if (distKm >= 12.5) {
      label = `Sortie Longue EF / SV1 (${distKm.toFixed(1)} km)`;
      badgeColor = "emerald";
    }

    if (shortFast.length >= 2) {
      const maxShortSpd = Math.max(...shortFast.map((l) => l.speedKmh));
      label += ` + ${shortFast.length}×30s (${formatPace(3600 / maxShortSpd)}/km)`;
    }

    return {
      label,
      badgeColor,
      isHighDrift,
      shortFastCount: shortFast.length,
      thresholdCount: thresholdBlocks.length
    };
  }

  /**
   * Calcule automatiquement FC Max, FC Repos et VMA à partir des séances actives
   */
  function autoDetectPhysiology(sessions) {
    if (!sessions || sessions.length === 0) {
      return { fcMax: 180, fcRest: 52, vma: 13.0 };
    }

    // 1. FC Max : On regarde les maxHr des séances hors dérive/artéfact, avec une marge physiologique
    const cleanSessions = sessions.filter((s) => !(s.avgHr >= 164 && s.avgSpeedKmh <= 9.5));
    const pool = cleanSessions.length > 0 ? cleanSessions : sessions;

    const maxHrs = pool.map((s) => s.maxHr).filter((h) => h > 130);
    const rawMaxHr = maxHrs.length > 0 ? Math.max(...maxHrs) : 175;
    // Sur des séances de seuil (sans test FCmax pur), le pic atteint (~168 bpm) représente ~93-94% FCmax
    // Si la séance du 15/09 (191 bpm) est présente, on plafonne ou ajuste intelligemment autour de 178-182 bpm
    let detectedFcMax = 178;
    if (rawMaxHr >= 185) {
      detectedFcMax = 185;
    } else if (rawMaxHr >= 165) {
      detectedFcMax = Math.round(rawMaxHr / 0.94); // ex: 168 / 0.94 = 179 bpm
    } else {
      detectedFcMax = Math.max(172, rawMaxHr + 12);
    }

    const detectedFcRest = 52;

    // 2. Détection de la VMA pondérée par la forme récente :
    const shortSpeeds = [];
    const thresholdSpeeds = [];
    const efSpeeds = [];
    const sv1Speeds = [];

    pool.forEach((s) => {
      (s.laps || []).forEach((l) => {
        if (l.durationSec >= 22 && l.durationSec <= 45 && l.speedKmh >= 12.0) {
          shortSpeeds.push(l.speedKmh);
        } else if (l.durationSec >= 240 && l.speedKmh >= 9.9 && l.avgHr >= 150 && l.avgHr <= 165) {
          thresholdSpeeds.push(l.speedKmh);
        } else if (l.durationSec >= 300 && l.avgHr >= 145 && l.avgHr <= 154 && l.speedKmh >= 8.9) {
          sv1Speeds.push(l.speedKmh);
        } else if (l.durationSec >= 300 && l.avgHr >= 132 && l.avgHr <= 143 && l.speedKmh >= 8.0) {
          efSpeeds.push(l.speedKmh);
        }
      });
    });

    const estimates = [];
    if (shortSpeeds.length > 0) {
      shortSpeeds.sort((a, b) => b - a);
      const topShort = shortSpeeds.slice(0, Math.min(4, shortSpeeds.length));
      const avgShort = topShort.reduce((a, b) => a + b, 0) / topShort.length;
      estimates.push(avgShort / 1.035);
    }
    if (thresholdSpeeds.length > 0) {
      thresholdSpeeds.sort((a, b) => b - a);
      const topThresh = thresholdSpeeds.slice(0, Math.min(5, thresholdSpeeds.length));
      const avgThresh = topThresh.reduce((a, b) => a + b, 0) / topThresh.length;
      estimates.push(avgThresh / 0.815);
    }
    if (sv1Speeds.length > 0) {
      const avgSv1 = sv1Speeds.reduce((a, b) => a + b, 0) / sv1Speeds.length;
      estimates.push(avgSv1 / 0.73);
    }
    if (efSpeeds.length > 0) {
      const avgEf = efSpeeds.reduce((a, b) => a + b, 0) / efSpeeds.length;
      estimates.push(avgEf / 0.68);
    }

    // Évaluation spécifique sur les 6 dernières séances pour refléter l'état de forme actuel
    const recentPool = pool.slice(-6);
    const recentVmaEstimates = [];
    const hrr = Math.max(40, detectedFcMax - detectedFcRest);
    recentPool.forEach((s) => {
      if (s.avgHr >= 130 && s.avgSpeedKmh >= 8.0) {
        const pctHrr = Math.max(0.5, Math.min(0.95, (s.avgHr - detectedFcRest) / hrr));
        // À %HRR donné, le %VMA correspondant est voisin de pctHrr * 0.99
        recentVmaEstimates.push(s.avgSpeedKmh / (pctHrr * 0.99));
      }
    });

    let histVma = estimates.length > 0 ? estimates.reduce((a, b) => a + b, 0) / estimates.length : 12.8;
    let recentVma =
      recentVmaEstimates.length > 0
        ? recentVmaEstimates.reduce((a, b) => a + b, 0) / recentVmaEstimates.length
        : histVma;

    // Pondération 55% forme récente / 45% potentiel pic
    let detectedVma = histVma * 0.45 + recentVma * 0.55;
    detectedVma = Math.round(detectedVma * 10) / 10;

    return {
      fcMax: detectedFcMax,
      fcRest: detectedFcRest,
      vma: detectedVma
    };
  }

  /**
   * Calcule l'efficacité aérobie d'une séance pour évaluer la tendance (Phase Ascendante vs Descendante)
   * Retourne l'allure ajustée à une FC de référence (ex: 140 bpm pour EF, 157 bpm pour Seuil)
   */
  function computeSessionEfficiency(session, fcMax, fcRest) {
    // On évalue le rendement aérobie sur la fenêtre stable (4 min à 55 min) hors dérive de sortie longue
    const rawSegs = (session.segments || []).filter(
      (sg) => sg.t >= 240 && sg.t <= 3300 && sg.hr >= 120 && sg.spd >= 7.5 && sg.spd <= 16.5
    );
    if (rawSegs.length < 5) return null;

    // Filtrage des phases de récupération post-fractionné
    const segs = rawSegs.filter((sg, idx) => {
      if (sg.spd < 8.65 && sg.hr > 143) return false;
      if (idx > 0 && rawSegs[idx - 1].spd - sg.spd > 1.0) return false;
      return true;
    });
    const activePool = segs.length >= 5 ? segs : rawSegs;

    const hrr = Math.max(40, fcMax - fcRest);
    let sumEff = 0;
    let count = 0;

    const efSegs = [];
    const tempoSegs = [];
    const seuilSegs = [];

    activePool.forEach((sg) => {
      const pctHrr = Math.max(0.35, Math.min(1.0, (sg.hr - fcRest) / hrr));
      const normSpdAt70 = sg.spd * Math.pow(0.70 / pctHrr, 0.85);
      sumEff += normSpdAt70;
      count++;

      if (sg.hr >= 128 && sg.hr <= 142 && sg.t <= 2400) efSegs.push(sg);
      if (sg.hr >= 143 && sg.hr <= 153) tempoSegs.push(sg);
      if (sg.hr >= 154 && sg.hr <= 165 && sg.spd >= 9.6) seuilSegs.push(sg);
    });

    const normEfSpeed = count > 0 ? sumEff / count : session.avgSpeedKmh;

    // Allure EF normalisée à 138 bpm
    let efPaceSec = speedToPaceSec(normEfSpeed * 0.96);
    if (efSegs.length >= 5) {
      const avgSpd = efSegs.reduce((a, b) => a + b.spd, 0) / efSegs.length;
      const avgHr = efSegs.reduce((a, b) => a + b.hr, 0) / efSegs.length;
      const adjSpd = avgSpd * (1 + (138 - avgHr) * 0.0085);
      efPaceSec = speedToPaceSec(adjSpd);
    }

    // Blocs de seuil explicites (laps >= 4 min à allure >= 9.8 km/h)
    const threshLaps = (session.laps || []).filter(
      (l) => l.durationSec >= 240 && l.speedKmh >= 9.8 && l.avgHr >= 150 && l.avgHr <= 166
    );

    let seuilPaceSec = efPaceSec * 0.835;
    if (threshLaps.length >= 1) {
      const avgLapSpd =
        threshLaps.reduce((a, b) => a + b.speedKmh, 0) / threshLaps.length;
      seuilPaceSec = speedToPaceSec(avgLapSpd);
    } else if (seuilSegs.length >= 4) {
      const avgSpd = seuilSegs.reduce((a, b) => a + b.spd, 0) / seuilSegs.length;
      seuilPaceSec = speedToPaceSec(avgSpd);
    }

    let tempoPaceSec = Math.round((efPaceSec + seuilPaceSec) / 2);
    if (tempoSegs.length >= 4) {
      const avgSpd = tempoSegs.reduce((a, b) => a + b.spd, 0) / tempoSegs.length;
      const avgHr = tempoSegs.reduce((a, b) => a + b.hr, 0) / tempoSegs.length;
      const adjSpd = avgSpd * (1 + (150 - avgHr) * 0.008);
      tempoPaceSec = speedToPaceSec(adjSpd);
    }

    const vmaPaceSec = seuilPaceSec * 0.815;

    return {
      date: session.date,
      fileName: session.fileName,
      normEfSpeed: Math.round(normEfSpeed * 100) / 100,
      efPaceSec: Math.round(efPaceSec),
      tempoPaceSec: Math.round(tempoPaceSec),
      seuilPaceSec: Math.round(seuilPaceSec),
      hasThreshBlocks: threshLaps.length >= 1,
      vmaPaceSec: Math.round(vmaPaceSec),
      avgHr: session.avgHr,
      avgSpeedKmh: session.avgSpeedKmh
    };
  }

  /**
   * Analyse complète d'un jeu de séances avec les paramètres (FC Max, FC Repos, VMA)
   */
  function analyze(sessions, userParams) {
    const sorted = [...(sessions || [])].sort((a, b) =>
      a.startTime.localeCompare(b.startTime)
    );

    const autoPhys = autoDetectPhysiology(sorted);
    const fcMax = userParams && userParams.fcMax ? Number(userParams.fcMax) : autoPhys.fcMax;
    const fcRest = userParams && userParams.fcRest ? Number(userParams.fcRest) : autoPhys.fcRest;
    const vma = userParams && userParams.vma ? Number(userParams.vma) : autoPhys.vma;
    const hrr = Math.max(40, fcMax - fcRest);

    // Calcul de l'évolution séance par séance
    const timeline = [];
    sorted.forEach((s) => {
      const eff = computeSessionEfficiency(s, fcMax, fcRest);
      const meta = classifySession(s);
      if (eff) {
        timeline.push({
          ...eff,
          id: s.id,
          distKm: Math.round((s.totalDistanceM / 100) ) / 10,
          durationMin: Math.round(s.totalTimeSec / 60),
          label: meta.label,
          badgeColor: meta.badgeColor,
          isHighDrift: meta.isHighDrift
        });
      }
    });

    // Détection d'une éventuelle coupure (> 20 jours sans séance) pour analyser le cycle actuel
    let breakIdx = -1;
    for (let i = 1; i < timeline.length; i++) {
      const d1 = Date.parse(timeline[i - 1].date);
      const d2 = Date.parse(timeline[i].date);
      if ((d2 - d1) / (1000 * 3600 * 24) >= 20) {
        breakIdx = i;
      }
    }

    let trendPct = 0;
    let deltaEfSec = 0;
    let deltaSeuilSec = 0;
    let cycleInfo = null;

    if (timeline.length >= 2) {
      // Si une coupure est détectée et qu'il y a au moins 4 séances de reprise,
      // on évalue la dynamique sur le bloc de reprise actuel tout en gardant la référence pré-coupure
      const evalSlice =
        breakIdx !== -1 && timeline.length - breakIdx >= 4
          ? timeline.slice(breakIdx)
          : timeline;

      const half = Math.max(1, Math.floor(evalSlice.length / 2));
      const firstHalf = evalSlice.slice(0, half);
      const secondHalf = evalSlice.slice(evalSlice.length - half);

      const eff1 = firstHalf.reduce((a, b) => a + b.normEfSpeed, 0) / firstHalf.length;
      const eff2 = secondHalf.reduce((a, b) => a + b.normEfSpeed, 0) / secondHalf.length;

      const ef1 = firstHalf.reduce((a, b) => a + b.efPaceSec, 0) / firstHalf.length;
      const ef2 = secondHalf.reduce((a, b) => a + b.efPaceSec, 0) / secondHalf.length;
      deltaEfSec = Math.round(ef2 - ef1);

      const s1 = firstHalf.reduce((a, b) => a + b.seuilPaceSec, 0) / firstHalf.length;
      const s2 = secondHalf.reduce((a, b) => a + b.seuilPaceSec, 0) / secondHalf.length;
      deltaSeuilSec = Math.round(s2 - s1);
      trendPct = ((eff2 - eff1) / eff1) * 100;

      if (breakIdx !== -1 && timeline.length - breakIdx >= 4) {
        const preBreak = timeline.slice(0, breakIdx).filter((t) => !t.isHighDrift);
        const postBreak = timeline.slice(breakIdx);
        const preEff =
          preBreak.reduce((a, b) => a + b.normEfSpeed, 0) / Math.max(1, preBreak.length);
        const postEff =
          postBreak.reduce((a, b) => a + b.normEfSpeed, 0) / postBreak.length;
        cycleInfo = {
          hasBreak: true,
          breakStart: timeline[breakIdx - 1].date,
          breakEnd: timeline[breakIdx].date,
          reboundCount: postBreak.length,
          vsPeakPct: Math.round(((postEff - preEff) / preEff) * 1000) / 10
        };
      }
    }

    const isAscending = trendPct >= -0.25; // Phase ascendante ou stable+

    // Calcul des 6 zones d'allures : EF -> SV1 -> Tempo modéré -> Seuil/T -> SV2 -> Intervalles/VMA
    // Définition des pourcentages VMA et Karvonen (%FC Réserve) calibrés sur les sorties Polar
    const zoneDefs = [
      {
        code: "EF",
        name: "Endurance Fondamentale",
        desc: "Base aérobie, footings de récupération et échauffement",
        vmaMinPct: 0.64,
        vmaTargetPct: 0.675,
        vmaMaxPct: 0.71,
        hrrMinPct: 0.60,
        hrrMaxPct: 0.70,
        color: "sky",
        border: "border-sky-500/40",
        bgBadge: "bg-sky-500/15 text-sky-400",
        barColor: "bg-sky-500",
        deltaFactor: 1.0
      },
      {
        code: "SV1",
        name: "Seuil Aérobie (SV1)",
        desc: "Endurance active, sorties longues soutenues (1er seuil ventilatoire)",
        vmaMinPct: 0.71,
        vmaTargetPct: 0.74,
        vmaMaxPct: 0.765,
        hrrMinPct: 0.70,
        hrrMaxPct: 0.76,
        color: "emerald",
        border: "border-emerald-500/40",
        bgBadge: "bg-emerald-500/15 text-emerald-400",
        barColor: "bg-emerald-500",
        deltaFactor: 0.9
      },
      {
        code: "Tempo modéré",
        name: "Allure Marathon / Tempo",
        desc: "Rendement aérobie élevé, allure spécifique marathon",
        vmaMinPct: 0.765,
        vmaTargetPct: 0.79,
        vmaMaxPct: 0.815,
        hrrMinPct: 0.76,
        hrrMaxPct: 0.81,
        color: "lime",
        border: "border-lime-500/40",
        bgBadge: "bg-lime-500/15 text-lime-400",
        barColor: "bg-lime-500",
        deltaFactor: 0.85
      },
      {
        code: "Seuil / T",
        name: "Allure Seuil / T-Pace",
        desc: "Blocs de 6 à 12 min (ex. 4×8' ou 2×10'), allure Semi-Marathon",
        vmaMinPct: 0.815,
        vmaTargetPct: 0.84,
        vmaMaxPct: 0.865,
        hrrMinPct: 0.81,
        hrrMaxPct: 0.86,
        color: "amber",
        border: "border-amber-500/40",
        bgBadge: "bg-amber-500/15 text-amber-400",
        barColor: "bg-amber-500",
        deltaFactor: 0.8
      },
      {
        code: "SV2",
        name: "Seuil Anaérobie (SV2)",
        desc: "2e seuil ventilatoire, allure spécifique 10 km / intervalles longs",
        vmaMinPct: 0.865,
        vmaTargetPct: 0.89,
        vmaMaxPct: 0.92,
        hrrMinPct: 0.86,
        hrrMaxPct: 0.91,
        color: "orange",
        border: "border-orange-500/40",
        bgBadge: "bg-orange-500/15 text-orange-400",
        barColor: "bg-orange-500",
        deltaFactor: 0.7
      },
      {
        code: "Intervalles / VMA",
        name: "Puissance VMA (95–105%)",
        desc: "Répétitions courtes (30s/30s, 200m–400m) et VMA moyenne",
        vmaMinPct: 0.95,
        vmaTargetPct: 1.00,
        vmaMaxPct: 1.05,
        hrrMinPct: 0.91,
        hrrMaxPct: 1.00,
        color: "rose",
        border: "border-rose-500/40",
        bgBadge: "bg-rose-500/15 text-rose-400",
        barColor: "bg-rose-500",
        deltaFactor: 0.55
      }
    ];

    // Calcul du temps passé dans chaque zone sur l'ensemble des segments Polar
    const zoneDurations = [0, 0, 0, 0, 0, 0];
    let totalSegDuration = 0;

    sorted.forEach((s) => {
      (s.segments || []).forEach((sg) => {
        const dur = sg.dur || 10;
        totalSegDuration += dur;
        const pctVma = sg.spd / vma;
        if (pctVma < 0.71) zoneDurations[0] += dur;
        else if (pctVma < 0.765) zoneDurations[1] += dur;
        else if (pctVma < 0.815) zoneDurations[2] += dur;
        else if (pctVma < 0.865) zoneDurations[3] += dur;
        else if (pctVma < 0.93) zoneDurations[4] += dur;
        else zoneDurations[5] += dur;
      });
    });

    const baseDeltaSec = deltaSeuilSec !== 0 ? deltaSeuilSec : deltaEfSec;

    const paces = zoneDefs.map((zd, idx) => {
      const targetSpd = vma * zd.vmaTargetPct;
      const minSpd = vma * zd.vmaMinPct;
      const maxSpd = vma * zd.vmaMaxPct;

      const targetPaceSec = speedToPaceSec(targetSpd);
      const slowPaceSec = speedToPaceSec(minSpd);
      const fastPaceSec = speedToPaceSec(maxSpd);

      const hrLow = Math.round(fcRest + hrr * zd.hrrMinPct);
      const hrHigh = Math.round(fcRest + hrr * zd.hrrMaxPct);
      const fcMaxMinPct = Math.round((hrLow / fcMax) * 100);
      const fcMaxMaxPct = Math.round((hrHigh / fcMax) * 100);

      const lap400Sec = Math.round(targetPaceSec * 0.4);
      const lap400M = Math.floor(lap400Sec / 60);
      const lap400S = lap400Sec % 60;
      const lap400Str = `${lap400M}:${lap400S < 10 ? "0" : ""}${lap400S} /400m`;

      const zDelta = Math.round(baseDeltaSec * zd.deltaFactor);
      let trendStr = "→ Stable";
      let trendType = "stable";
      if (zDelta <= -2) {
        trendStr = `↗ ${zDelta}s/km`;
        trendType = "up";
      } else if (zDelta >= 2) {
        trendStr = `↘ +${zDelta}s/km`;
        trendType = "down";
      }

      const distPct =
        totalSegDuration > 0
          ? Math.max(1, Math.round((zoneDurations[idx] / totalSegDuration) * 100))
          : [55, 18, 12, 9, 4, 2][idx];

      return {
        index: idx + 1,
        code: zd.code,
        name: zd.name,
        desc: zd.desc,
        targetPace: formatPace(targetPaceSec),
        targetPaceSec: Math.round(targetPaceSec),
        rangePace: `${formatPace(fastPaceSec)} – ${formatPace(slowPaceSec)}`,
        speedKmh: `${targetSpd.toFixed(1)} km/h`,
        vmaPctRange: `${Math.round(zd.vmaMinPct * 100)}–${Math.round(zd.vmaMaxPct * 100)}% VMA`,
        hrRange: `${hrLow} – ${hrHigh} bpm`,
        hrPctRange: `${fcMaxMinPct}–${fcMaxMaxPct}% FCmax`,
        lap400: lap400Str,
        trend: trendStr,
        trendType: trendType,
        color: zd.color,
        border: zd.border,
        bgBadge: zd.bgBadge,
        barColor: zd.barColor,
        distPct: distPct
      };
    });

    // 4 Prédictions de course : 5 km, 10 km, Semi-Marathon (21.0975 km), Marathon (42.195 km)
    // Basées sur le pourcentage soutenable de VMA + modèle d'endurance Riegel calibré
    const raceConfigs = [
      {
        distanceName: "5 km",
        distKm: 5.0,
        vmaPct: 0.905, // ~90.5% VMA
        zoneRef: "SV2+ (90% VMA)",
        hrrMin: 0.88,
        hrrMax: 0.93,
        splitsFn: (paceSec) =>
          `Passage 1 km : ${formatPace(paceSec)} • 3 km : ${formatDuration(paceSec * 3)}`
      },
      {
        distanceName: "10 km",
        distKm: 10.0,
        vmaPct: 0.855, // ~85.5% VMA (entre Seuil/T et SV2)
        zoneRef: "SV2 / Seuil+ (86% VMA)",
        hrrMin: 0.84,
        hrrMax: 0.89,
        splitsFn: (paceSec) =>
          `Passage 5 km : ${formatDuration(paceSec * 5)} • 8 km : ${formatDuration(paceSec * 8)}`
      },
      {
        distanceName: "Semi-Marathon",
        distKm: 21.0975,
        vmaPct: 0.805, // ~80.5% VMA (Tempo haut / Seuil-T)
        zoneRef: "Tempo / Seuil (81% VMA)",
        hrrMin: 0.79,
        hrrMax: 0.84,
        splitsFn: (paceSec) =>
          `Passage 10 km : ${formatDuration(paceSec * 10)} • 15 km : ${formatDuration(paceSec * 15)}`
      },
      {
        distanceName: "Marathon",
        distKm: 42.195,
        vmaPct: 0.75, // ~75% VMA (SV1+ / Tempo modéré)
        zoneRef: "SV1 / Tempo (75% VMA)",
        hrrMin: 0.73,
        hrrMax: 0.79,
        splitsFn: (paceSec) =>
          `Passage Semi : ${formatDuration(paceSec * 21.0975)} • 30 km : ${formatDuration(
            paceSec * 30
          )}`
      }
    ];

    const predictions = raceConfigs.map((rc) => {
      const targetSpd = vma * rc.vmaPct;
      const paceSec = speedToPaceSec(targetSpd);
      const totalSec = paceSec * rc.distKm;

      const hrLow = Math.round(fcRest + hrr * rc.hrrMin);
      const hrHigh = Math.round(fcRest + hrr * rc.hrrMax);

      const totalDeltaSec = Math.round(baseDeltaSec * 0.8 * rc.distKm);
      let deltaLabel = "→ Chrono stable";
      let deltaClass = "text-sky-400";

      if (totalDeltaSec <= -5) {
        const absD = Math.abs(totalDeltaSec);
        const dStr = absD >= 60 ? `${Math.floor(absD / 60)} min ${absD % 60}s` : `${absD} sec`;
        deltaLabel = `↗ Gain estimé : -${dStr}`;
        deltaClass = "text-emerald-400";
      } else if (totalDeltaSec >= 5) {
        const absD = Math.abs(totalDeltaSec);
        const dStr = absD >= 60 ? `${Math.floor(absD / 60)} min ${absD % 60}s` : `${absD} sec`;
        deltaLabel = `↘ Recul estimé : +${dStr}`;
        deltaClass = "text-amber-400";
      }

      return {
        distance: rc.distanceName,
        time: formatDuration(totalSec),
        pace: `${formatPace(paceSec)} /km`,
        speed: `${targetSpd.toFixed(2)} km/h`,
        zoneRef: rc.zoneRef,
        hrTarget: `${hrLow} – ${hrHigh} bpm`,
        delta: deltaLabel,
        deltaClass: deltaClass,
        splits: rc.splitsFn(paceSec)
      };
    });

    const totalDistKm =
      sorted.reduce((acc, s) => acc + s.totalDistanceM, 0) / 1000.0;
    const totalHours =
      sorted.reduce((acc, s) => acc + s.totalTimeSec, 0) / 3600.0;

    return {
      autoPhys,
      activePhys: { fcMax, fcRest, vma },
      sessionCount: sorted.length,
      totalDistKm: totalDistKm.toFixed(1),
      totalHours: totalHours.toFixed(1),
      isAscending,
      trendPct: Math.round(trendPct * 10) / 10,
      deltaEfSec,
      deltaSeuilSec,
      cycleInfo,
      paces,
      predictions,
      timeline
    };
  }

  window.PaceEngine = {
    analyze,
    autoDetectPhysiology,
    classifySession,
    formatPace,
    formatDuration
  };
})();
