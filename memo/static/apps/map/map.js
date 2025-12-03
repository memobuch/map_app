/**
 * MEMO Digitales Memobuch - Map Visualization
 * Interactive map for Holocaust victim data from Graz
 */

(function() {
    'use strict';

    // ===== Configuration =====
    const CONFIG = {
        geojsonFile: '/memo/static/apps/map/EVENTS.json', // GeoJSON file name (place in same directory)
        mapCenter: [47.0707, 15.4395], // Graz coordinates
        mapZoom: 12,
        minZoom: 6,
        maxZoom: 18,
        clusterMaxZoom: 15, // Clusters disappear at this zoom level
        clusterRadius: 50 // Cluster radius in pixels
    };

    // ===== State Management =====
    const state = {
        map: null,
        markerClusterGroup: null,
        geojsonData: null,
        allMarkers: [],
        activeFilters: new Set(['voluntary_residence', 'forced_residence', 'imprisonment', 'flight', 'death'])
    };

    // ===== Initialization =====
    function init() {
        initializeMap();
        setupEventListeners();
        loadGeoJSONData();
    }

    // ===== Map Setup =====
    function initializeMap() {
        // Create map
        state.map = L.map('map', {
            center: CONFIG.mapCenter,
            zoom: CONFIG.mapZoom,
            minZoom: CONFIG.minZoom,
            maxZoom: CONFIG.maxZoom,
            zoomControl: true
        });

        // Add tile layer - using CartoDB Positron for clean B&W look
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: CONFIG.maxZoom
        }).addTo(state.map);

        // Initialize marker cluster group with custom styling
        state.markerClusterGroup = L.markerClusterGroup({
            maxClusterRadius: CONFIG.clusterRadius,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            disableClusteringAtZoom: CONFIG.clusterMaxZoom,
            iconCreateFunction: createClusterIcon
        });

        state.map.addLayer(state.markerClusterGroup);
    }

    // ===== Custom Cluster Icon =====
    function createClusterIcon(cluster) {
        const count = cluster.getChildCount();
        let size = 'small';
        
        if (count > 100) {
            size = 'large';
        } else if (count > 20) {
            size = 'medium';
        }

        return L.divIcon({
            html: `<div><span>${count}</span></div>`,
            className: `marker-cluster marker-cluster-${size}`,
            iconSize: L.point(40, 40)
        });
    }

    // ===== Load GeoJSON Data =====
    async function loadGeoJSONData() {
        try {
            const response = await fetch(CONFIG.geojsonFile);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            state.geojsonData = await response.json();
            
            // Update statistics
            updateStatistics();
            
            // Process and add markers
            processGeoJSONData();
            
        } catch (error) {
            console.error('Error loading GeoJSON:', error);
            alert('Fehler beim Laden der Kartendaten. Bitte stellen Sie sicher, dass die Datei "EVENTS.json" im gleichen Verzeichnis liegt.');
        }
    }

    // ===== Process GeoJSON and Create Markers =====
    function processGeoJSONData() {
        if (!state.geojsonData || !state.geojsonData.features) {
            console.error('Invalid GeoJSON data');
            return;
        }

        // Clear existing markers
        state.allMarkers = [];
        state.markerClusterGroup.clearLayers();

        // Create markers for each feature
        state.geojsonData.features.forEach((feature) => {
            const marker = createMarkerFromFeature(feature);
            if (marker) {
                state.allMarkers.push({
                    marker: marker,
                    eventType: feature.properties.event_type,
                    feature: feature
                });
            }
        });

        // Apply initial filter
        updateMarkerVisibility();
    }

    // ===== Create Individual Marker =====
    function createMarkerFromFeature(feature) {
        const props = feature.properties;
        const coords = feature.geometry.coordinates;

        // Validate coordinates
        if (!coords || coords.length !== 2 || isNaN(coords[0]) || isNaN(coords[1])) {
            console.warn('Invalid coordinates for feature:', feature);
            return null;
        }

        // Create custom icon based on event type
        const icon = createCustomIcon(props);

        // Create marker (note: Leaflet uses [lat, lng], GeoJSON uses [lng, lat])
        const marker = L.marker([coords[1], coords[0]], { icon: icon });

        // Create and bind popup
        const popupContent = createPopupContent(props);
        marker.bindPopup(popupContent, {
            maxWidth: 350,
            minWidth: 280,
            className: 'custom-popup'
        });

        return marker;
    }

    // ===== Create Custom Icon =====
    function createCustomIcon(properties) {
        const color = properties.marker_color || '#666666';
        const eventType = properties.event_type || 'unknown';
        
        // SVG icon with color
        const svgIcon = `
            <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" fill="${color}" stroke="#fff" stroke-width="2"/>
                <circle cx="12" cy="12" r="4" fill="#fff" opacity="0.8"/>
            </svg>
        `;

        return L.divIcon({
            html: svgIcon,
            className: `custom-marker marker-${eventType}`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            popupAnchor: [0, -12]
        });
    }

    // ===== Create Popup Content =====
    function createPopupContent(props) {
        const name = props.person_name || 'Unbekannt';
        const eventType = props.event_type_label || props.event_type || 'Unbekannt';
        const placeName = props.place_name || 'Unbekannt';
        const date = props.date || 'Datum unbekannt';
        const birthDate = props.birth_date || 'Unbekannt';
        const deathDate = props.death_date || 'Unbekannt';
        const victimCategories = props.victim_categories ? props.victim_categories.join(', ') : 'Keine Angabe';
        const gamsLink = props.gams_link || '';

        let html = '<div class="popup-content">';
        
        // Header
        html += '<div class="popup-header">';
        html += `<div class="popup-name">${escapeHtml(name)}</div>`;
        html += `<div class="popup-event-type">${escapeHtml(eventType)}</div>`;
        html += '</div>';

        // Location
        html += '<div class="popup-section">';
        html += '<div class="popup-label">Ort</div>';
        html += `<div class="popup-value">${escapeHtml(placeName)}</div>`;
        if (date && date !== 'Datum unbekannt') {
            html += `<div class="popup-value" style="font-size: 0.85rem; color: #666; margin-top: 0.25rem;">${escapeHtml(date)}</div>`;
        }
        html += '</div>';

        // Biographical data
        html += '<div class="popup-section">';
        html += '<div class="popup-label">Lebensdaten</div>';
        html += `<div class="popup-value">Geboren: ${escapeHtml(birthDate)}</div>`;
        if (deathDate && deathDate !== 'Unbekannt') {
            html += `<div class="popup-value">Gestorben: ${escapeHtml(deathDate)}</div>`;
        }
        html += '</div>';

        // Victim categories
        if (victimCategories !== 'Keine Angabe') {
            html += '<div class="popup-section">';
            html += '<div class="popup-label">Opferkategorie</div>';
            html += `<div class="popup-value">${escapeHtml(victimCategories)}</div>`;
            html += '</div>';
        }

        // Event description (if available)
        if (props.event_description) {
            html += '<div class="popup-section">';
            html += '<div class="popup-label">Beschreibung</div>';
            html += `<div class="popup-value">${escapeHtml(props.event_description)}</div>`;
            html += '</div>';
        }

        // GAMS link
        if (gamsLink) {
            html += `<a href="${escapeHtml(gamsLink)}" target="_blank" rel="noopener noreferrer" class="popup-link">Mehr erfahren →</a>`;
        }

        html += '</div>';

        return html;
    }

    // ===== Filter Management =====
    function updateMarkerVisibility() {
        state.markerClusterGroup.clearLayers();

        const visibleMarkers = state.allMarkers.filter(item => 
            state.activeFilters.has(item.eventType)
        );

        visibleMarkers.forEach(item => {
            state.markerClusterGroup.addLayer(item.marker);
        });

        // Update visible count
        document.getElementById('visible-events').textContent = visibleMarkers.length.toLocaleString('de-DE');
    }

    function toggleFilter(eventType, isChecked) {
        if (isChecked) {
            state.activeFilters.add(eventType);
        } else {
            state.activeFilters.delete(eventType);
        }
        
        updateMarkerVisibility();
    }

    // ===== Statistics =====
    function updateStatistics() {
        if (!state.geojsonData || !state.geojsonData.metadata) {
            return;
        }

        const metadata = state.geojsonData.metadata;
        
        document.getElementById('total-persons').textContent = 
            (metadata.total_persons || 0).toLocaleString('de-DE');
        
        document.getElementById('total-events').textContent = 
            (metadata.total_location_events || 0).toLocaleString('de-DE');
        
        document.getElementById('visible-events').textContent = 
            (metadata.total_location_events || 0).toLocaleString('de-DE');
    }

    // ===== Event Listeners =====
    function setupEventListeners() {
        // Filter checkboxes
        const checkboxes = document.querySelectorAll('.filter-checkbox input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const eventType = e.target.dataset.eventType;
                toggleFilter(eventType, e.target.checked);
            });
        });
    }

    // ===== Utility Functions =====
    function escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    // ===== Initialize on DOM Ready =====
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();