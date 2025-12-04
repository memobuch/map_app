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
        currentIndex: 0,
        navControl: null
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

        const sortedPoints = [...points]
            .sort((a, b) => {
                const aIsVoluntary = isVoluntaryResidence(a.properties.tags);
                const bIsVoluntary = isVoluntaryResidence(b.properties.tags);

                if (aIsVoluntary && !bIsVoluntary) return -1;
                if (!aIsVoluntary && bIsVoluntary) return 1;

                const dateDiff = dateScore(a.properties.date) - dateScore(b.properties.date);
                if (dateDiff !== 0) {
                    return dateDiff;
                }

                return a.index - b.index;
            });

        sortedPoints.forEach((point, idx) => {
            point.sequence = idx + 1;
            point.isStart = idx === 0;
        });

        state.orderedPoints = sortedPoints;
        state.currentIndex = 0;

        addMarkers(sortedPoints);
        addConnections(sortedPoints);
        addNavigation();
        fitBounds(sortedPoints);
    }

    function addMarkers(points) {
        state.markers = points.map(point => {
            const marker = L.circleMarker(point.coords, {
                radius: point.isStart ? 13 : 10,
                weight: point.isStart ? 4 : 2,
                color: point.isStart ? '#FFB300' : '#FFFFFF',
                className: point.isStart ? 'start-marker' : '',
                fillColor: getEventColor(point.properties.tags),
                fillOpacity: point.isStart ? 1 : 0.9
            });

            marker.bindPopup(createPopupContent(point));
            marker.addTo(state.map);

            addStationLabel(marker, point.sequence, point.isStart);
            marker.on('click', () => setCurrentIndex(point.sequence - 1));

            return marker;
        });

        openPopupAtIndex(state.currentIndex);
    }

    function addStationLabel(marker, number, isStart) {
        const label = L.divIcon({
            className: `station-label${isStart ? ' station-label--start' : ''}`,
            html: `<span>${number}</span>`,
            iconSize: [22, 22]
        });

        L.marker(marker.getLatLng(), { icon: label, interactive: false }).addTo(state.map);
    }

    function addConnections(points) {
        if (points.length < 2) {
            return;
        }

        const latlngs = points.map(point => point.coords);
        state.connections = L.polyline(latlngs, {
            color: '#546E7A',
            weight: 3,
            opacity: 0.6,
            dashArray: '6 4'
        }).addTo(state.map);
    }

    function fitBounds(points) {
        if (!points.length) {
            return;
        }

        const bounds = L.latLngBounds(points.map(point => point.coords));
        state.map.fitBounds(bounds, { padding: [30, 30] });
    }

    function getEventColor(tags = []) {
        const eventType = tags.find(tag => EVENT_TYPES.has(tag));
        return CONFIG.colors[eventType] || '#546E7A';
    }

    function isVoluntaryResidence(tags = []) {
        return Array.isArray(tags) && tags.includes('voluntary_residence');
    }

    function createPopupContent(point) {
        const props = point.properties;
        const { eventTypes, victimCategories } = parseTags(props.tags);

        const eventTypeLabel = eventTypes.map(type => state.geojsonData.vocab?.event_types?.[type] || type).join(', ');
        const victimLabels = victimCategories.map(cat => state.geojsonData.vocab?.victim_category_types?.[cat] || cat).join(', ');

        return `
                <div class="popup-content">
                    <div class="popup-header">
                        <div class="popup-title">${props.person_name || 'Unbekannte Person'}</div>
                        <div class="popup-subtitle">${eventTypeLabel || 'Ohne Typangabe'}</div>
                    </div>
                <div class="popup-row"><strong>Ort:</strong> ${props.place_name || 'Unbekannt'}</div>
                <div class="popup-row"><strong>Datum:</strong> ${props.date || 'Ohne Datumsangabe'}</div>
                ${props.event_title ? `<div class="popup-row"><strong>Ereignis:</strong> ${props.event_title}</div>` : ''}
                ${props.event_description ? `<div class="popup-row">${props.event_description}</div>` : ''}
                ${eventTypeLabel ? `<div class="popup-row"><strong>Typ:</strong> ${eventTypeLabel}</div>` : ''}
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

    function addNavigation() {
        if (state.navControl) {
            state.map.removeControl(state.navControl);
        }

        const NavControl = L.Control.extend({
            options: { position: 'bottomleft' },
            onAdd: function() {
                const container = L.DomUtil.create('div', 'nav-control');

                const prevButton = L.DomUtil.create('button', 'nav-button', container);
                prevButton.textContent = '← Zurück';
                prevButton.addEventListener('click', () => stepNavigation(-1));

                const status = L.DomUtil.create('div', 'nav-status', container);
                status.id = 'nav-status';

                const nextButton = L.DomUtil.create('button', 'nav-button', container);
                nextButton.textContent = 'Weiter →';
                nextButton.addEventListener('click', () => stepNavigation(1));

                updateNavStatus(status, prevButton, nextButton);

                L.DomEvent.disableClickPropagation(container);
                return container;
            }
        });

        state.navControl = new NavControl();
        state.navControl.addTo(state.map);
    }

    function stepNavigation(direction) {
        const nextIndex = state.currentIndex + direction;
        if (nextIndex < 0 || nextIndex >= state.orderedPoints.length) return;

        setCurrentIndex(nextIndex);
    }

    function setCurrentIndex(idx) {
        if (idx < 0 || idx >= state.orderedPoints.length) return;
        state.currentIndex = idx;
        openPopupAtIndex(idx);
        refreshNavStatus();
    }

    function openPopupAtIndex(idx) {
        const marker = state.markers[idx];
        if (!marker) return;

        marker.openPopup();
        state.map.panTo(marker.getLatLng(), { animate: true });
    }

    function refreshNavStatus() {
        const status = document.getElementById('nav-status');
        const buttons = document.querySelectorAll('.nav-button');
        if (!status || !buttons.length) return;

        const total = state.orderedPoints.length;
        status.textContent = `Station ${state.currentIndex + 1} von ${total}`;

        const [prevButton, nextButton] = buttons;
        prevButton.disabled = state.currentIndex === 0;
        nextButton.disabled = state.currentIndex >= total - 1;
    }

    function updateNavStatus(statusEl, prevButton, nextButton) {
        const total = state.orderedPoints.length;
        statusEl.textContent = `Station ${state.currentIndex + 1} von ${total}`;
        prevButton.disabled = state.currentIndex === 0;
        nextButton.disabled = state.currentIndex >= total - 1;
    }

    document.addEventListener('DOMContentLoaded', init);
})();
