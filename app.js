(function () {
  'use strict';

  // ---------- Konfiguration ----------

  const DEFAULT_COLORS = {
    NSW: '#9b30ff', // Lila
    VIC: '#ff8c00', // Orange
    SA: '#ff4fb8',  // Pink
    WA: '#e3000f',  // Rot
    NT: '#1463ff',  // Blau
    QLD: '#39ff14', // Neongrün
    ACT: '#00bcd4', // nicht vorgegeben
    TAS: '#ffd400', // nicht vorgegeben
  };

  const STATE_NAMES = {
    NSW: 'New South Wales',
    VIC: 'Victoria',
    QLD: 'Queensland',
    SA: 'South Australia',
    WA: 'Western Australia',
    NT: 'Northern Territory',
    ACT: 'Australian Capital Territory',
    TAS: 'Tasmania',
  };
  const STATE_ORDER = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'NT', 'ACT', 'TAS'];

  // Ganz rausgezoomt deckend, ab ZOOM_CLEAR die eingestellte Mindest-Deckkraft.
  const ZOOM_OPAQUE = 5;
  const ZOOM_CLEAR = 15;

  // Unterhalb dieser Zoomstufe reicht die Übersichtsgeometrie (20 m Toleranz, kleiner als
  // ein Bildschirmpixel). Ab hier werden für sichtbare Gebiete die vollen Grenzen geladen.
  const DETAIL_ZOOM = 11;
  // So viele Detailgeometrien außerhalb des Ausschnitts dürfen im Speicher bleiben.
  const MAX_DETAIL = 250;

  const AUSTRALIA_BOUNDS = L.latLngBounds([-44.0, 112.5], [-10.0, 154.0]);
  const ABS_QUERY = 'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/POA/MapServer/0/query';
  const STORE_KEY = 'plz-karte:v1';

  // ---------- Zustand ----------

  const saved = loadSettings();
  const settings = {
    codes: Array.isArray(saved.codes) ? saved.codes : [],
    colors: Object.assign({}, DEFAULT_COLORS, saved.colors || {}),
    minOpacity: typeof saved.minOpacity === 'number' ? saved.minOpacity : 0.2,
    googleKey: saved.googleKey || '',
    showDots: saved.showDots !== false,
    baseLayer: saved.baseLayer || 'Google Maps',
    view: saved.view || null,
  };

  // code -> { state, status: 'loading'|'ok'|'missing'|'error', bbox, ov, det, dot, detLoading }
  // ov = Übersichtsgeometrie, det = volle Detailgeometrie
  const entries = new Map();
  let index = null;          // { code: { s, b } } aus data/index.json, null = nicht vorhanden
  let indexReady = null;

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSettings() {
    settings.codes = [...entries.keys()];
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* privat-Modus */ }
  }

  // ---------- Karte ----------

  const map = L.map('map', {
    zoomControl: false,
    worldCopyJump: true,
    preferCanvas: true,
    maxZoom: 21,
    zoomSnap: 0.25,
    wheelPxPerZoomLevel: 90,
  });
  // Feiner Toleranzwert: Leaflet vereinfacht Polygone beim Zeichnen sonst sichtbar.
  const renderer = L.canvas({ padding: 0.5, tolerance: 4 });
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  window.plzMap = map;

  if (settings.view) map.setView(settings.view.center, settings.view.zoom);
  else map.fitBounds(AUSTRALIA_BOUNDS);

  function googleTiles(lyrs) {
    return L.tileLayer(`https://mt{s}.google.com/vt/lyrs=${lyrs}&hl=de&gl=AU&x={x}&y={y}&z={z}`, {
      subdomains: '0123',
      maxZoom: 21,
      maxNativeZoom: 21,
      attribution: 'Kartendaten &copy; Google',
    });
  }

  function osmTiles() {
    return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 21,
      maxNativeZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende (Datenbasis von Organic Maps)',
    });
  }

  let baseLayers = {
    'Google Maps': googleTiles('m'),
    'Google Satellit': googleTiles('s'),
    'Google Hybrid': googleTiles('y'),
    'Organic Maps (OpenStreetMap)': osmTiles(),
  };
  let layerControl = null;

  function installBaseLayers() {
    const active = baseLayers[settings.baseLayer] ? settings.baseLayer : 'Google Maps';
    if (layerControl) layerControl.remove();
    layerControl = L.control.layers(baseLayers, null, { position: 'topright', collapsed: true }).addTo(map);
    baseLayers[active].addTo(map);
  }
  installBaseLayers();

  map.on('baselayerchange', (e) => {
    settings.baseLayer = e.name;
    saveSettings();
  });

  // Offizielle Google Maps JavaScript API, wenn ein Key hinterlegt ist.
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Konnte ${src} nicht laden`));
      document.head.appendChild(s);
    });
  }

  async function useGoogleApi(key) {
    if (!key) return;
    try {
      if (!(window.google && window.google.maps)) {
        await loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&language=de&region=AU`);
      }
      if (!L.gridLayer.googleMutant) {
        await loadScript('https://unpkg.com/leaflet.gridlayer.googlemutant@0.14.1/dist/Leaflet.GoogleMutant.js');
      }
      for (const name of Object.keys(baseLayers)) {
        if (name.startsWith('Google') && map.hasLayer(baseLayers[name])) map.removeLayer(baseLayers[name]);
      }
      baseLayers = {
        'Google Maps': L.gridLayer.googleMutant({ type: 'roadmap', maxZoom: 21 }),
        'Google Satellit': L.gridLayer.googleMutant({ type: 'satellite', maxZoom: 21 }),
        'Google Hybrid': L.gridLayer.googleMutant({ type: 'hybrid', maxZoom: 21 }),
        'Organic Maps (OpenStreetMap)': baseLayers['Organic Maps (OpenStreetMap)'],
      };
      if (map.hasLayer(baseLayers['Organic Maps (OpenStreetMap)'])) {
        map.removeLayer(baseLayers['Organic Maps (OpenStreetMap)']);
      }
      installBaseLayers();
    } catch (err) {
      setStatus(`Google Maps API konnte nicht geladen werden: ${err.message}`, true);
    }
  }
  useGoogleApi(settings.googleKey);

  // ---------- Transparenz nach Zoomstufe ----------

  function fillOpacityAt(zoom) {
    const t = Math.min(1, Math.max(0, (zoom - ZOOM_OPAQUE) / (ZOOM_CLEAR - ZOOM_OPAQUE)));
    return 1 - t * (1 - settings.minOpacity);
  }

  function styleFor(state) {
    const z = map.getZoom();
    const fill = fillOpacityAt(z);
    return {
      color: settings.colors[state] || '#888',
      weight: z >= 10 ? 2 : 1,
      opacity: Math.max(0.85, fill),
      fillColor: settings.colors[state] || '#888',
      fillOpacity: fill,
      lineJoin: 'round',
    };
  }

  function restyleAll() {
    for (const entry of entries.values()) {
      if (entry.ov) entry.ov.setStyle(styleFor(entry.state));
      if (entry.det) entry.det.setStyle(styleFor(entry.state));
      if (entry.dot) entry.dot.setStyle({ fillColor: settings.colors[entry.state] });
    }
  }
  map.on('zoom', restyleAll);

  // Sehr kleine Gebiete (z. B. Innenstadt-PLZ) sind rausgezoomt nur ein Pixel groß.
  // Optional wird dann zusätzlich ein Punkt angezeigt, damit man sie findet.
  const DOT_MIN_PX = 8;
  function updateDot(entry) {
    if (!entry.dot) return;
    const b = entry.bbox;
    const z = map.getZoom();
    const nw = map.project(b.getNorthWest(), z);
    const se = map.project(b.getSouthEast(), z);
    const small = settings.showDots && Math.max(se.x - nw.x, se.y - nw.y) < DOT_MIN_PX;
    if (small && !map.hasLayer(entry.dot)) entry.dot.addTo(map);
    else if (!small && map.hasLayer(entry.dot)) map.removeLayer(entry.dot);
  }
  function updateDots() {
    for (const entry of entries.values()) updateDot(entry);
  }
  map.on('zoomend', updateDots);

  map.on('moveend', () => {
    syncAll();
    settings.view = { center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() };
    saveSettings();
    updateAppLinks();
  });

  // ---------- Daten laden ----------

  function loadIndex() {
    if (!indexReady) {
      indexReady = fetch('data/index.json')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((json) => { index = json; return json; });
    }
    return indexReady;
  }

  // Übersichtsgeometrien liegen gebündelt nach erster Ziffer der Postleitzahl vor.
  const overviewChunks = {};
  function loadOverview(digit) {
    if (!overviewChunks[digit]) {
      overviewChunks[digit] = fetch(`data/overview/${digit}.json`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      overviewChunks[digit].catch(() => { delete overviewChunks[digit]; });
    }
    return overviewChunks[digit];
  }

  async function fetchDetail(code) {
    const res = await fetch(`data/poa/${code}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Ohne gebauten Datensatz (lokale Entwicklung): direkt beim ABS-Kartendienst abfragen.
  async function fetchFromAbs(code) {
    const params = new URLSearchParams({
      where: `poa_code_2021='${code}'`,
      outFields: 'poa_code_2021',
      outSR: '4326',
      geometryPrecision: '7',
      f: 'geojson',
    });
    const res = await fetch(`${ABS_QUERY}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fc = await res.json();
    if (!fc.features || !fc.features.length || !fc.features[0].geometry) return null;
    return fc.features[0];
  }

  function makeLayer(geojson, code, entry) {
    return L.geoJSON(geojson, {
      renderer,
      smoothFactor: 0.3,
      style: () => styleFor(entry.state),
    }).bindPopup(() => popupFor(code));
  }

  function setVisible(layer, on) {
    if (!layer) return;
    if (on && !map.hasLayer(layer)) layer.addTo(map);
    else if (!on && map.hasLayer(layer)) map.removeLayer(layer);
  }

  function viewBounds() {
    return map.getBounds().pad(0.25);
  }

  // Zeigt je nach Zoom und Ausschnitt Übersicht oder Detail und lädt Details nach.
  function sync(entry, view = viewBounds()) {
    if (entry.status !== 'ok') return;
    const wantDetail = !!index && map.getZoom() >= DETAIL_ZOOM && view.intersects(entry.bbox);
    if (wantDetail && !entry.det && !entry.detLoading) enqueueDetail(entry);
    const showDetail = wantDetail && !!entry.det;
    setVisible(entry.det, showDetail);
    setVisible(entry.ov, !showDetail);
    updateDot(entry);
  }

  function syncAll() {
    const view = viewBounds();
    for (const entry of entries.values()) sync(entry, view);
    evictDetails(view);
  }

  function evictDetails(view) {
    const loaded = [...entries.values()].filter((e) => e.det && !view.intersects(e.bbox));
    const inView = [...entries.values()].filter((e) => e.det).length - loaded.length;
    let excess = inView + loaded.length - MAX_DETAIL;
    for (const entry of loaded) {
      if (excess-- <= 0) break;
      setVisible(entry.det, false);
      entry.det = null;
    }
  }

  // Begrenzte Parallelität, damit auch sehr lange Listen flüssig laden.
  const MAX_PARALLEL = 6;
  const queue = [];
  let running = 0;

  function enqueue(job) {
    queue.push(job);
    pump();
  }

  function pump() {
    while (running < MAX_PARALLEL && queue.length) {
      const job = queue.shift();
      running++;
      job().finally(() => {
        running--;
        pump();
        if (!running && !queue.length) onQueueDrained();
      });
    }
  }

  function enqueueDetail(entry) {
    entry.detLoading = true;
    enqueue(async () => {
      try {
        const feature = await fetchDetail(entry.code);
        if (entries.get(entry.code) === entry) {
          entry.det = makeLayer(feature, entry.code, entry);
          sync(entry);
        }
      } catch (err) {
        // Übersicht bleibt sichtbar; beim nächsten Verschieben wird es erneut versucht.
      } finally {
        entry.detLoading = false;
      }
    });
  }

  async function loadOne(code) {
    const entry = entries.get(code);
    if (!entry) return;
    try {
      await loadIndex();
      let geometry = null;
      if (index) {
        if (index[code]) {
          const [w, s, e, n] = index[code].b;
          entry.bbox = L.latLngBounds([s, w], [n, e]);
          geometry = (await loadOverview(code[0]))[code] || null;
        }
      } else {
        const feature = await fetchFromAbs(code);
        geometry = feature && feature.geometry;
      }
      if (entries.get(code) !== entry) return; // inzwischen entfernt
      if (!geometry) {
        entry.status = 'missing';
      } else {
        entry.ov = makeLayer(geometry, code, entry);
        if (!entry.bbox) entry.bbox = entry.ov.getBounds();
        entry.dot = L.circleMarker(entry.bbox.getCenter(), {
          renderer,
          radius: 3.5,
          weight: 1,
          color: 'rgba(0,0,0,0.35)',
          fillColor: settings.colors[entry.state],
          fillOpacity: 1,
        }).bindPopup(() => popupFor(code));
        entry.status = 'ok';
        sync(entry);
      }
    } catch (err) {
      entry.status = 'error';
    }
    scheduleRender();
  }

  let pendingFit = false;
  let lastAddMsg = [];
  let batchPending = false;
  function onQueueDrained() {
    if (!batchPending) return; // nur nachgeladene Details, nichts zu melden
    batchPending = false;
    const missing = [...entries.entries()].filter(([, e]) => e.status === 'missing').map(([c]) => c);
    const errors = [...entries.entries()].filter(([, e]) => e.status === 'error').map(([c]) => c);
    const parts = lastAddMsg.slice();
    if (missing.length) parts.push(`Ohne Gebiet (z. B. Postfach-PLZ): ${missing.join(', ')}`);
    if (errors.length) parts.push(`Laden fehlgeschlagen: ${errors.join(', ')}`);
    if (parts.length) setStatus(parts.join(' · '), errors.length > 0 || lastAddMsg.isError);
    if (pendingFit) { pendingFit = false; fitToSelection(); }
  }

  // ---------- Postleitzahlen verwalten ----------

  function parseInput(text) {
    const codes = [];
    const invalid = [];
    for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
      const range = token.match(/^(\d{3,4})[-–](\d{3,4})$/);
      if (range) {
        let a = parseInt(range[1], 10);
        let b = parseInt(range[2], 10);
        if (a > b) [a, b] = [b, a];
        for (let n = a; n <= b; n++) codes.push({ code: String(n).padStart(4, '0'), fromRange: true });
      } else if (/^\d{3,4}$/.test(token)) {
        codes.push({ code: token.padStart(4, '0'), fromRange: false });
      } else {
        invalid.push(token);
      }
    }
    return { codes, invalid };
  }

  async function addCodes(text, { fit = true } = {}) {
    const { codes, invalid } = parseInput(text);
    if (codes.some((c) => c.fromRange)) await loadIndex();
    let added = 0;
    let skippedRange = 0;
    for (const { code, fromRange } of codes) {
      if (entries.has(code)) continue;
      // Bei Bereichen nur Postleitzahlen übernehmen, die tatsächlich ein Gebiet haben.
      if (fromRange && index && !index[code]) { skippedRange++; continue; }
      const state = window.AUState.stateOf(code);
      if (!state) { invalid.push(code); continue; }
      entries.set(code, { code, state, status: 'loading', bbox: null, ov: null, det: null, dot: null, detLoading: false });
      enqueue(() => loadOne(code));
      added++;
    }
    saveSettings();
    render();
    const msg = [];
    if (added) msg.push(`${added} Postleitzahl${added === 1 ? '' : 'en'} hinzugefügt`);
    if (skippedRange) msg.push(`${skippedRange} im Bereich ohne Gebiet übersprungen`);
    if (invalid.length) msg.push(`Ungültig: ${invalid.join(', ')}`);
    if (!added && !invalid.length && !skippedRange && codes.length) msg.push('Schon in der Liste');
    setStatus(msg.join(' · '), invalid.length > 0);
    lastAddMsg = msg;
    lastAddMsg.isError = invalid.length > 0;
    if (added) batchPending = true;
    if (added && fit) pendingFit = true;
    return added;
  }

  function removeCode(code) {
    const entry = entries.get(code);
    if (!entry) return;
    for (const layer of [entry.ov, entry.det, entry.dot]) if (layer) map.removeLayer(layer);
    entries.delete(code);
    saveSettings();
    render();
  }

  function clearAll() {
    for (const code of [...entries.keys()]) {
      const entry = entries.get(code);
      for (const layer of [entry.ov, entry.det, entry.dot]) if (layer) map.removeLayer(layer);
    }
    entries.clear();
    queue.length = 0;
    saveSettings();
    render();
    setStatus('');
  }

  function fitToSelection() {
    const bounds = L.latLngBounds([]);
    for (const entry of entries.values()) {
      if (entry.bbox && entry.status === 'ok') bounds.extend(entry.bbox);
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  }

  function zoomTo(code) {
    const entry = entries.get(code);
    if (entry && entry.bbox && entry.status === 'ok') map.fitBounds(entry.bbox, { padding: [30, 30] });
    if (window.matchMedia('(max-width: 767px)').matches) setCollapsed(true);
  }

  function popupFor(code) {
    const entry = entries.get(code);
    const div = document.createElement('div');
    div.innerHTML = `<div class="popup-code">${code}</div><div>${STATE_NAMES[entry.state]}</div>`;
    const btn = document.createElement('button');
    btn.className = 'popup-remove';
    btn.textContent = 'Entfernen';
    btn.onclick = () => { map.closePopup(); removeCode(code); };
    div.appendChild(btn);
    return div;
  }

  // Liste in kompakte Bereiche fassen: 2000,2001,2002 -> 2000-2002
  function compactList(codes) {
    const nums = codes.map((c) => parseInt(c, 10)).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < nums.length; i++) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      const a = String(nums[i]).padStart(4, '0');
      const b = String(nums[j]).padStart(4, '0');
      out.push(j > i + 1 ? `${a}-${b}` : j === i + 1 ? `${a},${b}` : a);
      i = j;
    }
    return out.join(',');
  }

  // ---------- Oberfläche ----------

  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const groupsEl = $('groups');
  const panel = $('panel');

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', !!isError);
  }

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  function render() {
    $('count-badge').textContent = entries.size;
    groupsEl.textContent = '';
    if (!entries.size) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Noch keine Postleitzahlen. Gib oben welche ein, getrennt durch Komma, Leerzeichen oder Zeilenumbruch.';
      groupsEl.appendChild(p);
      return;
    }
    const byState = {};
    for (const [code, entry] of entries) (byState[entry.state] = byState[entry.state] || []).push(code);

    for (const state of STATE_ORDER) {
      const codes = byState[state];
      if (!codes) continue;
      codes.sort();
      const group = document.createElement('section');
      group.className = 'group';

      const head = document.createElement('div');
      head.className = 'group-head';
      head.innerHTML = `<span class="swatch" style="background:${settings.colors[state]}"></span>
        <span>${state}</span><span class="count">${codes.length}</span>`;
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'ghost';
      clearBtn.textContent = 'Entfernen';
      clearBtn.title = `Alle ${state}-Postleitzahlen entfernen`;
      clearBtn.onclick = () => codes.forEach(removeCode);
      head.appendChild(clearBtn);
      group.appendChild(head);

      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const code of codes) {
        const entry = entries.get(code);
        const chip = document.createElement('span');
        chip.className = `chip ${entry.status}`;
        if (entry.status === 'missing') chip.title = 'Für diese Postleitzahl gibt es kein Gebiet (z. B. Postfach- oder Firmen-PLZ)';
        if (entry.status === 'error') chip.title = 'Konnte nicht geladen werden';

        const zoom = document.createElement('button');
        zoom.type = 'button';
        zoom.className = 'zoom';
        zoom.textContent = code + (entry.status === 'missing' ? ' –' : entry.status === 'error' ? ' !' : '');
        zoom.onclick = () => zoomTo(code);

        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'remove';
        rm.setAttribute('aria-label', `${code} entfernen`);
        rm.textContent = '×';
        rm.onclick = () => removeCode(code);

        chip.append(zoom, rm);
        chips.appendChild(chip);
      }
      group.appendChild(chips);
      groupsEl.appendChild(group);
    }
  }

  function renderColorSettings() {
    const wrap = $('color-settings');
    wrap.textContent = '';
    for (const state of STATE_ORDER) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'color';
      input.value = settings.colors[state];
      input.oninput = () => {
        settings.colors[state] = input.value;
        restyleAll();
        render();
      };
      input.onchange = saveSettings;
      label.append(input, document.createTextNode(state));
      wrap.appendChild(label);
    }
  }

  function setCollapsed(collapsed) {
    panel.classList.toggle('collapsed', collapsed);
    $('panel-toggle').setAttribute('aria-expanded', String(!collapsed));
  }

  $('panel-toggle').onclick = () => setCollapsed(!panel.classList.contains('collapsed'));

  $('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('plz-input');
    if (!input.value.trim()) return;
    addCodes(input.value);
    input.value = '';
  });
  $('plz-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('add-form').requestSubmit();
    }
  });

  $('btn-clear').onclick = () => {
    if (entries.size && confirm(`Alle ${entries.size} Postleitzahlen entfernen?`)) clearAll();
  };

  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(okMsg);
    } catch (e) {
      prompt('Zum Kopieren:', text);
    }
  }

  $('btn-copy').onclick = () => {
    if (!entries.size) return;
    copyText([...entries.keys()].sort().join(', '), 'Liste in die Zwischenablage kopiert');
  };

  $('btn-share').onclick = () => {
    const url = new URL(location.href);
    url.hash = entries.size ? `plz=${compactList([...entries.keys()])}` : '';
    copyText(url.toString(), 'Link kopiert – auf dem anderen Gerät öffnen, um dieselben Postleitzahlen zu sehen');
  };

  $('btn-fit').onclick = fitToSelection;
  $('btn-australia').onclick = () => map.fitBounds(AUSTRALIA_BOUNDS);

  let locateMarker = null;
  $('btn-locate').onclick = () => map.locate({ setView: true, maxZoom: 15, enableHighAccuracy: true });
  map.on('locationfound', (e) => {
    if (locateMarker) locateMarker.remove();
    locateMarker = L.layerGroup([
      L.circle(e.latlng, { radius: e.accuracy, weight: 1, color: '#1f6feb', fillOpacity: 0.1, renderer }),
      L.circleMarker(e.latlng, { radius: 7, weight: 3, color: '#fff', fillColor: '#1f6feb', fillOpacity: 1, renderer }),
    ]).addTo(map);
  });
  map.on('locationerror', (e) => setStatus(`Standort nicht verfügbar: ${e.message}`, true));

  const minOpacity = $('min-opacity');
  const minOpacityOut = $('min-opacity-out');
  minOpacity.value = settings.minOpacity;
  minOpacityOut.textContent = `${Math.round(settings.minOpacity * 100)} %`;
  minOpacity.oninput = () => {
    settings.minOpacity = parseFloat(minOpacity.value);
    minOpacityOut.textContent = `${Math.round(settings.minOpacity * 100)} %`;
    restyleAll();
  };
  minOpacity.onchange = saveSettings;

  const dotsInput = $('show-dots');
  dotsInput.checked = settings.showDots;
  dotsInput.onchange = () => {
    settings.showDots = dotsInput.checked;
    saveSettings();
    updateDots();
  };

  $('btn-reset-colors').onclick = () => {
    settings.colors = Object.assign({}, DEFAULT_COLORS);
    saveSettings();
    renderColorSettings();
    restyleAll();
    render();
  };

  const keyInput = $('google-key');
  keyInput.value = settings.googleKey;
  keyInput.onchange = () => {
    const key = keyInput.value.trim();
    const changed = key !== settings.googleKey;
    settings.googleKey = key;
    saveSettings();
    if (changed) location.reload();
  };

  // ---------- Links in die Apps ----------

  // Organic Maps / MAPS.ME "ge0"-Kurzlink (https://omaps.app/…)
  const GE0_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function ge0Link(lat, lon, zoom) {
    const MAX = (1 << 30) - 1;
    const zoomI = zoom <= 4 ? 0 : zoom >= 19.75 ? 63 : Math.floor((zoom - 4) * 4);
    let latI = Math.round(((lat + 90) / 180) * MAX);
    latI = Math.min(MAX, Math.max(0, latI));
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    let lonI = Math.round(((lon + 180) / 360) * (MAX + 1));
    if (lonI <= 0 || lonI >= MAX + 1) lonI = 0;
    let s = GE0_CHARS[zoomI];
    let shift = 27;
    for (let i = 0; i < 9; i++) {
      const la = (latI >> shift) & 7;
      const lo = (lonI >> shift) & 7;
      const v = ((la >> 2) & 1) << 5 | ((lo >> 2) & 1) << 4 | ((la >> 1) & 1) << 3 |
                ((lo >> 1) & 1) << 2 | (la & 1) << 1 | (lo & 1);
      s += GE0_CHARS[v];
      shift -= 3;
    }
    return `https://omaps.app/${s}/Karte`;
  }

  function updateAppLinks() {
    const c = map.getCenter().wrap();
    const z = Math.round(map.getZoom());
    $('open-google').href = `https://www.google.com/maps/@${c.lat.toFixed(6)},${c.lng.toFixed(6)},${z}z`;
    $('open-organic').href = ge0Link(c.lat, c.lng, z);
  }

  // ---------- Start ----------

  renderColorSettings();
  render();
  updateAppLinks();
  if (window.matchMedia('(max-width: 767px)').matches && settings.codes.length) setCollapsed(true);

  const initial = settings.codes.slice();
  const hash = new URLSearchParams(location.hash.slice(1));
  const shared = hash.get('plz');
  if (initial.length) addCodes(initial.join(','), { fit: false }).then(() => { if (!shared) setStatus(''); });
  if (shared) {
    addCodes(shared, { fit: true });
    history.replaceState(null, '', location.pathname + location.search);
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
