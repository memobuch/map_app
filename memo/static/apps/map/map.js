// ===================================
// MEMO Enhanced Map - JavaScript
// Version 3.0 - Points Mode Only
// ===================================

(function() {
    'use strict';

    // ===== Configuration =====
    const CONFIG = {
        geojsonFile: '/memo/static/apps/map/EVENTS.json',
        mapCenter: [47.0707, 15.4395],
        mapZoom: 13,
        minZoom: 1,
        maxZoom: 28,
        colors: {
            voluntary_residence: '#2196F3',
            forced_residence: '#FF9800',
            imprisonment: '#F44336',
            flight: '#9C27B0',
            death: '#000000'
        }
    };

    // Define event types (for tag parsing)
    const EVENT_TYPES = new Set([
        'voluntary_residence',
        'forced_residence',
        'imprisonment',
        'flight',
        'death'
    ]);

    // ===== State =====
    const state = {
        map: null,
        geojsonData: null,
        
        // Layer
        markerCluster: null,
        
        // Filters
        activeEventTypes: new Set(['voluntary_residence', 'forced_residence', 'imprisonment', 'flight', 'death']),
        activeVictimCategories: new Set(), // Will be populated from data
        allVictimCategories: new Set(),
        
        // All point markers
        allPointMarkers: []
    };

    // ===== Initialization =====
    function init() {
        console.log('Initializing MEMO Map (v3.0 - Points Only)...');
        initializeMap();
        setupEventListeners();
        loadGeoJSONData();
    }

    // ===== Map Setup =====
    function initializeMap() {
        state.map = L.map('map', {
            center: CONFIG.mapCenter,
            zoom: CONFIG.mapZoom,
            minZoom: CONFIG.minZoom,
            maxZoom: CONFIG.maxZoom,
            zoomControl: true
        });

        // CartoDB Positron basemap
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: CONFIG.maxZoom
        }).addTo(state.map);

        // Initialize marker cluster
        state.markerCluster = L.markerClusterGroup({
            maxClusterRadius: 80,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            iconCreateFunction: createClusterIcon
        });

        // Handle cluster clicks - show multi-person popup
        state.markerCluster.on('clusterclick', function(cluster) {
            // Get all markers in this cluster
            const markers = cluster.layer.getAllChildMarkers();
            
            // Group by person_id to avoid duplicates
            const personsMap = new Map();
            
            markers.forEach(marker => {
                const personId = marker.options.personId;
                const eventType = marker.options.eventType;
                const victimCategories = marker.options.victimCategories || [];
                
                if (!personsMap.has(personId)) {
                    personsMap.set(personId, {
                        properties: marker.options.properties,
                        eventTypes: new Set(),
                        victimCategories: new Set()
                    });
                }
                
                const person = personsMap.get(personId);
                person.eventTypes.add(eventType);
                victimCategories.forEach(cat => person.victimCategories.add(cat));
            });
            
            // Show multi-person popup
            const popup = L.popup({
                maxWidth: 500,
                maxHeight: 400,
                className: 'cluster-popup'
            })
            .setLatLng(cluster.layer.getLatLng())
            .setContent(createClusterPopupContent(personsMap, cluster.layer.getLatLng()))
            .openOn(state.map);
        });

        // Add legend
        addLegend();
    }

    // ===== TAGS PARSING =====
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
                // This is a victim category - extract main category
                const mainCategory = tag.split(';')[0].trim();
                if (mainCategory) {
                    victimCategories.push(mainCategory);
                }
            }
        });

        return { eventTypes, victimCategories };
    }

    // ===== Load and Process Data =====
    async function loadGeoJSONData() {
        try {
            const response = await fetch(CONFIG.geojsonFile);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            state.geojsonData = await response.json();
            console.log('Loaded GeoJSON:', state.geojsonData.metadata);
            console.log('Total features:', state.geojsonData.features.length);
            
            // Extract all victim categories
            extractVictimCategories();
            
            // Create point markers
            createPointMarkers();
            
            // Setup victim category filters UI
            setupVictimCategoryFilters();
            
            // Initial render
            renderMarkers();
            updateStatistics();
            
        } catch (error) {
            console.error('Error loading data:', error);
            showError('Fehler beim Laden der Kartendaten.');
        }
    }

    // ===== Extract Unique Victim Categories =====
    function extractVictimCategories() {
        state.allVictimCategories.clear();
        state.activeVictimCategories.clear();

        state.geojsonData.features.forEach(feature => {
            const props = feature.properties;
            
            // Handle aggregated features
            if (props.events && Array.isArray(props.events)) {
                props.events.forEach(event => {
                    const parsed = parseTags(event.tags);
                    parsed.victimCategories.forEach(cat => {
                        state.allVictimCategories.add(cat);
                        state.activeVictimCategories.add(cat);
                    });
                });
            } else {
                // Handle single person features
                const parsed = parseTags(props.tags);
                parsed.victimCategories.forEach(cat => {
                    state.allVictimCategories.add(cat);
                    state.activeVictimCategories.add(cat);
                });
            }
        });
        
        console.log('Found victim categories:', Array.from(state.allVictimCategories));
    }

    // ===== Create Point Markers =====
    function createPointMarkers() {
        state.allPointMarkers = [];
        
        state.geojsonData.features.forEach(feature => {
            const coords = feature.geometry.coordinates;
            const props = feature.properties;
            
            if (!coords || coords.length !== 2) return;
            
            // Handle aggregated features (with events array) - create marker for EACH event
            if (props.events && Array.isArray(props.events)) {
                props.events.forEach(event => {
                    const parsed = parseTags(event.tags);
                    
                    // Create a marker for each event type
                    parsed.eventTypes.forEach(eventType => {
                        const marker = L.marker([coords[1], coords[0]], {
                            icon: createPointIcon(eventType)
                        });
                        
                        // Store metadata on marker
                        marker.options.personId = event.person_id;
                        marker.options.eventType = eventType;
                        marker.options.victimCategories = parsed.victimCategories;
                        marker.options.properties = event;
                        
                        // Bind popup
                        marker.bindPopup(createPointPopupContent(event, eventType));
                        
                        state.allPointMarkers.push({
                            marker: marker,
                            eventType: eventType,
                            victimCategories: parsed.victimCategories
                        });
                    });
                });
            } else {
                // Handle single person features
                const parsed = parseTags(props.tags);
                
                parsed.eventTypes.forEach(eventType => {
                    const marker = L.marker([coords[1], coords[0]], {
                        icon: createPointIcon(eventType)
                    });
                    
                    marker.options.personId = props.person_id;
                    marker.options.eventType = eventType;
                    marker.options.victimCategories = parsed.victimCategories;
                    marker.options.properties = props;
                    
                    marker.bindPopup(createPointPopupContent(props, eventType));
                    
                    state.allPointMarkers.push({
                        marker: marker,
                        eventType: eventType,
                        victimCategories: parsed.victimCategories
                    });
                });
            }
        });
        
        console.log(`Created ${state.allPointMarkers.length} point markers`);
    }

    // ===== Render Markers =====
    function renderMarkers() {
        state.markerCluster.clearLayers();
        
        const filteredMarkers = state.allPointMarkers.filter(item => {
            // Check event type
            if (!state.activeEventTypes.has(item.eventType)) return false;
            
            // Check victim category
            if (state.activeVictimCategories.size === 0) return true;
            
            return item.victimCategories.some(cat => state.activeVictimCategories.has(cat));
        });
        
        console.log(`Rendering ${filteredMarkers.length} point markers`);
        
        filteredMarkers.forEach(item => {
            state.markerCluster.addLayer(item.marker);
        });
        
        // Add cluster layer to map
        if (!state.map.hasLayer(state.markerCluster)) {
            state.map.addLayer(state.markerCluster);
        }
    }

    // ===== Create Icons =====
    function createPointIcon(eventType) {
        const color = CONFIG.colors[eventType] || '#666';
        const svgIcon = `
            <svg width="20" height="20" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="${color}" stroke="#fff" stroke-width="2"/>
                <circle cx="12" cy="12" r="4" fill="#fff" opacity="0.8"/>
            </svg>
        `;
        
        return L.divIcon({
            html: svgIcon,
            className: `custom-marker marker-${eventType}`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
            popupAnchor: [0, -10]
        });
    }

    function createClusterIcon(cluster) {
        const count = cluster.getChildCount();
        let size = 'small';
        
        if (count > 100) size = 'large';
        else if (count > 20) size = 'medium';

        return L.divIcon({
            html: `<div><span>${count}</span></div>`,
            className: `marker-cluster marker-cluster-${size}`,
            iconSize: L.point(40, 40)
        });
    }

    // ===== Popup Content =====
    function createClusterPopupContent(personsMap, latlng) {
        const personsArray = Array.from(personsMap.values());
        const personCount = personsArray.length;
        
        // Get place name from first person
        const placeName = personsArray[0]?.properties?.place_name || 'Unbekannter Ort';
        
        // Count total events
        let totalEvents = 0;
        personsArray.forEach(person => {
            totalEvents += person.eventTypes.size;
        });
        
        let html = '<div class="popup-content cluster-popup-content">';
        
        // Header with summary
        html += '<div class="popup-header">';
        html += `<div class="popup-name" style="font-size: 1.1rem;">${escapeHtml(placeName)}</div>`;
        html += `<div class="popup-summary" style="margin-top: 0.5rem; padding: 0.5rem; background: #f5f5f0; border-left: 4px solid #1a1a1a;">`;
        html += `<strong>${personCount}</strong> Person${personCount !== 1 ? 'en' : ''} • `;
        html += `<strong>${totalEvents}</strong> Ereignis${totalEvents !== 1 ? 'se' : ''}`;
        html += `</div>`;
        html += '</div>';
        
        // Persons list - compact and scrollable
        html += '<div class="popup-section">';
        html += '<div class="popup-label">Personen an diesem Ort</div>';
        html += '<div class="persons-list">';
        
        // Sort persons by name
        personsArray.sort((a, b) => {
            const nameA = a.properties.person_name || '';
            const nameB = b.properties.person_name || '';
            return nameA.localeCompare(nameB, 'de');
        });
        
        personsArray.forEach((person, index) => {
            const props = person.properties;
            const name = props.person_name || 'Unbekannt';
            const birthYear = props.birth_date ? props.birth_date.split('.').pop() : '?';
            const deathYear = props.death_date ? props.death_date.split('.').pop() : '?';
            const gamsLink = props.gams_link || '';
            
            // Event types for this person
            const eventTypesList = Array.from(person.eventTypes)
                .map(type => getEventTypeLabel(type))
                .join(', ');
            
            // Victim categories
            const victimCats = Array.from(person.victimCategories).join(', ');
            
            html += '<div class="person-item">';
            html += `<div class="person-name">`;
            
            if (gamsLink) {
                html += `<a href="${escapeHtml(gamsLink)}" target="_blank" rel="noopener" class="person-link">`;
                html += `${escapeHtml(name)}`;
                html += `</a>`;
            } else {
                html += `<strong>${escapeHtml(name)}</strong>`;
            }
            
            html += ` <span class="person-years">(${birthYear}–${deathYear})</span>`;
            html += `</div>`;
            
            html += `<div class="person-details">`;
            html += `<span class="detail-item">${escapeHtml(eventTypesList)}</span>`;
            if (victimCats) {
                html += ` • <span class="detail-item victim-cat">${escapeHtml(victimCats)}</span>`;
            }
            html += `</div>`;
            
            html += '</div>';
            
            // Add separator between persons (except last)
            if (index < personsArray.length - 1) {
                html += '<div class="person-separator"></div>';
            }
        });
        
        html += '</div>'; // persons-list
        html += '</div>'; // popup-section
        
        html += '</div>';
        return html;
    }

    function createPointPopupContent(props, eventType) {
        const name = props.person_name || 'Unbekannt';
        const eventTypeLabel = getEventTypeLabel(eventType);
        const placeName = props.place_name || 'Unbekannt';
        const date = props.date || 'Datum unbekannt';
        const birthDate = props.birth_date || 'Unbekannt';
        const deathDate = props.death_date || '';
        const gamsLink = props.gams_link || '';
        
        // Parse victim categories from tags
        const parsed = parseTags(props.tags);

        let html = '<div class="popup-content">';
        
        html += '<div class="popup-header">';
        html += `<div class="popup-name">${escapeHtml(name)}</div>`;
        html += `<div class="popup-event-type">${escapeHtml(eventTypeLabel)}</div>`;
        html += '</div>';

        html += '<div class="popup-section">';
        html += '<div class="popup-label">Ort</div>';
        html += `<div class="popup-value">${escapeHtml(placeName)}</div>`;
        if (date !== 'Datum unbekannt') {
            html += `<div class="popup-value" style="font-size: 0.85rem; color: #666; margin-top: 0.25rem;">${escapeHtml(date)}</div>`;
        }
        html += '</div>';

        html += '<div class="popup-section">';
        html += '<div class="popup-label">Lebensdaten</div>';
        html += `<div class="popup-value">Geboren: ${escapeHtml(birthDate)}</div>`;
        if (deathDate) {
            html += `<div class="popup-value">Gestorben: ${escapeHtml(deathDate)}</div>`;
        }
        html += '</div>';

        if (parsed.victimCategories && parsed.victimCategories.length > 0) {
            html += '<div class="popup-section">';
            html += '<div class="popup-label">Opferkategorie</div>';
            html += `<div class="popup-value">${escapeHtml(parsed.victimCategories.join(', '))}</div>`;
            html += '</div>';
        }

        if (gamsLink) {
            html += `<a href="${escapeHtml(gamsLink)}" target="_blank" rel="noopener" class="popup-link">Mehr erfahren →</a>`;
        }

        html += '</div>';
        return html;
    }

    // ===== Legend =====
    function addLegend() {
        const legend = L.control({ position: 'bottomright' });
        
        legend.onAdd = function() {
            const div = L.DomUtil.create('div', 'map-legend');

            div.innerHTML = `
                <div class="legend-title">Ereignistypen</div>
                <div class="legend-item">
                    <span class="legend-color" style="background: ${CONFIG.colors.voluntary_residence}"></span>
                    Freiwillige Wohnadresse
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: ${CONFIG.colors.forced_residence}"></span>
                    Erzwungene Wohnadresse
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: ${CONFIG.colors.imprisonment}"></span>
                    Haft
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: ${CONFIG.colors.flight}"></span>
                    Flucht
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: ${CONFIG.colors.death}"></span>
                    Tod
                </div>
            `;
            return div;
        };
        
        legend.addTo(state.map);
    }

    // ===== Statistics =====
    function updateStatistics() {
        if (!state.geojsonData) return;
        
        const metadata = state.geojsonData.metadata;
        
        document.getElementById('total-persons').textContent = 
            (metadata.total_persons || 0).toLocaleString('de-DE');
        
        document.getElementById('total-events').textContent = 
            (metadata.total_location_events || 0).toLocaleString('de-DE');
        
        // Calculate visible events
        const visibleCount = state.allPointMarkers.filter(item => {
            if (!state.activeEventTypes.has(item.eventType)) return false;
            if (state.activeVictimCategories.size === 0) return true;
            return item.victimCategories.some(cat => state.activeVictimCategories.has(cat));
        }).length;
        
        document.getElementById('visible-events').textContent = visibleCount.toLocaleString('de-DE');
    }

    // ===== Event Listeners =====
    function setupEventListeners() {
        // Event type filters
        document.querySelectorAll('.filter-checkbox input[type="checkbox"]').forEach(checkbox => {
            if (checkbox.dataset.eventType) {
                checkbox.addEventListener('change', (e) => {
                    toggleEventTypeFilter(e.target.dataset.eventType, e.target.checked);
                });
            }
        });
    }

    function setupVictimCategoryFilters() {
        const container = document.getElementById('victim-category-filters');
        if (!container) return;
        
        // Sort categories alphabetically
        const sortedCategories = Array.from(state.allVictimCategories).sort();
        
        sortedCategories.forEach(category => {
            const label = document.createElement('label');
            label.className = 'filter-checkbox';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.dataset.victimCategory = category;
            
            checkbox.addEventListener('change', (e) => {
                toggleVictimCategoryFilter(category, e.target.checked);
            });
            
            const span = document.createElement('span');
            span.className = 'filter-label';
            span.textContent = category;
            
            label.appendChild(checkbox);
            label.appendChild(span);
            container.appendChild(label);
        });
    }

    function toggleEventTypeFilter(eventType, isChecked) {
        if (isChecked) {
            state.activeEventTypes.add(eventType);
        } else {
            state.activeEventTypes.delete(eventType);
        }
        renderMarkers();
        updateStatistics();
    }

    function toggleVictimCategoryFilter(category, isChecked) {
        if (isChecked) {
            state.activeVictimCategories.add(category);
        } else {
            state.activeVictimCategories.delete(category);
        }
        renderMarkers();
        updateStatistics();
    }

    // ===== Utility Functions =====
    function getEventTypeLabel(type) {
        const labels = {
            voluntary_residence: 'Freiwillige Wohnadresse',
            forced_residence: 'Erzwungene Wohnadresse',
            imprisonment: 'Haft',
            flight: 'Flucht',
            death: 'Tod'
        };
        return labels[type] || type;
    }

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

    function showError(message) {
        alert(message);
    }

    // ===== Initialize =====
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();