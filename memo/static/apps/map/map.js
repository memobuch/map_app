/**
 * MEMO Digitales Memobuch - Enhanced Public Map
 * Version 2.1 - REFACTORED for Unified Tags Structure
 * 
 * MAJOR CHANGES:
 * - Supports unified "tags" array (event_types + victim_categories combined)
 * - Handles both aggregated features (with events array) and single-person features
 * - Separates event_types from victim_categories using predefined EVENT_TYPES list
 * - Maintains dual view modes: Aggregate (sized circles) + Point view
 * - Multi-dimensional filtering (event type + victim category)
 */

(function() {
    'use strict';

    // ===== Configuration =====
    const CONFIG = {
        geojsonFile: '/memo/static/apps/map/EVENTS.json',
        mapCenter: [47.0707, 15.4395], // Graz
        mapZoom: 7,
        minZoom: 5,
        maxZoom: 18,
        clusterRadius: 50,
        // Proportional symbol scaling
        circleBaseRadius: 5,
        circleScaleFactor: 3,
        // Colors
        colors: {
            voluntary_residence: '#2196F3',
            forced_residence: '#FF9800',
            imprisonment: '#F44336',
            flight: '#9C27B0',
            death: '#000000'
        }
    };

    // ===== PREDEFINED EVENT TYPES =====
    // This list determines what is an event_type vs victim_category
    const EVENT_TYPES = new Set([
        'voluntary_residence',
        'forced_residence',
        'imprisonment',
        'flight',
        'death'
    ]);

    // ===== State Management =====
    const state = {
        map: null,
        geojsonData: null,
        viewMode: 'aggregate', // 'aggregate' or 'points'
        
        // Layers
        aggregateLayer: null,
        pointsMarkerCluster: null,
        
        // Aggregated data
        locationAggregates: new Map(),
        
        // Filters
        activeEventTypes: new Set(['voluntary_residence', 'forced_residence', 'imprisonment', 'flight', 'death']),
        activeVictimCategories: new Set(), // Will be populated from data
        allVictimCategories: new Set(),
        
        // Original point markers
        allPointMarkers: []
    };

    // ===== Initialization =====
    function init() {
        console.log('Initializing MEMO Enhanced Map (v2.1 - Unified Tags)...');
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

        // Initialize layers
        state.aggregateLayer = L.layerGroup().addTo(state.map);
        
        state.pointsMarkerCluster = L.markerClusterGroup({
            maxClusterRadius: CONFIG.clusterRadius,
            spiderfyOnMaxZoom: false, // DISABLED: Show popup instead
            showCoverageOnHover: false,
            zoomToBoundsOnClick: false, // DISABLED: Handle click manually
            iconCreateFunction: createClusterIcon
        });
        
        // Custom cluster click handler - show multi-person popup instead of spiderfying
        state.pointsMarkerCluster.on('clusterclick', function(e) {
            const cluster = e.layer;
            const markers = cluster.getAllChildMarkers();
            
            // Group markers by person to avoid duplicates
            const personsMap = new Map();
            markers.forEach(marker => {
                const item = state.allPointMarkers.find(m => m.marker === marker);
                if (item && item.properties) {
                    const personId = item.properties.person_id;
                    if (!personsMap.has(personId)) {
                        personsMap.set(personId, {
                            properties: item.properties,
                            eventTypes: new Set(),
                            victimCategories: item.victimCategories
                        });
                    }
                    personsMap.get(personId).eventTypes.add(item.eventType);
                }
            });
            
            // Create and show multi-person popup
            const popup = L.popup({
                maxWidth: 500,
                maxHeight: 400,
                className: 'cluster-popup'
            })
            .setLatLng(cluster.getLatLng())
            .setContent(createClusterPopupContent(personsMap, cluster.getLatLng()))
            .openOn(state.map);
        });

        // Add legend
        addLegend();
    }

    // ===== TAGS PARSING =====
    /**
     * Parse unified tags array into event_types and victim_categories
     * Uses predefined EVENT_TYPES list to separate them
     */
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
                // This is a victim category - extract main category (split on semicolon)
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
            
            // Process features and extract categories
            processFeatures();
            
            // Extract all victim categories
            extractVictimCategories();
            
            // Process data
            aggregateDataByLocation();
            createPointMarkers();
            
            // Setup victim category filters UI
            setupVictimCategoryFilters();
            
            // Initial render
            updateVisualization();
            updateStatistics();
            
        } catch (error) {
            console.error('Error loading data:', error);
            showError('Fehler beim Laden der Kartendaten.');
        }
    }

    // ===== Process Features =====
    /**
     * Process features to normalize structure:
     * - Features with "events" array: aggregated (multiple persons at same location)
     * - Features without "events": single person
     */
    function processFeatures() {
        console.log('Processing features...');
        
        state.geojsonData.features.forEach((feature, idx) => {
            const props = feature.properties;
            
            // Check if this is an aggregated feature (has events array)
            if (props.events && Array.isArray(props.events)) {
                // Aggregated feature - we'll handle this in aggregate view
                console.log(`Feature ${idx}: Aggregated (${props.events.length} events)`);
            } else {
                // Single person feature - parse tags from feature level
                const parsed = parseTags(props.tags);
                console.log(`Feature ${idx}: Single person, event_types: ${parsed.eventTypes}, victims: ${parsed.victimCategories}`);
            }
        });
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

    // ===== Aggregate Data by Location =====
    /**
     * Aggregate features by location for the aggregate view
     * Option B: Show aggregated features as one marker with multiple persons
     */
    function aggregateDataByLocation() {
        state.locationAggregates.clear();
        
        state.geojsonData.features.forEach(feature => {
            const coords = feature.geometry.coordinates;
            const key = `${coords[0]},${coords[1]}`;
            const props = feature.properties;
            
            // Initialize aggregate if doesn't exist
            if (!state.locationAggregates.has(key)) {
                state.locationAggregates.set(key, {
                    coordinates: coords,
                    lat: coords[1],
                    lng: coords[0],
                    place_name: props.place_name || props.events?.[0]?.place_name || 'Unbekannter Ort',
                    events: [],
                    persons: new Set(),
                    eventTypeCounts: {
                        voluntary_residence: 0,
                        forced_residence: 0,
                        imprisonment: 0,
                        flight: 0,
                        death: 0
                    },
                    victimCategoryCounts: {}
                });
            }
            
            const aggregate = state.locationAggregates.get(key);
            
            // Handle aggregated features (with events array)
            if (props.events && Array.isArray(props.events)) {
                props.events.forEach(event => {
                    const parsed = parseTags(event.tags);
                    
                    // Add to aggregate
                    aggregate.events.push(event);
                    aggregate.persons.add(event.person_id);
                    
                    // Count event types
                    parsed.eventTypes.forEach(eventType => {
                        aggregate.eventTypeCounts[eventType]++;
                    });
                    
                    // Count victim categories
                    parsed.victimCategories.forEach(cat => {
                        aggregate.victimCategoryCounts[cat] = 
                            (aggregate.victimCategoryCounts[cat] || 0) + 1;
                    });
                });
            } else {
                // Handle single person features
                const parsed = parseTags(props.tags);
                
                aggregate.events.push(props);
                aggregate.persons.add(props.person_id);
                
                // Count event types
                parsed.eventTypes.forEach(eventType => {
                    aggregate.eventTypeCounts[eventType]++;
                });
                
                // Count victim categories
                parsed.victimCategories.forEach(cat => {
                    aggregate.victimCategoryCounts[cat] = 
                        (aggregate.victimCategoryCounts[cat] || 0) + 1;
                });
            }
        });
        
        console.log(`Aggregated ${state.locationAggregates.size} unique locations`);
    }

    // ===== Create Point Markers (for point view) =====
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
                    
                    // Create a marker for each event
                    parsed.eventTypes.forEach(eventType => {
                        const marker = L.marker([coords[1], coords[0]], {
                            icon: createPointIcon(eventType)
                        });
                        
                        marker.bindPopup(createPointPopupContent(event, eventType), {
                            maxWidth: 350,
                            className: 'custom-popup'
                        });
                        
                        state.allPointMarkers.push({
                            marker: marker,
                            eventType: eventType,
                            victimCategories: parsed.victimCategories,
                            properties: event
                        });
                    });
                });
            } else {
                // Handle single person features
                const parsed = parseTags(props.tags);
                
                // Create a marker for each event type
                parsed.eventTypes.forEach(eventType => {
                    const marker = L.marker([coords[1], coords[0]], {
                        icon: createPointIcon(eventType)
                    });
                    
                    marker.bindPopup(createPointPopupContent(props, eventType), {
                        maxWidth: 350,
                        className: 'custom-popup'
                    });
                    
                    state.allPointMarkers.push({
                        marker: marker,
                        eventType: eventType,
                        victimCategories: parsed.victimCategories,
                        properties: props
                    });
                });
            }
        });
        
        console.log(`Created ${state.allPointMarkers.length} point markers`);
    }

    // ===== Render Aggregate View (Proportional Circles) =====
    function renderAggregateView() {
        state.aggregateLayer.clearLayers();
        
        const filteredAggregates = getFilteredAggregates();
        console.log(`Rendering ${filteredAggregates.length} aggregate locations`);
        
        filteredAggregates.forEach(aggregate => {
            const totalEvents = calculateFilteredEventCount(aggregate);
            if (totalEvents === 0) return;
            
            // Determine dominant event type (for coloring)
            const dominantType = getDominantEventType(aggregate);
            const color = CONFIG.colors[dominantType];
            
            // Calculate radius (proportional to count)
            const radius = calculateCircleRadius(totalEvents);
            
            // Create circle marker
            const circle = L.circle([aggregate.lat, aggregate.lng], {
                radius: radius,
                fillColor: color,
                fillOpacity: 0.5,
                color: '#000',
                weight: 2,
                className: 'aggregate-circle'
            });
            
            circle.bindPopup(createAggregatePopupContent(aggregate), {
                maxWidth: 400,
                className: 'aggregate-popup'
            });
            
            // Tooltip on hover
            circle.bindTooltip(
                `<strong>${aggregate.place_name || 'Unbekannter Ort'}</strong><br>` +
                `${totalEvents} Ereignis${totalEvents !== 1 ? 'se' : ''}` +
                `<br>${aggregate.persons.size} Person${aggregate.persons.size !== 1 ? 'en' : ''}`,
                { direction: 'top', offset: [0, -10] }
            );
            
            state.aggregateLayer.addLayer(circle);
        });
    }

    // ===== Render Points View =====
    function renderPointsView() {
        state.pointsMarkerCluster.clearLayers();
        
        const filteredMarkers = state.allPointMarkers.filter(item => {
            // Check event type
            if (!state.activeEventTypes.has(item.eventType)) return false;
            
            // Check victim category
            if (state.activeVictimCategories.size === 0) return true;
            
            return item.victimCategories.some(cat => state.activeVictimCategories.has(cat));
        });
        
        console.log(`Rendering ${filteredMarkers.length} point markers`);
        
        filteredMarkers.forEach(item => {
            state.pointsMarkerCluster.addLayer(item.marker);
        });
    }

    // ===== Update Visualization Based on Current Mode =====
    function updateVisualization() {
        if (state.viewMode === 'aggregate') {
            // Switch to aggregate view
            state.map.removeLayer(state.pointsMarkerCluster);
            if (!state.map.hasLayer(state.aggregateLayer)) {
                state.map.addLayer(state.aggregateLayer);
            }
            renderAggregateView();
        } else {
            // Switch to points view
            state.map.removeLayer(state.aggregateLayer);
            if (!state.map.hasLayer(state.pointsMarkerCluster)) {
                state.map.addLayer(state.pointsMarkerCluster);
            }
            renderPointsView();
        }
        
        updateStatistics();
    }

    // ===== Filter Helpers =====
    function getFilteredAggregates() {
        return Array.from(state.locationAggregates.values()).filter(aggregate => {
            // Check if has any events of active types
            const hasActiveEventType = Object.keys(aggregate.eventTypeCounts).some(
                type => state.activeEventTypes.has(type) && aggregate.eventTypeCounts[type] > 0
            );
            
            if (!hasActiveEventType) return false;
            
            // Check victim categories
            if (state.activeVictimCategories.size === 0) return true;
            
            const aggregateCategories = Object.keys(aggregate.victimCategoryCounts);
            return aggregateCategories.some(cat => state.activeVictimCategories.has(cat));
        });
    }

    function calculateFilteredEventCount(aggregate) {
        let count = 0;
        state.activeEventTypes.forEach(type => {
            count += aggregate.eventTypeCounts[type] || 0;
        });
        return count;
    }

    function getDominantEventType(aggregate) {
        let maxCount = 0;
        let dominantType = 'voluntary_residence';
        
        state.activeEventTypes.forEach(type => {
            const count = aggregate.eventTypeCounts[type] || 0;
            if (count > maxCount) {
                maxCount = count;
                dominantType = type;
            }
        });
        
        return dominantType;
    }

    function calculateCircleRadius(count) {
        // Square root scaling for area (more visually accurate)
        return Math.sqrt(count) * CONFIG.circleScaleFactor * 100; // meters
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
    
    /**
     * Create popup content for clusters (multiple persons at same location)
     * Organized efficiently to show all persons without overwhelming the UI
     */
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
            const victimCats = person.victimCategories.length > 0 
                ? person.victimCategories.join(', ') 
                : '';
            
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

    // ===== Popup Content =====
    function createAggregatePopupContent(aggregate) {
        const totalEvents = calculateFilteredEventCount(aggregate);
        const personCount = aggregate.persons.size;
        
        let html = '<div class="popup-content aggregate-popup-content">';
        
        // Header
        html += '<div class="popup-header">';
        html += `<div class="popup-name" style="font-size: 1.1rem;">${escapeHtml(aggregate.place_name || 'Unbekannter Ort')}</div>`;
        html += '</div>';
        
        // Summary
        html += '<div class="popup-section">';
        html += `<div class="popup-summary">`;
        html += `<strong>${totalEvents}</strong> Ereignis${totalEvents !== 1 ? 'se' : ''} • `;
        html += `<strong>${personCount}</strong> Person${personCount !== 1 ? 'en' : ''}`;
        html += `</div>`;
        html += '</div>';
        
        // Event type breakdown
        html += '<div class="popup-section">';
        html += '<div class="popup-label">Ereignisse nach Typ</div>';
        html += '<div class="event-breakdown">';
        
        Object.entries(aggregate.eventTypeCounts).forEach(([type, count]) => {
            if (count > 0 && state.activeEventTypes.has(type)) {
                const label = getEventTypeLabel(type);
                const color = CONFIG.colors[type];
                html += `
                    <div class="event-type-row">
                        <span class="color-dot" style="background-color: ${color};"></span>
                        <span class="event-type-label">${label}:</span>
                        <span class="event-type-count">${count}</span>
                    </div>
                `;
            }
        });
        
        html += '</div></div>';
        
        // Victim categories
        if (Object.keys(aggregate.victimCategoryCounts).length > 0) {
            html += '<div class="popup-section">';
            html += '<div class="popup-label">Opferkategorien</div>';
            html += '<div class="victim-categories">';
            
            Object.entries(aggregate.victimCategoryCounts).forEach(([cat, count]) => {
                if (state.activeVictimCategories.size === 0 || state.activeVictimCategories.has(cat)) {
                    html += `<div class="category-tag">${escapeHtml(cat)} (${count})</div>`;
                }
            });
            
            html += '</div></div>';
        }
        
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
        let visibleCount = 0;
        if (state.viewMode === 'aggregate') {
            const filtered = getFilteredAggregates();
            filtered.forEach(agg => {
                visibleCount += calculateFilteredEventCount(agg);
            });
        } else {
            visibleCount = state.allPointMarkers.filter(item => {
                if (!state.activeEventTypes.has(item.eventType)) return false;
                if (state.activeVictimCategories.size === 0) return true;
                return item.victimCategories.some(cat => state.activeVictimCategories.has(cat));
            }).length;
        }
        
        document.getElementById('visible-events').textContent = visibleCount.toLocaleString('de-DE');
    }

    // ===== Event Listeners =====
    function setupEventListeners() {
        // View mode toggle
        document.querySelectorAll('.view-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.target.dataset.mode;
                switchViewMode(mode);
            });
        });
        
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

    function switchViewMode(mode) {
        if (mode === state.viewMode) return;
        
        state.viewMode = mode;
        
        // Update button states
        document.querySelectorAll('.view-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        
        updateVisualization();
    }

    function toggleEventTypeFilter(eventType, isChecked) {
        if (isChecked) {
            state.activeEventTypes.add(eventType);
        } else {
            state.activeEventTypes.delete(eventType);
        }
        updateVisualization();
    }

    function toggleVictimCategoryFilter(category, isChecked) {
        if (isChecked) {
            state.activeVictimCategories.add(category);
        } else {
            state.activeVictimCategories.delete(category);
        }
        updateVisualization();
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