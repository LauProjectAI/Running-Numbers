import glob
import json
import os
import statistics
import xml.etree.ElementTree as ET
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
tcx_files = sorted(glob.glob(os.path.join(BASE_DIR, "*.TCX")) + glob.glob(os.path.join(BASE_DIR, "*.tcx")))
# Évite les doublons sur Windows (insensible à la casse)
seen_paths = set()
unique_files = []
for f in tcx_files:
    norm = os.path.normcase(os.path.abspath(f))
    if norm not in seen_paths:
        seen_paths.add(norm)
        unique_files.append(f)

ns = {
    'tcx': 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2',
    'ext': 'http://www.garmin.com/xmlschemas/ActivityExtension/v2'
}

sessions_data = []

for f in unique_files:
    try:
        tree = ET.parse(f)
        root = tree.getroot()
        act_id_el = root.find('.//tcx:Activity/tcx:Id', ns)
        act_id = act_id_el.text if act_id_el is not None else os.path.basename(f)
        laps = root.findall('.//tcx:Lap', ns)

        total_time = 0.0
        total_dist = 0.0
        calories = 0
        laps_clean = []

        for idx, l in enumerate(laps):
            t_el = l.find('tcx:TotalTimeSeconds', ns)
            d_el = l.find('tcx:DistanceMeters', ns)
            c_el = l.find('tcx:Calories', ns)
            ah_el = l.find('tcx:AverageHeartRateBpm/tcx:Value', ns)
            mh_el = l.find('tcx:MaximumHeartRateBpm/tcx:Value', ns)
            ms_el = l.find('tcx:MaximumSpeed', ns)
            cad_el = l.find('tcx:Cadence', ns)
            trig_el = l.find('tcx:TriggerMethod', ns)

            t = float(t_el.text) if t_el is not None else 0.0
            d = float(d_el.text) if d_el is not None else 0.0
            cal = int(c_el.text) if c_el is not None else 0
            ah = int(ah_el.text) if ah_el is not None else 0
            mh = int(mh_el.text) if mh_el is not None else 0
            ms = float(ms_el.text) * 3.6 if ms_el is not None else 0.0
            cad = int(cad_el.text) if cad_el is not None else 0
            trig = trig_el.text if trig_el is not None else "Manual"

            total_time += t
            total_dist += d
            calories += cal

            if t >= 15 and d >= 30:
                spd = (d / 1000.0) / (t / 3600.0)
                laps_clean.append({
                    "index": idx + 1,
                    "durationSec": round(t, 1),
                    "distanceM": round(d, 1),
                    "speedKmh": round(spd, 2),
                    "avgHr": ah,
                    "maxHr": mh,
                    "maxSpeedKmh": round(ms, 2),
                    "cadence": cad,
                    "trigger": trig
                })

        tps = root.findall('.//tcx:Trackpoint', ns)
        pts = []
        watts_list = []
        cad_list = []
        hr_all = []

        for tp in tps:
            t_el = tp.find('tcx:Time', ns)
            d_el = tp.find('tcx:DistanceMeters', ns)
            h_el = tp.find('tcx:HeartRateBpm/tcx:Value', ns)
            w_el = tp.find('.//ext:Watts', ns)
            c_el = tp.find('tcx:Cadence', ns)
            if t_el is not None and d_el is not None:
                dt = datetime.fromisoformat(t_el.text.replace('Z', '+00:00'))
                d = float(d_el.text)
                h = int(h_el.text) if h_el is not None else None
                w = int(w_el.text) if w_el is not None else None
                c = int(c_el.text) if c_el is not None else None
                pts.append((dt.timestamp(), d, h, w))
                if h is not None and h > 60:
                    hr_all.append(h)
                if w is not None and w > 50:
                    watts_list.append(w)
                if c is not None and c > 50:
                    cad_list.append(c)

        segments = []
        if len(pts) > 25:
            t_start = pts[0][0]
            for i in range(20, len(pts), 10):
                dt_sec = pts[i][0] - pts[i-20][0]
                dd_m = pts[i][1] - pts[i-20][1]
                if 14 <= dt_sec <= 26 and dd_m > 15:
                    spd_kmh = (dd_m / dt_sec) * 3.6
                    if 5.5 <= spd_kmh <= 21.0:
                        hrs_w = [p[2] for p in pts[i-15:i+1] if p[2] is not None and p[2] > 80]
                        wts_w = [p[3] for p in pts[i-15:i+1] if p[3] is not None and p[3] > 50]
                        hr_med = int(round(statistics.median(hrs_w))) if hrs_w else 0
                        wt_med = int(round(statistics.median(wts_w))) if wts_w else 0
                        segments.append({
                            "t": int(pts[i][0] - t_start),
                            "spd": round(spd_kmh, 2),
                            "hr": hr_med,
                            "w": wt_med,
                            "dur": round(dt_sec / 2.0, 1)
                        })

        avg_spd = (total_dist / 1000.0) / (total_time / 3600.0) if total_time > 0 else 0
        avg_hr = int(round(sum(hr_all) / len(hr_all))) if hr_all else 0
        max_hr = max(hr_all) if hr_all else 0
        avg_watts = int(round(sum(watts_list) / len(watts_list))) if watts_list else 0
        avg_cad = int(round(sum(cad_list) / len(cad_list))) if cad_list else 0

        sessions_data.append({
            "id": os.path.basename(f),
            "fileName": os.path.basename(f),
            "startTime": act_id,
            "date": act_id[:10],
            "totalTimeSec": round(total_time, 1),
            "totalDistanceM": round(total_dist, 1),
            "avgSpeedKmh": round(avg_spd, 2),
            "avgHr": avg_hr,
            "maxHr": max_hr,
            "avgWatts": avg_watts,
            "avgCadence": avg_cad,
            "calories": calories,
            "laps": laps_clean,
            "segments": segments
        })
    except Exception as e:
        print(f"Erreur sur {f}: {e}")

out_dir = os.path.join(BASE_DIR, "data")
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, "default_sessions.js")
with open(out_path, "w", encoding="utf-8") as fp:
    fp.write("// Données pré-extraites des fichiers TCX Polar présents dans le dossier du projet\n")
    fp.write("window.DEFAULT_POLAR_SESSIONS = ")
    json.dump(sessions_data, fp, ensure_ascii=False, indent=2)
    fp.write(";\n")

print(f"Base mise à jour avec succès : {len(sessions_data)} séances TCX intégrées dans {out_path}")
