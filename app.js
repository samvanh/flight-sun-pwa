
// --- Storage & PWA
const $ = (id) => document.getElementById(id);
const route = $("route"), off = $("off"), on = $("on"), crz = $("crz"), start = $("start"), end = $("end"), step = $("step");
const results = $("results"), statusEl = $("status"), stepLabel = $("stepLabel"), pwa = $("pwa");
const mapDiv = $("map");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").then(()=>{
    pwa.textContent = "ready"; pwa.className="badge badge-ok";
  }).catch(()=>{ pwa.textContent="error"; pwa.className="badge badge-danger"; });
} else { pwa.textContent = "unsupported"; pwa.className="badge badge-danger"; }

function loadInputs() {
  const s = JSON.parse(localStorage.getItem("flight-sun-inputs")||"{}");
  ["route","off","on","crz","start","end","step"].forEach(k=>{ if (s[k]) $(k).value = s[k]; });
  stepLabel.textContent = (step.value||"60")+"s";
}
function saveInputs() {
  const s = { route: route.value, off: off.value, on: on.value, crz: crz.value, start: start.value, end: end.value, step: step.value };
  localStorage.setItem("flight-sun-inputs", JSON.stringify(s));
  statusEl.textContent = "Inputs saved";
}
$("save").onclick = saveInputs;
step.oninput = () => stepLabel.textContent = (step.value||"60")+"s";
loadInputs();

// --- Math helpers
const deg2rad = (d)=>d*Math.PI/180, rad2deg = (r)=>r*180/Math.PI;

function solarAltitudeUTC(dateUTC, latDeg, lonDeg) {
  const d = dateUTC;
  const jd = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())/86400000) + 2440587.5;
  const T = (jd - 2451545.0) / 36525.0;
  const L0 = (280.46646 + 36000.76983*T + 0.0003032*T*T) % 360;
  const M = 357.52911 + 35999.05029*T - 0.0001537*T*T;
  const Mrad = deg2rad(M);
  const C = (1.914602 - 0.004817*T - 0.000014*T*T)*Math.sin(Mrad) + (0.019993 - 0.000101*T)*Math.sin(2*Mrad) + 0.000289*Math.sin(3*Mrad);
  const lam = deg2rad(L0 + C);
  const eps0 = 23 + (26 + ((21.448 - T*(46.815 + T*(0.00059 - T*0.001813))))/60)/60;
  const eps = deg2rad(eps0);
  const sinDec = Math.sin(eps)*Math.sin(lam);
  const dec = Math.asin(sinDec);
  const y = Math.cos(eps)*Math.sin(lam);
  const x = Math.cos(lam);
  let ra = Math.atan2(y,x); if (ra<0) ra+=2*Math.PI;
  const T0 = (Math.floor(jd-0.5)+0.5 - 2451545.0)/36525.0;
  const GMSTdeg = (280.46061837 + 360.98564736629*(jd-2451545.0) + 0.000387933*T0*T0 - T0*T0*T0/38710000) % 360;
  const GMST = deg2rad((GMSTdeg+360)%360);
  const phi = deg2rad(latDeg), lamLon = deg2rad(lonDeg);
  const H = GMST + lamLon - ra;
  const alt = Math.asin(Math.sin(phi)*Math.sin(dec) + Math.cos(phi)*Math.cos(dec)*Math.cos(H));
  return rad2deg(alt);
}

