// Persons Map: visualize a single person's stations in chronological order

(function () {
	const DATA_URL = 
		"/memo/static/apps/persons_map/test_person.json";

	// Fallback colors for victim categories when vocab doesn't provide a color
	const DEFAULT_VICTIM_COLORS = {
		"widerstand;politisch": "#e41a1c",
		"widerstand;religiös": "#e7298a",
		"widerstand;individuell": "#fb9a99",
		"widerstand;deserteure": "#fdbf6f",
		"zeugenjehovas": "#bc80bd",
		"jüdischeopfer;jüdisch": "#377eb8",
		"jüdischeopfer;als Jude verfolgt": "#1f78b4",
		"roma": "#984ea3",
		"euthanasieopfer": "#ff7f00",
		"homosexuelleopfer": "#4daf4a",
		"opfernsjustiz": "#ffff33",
		"asoziale": "#a65628",
		"spanienkämpfer": "#f781bf",
		"zwangsarbeiter": "#999999",
		"alliierte": "#66c2a5",
		"zivileopfer": "#8da0cb"
	};

	// Map init 
	const map = L.map("map");
	L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
		attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
		subdomains: 'abcd',
		maxZoom: 28
	}).addTo(map);

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
		// If multiple death, keep by date ascending and take last position
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

		// We now color each point by its event_type, not victim category.
		// No need to derive a single person-level color.

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

			// Use circle markers to exactly represent coordinates (drop symbols)
			const m = L.circleMarker(latlng, {
				radius: 10,
				color: color,
				weight: 2,
				fillColor: color,
				fillOpacity: 0.85,
				interactive: true
			}).addTo(map);
			// Enumerate stations: add a small permanent tooltip with the sequence number
			m.bindTooltip(String(idx + 1), {
				permanent: true,
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
		});

		// Draw polyline connecting stations in order
		if (pathLatLngs.length >= 2) {
			L.polyline(pathLatLngs, { color: "#333", weight: 2, opacity: 0.8 }).addTo(map);
		}

		// Legend: Leaflet control so it persists reliably
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

		let currentIndex = -1; // no selection initially

		// Set dynamic panel title to person name
		if (titleEl) {
			titleEl.textContent = metadata?.person_name || 'Person';
		}

		function setNavButtonsState() {
			if (!prevBtn || !nextBtn) return;
			const noSelection = currentIndex === -1;
			const atStart = currentIndex <= 0;
			const atEnd = currentIndex >= (markers.length - 1);
			prevBtn.style.display = (noSelection || atStart) ? 'none' : '';
			nextBtn.style.display = (markers.length === 0 || atEnd) ? 'none' : '';
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
			marker.openPopup();
			map.panTo(marker.getLatLng());
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

		// Initialize panel without selecting a point
		counterEl.textContent = `0/${markers.length}`;
		eventEl.textContent = '—';
		placeEl.textContent = '—';
		dateEl.textContent = '—';
		setNavButtonsState();
	}

	fetch(DATA_URL)
		.then(r => r.json())
		.then(main)
		.catch(err => {
			console.error("Fehler beim Laden der Personendaten:", err);
		});
})();
