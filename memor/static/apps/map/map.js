// ===================================
// MEMO Enhanced Map - JavaScript
// Version 7.0.0 - Environment-Aware Configuration
// Called via MEMO.initMap({ geoJsonUrl, personBaseUrl })
// ===================================

var MEMO = MEMO || {};

MEMO.initMap = function(options) {
    'use strict';

    // ===== Validate Required Options =====
    if (!options || !options.geoJsonUrl) {
        console.error('MEMO.initMap: "geoJsonUrl" is required. Usage: MEMO.initMap({ geoJsonUrl: "...", personBaseUrl: "..." })');
        return;
    }

    // ===== Configuration =====
    const CONFIG = {
        geoJsonUrl: options.geoJsonUrl,
        personBaseUrl: options.personBaseUrl || null, // e.g. 'http://localhost:18090/pub/memo/objects'
        mapCenter: [47.0707, 15.4395],
        mapZoom: 13,
        minZoom: 1,
        maxZoom: 28,
        // The single event type we display
        targetEventType: 'voluntary_residence'
    };

    console.log('MEMO.initMap called with:', {
        geoJsonUrl: CONFIG.geoJsonUrl,
        personBaseUrl: CONFIG.personBaseUrl || '(not set — person links disabled)'
    });

    // ===== State =====
    const state = {
        map: null,
        geojsonData: null,
        
        // Vocabulary from data (kept complete for reference)
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
        
        // Filters - only victim categories (no event type filtering)
        activeVictimCategories: new Set(),
        allVictimCategories: new Set(),
        
        // All point markers (only voluntary_residence)
        allPointMarkers: []
    };

    // ===== Utility Functions =====

    /**
     * Build a full URL to a person's page.
     * Returns null if personBaseUrl is not configured.
     * Constructs: {personBaseUrl}/{personId}/
     */
    function buildPersonUrl(personId) {
        if (!CONFIG.personBaseUrl || !personId) return null;
        // Strip trailing slash from base, then build clean URL
        const base = CONFIG.personBaseUrl.replace(/\/+$/, '');
        return `${base}/${personId}/`;
    }
    
    function getEventTypeLabel(type) {
        if (type === 'unknown') return 'Unbekannt';
        return state.vocab.event_types[type]?.label || type;
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
        console.log('Initializing MEMO Map (v7.0.0 - Environment-Aware)...');
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
            const markers = cluster.layer.getAllChildMarkers();
            
            // Group by person_id to avoid duplicates
            const personsMap = new Map();
            
            markers.forEach(marker => {
                const personId = marker.options.personId;
                const victimCategories = marker.options.victimCategories || [];
                
                if (!personsMap.has(personId)) {
                    personsMap.set(personId, {
                        properties: marker.options.properties,
                        victimCategories: new Set()
                    });
                }
                
                const person = personsMap.get(personId);
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
        
        // Build event type lookups (kept for tag classification)
        state.eventTypeKeys = new Set(Object.keys(state.vocab.event_types || {}));
        console.log('Event types from vocab:', Array.from(state.eventTypeKeys));
        
        // Build victim category lookups
        state.victimCategoryKeys = new Set(Object.keys(state.vocab.victim_category_types || {}));
        console.log('Victim category types from vocab:', Array.from(state.victimCategoryKeys));
        
        // Log target event type
        console.log(`Target event type: "${CONFIG.targetEventType}" → "${getEventTypeLabel(CONFIG.targetEventType)}"`);
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
        });

        return { eventTypes, victimCategories };
    }

    /**
     * Check if an event's tags include the target event type (voluntary_residence)
     */
    function isTargetEvent(tags) {
        if (!tags || !Array.isArray(tags)) return false;
        return tags.includes(CONFIG.targetEventType);
    }

    // ===== Load and Process Data =====
    async function loadGeoJSONData() {
        try {
            const response = await fetch(CONFIG.geoJsonUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            state.geojsonData = await response.json();
            console.log('Loaded GeoJSON:', state.geojsonData.metadata);
            console.log('Total features:', state.geojsonData.features.length);
            
            // Process vocabulary FIRST
            processVocabulary();
            
            // Extract victim categories (only from voluntary_residence events)
            extractVictimCategories();
            
            // Create point markers (only voluntary_residence)
            createPointMarkers();
            
            // Setup UI (victim categories only - no event type filters)
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
    // Only considers voluntary_residence events
    function extractVictimCategories() {
        state.allVictimCategories.clear();
        state.activeVictimCategories.clear();

        state.geojsonData.features.forEach(feature => {
            const props = feature.properties;
            
            if (props.events && Array.isArray(props.events)) {
                // Aggregated features - only process voluntary_residence events
                props.events.forEach(event => {
                    if (!isTargetEvent(event.tags)) return;
                    const parsed = parseTags(event.tags);
                    parsed.victimCategories.forEach(cat => {
                        state.allVictimCategories.add(cat);
                        state.activeVictimCategories.add(cat);
                    });
                });
            } else {
                // Single person features - only process if voluntary_residence
                if (!isTargetEvent(props.tags)) return;
                const parsed = parseTags(props.tags);
                parsed.victimCategories.forEach(cat => {
                    state.allVictimCategories.add(cat);
                    state.activeVictimCategories.add(cat);
                });
            }
        });
        
        console.log('Found victim categories in voluntary_residence data:', Array.from(state.allVictimCategories));
    }

    // ===== Create Point Markers =====
    // Only creates markers for voluntary_residence events
    function createPointMarkers() {
        state.allPointMarkers = [];
        
        state.geojsonData.features.forEach(feature => {
            const coords = feature.geometry.coordinates;
            const props = feature.properties;
            
            if (!coords || coords.length !== 2) return;
            
            if (props.events && Array.isArray(props.events)) {
                // Aggregated features - create marker only for voluntary_residence events
                props.events.forEach(event => {
                    if (!isTargetEvent(event.tags)) return;
                    
                    const parsed = parseTags(event.tags);
                    const victimCategories = parsed.victimCategories.length > 0 ? parsed.victimCategories : ['unknown'];
                    
                    // Get color from first victim category
                    const primaryVictimCategory = victimCategories[0];
                    const color = getVictimCategoryColor(primaryVictimCategory);
                    
                    const marker = L.marker([coords[1], coords[0]], {
                        icon: createPointIcon(color)
                    });
                    
                    marker.options.personId = event.person_id;
                    marker.options.victimCategories = victimCategories;
                    marker.options.properties = event;
                    
                    marker.bindPopup(createPointPopupContent(event));
                    
                    state.allPointMarkers.push({
                        marker: marker,
                        victimCategories: victimCategories
                    });
                });
            } else {
                // Single person features - only process if voluntary_residence
                if (!isTargetEvent(props.tags)) return;
                
                const parsed = parseTags(props.tags);
                const victimCategories = parsed.victimCategories.length > 0 ? parsed.victimCategories : ['unknown'];
                
                const primaryVictimCategory = victimCategories[0];
                const color = getVictimCategoryColor(primaryVictimCategory);
                
                const marker = L.marker([coords[1], coords[0]], {
                    icon: createPointIcon(color)
                });
                
                marker.options.personId = props.person_id;
                marker.options.victimCategories = victimCategories;
                marker.options.properties = props;
                
                marker.bindPopup(createPointPopupContent(props));
                
                state.allPointMarkers.push({
                    marker: marker,
                    victimCategories: victimCategories
                });
            }
        });
        
        console.log(`Created ${state.allPointMarkers.length} voluntary_residence markers`);
    }

    // ===== Render Markers =====
    function renderMarkers() {
        state.markerCluster.clearLayers();
        
        const filteredMarkers = state.allPointMarkers.filter(item => {
            // Only filter by victim category
            if (state.activeVictimCategories.size === 0) return true;
            return item.victimCategories.some(cat => state.activeVictimCategories.has(cat));
        });
        
        console.log(`Rendering ${filteredMarkers.length} markers`);
        
        filteredMarkers.forEach(item => {
            state.markerCluster.addLayer(item.marker);
        });
        
        // Add cluster layer to map
        if (!state.map.hasLayer(state.markerCluster)) {
            state.map.addLayer(state.markerCluster);
        }
    }

    // ===== Create Icons =====
    // All markers are circles (voluntary_residence shape) colored by victim category
    function createPointIcon(color) {
        const svgIcon = `
            <svg width="24" height="24" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="8" fill="${color}" stroke="#fff" stroke-width="2"/>
            </svg>
        `;
        
        return L.divIcon({
            html: svgIcon,
            className: 'custom-marker',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            popupAnchor: [0, -12]
        });
    }

    // ===== Cluster Icon =====
    // Shows victim category distribution as donut chart
    function createClusterIcon(cluster) {
        const markers = cluster.getAllChildMarkers();
        const count = markers.length;
        
        // Count by victim category
        const categoryCounts = {};
        markers.forEach(marker => {
            const categories = marker.options.victimCategories || ['unknown'];
            // Use primary (first) category for cluster visualization
            const primary = categories[0];
            categoryCounts[primary] = (categoryCounts[primary] || 0) + 1;
        });
        
        // Determine size
        let size = 'small';
        let diameter = 40;
        if (count > 100) {
            size = 'large';
            diameter = 60;
        } else if (count > 20) {
            size = 'medium';
            diameter = 50;
        }
        
        // Generate SVG
        const svg = createCategoryPieChartSVG(categoryCounts, diameter, count);
        
        return L.divIcon({
            html: svg,
            className: `marker-cluster marker-cluster-${size} marker-cluster-category`,
            iconSize: L.point(diameter, diameter)
        });
    }
    
    /**
     * Create SVG pie/donut chart showing victim category distribution
     */
    function createCategoryPieChartSVG(categoryCounts, diameter, totalCount) {
        const radius = diameter / 2;
        const innerRadius = radius * 0.55;
        
        const categories = Object.keys(categoryCounts);
        
        // Single category = full circle
        if (categories.length === 1) {
            const color = getVictimCategoryColor(categories[0]);
            return `
                <svg width="${diameter}" height="${diameter}" viewBox="0 0 ${diameter} ${diameter}">
                    <circle cx="${radius}" cy="${radius}" r="${radius}" fill="${color}" stroke="white" stroke-width="2"/>
                    <circle cx="${radius}" cy="${radius}" r="${innerRadius - 1}" fill="white" stroke="#1a1a1a" stroke-width="2"/>
                    <text x="${radius}" y="${radius}" 
                          text-anchor="middle" 
                          dominant-baseline="central" 
                          style="font-size: ${diameter * 0.28}px; font-weight: 700; font-family: 'Courier New', monospace; fill: #1a1a1a;">
                        ${totalCount}
                    </text>
                </svg>
            `;
        }
        
        // Multiple categories = donut chart
        let cumulativePercent = 0;
        let pathsHTML = '';
        
        categories.forEach(category => {
            const count = categoryCounts[category];
            const percent = count / totalCount;
            
            if (percent > 0) {
                const startAngle = cumulativePercent * 2 * Math.PI;
                const endAngle = (cumulativePercent + percent) * 2 * Math.PI;
                
                const color = getVictimCategoryColor(category);
                pathsHTML += createArcPath(radius, innerRadius, startAngle, endAngle, color);
                
                cumulativePercent += percent;
            }
        });
        
        return `
            <svg width="${diameter}" height="${diameter}" viewBox="0 0 ${diameter} ${diameter}">
                ${pathsHTML}
                <circle cx="${radius}" cy="${radius}" r="${innerRadius - 1}" fill="white" stroke="#1a1a1a" stroke-width="2"/>
                <text x="${radius}" y="${radius}" 
                      text-anchor="middle" 
                      dominant-baseline="central" 
                      style="font-size: ${diameter * 0.28}px; font-weight: 700; font-family: 'Courier New', monospace; fill: #1a1a1a;">
                    ${totalCount}
                </text>
            </svg>
        `;
    }
    
    /**
     * Create SVG arc path for pie chart slice
     */
    function createArcPath(outerRadius, innerRadius, startAngle, endAngle, color) {
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
        
        // Check if all events are at the exact same location
        const allPlaceNames = personsArray.map(p => p.properties?.place_name).filter(Boolean);
        const uniquePlaceNames = [...new Set(allPlaceNames)];
        const isSameLocation = uniquePlaceNames.length === 1;
        const placeName = isSameLocation ? uniquePlaceNames[0] : null;
        
        let html = '<div class="popup-content cluster-popup-content">';
        
        // Header
        html += '<div class="popup-header">';
        
        if (placeName) {
            html += `<div class="popup-name" style="font-size: 1.1rem;">${escapeHtml(placeName)}</div>`;
        } else {
            html += `<div class="popup-name" style="font-size: 1.1rem;">Wohnadressen-Cluster</div>`;
            html += `<div class="popup-note">Mehrere Adressen in diesem Bereich</div>`;
        }
        
        html += `<div class="popup-summary" style="margin-top: 0.5rem; padding: 0.5rem; background: #f5f5f0; border-left: 4px solid #1a1a1a;">`;
        html += `<strong>${personCount}</strong> Person${personCount !== 1 ? 'en' : ''}`;
        html += `</div>`;
        html += '</div>';
        
        // Persons list
        html += '<div class="popup-section">';
        
        if (isSameLocation) {
            html += '<div class="popup-label">Personen an dieser Adresse</div>';
        } else {
            html += '<div class="popup-label">Personen in diesem Bereich</div>';
        }
        
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
            const personUrl = buildPersonUrl(props.person_id);
            
            // Victim categories
            const victimCats = Array.from(person.victimCategories)
                .map(cat => getVictimCategoryLabel(cat))
                .join(', ');
            
            html += '<div class="person-item">';
            html += `<div class="person-name">`;
            
            if (personUrl) {
                html += `<a href="${escapeHtml(personUrl)}" target="_blank" rel="noopener" class="person-link">`;
                html += `${escapeHtml(name)}`;
                html += `</a>`;
            } else {
                html += `<strong>${escapeHtml(name)}</strong>`;
            }
            
            html += ` <span class="person-years">(${birthYear}–${deathYear})</span>`;
            html += `</div>`;
            
            if (victimCats) {
                html += `<div class="person-details">`;
                html += `<span class="detail-item victim-cat">${escapeHtml(victimCats)}</span>`;
                html += `</div>`;
            }
            
            html += '</div>';
            
            if (index < personsArray.length - 1) {
                html += '<div class="person-separator"></div>';
            }
        });
        
        html += '</div>'; // persons-list
        html += '</div>'; // popup-section
        
        html += '</div>';
        return html;
    }

    function createPointPopupContent(props) {
        const name = props.person_name || 'Unbekannt';
        const placeName = props.place_name || 'Unbekannt';
        const date = props.date || null;
        const birthDate = props.birth_date || 'Unbekannt';
        const deathDate = props.death_date || '';
        const personUrl = buildPersonUrl(props.person_id);
        
        // Parse victim categories from tags
        const parsed = parseTags(props.tags);

        let html = '<div class="popup-content">';
        
        html += '<div class="popup-header">';
        if (personUrl) {
            html += `<a href="${escapeHtml(personUrl)}" target="_blank" rel="noopener" class="popup-name-link"><div class="popup-name">${escapeHtml(name)}</div></a>`;
        } else {
            html += `<div class="popup-name">${escapeHtml(name)}</div>`;
        }
        html += `<div class="popup-event-type">Letzte Freiwillige Wohnadresse</div>`;
        html += '</div>';

        html += '<div class="popup-section">';
        html += '<div class="popup-label">Adresse</div>';
        html += `<div class="popup-value">${escapeHtml(placeName)}</div>`;
        if (date) {
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

        if (personUrl) {
            html += `<a href="${escapeHtml(personUrl)}" target="_blank" rel="noopener" class="popup-link">Mehr erfahren →</a>`;
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
        
        // Show total voluntary_residence markers (not all events)
        document.getElementById('total-events').textContent = 
            state.allPointMarkers.length.toLocaleString('de-DE');
        
        // Calculate visible (after victim category filtering)
        const visibleCount = state.allPointMarkers.filter(item => {
            if (state.activeVictimCategories.size === 0) return true;
            return item.victimCategories.some(cat => state.activeVictimCategories.has(cat));
        }).length;
        
        document.getElementById('visible-events').textContent = visibleCount.toLocaleString('de-DE');
    }

    // ===== Victim Category Filters UI Setup =====
    function setupVictimCategoryFilters() {
        const container = document.getElementById('victim-category-filters');
        if (!container) return;
        
        container.innerHTML = '';
        
        // Show ALL categories from vocab (sorted alphabetically)
        const sortedCategories = Array.from(state.victimCategoryKeys).sort((a, b) => {
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

    // ===== Filter Toggle =====
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

            // Only victim categories legend (colors)
            div.innerHTML = '<div class="legend-title">Opferkategorien</div>';
            
            // Show ALL categories from vocab (sorted alphabetically)
            Array.from(state.victimCategoryKeys).sort((a, b) => {
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

    // ===== Start =====
    init();
};