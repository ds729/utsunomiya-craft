// HUD（DOM）: 方位・座標・緯度経度・FPS・最寄りPOI
import { toLatLon, yawToHeading, headingLabel, nearestPoi } from './geo.js';

const COMPASS_MARKS = [['N', 0, true], ['NE', 45], ['E', 90, true], ['SE', 135], ['S', 180, true], ['SW', 225], ['W', 270, true], ['NW', 315]];

export class Hud {
  constructor(meta) {
    this.meta = meta;
    this.compass = document.getElementById('compass');
    this.info = document.getElementById('info');
    this.poi = document.getElementById('poi');
    this.marks = COMPASS_MARKS.map(([label, deg, major]) => {
      const s = document.createElement('span');
      s.textContent = label;
      if (major) s.className = 'major';
      this.compass.appendChild(s);
      return { s, deg };
    });
    this.lastPoiCheck = 0;
    this.lastPoi = null;
  }

  update(p, yaw, fps, extra, now) {
    const heading = yawToHeading(yaw);
    for (const m of this.marks) {
      const d = ((m.deg - heading + 540) % 360) - 180; // -180..180
      m.s.style.display = Math.abs(d) < 70 ? '' : 'none';
      m.s.style.left = `${50 + (d / 70) * 50}%`;
    }
    const ll = toLatLon(this.meta.origin, p.x, p.z);
    this.info.innerHTML =
      `x ${p.x.toFixed(1)}　y ${(p.y - 1).toFixed(1)}　z ${p.z.toFixed(1)}<br>` +
      `${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}<br>` +
      `方位 ${Math.round(heading)}° ${headingLabel(heading)}　${fps} FPS${p.flying ? '　フライ' : ''}${extra ? `<br>${extra}` : ''}`;
    if (now - this.lastPoiCheck > 250) {
      this.lastPoiCheck = now;
      const poi = nearestPoi(this.meta.pois, p.x, p.z, 30);
      const text = poi ? poi.name : '';
      if (text !== this.lastPoi) { this.poi.textContent = text; this.lastPoi = text; }
    }
  }
}