function gcInterpolate(lat1, lon1, lat2, lon2, f) {
  const φ1 = deg2rad(lat1), λ1 = deg2rad(lon1);
  const φ2 = deg2rad(lat2), λ2 = deg2rad(lon2);
  const Δ = 2 * Math.asin(Math.sqrt(Math.sin((φ2-φ1)/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin((λ2-λ1)/2)**2));
  if (Δ === 0) return [lat1, lon1];
  const A = Math.sin((1-f)*Δ) / Math.sin(Δ);
  const B = Math.sin(f*Δ) / Math.sin(Δ);
  const x = A*Math.cos(φ1)*Math.cos(λ1) + B*Math.cos(φ2)*Math.cos(λ2);
  const y = A*Math.cos(φ1)*Math.sin(λ1) + B*Math.cos(φ2)*Math.sin(λ2);
  const z = A*Math.sin(φ1) + B*Math.sin(φ2);
  const φi = Math.atan2(z, Math.sqrt(x*x + y*y));
  const λi = Math.atan2(y, x);
  return [rad2deg(φi), (rad2deg(λi)+540)%360-180];
}

function formatLatLon(lat, lon) {
  const ns = lat>=0 ? "N" : "S";
  const ew = lon>=0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)}°${ns}, ${Math.abs(lon).toFixed(3)}°${ew}`;
}

// --- Data loading (ICAO + waypoints)
let AIRPORTS = {}, WPTS = {};
async function loadDB() {
  const a = await fetch("./data/airports.json").then(r=>r.json()).catch(()=>({}));
  const w = await fetch("./data/waypoints.json").then(r=>r.json()).catch(()=>({}));
  AIRPORTS = a; WPTS = w;
}
loadDB();

// --- Route parsing with ICAO/waypoints/coords
function parseLatLonToken(tok) {
  tok = tok.trim().toUpperCase();
  let m = tok.match(/^(\d{2})(\d{2})?N(\d{3})(\d{2})?W$/);
  if (m) { const lat = parseInt(m[1],10)+(m[2]?parseInt(m[2],10):0)/60; const lon = parseInt(m[3],10)+(m[4]?parseInt(m[4],10):0)/60; return [ lat, -lon ]; }
  m = tok.match(/^(\d{2})(\d{2})?N(\d{3})(\d{2})?E$/);
  if (m) { const lat = parseInt(m[1],10)+(m[2]?parseInt(m[2],10):0)/60; const lon = parseInt(m[3],10)+(m[4]?parseInt(m[4],10):0)/60; return [ lat, lon ]; }
  m = tok.match(/^(\d{2})(\d{2})?S(\d{3})(\d{2})?W$/);
  if (m) { const lat = parseInt(m[1],10)+(m[2]?parseInt(m[2],10):0)/60; const lon = parseInt(m[3],10)+(m[4]?parseInt(m[4],10):0)/60; return [ -lat, -lon ]; }
  m = tok.match(/^(\d{2})(\d{2})?S(\d{3})(\d{2})?E$/);
  if (m) { const lat = parseInt(m[1],10)+(m[2]?parseInt(m[2],10):0)/60; const lon = parseInt(m[3],10)+(m[4]?parseInt(m[4],10):0)/60; return [ -lat, lon ]; }
  m = tok.match(/^(\d{2})(\d{2})(N|S)(\d{3})(\d{2})(E|W)$/);
  if (m) {
    const lat = parseInt(m[1],10)+parseInt(m[2],10)/60;
    const lon = parseInt(m[4],10)+parseInt(m[5],10)/60;
    return [ m[3]==="N"? lat : -lat, m[6]==="E"? lon : -lon ];
  }
  // Pair form handled in parseRoute
  return null;
}

function parseLatLonPair(s) {
  if (!s) return null;
  const m = s.split(/[,\s]+/).map(x=>x.trim()).filter(Boolean);
  if (m.length>=2) {
    const lat = parseFloat(m[0]), lon = parseFloat(m[1]);
    if (!isNaN(lat) && !isNaN(lon)) return [lat, lon];
  }
  return null;
}

function parseRoute(text) {
  const toks = text.split(/[\s,;/]+/).filter(Boolean);
  let coords = [];
  for (let i=0;i<toks.length;i++) {
    const t = toks[i].toUpperCase();
    // 1) ICAO airport (4 letters) or 5-letter waypoint
    if (/^[A-Z]{4}$/.test(t) && AIRPORTS[t]) { coords.push(AIRPORTS[t]); continue; }
    if (/^[A-Z0-9]{5}$/.test(t) && WPTS[t]) { coords.push(WPTS[t]); continue; }
    // 2) Compact/standard coordinate token
    let ll = parseLatLonToken(t);
    if (ll) { coords.push(ll); continue; }
    // 3) Pair like "51.5N 20.3W"
    const a = t.match(/^(\d{1,2}(\.\d+)?)\s*(N|S)$/);
    if (a && i+1 < toks.length) {
      const b = toks[i+1].toUpperCase().match(/^(\d{1,3}(\.\d+)?)\s*(E|W)$/);
      if (b) {
        const lat = (a[3]==="N"? 1 : -1) * parseFloat(a[1]);
        const lon = (b[3]==="E"? 1 : -1) * parseFloat(b[1]);
        coords.push([lat, lon]); i++; continue;
      }
    }
  }
  return coords;
}

// --- Mini map backend (SVG fallback); Leaflet optional
let mapBackend = null;
function initMap() {
  // If Leaflet present and tiles exist, use that; else SVG fallback
  if (window.L) {
    mapBackend = createLeafletBackend(mapDiv);
  } else {
    mapBackend = createSVGFallback(mapDiv);
  }
}
function updateMap(segments, sunrise, sunset) {
  if (!mapBackend) initMap();
  mapBackend.render(segments, sunrise, sunset);
}
function boundsOfCoords(coords) {
  let minLat=90, maxLat=-90, minLon=180, maxLon=-180;
  coords.forEach(([la,lo])=>{
    minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la);
    minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo);
  });
  return {minLat,maxLat,minLon,maxLon};
}

// --- Leaflet backend (optional, requires leaflet.js/css + ./tiles/*)
function createLeafletBackend(container) {
  // Expect Leaflet to be already loaded locally by user (not included here)
  // Create base map
  const map = L.map(container, { zoomControl:true, attributionControl:false, worldCopyJump:true });
  const tiles = L.tileLayer('./tiles/{z}/{x}/{y}.png', { minZoom: 0, maxZoom: 3, noWrap: true });
  tiles.addTo(map);
  let layers=[];
  function render(segments, sunrise, sunset) {
    layers.forEach(l => map.removeLayer(l));
    layers = [];
    let latlngs = [];
    segments.forEach(seg => { latlngs.push([seg.lat, seg.lon]); });
    // Split into day/night polylines
    let current = [], currentType = null;
    const flush = (type)=>{
      if (current.length>1) {
        const color = type==="day" ? "#facc15" : "#1e3a8a";
        const pl = L.polyline(current, { color, weight: 4, opacity: 0.9 });
        pl.addTo(map); layers.push(pl);
      }
      current = [];
    };
    segments.forEach((s,i)=>{
      const type = s.day ? "day" : "night";
      if (currentType===null) currentType=type;
      if (type!==currentType) { flush(currentType); currentType=type; }
      current.push([s.lat, s.lon]);
    });
    flush(currentType);
    // Markers
    function addMarker(obj, color) {
      if (!obj) return;
      const m = L.circleMarker([obj.lat, obj.lon], { radius:6, color, weight:2, fillOpacity:1 });
      m.bindPopup(`${obj.kind} at ${obj.t.toISOString().replace('.000','')}<br>${obj.lat.toFixed(3)}, ${obj.lon.toFixed(3)}`);
      m.addTo(map); layers.push(m);
    }
    addMarker(sunrise, "#f97316"); // orange
    addMarker(sunset, "#ef4444"); // red
    // Fit bounds
    const b = boundsOfCoords(segments.map(s=>[s.lat,s.lon]));
    const pad = 5;
    const southWest = L.latLng(b.minLat-pad, b.minLon-pad);
    const northEast = L.latLng(b.maxLat+pad, b.maxLon+pad);
    map.fitBounds(L.latLngBounds(southWest, northEast));
  }
  return { render };
}

// --- SVG fallback backend (works 100% offline, no tiles needed)
function createSVGFallback(container) {
  container.innerHTML = "";
  const w = container.clientWidth || 600, h = container.clientHeight || 380;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.style.background = "#0b1220";
  container.appendChild(svg);
  const group = document.createElementNS(svgNS, "g");
  svg.appendChild(group);

  function project(lat, lon) { // simple equirectangular
    const x = (lon + 180) / 360 * w;
    const y = (90 - lat) / 180 * h;
    return [x,y];
  }
  let drawn = [];

  function render(segments, sunrise, sunset) {
    // Clear
    drawn.forEach(el => el.remove()); drawn = [];
    // Compute bounds
    const b = boundsOfCoords(segments.map(s=>[s.lat,s.lon]));
    // Route
    let prev = null, prevDay=null;
    segments.forEach(s => {
      const [x,y] = project(s.lat, s.lon);
      if (prev) {
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", prev[0]); line.setAttribute("y1", prev[1]);
        line.setAttribute("x2", x); line.setAttribute("y2", y);
        line.setAttribute("stroke", s.day ? "#facc15" : "#1e3a8a");
        line.setAttribute("stroke-width", "3.5");
        line.setAttribute("stroke-linecap", "round");
        group.appendChild(line); drawn.push(line);
      }
      prev = [x,y]; prevDay = s.day;
    });
    // Markers
    function addDot(obj, color) {
      if (!obj) return;
      const [x,y] = project(obj.lat, obj.lon);
      const c = document.createElementNS(svgNS, "circle");
      c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 5);
      c.setAttribute("fill", color);
      c.setAttribute("stroke", "#fff"); c.setAttribute("stroke-width", "1");
      group.appendChild(c); drawn.push(c);
      // tooltip-ish
      c.addEventListener("click", ()=>{
        alert(`${obj.kind} at ${obj.t.toISOString().replace('.000','')}\n${obj.lat.toFixed(3)}, ${obj.lon.toFixed(3)}`);
      });
    }
    addDot(sunrise, "#f97316");
    addDot(sunset, "#ef4444");
  }
  return { render };
}

// --- Main calc
$("calc").onclick = () => {
  const routeText = route.value||"";
  const offVal = off.value, onVal = on.value;
  const crzVal = parseFloat(crz.value||"0");
  const stepSec = Math.max(10, parseInt(step.value||"60",10));
  if (!offVal || !onVal) { results.innerHTML = `<div class="pill">Please enter take-off and landing times (UTC).</div>`; return; }
  const t0 = new Date(offVal), t1 = new Date(onVal);
  if (isNaN(t0)||isNaN(t1)||t1<=t0) { results.innerHTML = `<div class="pill">Invalid time range.</div>`; return; }

  // Build coordinate list
  let coords = parseRoute(routeText);
  const sLL = parseLatLonPair(start.value), eLL = parseLatLonPair(end.value);
  if (sLL) coords = [sLL, ...(coords.length? coords.slice(1) : [])];
  if (eLL) { if (coords.length>=1) coords[coords.length-1] = eLL; else coords.push(eLL); }
  if (coords.length < 2) { results.innerHTML = `<div class="pill">Need at least two coordinates (start & end via ICAO/waypoint/latlon).</div>`; return; }

  const [latA, lonA] = coords[0];
  const [latB, lonB] = coords[coords.length-1];

  const threshold = -0.833;
  let sunrise=null, sunset=null, prevAlt=null;
  const segments = [];
  let samples=0;
  for (let t=t0.getTime(); t<=t1.getTime(); t+= stepSec*1000) {
    const f = (t - t0.getTime())/(t1.getTime()-t0.getTime());
    const [lat, lon] = gcInterpolate(latA, lonA, latB, lonB, f);
    const alt = solarAltitudeUTC(new Date(t), lat, lon);
    const day = alt >= threshold;
    segments.push({ t: new Date(t), lat, lon, day });
    if (prevAlt!==null) {
      if (prevAlt < threshold && alt >= threshold && !sunrise) sunrise = { t: new Date(t), lat, lon, kind:"Sunrise" };
      if (prevAlt >= threshold && alt < threshold && !sunset) sunset = { t: new Date(t), lat, lon, kind:"Sunset" };
    }
    prevAlt = alt; samples++;
  }

  const pathStr = `${formatLatLon(latA,lonA)} → ${formatLatLon(latB,lonB)}`;
  function row(title, obj) {
    if (!obj) return `<div class="pill">${title}: <span class="badge badge-warn">none within flight</span></div>`;
    return `<div class="card"><div><div class="muted">${title}</div><div style="font-size:1.2rem;margin-top:4px;"><span class="mono">${obj.t.toISOString().replace('.000','')}</span></div><div class="muted" style="margin-top:6px;">${formatLatLon(obj.lat, obj.lon)}</div></div></div>`;
  }
  results.innerHTML = `
    <div class="pill"><strong>Path:</strong> ${pathStr}</div>
    <div class="pill"><strong>Cruise:</strong> FL ${(crzVal/100).toFixed(0)} ( ${Math.round(crzVal)} ft )</div>
    <div class="pill"><strong>Samples:</strong> ${samples} @ ${stepSec}s</div>
    ${row("Sunrise (alt crosses -0.833° upwards)", sunrise)}
    ${row("Sunset (alt crosses -0.833° downwards)", sunset)}
  `;

  updateMap(segments, sunrise, sunset);
  statusEl.textContent = "Done";
};
