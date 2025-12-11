// Persons Map: visualize a single person's stations in chronological order

(function () {
	const DATA_URL = 
		"/memo/static/apps/persons_map/test_person.json";

	// Map init 
	const map = L.map("map");
	L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
		attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
		subdomains: 'abcd',
		maxZoom: 28
	}).addTo(map);

	// Cluster group for spiderfying overlapping points
	const clusterGroup = L.markerClusterGroup({
		maxClusterRadius: 60,
		spiderfyOnMaxZoom: true,
		showCoverageOnHover: false,
		zoomToBoundsOnClick: true,
		spiderLegPolylineOptions: { weight: 1.5, color: '#666', opacity: 0.6 }
	});
	map.addLayer(clusterGroup);

	function parseDate(d) {
		if (!d) return null;
		// Expecting dd.mm.yyyy
		const m = d.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
		if (!m) return null;
		const [_, dd, mm, yyyy] = m;
		return new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
	}

	function sortFeatures(features, vocab) {
		// Rules:
		// 1) First: voluntary_residence (if present)
		// 2) Middle: by date ascending (nulls last among middle)
		// 3) Last: death (if present)

		const hasTag = (props, tag) => Array.isArray(props.tags) && props.tags.includes(tag);

		const voluntary = features.filter(f => hasTag(f.properties, "voluntary_residence"));
		const death = features.filter(f => hasTag(f.properties, "death"));
		const others = features.filter(f => !hasTag(f.properties, "voluntary_residence") && !hasTag(f.properties, "death"));

		others.sort((a, b) => {
			const da = parseDate(a.properties.date);
			const db = parseDate(b.properties.date);
			if (da && db) return da - db;
			if (da && !db) return -1;
			if (!da && db) return 1;
			return 0;
		});

		const ordered = [];
		// If multiple voluntary, keep by date if available
		voluntary.sort((a, b) => {
			const da = parseDate(a.properties.date);
			const db = parseDate(b.properties.date);
			if (da && db) return da - db;
			if (da && !db) return -1;
			if (!da && db) return 1;
			return 0;
		});

		ordered.push(...voluntary);
		ordered.push(...others);
		death.sort((a, b) => {
			const da = parseDate(a.properties.date);
			const db = parseDate(b.properties.date);
			if (da && db) return da - db;
			if (da && !db) return -1;
			if (!da && db) return 1;
			return 0;
		});
		ordered.push(...death);

		return ordered;
	}

	function createCircleIcon(color) {
		const svg = `
			<svg width="24" height="24" viewBox="0 0 24 24">
				<circle cx="12" cy="12" r="8" fill="${color}" stroke="#333" stroke-width="2"/>
			</svg>
		`;
		return L.divIcon({
			html: svg,
			className: 'pm-circle-marker',
			iconSize: [24, 24],
			iconAnchor: [12, 12],
			popupAnchor: [0, -12]
		});
	}

	function main(data) {
		const { vocab, features, metadata } = data;

		// Fit bounds to points
		const latlngs = features.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
		if (latlngs.length) {
			map.fitBounds(latlngs, { padding: [20, 20] });
		} else {
			map.setView([47.07, 15.44], 12);
		}

		const ordered = sortFeatures(features, vocab);

		// Create point markers that exactly represent coordinates; connect with polyline
		const eventTypes = vocab.event_types || {};
		const victimTypes = vocab.victim_category_types || {};

		const pathLatLngs = [];
		const markers = [];

		ordered.forEach((f, idx) => {
			const props = f.properties || {};
			const coords = f.geometry.coordinates;
			const latlng = [coords[1], coords[0]];
			pathLatLngs.push(latlng);
			// Color per point from its event_type; fallback to a default.
			const evtTag = (props.tags || []).find(t => eventTypes[t]);
			let color = evtTag ? (eventTypes[evtTag]?.color || "#1f78b4") : "#1f78b4";

			// Use L.marker with DivIcon so cluster group can spiderfy
			const m = L.marker(latlng, {
				icon: createCircleIcon(color),
				title: props.place_name || metadata?.person_name || 'Station'
			});
			// Enumerate stations: add a small tooltip with the sequence number
			m.bindTooltip(String(idx + 1), {
				permanent: false,
				direction: 'top',
				className: 'pm-step-label'
			});
						const dateStr = props.date || "unbekanntes Datum";
						const eventLabel = evtTag ? (eventTypes[evtTag]?.label || evtTag) : "Ereignis";
						const victimLabels = (props.tags || [])
								.filter(t => victimTypes[t])
								.map(t => victimTypes[t]?.label || t)
								.join(', ');

						const popupHtml = `
							<div class="popup-content">
								<div class="popup-header">
									<div class="popup-name">${metadata?.person_name || props.person_name || 'Person'}</div>
									<div class="popup-event-type">${eventLabel}</div>
								</div>
								<div class="popup-section">
									<div class="popup-label">Ort</div>
									<div class="popup-value">${props.place_name || 'Ort unbekannt'}</div>
								</div>
								<div class="popup-section">
									<div class="popup-label">Datum</div>
									<div class="popup-value">${dateStr}</div>
								</div>
								${victimLabels ? `
								<div class="popup-section">
									<div class="popup-label">Kategorie(n)</div>
									<div class="popup-value">${victimLabels}</div>
								</div>` : ''}
                        
							</div>
						`;
						m.bindPopup(popupHtml);
						// Sync panel when user clicks a marker
						m.on('click', () => {
							updatePanel(idx);
						});
						markers.push({ marker: m, props, latlng, evtTag, idx });

						// Add to cluster group (enables spiderfy on overlap)
						clusterGroup.addLayer(m);
		});

		// Create dashed polyline for path connecting the points
		let pathLine = null;
		let pathArrows = null;
		const arrowOptions = {
			patterns: [
				{
					offset: '12px',
					repeat: '60px',
					symbol: L.Symbol && L.Symbol.arrowHead ? L.Symbol.arrowHead({
						pixelSize: 10,
						polygon: false,
						pathOptions: { color: '#333', weight: 2, opacity: 0.9 }
					}) : null
				}
			]
		};
		if (pathLatLngs.length >= 2) {
			pathLine = L.polyline(pathLatLngs, {
				color: "#333",
				weight: 3,
				opacity: 0.8,
				dashArray: '4 6',
				lineCap: 'round',
				lineJoin: 'round'
			});
			// Prepare directional arrows (visibility handled dynamically)
			if (L.polylineDecorator && arrowOptions.patterns[0].symbol) {
				pathArrows = L.polylineDecorator(pathLine, arrowOptions);
			}
		}

		// Legend
		(function addLegendControl() {
			const usedEventKeys = Array.from(new Set(
				ordered.flatMap(f => (f.properties?.tags || []).filter(t => eventTypes[t]))
			));
			if (!usedEventKeys.length) return;

			const LegendControl = L.Control.extend({
				options: { position: 'bottomright' },
				onAdd: function () {
					const div = L.DomUtil.create('div', 'pm-legend');
					div.setAttribute('aria-label', 'Ereignis-Legende');
					usedEventKeys.forEach(key => {
						const evt = eventTypes[key] || {};
						const color = evt.color || '#1f78b4';
						const label = evt.label || key;
						const item = document.createElement('div');
						item.className = 'pm-legend-item';
						item.innerHTML = `
							<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${color};border:1px solid #333"></span>
							<span>${label}</span>
						`;
						div.appendChild(item);
					});
					// Prevent map drag when interacting with legend
					L.DomEvent.disableClickPropagation(div);
					return div;
				}
			});
			map.addControl(new LegendControl());
		})();

		// Navigation panel logic
		const prevBtn = document.getElementById('pm-prev');
		const nextBtn = document.getElementById('pm-next');
		const counterEl = document.getElementById('pm-nav-counter');
		const eventEl = document.getElementById('pm-nav-event');
		const placeEl = document.getElementById('pm-nav-place');
		const dateEl = document.getElementById('pm-nav-date');
		const titleEl = document.getElementById('pm-nav-title');
		const toggleEl = document.getElementById('pm-toggle-path');
		const panelEl = document.getElementById('pm-nav');

		// Prevent map drag/scroll when interacting with the panel
		if (panelEl) {
			L.DomEvent.disableClickPropagation(panelEl);
			L.DomEvent.disableScrollPropagation(panelEl);
		}

		let currentIndex = -1; // no selection initially

		// Set dynamic panel title to person name
		if (titleEl) {
			titleEl.textContent = metadata?.person_name || 'Person';
		}

		function setNavButtonsState() {
			if (!prevBtn || !nextBtn) return;
			const atStart = currentIndex <= 0;
			const atEnd = currentIndex >= (markers.length - 1);
			// Keep buttons visible but disable them at bounds
			prevBtn.disabled = atStart;
			nextBtn.disabled = (markers.length === 0) || atEnd;
		}

		function updatePanel(i) {
			if (!markers.length) return;
			currentIndex = Math.max(0, Math.min(i, markers.length - 1));
			const { marker, props, evtTag } = markers[currentIndex];
			const eventLabel = evtTag ? (eventTypes[evtTag]?.label || evtTag) : 'Ereignis';
			counterEl.textContent = `${currentIndex + 1}/${markers.length}`;
			eventEl.textContent = eventLabel;
			placeEl.textContent = props.place_name || 'Ort unbekannt';
			dateEl.textContent = props.date || 'unbekanntes Datum';
			// Ensure popup is visible even when marker is inside a cluster
			(function ensureVisibleAndOpen() {
				const parent = clusterGroup.getVisibleParent(marker) || marker;
				if (parent && parent.spiderfy) {
					// If inside a cluster, spiderfy to reveal without changing zoom
					parent.spiderfy();
				}
				marker.openPopup();
			})();
			setNavButtonsState();
		}

		function goPrev() {
			if (currentIndex <= 0) return;
			updatePanel(currentIndex - 1);
		}
		function goNext() {
			if (currentIndex === -1) { updatePanel(0); return; }
			updatePanel(currentIndex + 1);
		}

		if (prevBtn && nextBtn) {
			prevBtn.addEventListener('click', goPrev);
			nextBtn.addEventListener('click', goNext);
		}

		// Helper: compute path latlngs based on visible parents (clusters/markers)
		function computeVisiblePathLatLngs() {
			if (!markers.length) return [];
			const latlngs = markers.map(m => {
				const parent = clusterGroup.getVisibleParent(m.marker) || m.marker;
				return parent.getLatLng ? parent.getLatLng() : m.marker.getLatLng();
			});
			// Collapse consecutive duplicates (when multiple points share same cluster)
			const deduped = [];
			for (let i = 0; i < latlngs.length; i++) {
				const cur = latlngs[i];
				const prev = deduped[deduped.length - 1];
				if (!prev || prev.lat !== cur.lat || prev.lng !== cur.lng) {
					deduped.push(cur);
				}
			}
			return deduped;
		}

		// Update path to reflect current clustering/zoom and toggle
		function updatePath() {
			if (!pathLine) return; // nothing to draw
			// Respect checkbox toggle if present
			if (toggleEl && !toggleEl.checked) {
				if (map.hasLayer(pathLine)) map.removeLayer(pathLine);
				if (pathArrows && map.hasLayer(pathArrows)) map.removeLayer(pathArrows);
				return;
			}
			const latlngs = computeVisiblePathLatLngs();
			// Hide when fewer than two distinct visible waypoints
			if (latlngs.length < 2) {
				if (map.hasLayer(pathLine)) map.removeLayer(pathLine);
				if (pathArrows && map.hasLayer(pathArrows)) map.removeLayer(pathArrows);
				return;
			}
			pathLine.setLatLngs(latlngs);
			if (!map.hasLayer(pathLine)) map.addLayer(pathLine);
			if (pathArrows) {
				// Keep arrows in sync with updated polyline
				if (typeof pathArrows.setPaths === 'function') {
					pathArrows.setPaths(pathLine);
					if (!map.hasLayer(pathArrows)) map.addLayer(pathArrows);
				} else {
					if (map.hasLayer(pathArrows)) map.removeLayer(pathArrows);
					if (L.polylineDecorator) {
						pathArrows = L.polylineDecorator(pathLine, arrowOptions);
						map.addLayer(pathArrows);
					}
				}
			}
		}

		// Handle path visibility via checkbox and URL param
		const urlParams = new URLSearchParams(window.location.search);
		const paramPath = urlParams.get('path'); // "1" to show, "0" to hide
		let showPath = true;
		if (paramPath === '0') showPath = false;
		if (paramPath === '1') showPath = true;

		if (toggleEl) {
			// Initialize checkbox state: from URL param or default true
			toggleEl.checked = showPath;
			// Apply initial state and wire events
			updatePath();
			toggleEl.addEventListener('change', updatePath);
		} else {
			// Fallback: respect URL param even if checkbox not found
			updatePath();
		}

		// Keep path in sync with clustering/zoom interactions
		if (pathLine) {
			map.on('zoomend', updatePath);
			map.on('moveend', updatePath);
			clusterGroup.on('animationend', updatePath);
			clusterGroup.on('spiderfied', updatePath);
			clusterGroup.on('unspiderfied', updatePath);
			clusterGroup.on('clusterclick', () => {
				// Let zoom or spiderfy settle first
				setTimeout(updatePath, 0);
			});
		}

		// Initialize panel without selecting a point
		counterEl.textContent = `0/${markers.length}`;
		eventEl.textContent = 'Typ';
		placeEl.textContent = 'Ort';
		dateEl.textContent = 'Datum';
		setNavButtonsState();
		// Ensure initial path reflects current view
		updatePath();
	}

	fetch(DATA_URL)
		.then(r => r.json())
		.then(main)
		.catch(err => {
			console.error("Fehler beim Laden der Personendaten:", err);
		});
})();
