(function() {
    'use strict';

    const CONFIG = {
        geojsonFile: '/memo/static/apps/map/sample_person_network.json',
        mapCenter: [47.0707, 15.4395],
        mapZoom: 5,
        minZoom: 3,
        maxZoom: 18,
        colors: {
            voluntary_residence: '#2196F3',
            forced_residence: '#FF9800',
            imprisonment: '#F44336',
            flight: '#9C27B0',
            death: '#000000'
        }
    };

    const EVENT_TYPES = new Set([
        'voluntary_residence',
        'forced_residence',
        'imprisonment',
        'flight',
        'death'
    ]);

    const state = {
        map: null,
        geojsonData: null,
        markers: [],
        connections: null,
        orderedPoints: [],
        currentIndex: 0
    };

    function init() {
        initializeMap();
        loadGeoJSONData();
    }

    function initializeMap() {
        state.map = L.map('map', {
            center: CONFIG.mapCenter,
            zoom: CONFIG.mapZoom,
            minZoom: CONFIG.minZoom,
            maxZoom: CONFIG.maxZoom,
            zoomControl: true
        });

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: CONFIG.maxZoom
        }).addTo(state.map);

        addLegend();
    }

    async function loadGeoJSONData() {
        try {
            const response = await fetch(CONFIG.geojsonFile);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            state.geojsonData = await response.json();
            updatePageTitle();
            renderPersonNetwork();
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }

    function renderPersonNetwork() {
        if (!state.geojsonData || !Array.isArray(state.geojsonData.features)) {
            return;
        }

        const points = state.geojsonData.features
            .filter(feature => feature.geometry && feature.geometry.type === 'Point')
            .map((feature, index) => ({
                index,
                coords: [feature.geometry.coordinates[1], feature.geometry.coordinates[0]],
                properties: feature.properties || {}
            }));

        const orderedPoints = orderPoints(points);
        state.orderedPoints = orderedPoints;

        addMarkers(orderedPoints);
        addConnections(orderedPoints);
        fitBounds(orderedPoints);
        addNavigationControl();
        setActiveStation(0);
    }

    function addMarkers(points) {
        state.markers = points.map((point, idx) => {
            const isStart = idx === 0;
            const marker = L.circleMarker(point.coords, {
                radius: isStart ? 13 : 10,
                weight: isStart ? 4 : 2,
                color: '#ffffff',
                className: isStart ? 'start-marker' : '',
                fillColor: getEventColor(point.properties.tags),
                fillOpacity: 0.95
            });

            marker.bindPopup(createPopupContent({ ...point, index: idx }));
            marker.on('click', () => setActiveStation(idx));
            marker.addTo(state.map);

            return marker;
        });
    }

    function addConnections(points) {
        if (points.length < 2) {
            return;
        }

        const latlngs = points.map(point => point.coords);
        state.connections = L.polyline(latlngs, {
            color: '#37474F',
            weight: 4,
            opacity: 0.75
        }).addTo(state.map);
    }

    function fitBounds(points) {
        if (!points.length) {
            return;
        }

        const bounds = L.latLngBounds(points.map(point => point.coords));
        state.map.fitBounds(bounds, { padding: [30, 30] });
    }

    function setActiveStation(index) {
        if (!state.markers.length || !state.markers[index]) return;

        state.currentIndex = index;
        const marker = state.markers[index];
        marker.openPopup();
        state.map.panTo(marker.getLatLng(), { animate: true });
    }

    function addNavigationControl() {
        if (state.markers.length < 2) return;

        const control = L.control({ position: 'bottomleft' });

        control.onAdd = () => {
            const container = L.DomUtil.create('div', 'station-nav');
            container.innerHTML = `
                <button type="button" class="station-nav__btn station-nav__btn--prev" aria-label="Vorherige Station">⟨</button>
                <button type="button" class="station-nav__btn station-nav__btn--next" aria-label="Nächste Station">⟩</button>
            `;

            L.DomEvent.on(container.querySelector('.station-nav__btn--prev'), 'click', (e) => {
                L.DomEvent.stopPropagation(e);
                goToStation(-1);
            });

            L.DomEvent.on(container.querySelector('.station-nav__btn--next'), 'click', (e) => {
                L.DomEvent.stopPropagation(e);
                goToStation(1);
            });

            return container;
        };

        control.addTo(state.map);
    }

    function goToStation(step) {
        if (!state.markers.length) return;
        const total = state.markers.length;
        const nextIndex = (state.currentIndex + step + total) % total;
        setActiveStation(nextIndex);
    }

    function getEventColor(tags = []) {
        const eventType = tags.find(tag => EVENT_TYPES.has(tag));
        return CONFIG.colors[eventType] || '#546E7A';
    }

    function updatePageTitle() {
        const titleElement = document.getElementById('person-network-title');
        if (!titleElement) return;

        const personName = state.geojsonData?.metadata?.person_name
            || state.geojsonData?.features?.[0]?.properties?.person_name
            || 'Unbekannte Person';

        titleElement.textContent = `Personenbezogene Netzwerk-Ansicht: ${personName}`;
    }

    function createPopupContent(point) {
        const props = point.properties;
        const { eventTypes, victimCategories } = parseTags(props.tags);

        const eventTypeLabel = eventTypes.map(type => state.geojsonData.vocab?.event_types?.[type] || type).join(', ');
        const victimLabels = victimCategories.map(cat => state.geojsonData.vocab?.victim_category_types?.[cat] || cat).join(', ');

        const subtitle = props.tags?.includes('voluntary_residence')
            ? 'Freiwillige Wohnadresse'
            : (eventTypeLabel || 'Ereignis');

        return `
            <div class="popup-content">
                <div class="popup-header">
                    <div class="popup-title">${props.person_name || 'Unbekannte Person'}</div>
                    <div class="popup-subtitle">${subtitle}</div>
                </div>
                <div class="popup-row"><strong>Ort:</strong> ${props.place_name || 'Unbekannt'}</div>
                <div class="popup-row"><strong>Datum:</strong> ${props.date || 'Ohne Datumsangabe'}</div>
                ${props.event_title ? `<div class="popup-row"><strong>Ereignis:</strong> ${props.event_title}</div>` : ''}
                ${props.event_description ? `<div class="popup-row">${props.event_description}</div>` : ''}
                ${victimLabels ? `<div class="popup-row"><strong>Kategorie:</strong> ${victimLabels}</div>` : ''}
            </div>
        `;
    }

    function parseTags(tags) {
        if (!tags || !Array.isArray(tags)) {
            return { eventTypes: [], victimCategories: [] };
        }

        const eventTypes = [];
        const victimCategories = [];

        tags.forEach(tag => {
            if (EVENT_TYPES.has(tag)) {
                eventTypes.push(tag);
            } else {
                const mainCategory = tag.split(';')[0].trim();
                if (mainCategory) {
                    victimCategories.push(mainCategory);
                }
            }
        });

        return { eventTypes, victimCategories };
    }

    function dateScore(value) {
        if (!value) return Number.MAX_SAFE_INTEGER;

        // Try to parse dd.mm.yyyy
        const dateMatch = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
        if (dateMatch) {
            const [_, d, m, y] = dateMatch;
            return new Date(`${y}-${m}-${d}`).getTime();
        }

        // Try yyyy
        const yearMatch = value.match(/^(\d{4})$/);
        if (yearMatch) {
            return new Date(`${value}-01-01`).getTime();
        }

        return Number.MAX_SAFE_INTEGER;
    }

    function orderPoints(points) {
        const withSortingMeta = points.map((point, index) => ({
            ...point,
            _sortScore: dateScore(point.properties.date),
            _originalIndex: index,
            _isDeath: (point.properties.tags || []).includes('death')
        }));

        const sortChronologically = (a, b) => {
            if (a._sortScore !== b._sortScore) {
                return a._sortScore - b._sortScore;
            }
            return a._originalIndex - b._originalIndex;
        };

        const nonDeathPoints = withSortingMeta
            .filter(point => !point._isDeath)
            .sort(sortChronologically);

        const deathPoints = withSortingMeta
            .filter(point => point._isDeath)
            .sort(sortChronologically);

        return [...nonDeathPoints, ...deathPoints].map(point => ({
            index: point.index,
            coords: point.coords,
            properties: point.properties
        }));
    }

    function addLegend() {
        const legend = L.control({ position: 'bottomright' });

        legend.onAdd = function() {
            const div = L.DomUtil.create('div', 'map-legend');
            div.innerHTML = `
                <div class="legend-title">Ereignistypen</div>
                ${Object.entries(CONFIG.colors).map(([key, color]) => `
                    <div class="legend-item">
                        <span class="legend-color" style="background:${color}"></span>
                        <span>${translateEventType(key)}</span>
                    </div>
                `).join('')}
            `;
            return div;
        };

        legend.addTo(state.map);
    }

    function translateEventType(key) {
        return {
            voluntary_residence: 'Freiwillige Wohnadresse',
            forced_residence: 'Erzwungene Wohnadresse',
            imprisonment: 'Haft',
            flight: 'Flucht',
            death: 'Tod'
        }[key] || key;
    }

    document.addEventListener('DOMContentLoaded', init);
})();
