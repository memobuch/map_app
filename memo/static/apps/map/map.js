// ===================================
// MEMO Enhanced Map - JavaScript
// Version 5.1.1 - Nested Vocab + Event Type Clusters + Text Fix
// ===================================

(function() {
    'use strict';

    // ===== Configuration =====
    const CONFIG = {
        geojsonFile: '/memo/static/apps/map/EVENTS.json',
        mapCenter: [47.0707, 15.4395],
        mapZoom: 13,
        minZoom: 1,
        maxZoom: 28
    };

    // Event type shape definitions (shapes stay in code, colors come from vocab)
    const EVENT_TYPE_SHAPES = {
        voluntary_residence: 'circle',
        forced_residence: 'square',
        imprisonment: 'diamond',
        flight: 'triangle',
        death: 'cross',
        unknown: 'hexagon'
    };

    // ===== State =====
    const state = {
        map: null,
        geojsonData: null,
        
        // Vocabulary from data (now contains nested objects with label & color)
        vocab: {
            event_types: {},
            victim_category_types: {}
        },
        
        // Derived lookups (computed from vocab)
        eventTypeKeys: new Set(),
        victimCategoryKeys: new Set(),
        
        // Validation
        unknownTags: new Set(),
        
        // Layer
        markerCluster: null,
        
        // Filters
        activeEventTypes: new Set(),
        activeVictimCategories: new Set(),
        allVictimCategories: new Set(),
        
        // All point markers
        allPointMarkers: []
    };

    // ===== Utility Functions for Vocab Access =====
    
    function getEventTypeLabel(type) {
        if (type === 'unknown') return 'Unbekannt';
        return state.vocab.event_types[type]?.label || type;
    }

    function getEventTypeColor(type) {
        if (type === 'unknown') return '#999999';
        return state.vocab.event_types[type]?.color || '#999999';
    }

    function getVictimCategoryLabel(key) {
        if (key === 'unknown') return 'Unbekannt';
        return state.vocab.victim_category_types[key]?.label || key;
    }

    function getVictimCategoryColor(key) {
        if (key === 'unknown') return '#999999';
        return state.vocab.victim_category_types[key]?.color || '#999999';
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

    // ===== Initialization =====
    function init() {
        console.log('Initializing MEMO Map (v5.1 - Nested Vocab + Event Type Clusters)...');
        initializeMap();
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
            spiderfyOnMaxZoom: false,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: false,
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
    }

    // ===== Vocabulary Processing =====
    function processVocabulary() {
        console.log('Processing vocabulary from data...');
        
        if (!state.geojsonData.vocab) {
            console.error('No vocab found in GeoJSON data!');
            return;
        }

        state.vocab = state.geojsonData.vocab;
        
        // Build event type lookups
        state.eventTypeKeys = new Set(Object.keys(state.vocab.event_types || {}));
        console.log('Event types from vocab:', Array.from(state.eventTypeKeys));
        
        // Build victim category lookups
        state.victimCategoryKeys = new Set(Object.keys(state.vocab.victim_category_types || {}));
        console.log('Victim category types from vocab:', Array.from(state.victimCategoryKeys));
        
        // Initialize active filters with all event types (including unknown)
        state.activeEventTypes = new Set([...state.eventTypeKeys, 'unknown']);
        
        // Log colors for verification
        console.log('Event type colors loaded from vocab');
        console.log('Victim category colors loaded from vocab');
    }

    // ===== Tag Classification & Validation =====
    function classifyTag(tag) {
        if (state.eventTypeKeys.has(tag)) {
            return { type: 'event_type', key: tag };
        }
        if (state.victimCategoryKeys.has(tag)) {
            return { type: 'victim_category', key: tag };
        }
        
        // Validation: tag not in vocab
        if (!state.unknownTags.has(tag)) {
            state.unknownTags.add(tag);
            console.warn(`⚠️ Unknown tag: "${tag}" not found in vocab`);
        }
        
        return { type: 'unknown', key: tag };
    }

    function parseTags(tags) {
        if (!tags || !Array.isArray(tags)) {
            return { eventTypes: [], victimCategories: [] };
        }

        const eventTypes = [];
        const victimCategories = [];

        tags.forEach(tag => {
            const classified = classifyTag(tag);
            
            if (classified.type === 'event_type') {
                eventTypes.push(classified.key);
            } else if (classified.type === 'victim_category') {
                victimCategories.push(classified.key);
            }
            // Unknown tags are logged but not added to results
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
            
            // Process vocabulary FIRST
            processVocabulary();
            
            // Extract all victim categories from actual data
            extractVictimCategories();
            
            // Create point markers
            createPointMarkers();
            
            // Setup UI
            setupEventTypeFilters();
            setupVictimCategoryFilters();
            
            // Initial render
            renderMarkers();
            updateStatistics();
            
            // Add legend
            addLegend();
            
            // Report unknown tags if any
            if (state.unknownTags.size > 0) {
                console.warn(`⚠️ Total unknown tags found: ${state.unknownTags.size}`, Array.from(state.unknownTags));
            }
            
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
        
        console.log('Found victim categories in data:', Array.from(state.allVictimCategories));
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
                    
                    // Ensure at least one event type
                    const eventTypes = parsed.eventTypes.length > 0 ? parsed.eventTypes : ['unknown'];
                    
                    // Ensure at least one victim category
                    const victimCategories = parsed.victimCategories.length > 0 ? 
                        parsed.victimCategories : ['unknown'];
                    
                    // Create a marker for each event type
                    eventTypes.forEach(eventType => {
                        // Get color from FIRST victim category
                        const primaryVictimCategory = victimCategories[0];
                        const color = getVictimCategoryColor(primaryVictimCategory);
                        
                        const marker = L.marker([coords[1], coords[0]], {
                            icon: createPointIcon(eventType, color)
                        });
                        
                        // Store metadata on marker
                        marker.options.personId = event.person_id;
                        marker.options.eventType = eventType;
                        marker.options.victimCategories = victimCategories;
                        marker.options.properties = event;
                        
                        // Bind popup
                        marker.bindPopup(createPointPopupContent(event, eventType));
                        
                        state.allPointMarkers.push({
                            marker: marker,
                            eventType: eventType,
                            victimCategories: victimCategories
                        });
                    });
                });
            } else {
                // Handle single person features
                const parsed = parseTags(props.tags);
                
                // Ensure at least one event type
                const eventTypes = parsed.eventTypes.length > 0 ? parsed.eventTypes : ['unknown'];
                
                // Ensure at least one victim category
                const victimCategories = parsed.victimCategories.length > 0 ? 
                    parsed.victimCategories : ['unknown'];
                
                eventTypes.forEach(eventType => {
                    // Get color from FIRST victim category
                    const primaryVictimCategory = victimCategories[0];
                    const color = getVictimCategoryColor(primaryVictimCategory);
                    
                    const marker = L.marker([coords[1], coords[0]], {
                        icon: createPointIcon(eventType, color)
                    });
                    
                    marker.options.personId = props.person_id;
                    marker.options.eventType = eventType;
                    marker.options.victimCategories = victimCategories;
                    marker.options.properties = props;
                    
                    marker.bindPopup(createPointPopupContent(props, eventType));
                    
                    state.allPointMarkers.push({
                        marker: marker,
                        eventType: eventType,
                        victimCategories: victimCategories
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
            
            // Check victim category - keep visible if ANY active category matches
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
    function createPointIcon(eventType, color) {
        const shape = EVENT_TYPE_SHAPES[eventType] || 'circle';
        let svgIcon = '';
        
        // Different SVG shapes based on event type
        switch (shape) {
            case 'circle':
                svgIcon = `
                    <svg width="24" height="24" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="8" fill="${color}" stroke="#fff" stroke-width="2"/>
                    </svg>
                `;
                break;
            case 'square':
                svgIcon = `
                    <svg width="24" height="24" viewBox="0 0 24 24">
                        <rect x="4" y="4" width="16" height="16" fill="${color}" stroke="#fff" stroke-width="2"/>
                    </svg>
                `;
                break;
            case 'diamond':
                svgIcon = `
                    <svg width="24" height="24" viewBox="0 0 24 24">
                        <path d="M12 4 L20 12 L12 20 L4 12 Z" fill="${color}" stroke="#fff" stroke-width="2"/>
                    </svg>
                `;
                break;
            case 'triangle':
                svgIcon = `
                    <svg width="24" height="24" viewBox="0 0 24 24">
                        <path d="M12 4 L20 20 L4 20 Z" fill="${color}" stroke="#fff" stroke-width="2"/>
                    </svg>
                `;
                break;
            case 'cross':
                svgIcon = `
                    <svg width="24" height="24" viewBox="0 0 24 24">
                        <path d="M12 2 L12 10 L20 10 L20 14 L12 14 L12 22 L8 22 L8 14 L0 14 L0 10 L8 10 L8 2 Z" 
                              fill="${color}" stroke="#fff" stroke-width="1.5" transform="translate(2, 1)"/>
                    </svg>
                `;
                break;
            case 'hexagon':
                svgIcon = `
                    <svg width="24" height="24" viewBox="0 0 24 24">
                        <path d="M12 2 L20 7 L20 17 L12 22 L4 17 L4 7 Z" fill="${color}" stroke="#fff" stroke-width="2"/>
                    </svg>
                `;
                break;
            default:
                svgIcon = `
                    <svg width="24" height="24" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="8" fill="${color}" stroke="#fff" stroke-width="2"/>
                    </svg>
                `;
        }
        
        return L.divIcon({
            html: svgIcon,
            className: `custom-marker marker-${eventType}`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            popupAnchor: [0, -12]
        });
    }

    function createClusterIcon(cluster) {
        const markers = cluster.getAllChildMarkers();
        const count = markers.length;
        
        // Count events by type
        const eventTypeCounts = {};
        markers.forEach(marker => {
            const eventType = marker.options.eventType || 'unknown';
            eventTypeCounts[eventType] = (eventTypeCounts[eventType] || 0) + 1;
        });
        
        // Determine size class
        let size = 'small';
        let diameter = 40;
        if (count > 100) {
            size = 'large';
            diameter = 60;
        } else if (count > 20) {
            size = 'medium';
            diameter = 50;
        }
        
        // Generate SVG pie chart
        const svg = createPieChartSVG(eventTypeCounts, diameter, count);
        
        return L.divIcon({
            html: svg,
            className: `marker-cluster marker-cluster-${size} marker-cluster-eventtype`,
            iconSize: L.point(diameter, diameter)
        });
    }
    
    /**
     * Create SVG pie chart showing event type distribution
     */
    function createPieChartSVG(eventTypeCounts, diameter, totalCount) {
        const radius = diameter / 2;
        
        // Calculate total and percentages
        const total = Object.values(eventTypeCounts).reduce((sum, val) => sum + val, 0);
        const eventTypeCount = Object.keys(eventTypeCounts).length;
        
        // If only one event type, show as solid circle (not donut) with event type color
        if (eventTypeCount === 1) {
            const eventType = Object.keys(eventTypeCounts)[0];
            const color = getEventTypeColor(eventType);
            
            const svg = `
                <svg width="${diameter}" height="${diameter}" viewBox="0 0 ${diameter} ${diameter}">
                    <!-- Solid circle for single event type -->
                    <circle cx="${radius}" cy="${radius}" r="${radius - 2}" fill="${color}" stroke="white" stroke-width="2"/>
                    <!-- Count text -->
                    <text x="${radius}" y="${radius}" 
                          text-anchor="middle" 
                          dominant-baseline="central" 
                          style="font-size: ${diameter * 0.35}px; font-weight: 700; font-family: 'Courier New', monospace; fill: white; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">
                        ${totalCount}
                    </text>
                </svg>
            `;
            return svg;
        }
        
        // Multiple event types - use donut style
        const innerRadius = radius * 0.65; // Larger inner circle to ensure text has comfortable padding
        
        // Sort by priority (death first, then others)
        const eventTypePriority = ['death', 'imprisonment', 'forced_residence', 'flight', 'voluntary_residence', 'unknown'];
        const sortedTypes = Object.keys(eventTypeCounts).sort((a, b) => {
            return eventTypePriority.indexOf(a) - eventTypePriority.indexOf(b);
        });
        
        // Generate pie slices
        let cumulativePercent = 0;
        let pathsHTML = '';
        
        sortedTypes.forEach(eventType => {
            const value = eventTypeCounts[eventType];
            const percent = value / total;
            
            if (percent > 0) {
                const startAngle = cumulativePercent * 2 * Math.PI;
                const endAngle = (cumulativePercent + percent) * 2 * Math.PI;
                
                const color = getEventTypeColor(eventType);
                pathsHTML += createArcPath(radius, innerRadius, startAngle, endAngle, color);
                
                cumulativePercent += percent;
            }
        });
        
        const svg = `
            <svg width="${diameter}" height="${diameter}" viewBox="0 0 ${diameter} ${diameter}">
                <!-- Pie slices -->
                ${pathsHTML}
                <!-- Center circle with count -->
                <circle cx="${radius}" cy="${radius}" r="${innerRadius - 1}" fill="white" stroke="#1a1a1a" stroke-width="2"/>
                <text x="${radius}" y="${radius}" 
                      text-anchor="middle" 
                      dominant-baseline="central" 
                      style="font-size: ${diameter * 0.28}px; font-weight: 700; font-family: 'Courier New', monospace; fill: #1a1a1a;">
                    ${totalCount}
                </text>
            </svg>
        `;
        
        return svg;
    }
    
    /**
     * Create SVG arc path for pie chart slice
     */
    function createArcPath(outerRadius, innerRadius, startAngle, endAngle, color) {
        // Convert angles to coordinates
        const x1 = outerRadius + outerRadius * Math.cos(startAngle - Math.PI / 2);
        const y1 = outerRadius + outerRadius * Math.sin(startAngle - Math.PI / 2);
        const x2 = outerRadius + outerRadius * Math.cos(endAngle - Math.PI / 2);
        const y2 = outerRadius + outerRadius * Math.sin(endAngle - Math.PI / 2);
        
        const x3 = outerRadius + innerRadius * Math.cos(endAngle - Math.PI / 2);
        const y3 = outerRadius + innerRadius * Math.sin(endAngle - Math.PI / 2);
        const x4 = outerRadius + innerRadius * Math.cos(startAngle - Math.PI / 2);
        const y4 = outerRadius + innerRadius * Math.sin(startAngle - Math.PI / 2);
        
        const largeArc = (endAngle - startAngle) > Math.PI ? 1 : 0;
        
        return `
            <path d="
                M ${x1} ${y1}
                A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2}
                L ${x3} ${y3}
                A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4}
                Z
            " fill="${color}" stroke="white" stroke-width="1.5"/>
        `;
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
            
            // Victim categories (use vocab labels)
            const victimCats = Array.from(person.victimCategories)
                .map(cat => getVictimCategoryLabel(cat))
                .join(', ');
            
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
            const labels = parsed.victimCategories.map(cat => getVictimCategoryLabel(cat)).join(', ');
            html += `<div class="popup-value">${escapeHtml(labels)}</div>`;
            html += '</div>';
        }

        if (gamsLink) {
            html += `<a href="${escapeHtml(gamsLink)}" target="_blank" rel="noopener" class="popup-link">Mehr erfahren →</a>`;
        }

        html += '</div>';
        return html;
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

    // ===== Event Type Filters UI Setup =====
    function setupEventTypeFilters() {
        const container = document.getElementById('event-type-filters');
        if (!container) {
            console.warn('Event type filters container not found');
            return;
        }
        
        // Clear existing content
        container.innerHTML = '';
        
        // Create filters from vocab
        state.eventTypeKeys.forEach(key => {
            const label = getEventTypeLabel(key);
            const shape = EVENT_TYPE_SHAPES[key] || 'circle';
            const sampleColor = '#666';
            
            const labelEl = document.createElement('label');
            labelEl.className = 'filter-checkbox';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.dataset.eventType = key;
            
            checkbox.addEventListener('change', (e) => {
                toggleEventTypeFilter(key, e.target.checked);
            });
            
            const span = document.createElement('span');
            span.className = 'filter-label';
            span.innerHTML = `${getShapeIcon(shape, sampleColor)} ${escapeHtml(label)}`;
            
            labelEl.appendChild(checkbox);
            labelEl.appendChild(span);
            container.appendChild(labelEl);
        });
        
        // Add unknown event type filter
        const labelEl = document.createElement('label');
        labelEl.className = 'filter-checkbox';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.dataset.eventType = 'unknown';
        
        checkbox.addEventListener('change', (e) => {
            toggleEventTypeFilter('unknown', e.target.checked);
        });
        
        const span = document.createElement('span');
        span.className = 'filter-label';
        span.innerHTML = `${getShapeIcon('hexagon', '#999')} Unbekannt`;
        
        labelEl.appendChild(checkbox);
        labelEl.appendChild(span);
        container.appendChild(labelEl);
    }

    // ===== Victim Category Filters UI Setup =====
    function setupVictimCategoryFilters() {
        const container = document.getElementById('victim-category-filters');
        if (!container) return;
        
        // Clear existing
        container.innerHTML = '';
        
        // Sort categories alphabetically by label
        const sortedCategories = Array.from(state.allVictimCategories).sort((a, b) => {
            return getVictimCategoryLabel(a).localeCompare(getVictimCategoryLabel(b), 'de');
        });
        
        sortedCategories.forEach(key => {
            const label = getVictimCategoryLabel(key);
            const color = getVictimCategoryColor(key);
            
            const labelEl = document.createElement('label');
            labelEl.className = 'filter-checkbox';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.dataset.victimCategory = key;
            
            checkbox.addEventListener('change', (e) => {
                toggleVictimCategoryFilter(key, e.target.checked);
            });
            
            const span = document.createElement('span');
            span.className = 'filter-label';
            
            const colorIndicator = document.createElement('span');
            colorIndicator.className = 'color-indicator';
            colorIndicator.style.backgroundColor = color;
            
            span.appendChild(colorIndicator);
            span.appendChild(document.createTextNode(label));
            
            labelEl.appendChild(checkbox);
            labelEl.appendChild(span);
            container.appendChild(labelEl);
        });
    }

    // ===== Filter Toggle Functions =====
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

    // ===== Legend =====
    function addLegend() {
        const legend = L.control({ position: 'bottomright' });
        
        legend.onAdd = function() {
            const div = L.DomUtil.create('div', 'map-legend');

            // Event types legend (shapes)
            div.innerHTML = '<div class="legend-title">Ereignistypen (Formen)</div>';
            
            // Add all event types from vocab
            state.eventTypeKeys.forEach(key => {
                const label = getEventTypeLabel(key);
                const shape = EVENT_TYPE_SHAPES[key] || 'circle';
                const sampleColor = '#666'; // Neutral color for shape demo
                
                div.innerHTML += `
                    <div class="legend-item">
                        <span class="legend-shape">${getShapeIcon(shape, sampleColor)}</span>
                        <span>${escapeHtml(label)}</span>
                    </div>
                `;
            });
            
            // Add unknown event type
            div.innerHTML += `
                <div class="legend-item">
                    <span class="legend-shape">${getShapeIcon('hexagon', '#999')}</span>
                    <span>Unbekannt</span>
                </div>
            `;
            
            // Victim categories legend (colors)
            div.innerHTML += '<div class="legend-title" style="margin-top: 1rem;">Opferkategorien (Farben)</div>';
            
            // Show only categories that exist in the data
            Array.from(state.allVictimCategories).sort((a, b) => {
                return getVictimCategoryLabel(a).localeCompare(getVictimCategoryLabel(b), 'de');
            }).forEach(key => {
                const label = getVictimCategoryLabel(key);
                const color = getVictimCategoryColor(key);
                
                div.innerHTML += `
                    <div class="legend-item">
                        <span class="legend-color" style="background: ${color}"></span>
                        <span>${escapeHtml(label)}</span>
                    </div>
                `;
            });

            return div;
        };
        
        legend.addTo(state.map);
    }

    function getShapeIcon(shape, color) {
        let svg = '';
        switch (shape) {
            case 'circle':
                svg = `<svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="${color}" stroke="#fff" stroke-width="2"/></svg>`;
                break;
            case 'square':
                svg = `<svg width="16" height="16" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" fill="${color}" stroke="#fff" stroke-width="2"/></svg>`;
                break;
            case 'diamond':
                svg = `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 4 L20 12 L12 20 L4 12 Z" fill="${color}" stroke="#fff" stroke-width="2"/></svg>`;
                break;
            case 'triangle':
                svg = `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 4 L20 20 L4 20 Z" fill="${color}" stroke="#fff" stroke-width="2"/></svg>`;
                break;
            case 'cross':
                svg = `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 2 L12 10 L20 10 L20 14 L12 14 L12 22 L8 22 L8 14 L0 14 L0 10 L8 10 L8 2 Z" fill="${color}" stroke="#fff" stroke-width="1.5" transform="translate(2, 1)"/></svg>`;
                break;
            case 'hexagon':
                svg = `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 2 L20 7 L20 17 L12 22 L4 17 L4 7 Z" fill="${color}" stroke="#fff" stroke-width="2"/></svg>`;
                break;
            default:
                svg = `<svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="${color}" stroke="#fff" stroke-width="2"/></svg>`;
        }
        return svg;
    }

    // ===== Initialize =====
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();