<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { mapState, userLocation, setMapBounds, DC_CENTER, DEFAULT_ZOOM, centerOnDC, searchLocation } from '$stores/location';
  import { filteredIncidents } from '$stores/filters';
  import { filteredCameraList, selectCamera } from '$stores/cameras';
  import { selectIncident, selectedIncident } from '$stores/incidents';
  import { filters } from '$stores/filters';
  import { activeWeatherAlerts } from '$stores/weather';
  import { aircraftList, selectAircraft } from '$stores/aircraft';
  import { getSeverityColor, getIncidentTypeColor } from '$utils/format';
  import type { Incident, Camera, WeatherAlert, Aircraft } from '$types';

  let mapContainer: HTMLDivElement;
  let map: L.Map | null = null;
  let L: typeof import('leaflet') | null = null;
  let incidentMarkers: L.MarkerClusterGroup | null = null;
  let cameraMarkers: L.LayerGroup | null = null;
  let aircraftMarkers: L.LayerGroup | null = null;
  let userMarker: L.Marker | null = null;
  let searchMarker: L.Marker | null = null;
  let weatherLayers: L.LayerGroup | null = null;
  let heatmapLayer: L.Layer | null = null;
  let heatLayerLoaded = false;

  onMount(async () => {
    if (!browser) return;

    try {
      console.log('MapContainer: Starting initialization...');
      
      // Dynamically import Leaflet
      L = await import('leaflet');
      console.log('MapContainer: Leaflet imported', L);
      
      // Set global L for plugins that need it (like leaflet.heat)
      (window as any).L = L;
      
      const markerClusterModule = await import('leaflet.markercluster');
      const MarkerClusterGroup = markerClusterModule.MarkerClusterGroup || (markerClusterModule as any).default?.MarkerClusterGroup;
      console.log('MapContainer: MarkerCluster imported', MarkerClusterGroup);

      // Initialize map
      map = L.map(mapContainer, {
        center: DC_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: true,
        attributionControl: true,
      });
      console.log('MapContainer: Map created');

      // Add tile layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      console.log('MapContainer: Tile layer added');

      // Initialize marker groups
      if (MarkerClusterGroup) {
        incidentMarkers = new MarkerClusterGroup({
          maxClusterRadius: 50,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          iconCreateFunction: (cluster: any) => {
            const count = cluster.getChildCount();
            let size = 'small';
            if (count > 10) size = 'medium';
            if (count > 25) size = 'large';

            return L!.divIcon({
              html: `<div><span>${count}</span></div>`,
              className: `marker-cluster marker-cluster-${size}`,
              iconSize: L!.point(40, 40),
            });
          },
        });
        map.addLayer(incidentMarkers);
        console.log('MapContainer: Incident markers layer added');
      } else {
        console.error('MapContainer: MarkerClusterGroup not available');
      }

      cameraMarkers = L.layerGroup().addTo(map);
      weatherLayers = L.layerGroup().addTo(map);
      aircraftMarkers = L.layerGroup().addTo(map);
      console.log('MapContainer: Camera, weather, and aircraft layers added');

      // Load heatmap plugin
      try {
        await import('leaflet.heat');
        // Check if heatLayer was added to the global L
        const globalL = (window as any).L;
        heatLayerLoaded = typeof globalL?.heatLayer === 'function';
        console.log('MapContainer: leaflet.heat loaded, heatLayer available:', heatLayerLoaded);
      } catch (e) {
        console.error('MapContainer: Failed to load leaflet.heat:', e);
        heatLayerLoaded = false;
      }

      // Update bounds on move
      map.on('moveend', () => {
        if (!map) return;
        const bounds = map.getBounds();
        setMapBounds({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        });
      });

      // Add location control
      const locationControl = L.Control.extend({
        onAdd: function() {
          const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
          div.innerHTML = `
            <a href="#" title="My Location" style="display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; background: white; border-radius: 4px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 2v2m0 16v2M2 12h2m16 0h2"/>
              </svg>
            </a>
          `;
          L.DomEvent.on(div, 'click', function(e: any) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            if ($userLocation) {
              map?.setView($userLocation, 15);
            }
          });
          return div;
        }
      });
      new locationControl({ position: 'bottomright' }).addTo(map);

      // Add DC center control
      const dcControl = L.Control.extend({
        onAdd: function() {
          const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
          div.innerHTML = `
            <a href="#" title="Center on DC" style="display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; background: white; border-radius: 4px; font-weight: bold; font-size: 10px;">
              DC
            </a>
          `;
          L.DomEvent.on(div, 'click', function(e: any) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            centerOnDC();
            map?.setView(DC_CENTER, DEFAULT_ZOOM);
          });
          return div;
        }
      });
      new dcControl({ position: 'bottomright' }).addTo(map);

      console.log('MapContainer: Initialization complete!');
    } catch (error) {
      console.error('MapContainer: Fatal error during initialization:', error);
    }
  });

  onDestroy(() => {
    if (map) {
      map.remove();
      map = null;
    }
  });

  // Update incident markers when filtered incidents change
  // When heatmap is enabled, exclude crime/gunshot from markers (shown as heatmap instead)
  $: if (incidentMarkers && L && $filteredIncidents) {
    const markersToShow = $filters.showCrimeHeatmap
      ? $filteredIncidents.filter(i => i.type !== 'crime' && i.type !== 'gunshot')
      : $filteredIncidents;
    updateIncidentMarkers(markersToShow);
  }

  // Update camera markers when cameras change
  $: if (cameraMarkers && L && $filteredCameraList && $filters.showCameras) {
    updateCameraMarkers($filteredCameraList);
  } else if (cameraMarkers && !$filters.showCameras) {
    cameraMarkers.clearLayers();
  }

  // Update user location marker
  $: if (map && L && $userLocation) {
    updateUserMarker($userLocation);
  }

  // Update weather polygons
  $: if (weatherLayers && L && $activeWeatherAlerts && $filters.showWeather) {
    updateWeatherLayers($activeWeatherAlerts);
  } else if (weatherLayers && !$filters.showWeather) {
    weatherLayers.clearLayers();
  }

  // Update crime heatmap - split into two reactive statements for better control
  $: showHeatmap = $filters.showCrimeHeatmap;
  $: crimeData = $filteredIncidents.filter(i => i.type === 'crime' || i.type === 'gunshot');
  
  $: {
    if (map && L && heatLayerLoaded) {
      if (showHeatmap && crimeData.length > 0) {
        updateHeatmap(crimeData);
      } else if (heatmapLayer) {
        map.removeLayer(heatmapLayer);
        heatmapLayer = null;
      }
    }
  }

  // Update aircraft markers
  $: if (aircraftMarkers && L && $aircraftList && $filters.showAircraft) {
    const visibleAircraft = $filters.hideGroundAircraft 
      ? $aircraftList.filter(a => !a.onGround)
      : $aircraftList;
    updateAircraftMarkers(visibleAircraft);
  } else if (aircraftMarkers && !$filters.showAircraft) {
    aircraftMarkers.clearLayers();
  }

  // Center map when incident is selected
  $: if (map && $selectedIncident) {
    map.setView([$selectedIncident.location.lat, $selectedIncident.location.lng], 17);
  }

  // Pan to search location when user searches
  $: if (map && L && $searchLocation) {
    panToSearchLocation($searchLocation);
  }

  function panToSearchLocation(location: { lat: number; lng: number; name: string }) {
    if (!map || !L) return;

    // Pan to the location with a nice zoom level
    map.setView([location.lat, location.lng], 16);

    // Add or update search marker
    if (searchMarker) {
      searchMarker.setLatLng([location.lat, location.lng]);
      searchMarker.setPopupContent(`<strong>📍 ${location.name}</strong>`);
    } else {
      const icon = L.divIcon({
        className: '',
        html: `
          <div style="width: 32px; height: 32px; background: #6366f1; border: 3px solid white; border-radius: 50%; box-shadow: 0 3px 8px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="none">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      searchMarker = L.marker([location.lat, location.lng], { icon, zIndexOffset: 900 }).addTo(map);
      searchMarker.bindPopup(`<strong>📍 ${location.name}</strong>`).openPopup();
    }

    // Clear the search marker after 10 seconds
    setTimeout(() => {
      if (searchMarker && map) {
        map.removeLayer(searchMarker);
        searchMarker = null;
      }
    }, 10000);
  }

  function updateIncidentMarkers(incidents: Incident[]) {
    if (!incidentMarkers || !L) return;

    incidentMarkers.clearLayers();

    for (const incident of incidents) {
      const color = getSeverityColor(incident.severity);
      const icon = L.divIcon({
        className: '',
        html: `
          <div class="incident-marker severity-${incident.severity}" style="width: 24px; height: 24px; background-color: ${color};">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="white" style="margin: 5px;">
              ${getIncidentIcon(incident.type)}
            </svg>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const marker = L.marker([incident.location.lat, incident.location.lng], { icon });
      marker.on('click', () => selectIncident(incident));
      incidentMarkers.addLayer(marker);
    }
  }

  function updateCameraMarkers(cameras: Camera[]) {
    if (!cameraMarkers || !L) return;

    cameraMarkers.clearLayers();

    for (const camera of cameras) {
      // Different styles for landmark vs traffic cameras
      const isLandmark = camera.source === 'landmark';
      const isDC = camera.source === 'dc';

      const markerClass = isLandmark ? 'landmark-marker' : isDC ? 'dc-camera-marker' : 'camera-marker';
      const svgIcon = isLandmark
        ? '<path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><circle cx="12" cy="11" r="3"/>' // Map pin
        : '<path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4zM3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>'; // Camera

      const icon = L.divIcon({
        className: '',
        html: `
          <div class="${markerClass}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="white">
              ${svgIcon}
            </svg>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const marker = L.marker([camera.location.lat, camera.location.lng], { icon });
      marker.on('click', () => selectCamera(camera));
      cameraMarkers.addLayer(marker);
    }
  }

  function updateUserMarker(location: [number, number]) {
    if (!map || !L) return;

    if (userMarker) {
      userMarker.setLatLng(location);
    } else {
      const icon = L.divIcon({
        className: '',
        html: `
          <div style="width: 20px; height: 20px; background: #3b82f6; border: 3px solid white; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
          </div>
        `,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      userMarker = L.marker(location, { icon, zIndexOffset: 1000 }).addTo(map);
    }
  }

  function updateWeatherLayers(alerts: WeatherAlert[]) {
    if (!weatherLayers || !L) return;

    weatherLayers.clearLayers();

    for (const alert of alerts) {
      if (alert.polygon && alert.polygon.length > 0) {
        const color = getWeatherColor(alert.severity);
        const polygon = L.polygon(alert.polygon, {
          color,
          fillColor: color,
          fillOpacity: 0.2,
          weight: 2,
        });
        polygon.bindPopup(`<strong>${alert.event}</strong><br>${alert.headline}`);
        weatherLayers.addLayer(polygon);
      }
    }
  }

  function getWeatherColor(severity: string): string {
    const colors: Record<string, string> = {
      minor: '#22c55e',
      moderate: '#eab308',
      severe: '#f97316',
      extreme: '#ef4444',
    };
    return colors[severity] || '#6b7280';
  }

  function updateHeatmap(incidents: Incident[]) {
    if (!map || !L) {
      console.warn('updateHeatmap: map or L not ready');
      return;
    }

    // Get the global L which has heatLayer attached by leaflet.heat
    const globalL = (window as any).L;
    
    if (!heatLayerLoaded || typeof globalL?.heatLayer !== 'function') {
      console.warn('updateHeatmap: leaflet.heat not available');
      return;
    }

    // Remove existing heatmap layer
    if (heatmapLayer) {
      map.removeLayer(heatmapLayer);
      heatmapLayer = null;
    }

    if (incidents.length === 0) {
      console.log('updateHeatmap: no crime/gunshot incidents to display');
      return;
    }

    console.log(`updateHeatmap: creating heatmap with ${incidents.length} crime/gunshot incidents`);

    // Create heatmap data points [lat, lng, intensity]
    const heatData: [number, number, number][] = incidents.map(incident => [
      incident.location.lat,
      incident.location.lng,
      incident.severity * 0.2
    ]);

    try {
      // Create heatmap layer using the global L.heatLayer
      heatmapLayer = globalL.heatLayer(heatData, {
        radius: 30,
        blur: 20,
        maxZoom: 17,
        max: 1.0,
        minOpacity: 0.4,
        gradient: {
          0.2: '#22c55e',
          0.4: '#84cc16',
          0.5: '#eab308',
          0.6: '#f97316',
          0.8: '#ef4444',
          1.0: '#dc2626',
        }
      }).addTo(map);
      console.log('✓ Heatmap layer added successfully with', heatData.length, 'points');
    } catch (e) {
      console.error('✗ Failed to create heatmap layer:', e);
      heatLayerLoaded = false;
    }
  }

  function getIncidentIcon(type: string): string {
    const icons: Record<string, string> = {
      traffic: '<path d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"/><path d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10h10zm2 0V7.97A1 1 0 0116 7h3l2 4v5h-6z"/>',
      crime: '<path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>',
      fire: '<path d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"/><path d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z"/>',
      weather: '<path d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"/>',
      transit: '<path d="M8 4h8a2 2 0 012 2v10a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2z"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M9 18v2m6-2v2"/>',
      gunshot: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
      hazard: '<path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>',
    };
    return icons[type] || icons.hazard;
  }

  function updateAircraftMarkers(aircraft: Aircraft[]) {
    if (!aircraftMarkers || !L) return;

    aircraftMarkers.clearLayers();

    for (const plane of aircraft) {
      const color = getAircraftColor(plane);
      const isHelicopter = plane.category === 'helicopter';
      const size = plane.category === 'commercial' ? 28 : 24;
      const opacity = plane.onGround ? 0.5 : 1;
      
      // Different SVG path for helicopters vs fixed-wing
      const svgPath = isHelicopter
        ? '<path d="M12 2C11.2 2 10.5 2.5 10.2 3.2L9.5 5H7V7H9L8 9H6V11H7.5L6.5 13H5V15H6L5.2 17H3V19H5L4.5 20.5C4.3 21.1 4.7 21.7 5.3 21.9C5.9 22.1 6.5 21.7 6.7 21.1L7.5 19H16.5L17.3 21.1C17.5 21.7 18.1 22.1 18.7 21.9C19.3 21.7 19.7 21.1 19.5 20.5L19 19H21V17H18.8L18 15H19V13H17.5L16.5 11H18V9H16L15 7H17V5H14.5L13.8 3.2C13.5 2.5 12.8 2 12 2M12 5C12.6 5 13 5.4 13 6C13 6.6 12.6 7 12 7C11.4 7 11 6.6 11 6C11 5.4 11.4 5 12 5M9.5 9H14.5L15.5 11H8.5L9.5 9M8 13H16L17 15H7L8 13M7.5 17H16.5L16 18H8L7.5 17Z"/>'
        : '<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>';
      
      const icon = L.divIcon({
        className: '',
        html: `
          <div class="aircraft-marker ${isHelicopter ? 'helicopter' : ''} ${plane.isEmergency ? 'emergency' : ''}" 
               style="width: ${size}px; height: ${size}px; opacity: ${opacity}; transform: rotate(${plane.heading}deg);">
            <svg viewBox="0 0 24 24" width="${size - 6}" height="${size - 6}" fill="${color}" style="margin: 3px;">
              ${svgPath}
            </svg>
          </div>
        `,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([plane.location.lat, plane.location.lng], { icon });
      
      // Build popup content with metadata
      const altitudeStr = plane.location.altitude.toLocaleString();
      const speedStr = plane.speed.toLocaleString();
      const verticalIndicator = plane.verticalRate > 100 ? '↗️ Climbing' : 
                                plane.verticalRate < -100 ? '↘️ Descending' : '→ Level';
      
      const categoryIcon = isHelicopter ? '🚁' : '✈️';
      const meta = plane.metadata;
      
      // Build metadata section if available
      let metadataHtml = '';
      if (meta && Object.keys(meta).length > 0) {
        const parts = [];
        if (meta.manufacturer && meta.model) {
          parts.push(`<div><strong>Aircraft:</strong> ${meta.manufacturer} ${meta.model}</div>`);
        } else if (meta.model) {
          parts.push(`<div><strong>Model:</strong> ${meta.model}</div>`);
        }
        if (meta.registration) {
          parts.push(`<div><strong>Registration:</strong> ${meta.registration}</div>`);
        }
        if (meta.operator) {
          parts.push(`<div><strong>Operator:</strong> ${meta.operator}</div>`);
        } else if (meta.owner) {
          parts.push(`<div><strong>Owner:</strong> ${meta.owner}</div>`);
        }
        if (parts.length > 0) {
          metadataHtml = `<hr style="margin: 6px 0; border: none; border-top: 1px solid #eee;">${parts.join('')}`;
        }
      }
      
      const popupContent = `
        <div style="min-width: 180px;">
          <strong style="font-size: 14px;">${categoryIcon} ${plane.callsign}</strong>
          <div style="font-size: 11px; color: #666; margin-top: 2px;">${plane.origin}</div>
          ${metadataHtml}
          <hr style="margin: 6px 0; border: none; border-top: 1px solid #eee;">
          <div style="font-size: 12px;">
            <div><strong>Altitude:</strong> ${altitudeStr} ft</div>
            <div><strong>Speed:</strong> ${speedStr} kts</div>
            <div><strong>Heading:</strong> ${Math.round(plane.heading)}°</div>
            <div>${verticalIndicator} (${plane.verticalRate > 0 ? '+' : ''}${plane.verticalRate} ft/min)</div>
            ${plane.squawk ? `<div><strong>Squawk:</strong> ${plane.squawk}${plane.isEmergency ? ' ⚠️' : ''}</div>` : ''}
          </div>
        </div>
      `;
      
      marker.bindPopup(popupContent);
      marker.on('click', () => selectAircraft(plane));
      aircraftMarkers.addLayer(marker);
    }
  }

  function getAircraftColor(aircraft: Aircraft): string {
    // Emergency aircraft are always red
    if (aircraft.isEmergency) return '#ef4444';
    
    // If on ground, use a dimmer color
    if (aircraft.onGround) {
      return '#9ca3af'; // gray-400
    }
    
    // Color by category
    const categoryColors: Record<string, string> = {
      commercial: '#3b82f6',   // blue
      military: '#4b5563',     // gray-600
      helicopter: '#dc2626',   // red-600 - helicopters stand out!
      general: '#22c55e',      // green
      unknown: '#f59e0b',      // amber
    };
    
    return categoryColors[aircraft.category] || categoryColors.unknown;
  }
</script>

<div bind:this={mapContainer} class="w-full h-full"></div>

<style>
  :global(.leaflet-container) {
    font-family: inherit;
  }
  
  /* Ensure heatmap layer canvas is visible */
  :global(.leaflet-heatmap-layer) {
    z-index: 200 !important;
    opacity: 0.8;
  }
  
  :global(.leaflet-pane.leaflet-overlay-pane) {
    z-index: 400;
  }

  /* Aircraft marker styles */
  :global(.aircraft-marker) {
    display: flex;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.3));
    transition: transform 0.5s ease-out;
  }

  :global(.aircraft-marker.emergency) {
    animation: pulse-emergency 1s infinite;
  }

  @keyframes pulse-emergency {
    0%, 100% {
      filter: drop-shadow(0 0 8px rgba(239, 68, 68, 0.8));
    }
    50% {
      filter: drop-shadow(0 0 16px rgba(239, 68, 68, 1));
    }
  }
</style>
