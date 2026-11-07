/**
 * Analyseur côté client pour les exports Polar Flow (.TCX et .CSV)
 */
(function () {
  "use strict";

  function median(values) {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Parse un fichier XML TCX Polar Flow
   */
  function parseTCX(xmlString, fileName) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");

    const idNode = doc.getElementsByTagName("Id")[0];
    const startTime = idNode ? idNode.textContent.trim() : new Date().toISOString();
    const dateStr = startTime.slice(0, 10);

    const lapNodes = Array.from(doc.getElementsByTagName("Lap"));
    let totalTimeSec = 0;
    let totalDistanceM = 0;
    let calories = 0;
    const laps = [];

    lapNodes.forEach((lap, idx) => {
      const tNode = lap.getElementsByTagName("TotalTimeSeconds")[0];
      const dNode = lap.getElementsByTagName("DistanceMeters")[0];
      const calNode = lap.getElementsByTagName("Calories")[0];
      const maxSpdNode = lap.getElementsByTagName("MaximumSpeed")[0];
      const cadNode = lap.getElementsByTagName("Cadence")[0];
      const trigNode = lap.getElementsByTagName("TriggerMethod")[0];

      let avgHr = 0;
      const avgHrParent = lap.getElementsByTagName("AverageHeartRateBpm")[0];
      if (avgHrParent) {
        const val = avgHrParent.getElementsByTagName("Value")[0];
        if (val) avgHr = parseInt(val.textContent, 10) || 0;
      }

      let maxHr = 0;
      const maxHrParent = lap.getElementsByTagName("MaximumHeartRateBpm")[0];
      if (maxHrParent) {
        const val = maxHrParent.getElementsByTagName("Value")[0];
        if (val) maxHr = parseInt(val.textContent, 10) || 0;
      }

      const t = tNode ? parseFloat(tNode.textContent) || 0 : 0;
      const d = dNode ? parseFloat(dNode.textContent) || 0 : 0;
      const cal = calNode ? parseInt(calNode.textContent, 10) || 0 : 0;
      const ms = maxSpdNode ? (parseFloat(maxSpdNode.textContent) || 0) * 3.6 : 0;
      const cad = cadNode ? parseInt(cadNode.textContent, 10) || 0 : 0;
      const trig = trigNode ? trigNode.textContent.trim() : "Manual";

      totalTimeSec += t;
      totalDistanceM += d;
      calories += cal;

      if (t >= 15 && d >= 30) {
        const spd = (d / 1000.0) / (t / 3600.0);
        laps.push({
          index: idx + 1,
          durationSec: Math.round(t * 10) / 10,
          distanceM: Math.round(d * 10) / 10,
          speedKmh: Math.round(spd * 100) / 100,
          avgHr: avgHr,
          maxHr: maxHr,
          maxSpeedKmh: Math.round(ms * 100) / 100,
          cadence: cad,
          trigger: trig
        });
      }
    });

    const tpNodes = Array.from(doc.getElementsByTagName("Trackpoint"));
    const pts = [];
    const hrAll = [];
    const wattsList = [];
    const cadList = [];

    for (let i = 0; i < tpNodes.length; i++) {
      const tp = tpNodes[i];
      const tNode = tp.getElementsByTagName("Time")[0];
      const dNode = tp.getElementsByTagName("DistanceMeters")[0];
      if (!tNode || !dNode) continue;

      const ts = Date.parse(tNode.textContent.trim()) / 1000;
      const dist = parseFloat(dNode.textContent) || 0;

      let hr = null;
      const hrParent = tp.getElementsByTagName("HeartRateBpm")[0];
      if (hrParent) {
        const v = hrParent.getElementsByTagName("Value")[0];
        if (v) hr = parseInt(v.textContent, 10);
      }

      let watts = null;
      const wNode = tp.getElementsByTagName("Watts")[0];
      if (wNode) watts = parseInt(wNode.textContent, 10);

      let cad = null;
      const cNode = tp.getElementsByTagName("Cadence")[0];
      if (cNode) cad = parseInt(cNode.textContent, 10);

      pts.push({ ts, dist, hr, watts });
      if (hr && hr > 60) hrAll.push(hr);
      if (watts && watts > 50) wattsList.push(watts);
      if (cad && cad > 50) cadList.push(cad);
    }

    const segments = [];
    if (pts.length > 25) {
      const tStart = pts[0].ts;
      for (let i = 20; i < pts.length; i += 10) {
        const dtSec = pts[i].ts - pts[i - 20].ts;
        const ddM = pts[i].dist - pts[i - 20].dist;
        if (dtSec >= 14 && dtSec <= 26 && ddM > 15) {
          const spdKmh = (ddM / dtSec) * 3.6;
          if (spdKmh >= 5.5 && spdKmh <= 21.0) {
            const hrsW = [];
            const wtsW = [];
            for (let j = i - 15; j <= i; j++) {
              if (pts[j].hr && pts[j].hr > 80) hrsW.push(pts[j].hr);
              if (pts[j].watts && pts[j].watts > 50) wtsW.push(pts[j].watts);
            }
            segments.push({
              t: Math.round(pts[i].ts - tStart),
              spd: Math.round(spdKmh * 100) / 100,
              hr: Math.round(median(hrsW)),
              w: Math.round(median(wtsW)),
              dur: Math.round((dtSec / 2) * 10) / 10
            });
          }
        }
      }
    }

    const avgSpeedKmh = totalTimeSec > 0 ? (totalDistanceM / 1000) / (totalTimeSec / 3600) : 0;
    const avgHr = hrAll.length > 0 ? Math.round(hrAll.reduce((a, b) => a + b, 0) / hrAll.length) : 0;
    const maxHr = hrAll.length > 0 ? Math.max(...hrAll) : 0;
    const avgWatts = wattsList.length > 0 ? Math.round(wattsList.reduce((a, b) => a + b, 0) / wattsList.length) : 0;
    const avgCadence = cadList.length > 0 ? Math.round(cadList.reduce((a, b) => a + b, 0) / cadList.length) : 0;

    return {
      id: fileName || `TCX_${startTime}`,
      fileName: fileName || `Polar_${dateStr}.tcx`,
      startTime: startTime,
      date: dateStr,
      totalTimeSec: Math.round(totalTimeSec * 10) / 10,
      totalDistanceM: Math.round(totalDistanceM * 10) / 10,
      avgSpeedKmh: Math.round(avgSpeedKmh * 100) / 100,
      avgHr: avgHr,
      maxHr: maxHr,
      avgWatts: avgWatts,
      avgCadence: avgCadence,
      calories: calories,
      laps: laps,
      segments: segments
    };
  }

  /**
   * Parse un fichier CSV Polar Flow
   * Format standard Polar Flow CSV :
   * Ligne 1 : En-tête de métadonnées (Date, Start time, Duration, Total distance, Average heart rate, ...)
   * Ligne 2 : Valeurs des métadonnées
   * Ligne 3 : En-tête des échantillons (Sample rate, Time, HR (bpm), Speed (km/h), Pace (min/km), Cadence, Altitude, Distances (m), Power (W)...)
   * Lignes 4+ : Échantillons seconde par seconde
   */
  function parsePolarCSV(csvString, fileName) {
    const lines = csvString.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 4) {
      throw new Error("Fichier CSV Polar invalide ou vide.");
    }

    const sep = lines[0].includes(";") ? ";" : ",";
    const metaHeaders = lines[0].split(sep).map((s) => s.trim().toLowerCase());
    const metaValues = lines[1].split(sep).map((s) => s.trim());

    let dateStr = new Date().toISOString().slice(0, 10);
    const dateIdx = metaHeaders.findIndex((h) => h.includes("date"));
    if (dateIdx !== -1 && metaValues[dateIdx]) {
      const rawDate = metaValues[dateIdx];
      // Format Polar souvent DD-MM-YYYY ou YYYY-MM-DD
      if (/^\d{2}[-/.]\d{2}[-/.]\d{4}$/.test(rawDate)) {
        const parts = rawDate.split(/[-/.]/);
        dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
      } else if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
        dateStr = rawDate.slice(0, 10);
      }
    }

    // Recherche de la ligne d'en-tête des échantillons (contenant HR et Speed/Pace)
    let sampleHeaderIdx = 2;
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const low = lines[i].toLowerCase();
      if (low.includes("hr") && (low.includes("speed") || low.includes("pace") || low.includes("vitesse"))) {
        sampleHeaderIdx = i;
        break;
      }
    }

    const sampleHeaders = lines[sampleHeaderIdx].split(sep).map((s) => s.trim().toLowerCase());
    const hrCol = sampleHeaders.findIndex((h) => h.includes("hr") || h.includes("fc") || h.includes("heart"));
    const spdCol = sampleHeaders.findIndex((h) => h.includes("speed") || h.includes("vitesse"));
    const distCol = sampleHeaders.findIndex((h) => h.includes("distance"));
    const wattsCol = sampleHeaders.findIndex((h) => h.includes("power") || h.includes("watts") || h.includes("puissance"));
    const cadCol = sampleHeaders.findIndex((h) => h.includes("cadence") || h.includes("stride"));

    const pts = [];
    const hrAll = [];
    const wattsList = [];
    const cadList = [];

    for (let i = sampleHeaderIdx + 1; i < lines.length; i++) {
      const cols = lines[i].split(sep);
      if (cols.length < 3) continue;

      const hr = hrCol !== -1 ? parseInt(cols[hrCol], 10) || 0 : 0;
      let spd = spdCol !== -1 ? parseFloat((cols[spdCol] || "0").replace(",", ".")) || 0 : 0;
      const dist = distCol !== -1 ? parseFloat((cols[distCol] || "0").replace(",", ".")) || 0 : 0;
      const watts = wattsCol !== -1 ? parseInt(cols[wattsCol], 10) || 0 : 0;
      const cad = cadCol !== -1 ? parseInt(cols[cadCol], 10) || 0 : 0;

      const ts = i - (sampleHeaderIdx + 1);
      pts.push({ ts, spd, dist, hr, watts });

      if (hr > 60) hrAll.push(hr);
      if (watts > 50) wattsList.push(watts);
      if (cad > 50) cadList.push(cad);
    }

    const totalTimeSec = pts.length;
    let totalDistanceM = pts.length > 0 && pts[pts.length - 1].dist > 0 ? pts[pts.length - 1].dist : 0;
    if (totalDistanceM === 0 && pts.length > 0) {
      totalDistanceM = pts.reduce((acc, p) => acc + p.spd / 3.6, 0);
    }

    const segments = [];
    const laps = [];
    if (pts.length > 25) {
      for (let i = 20; i < pts.length; i += 10) {
        const spdWindow = [];
        const hrWindow = [];
        const wWindow = [];
        for (let j = i - 19; j <= i; j++) {
          if (pts[j].spd > 5.0 && pts[j].spd < 22.0) spdWindow.push(pts[j].spd);
          if (pts[j].hr > 80) hrWindow.push(pts[j].hr);
          if (pts[j].watts > 50) wWindow.push(pts[j].watts);
        }
        if (spdWindow.length >= 10) {
          const avgSpd = spdWindow.reduce((a, b) => a + b, 0) / spdWindow.length;
          segments.push({
            t: pts[i].ts,
            spd: Math.round(avgSpd * 100) / 100,
            hr: Math.round(median(hrWindow)),
            w: Math.round(median(wWindow)),
            dur: 10
          });
        }
      }

      // Découpage en tours de 1 km approximatifs ou blocs de 6 min pour analyse
      const step = 360;
      let lapIdx = 1;
      for (let start = 0; start < pts.length; start += step) {
        const slice = pts.slice(start, start + step);
        if (slice.length < 60) continue;
        const avgS = slice.reduce((a, p) => a + p.spd, 0) / slice.length;
        const hrs = slice.filter((p) => p.hr > 60).map((p) => p.hr);
        const avgH = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0;
        const maxH = hrs.length ? Math.max(...hrs) : 0;
        const maxS = Math.max(...slice.map((p) => p.spd));
        const dM = (avgS / 3.6) * slice.length;
        laps.push({
          index: lapIdx++,
          durationSec: slice.length,
          distanceM: Math.round(dM * 10) / 10,
          speedKmh: Math.round(avgS * 100) / 100,
          avgHr: avgH,
          maxHr: maxH,
          maxSpeedKmh: Math.round(maxS * 100) / 100,
          cadence: 0,
          trigger: "CSV"
        });
      }
    }

    const avgSpeedKmh = totalTimeSec > 0 ? (totalDistanceM / 1000) / (totalTimeSec / 3600) : 0;
    const avgHr = hrAll.length > 0 ? Math.round(hrAll.reduce((a, b) => a + b, 0) / hrAll.length) : 0;
    const maxHr = hrAll.length > 0 ? Math.max(...hrAll) : 0;
    const avgWatts = wattsList.length > 0 ? Math.round(wattsList.reduce((a, b) => a + b, 0) / wattsList.length) : 0;
    const avgCadence = cadList.length > 0 ? Math.round(cadList.reduce((a, b) => a + b, 0) / cadList.length) : 0;

    return {
      id: fileName || `CSV_${dateStr}_${Date.now()}`,
      fileName: fileName || `Polar_${dateStr}.csv`,
      startTime: `${dateStr}T08:00:00Z`,
      date: dateStr,
      totalTimeSec: totalTimeSec,
      totalDistanceM: Math.round(totalDistanceM * 10) / 10,
      avgSpeedKmh: Math.round(avgSpeedKmh * 100) / 100,
      avgHr: avgHr,
      maxHr: maxHr,
      avgWatts: avgWatts,
      avgCadence: avgCadence,
      calories: 0,
      laps: laps,
      segments: segments
    };
  }

  window.PolarParser = {
    parseTCX,
    parsePolarCSV
  };
})();
