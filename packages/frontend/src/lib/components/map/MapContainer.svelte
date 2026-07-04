<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { mapState, userLocation, setMapBounds, searchLocation } from '$stores/location';
  import { filteredIncidents } from '$stores/filters';
  import { filteredCameraList, selectCamera } from '$stores/cameras';
  import { selectIncident, selectedIncident } from '$stores/incidents';
  import { filters } from '$stores/filters';
  import { activeWeatherAlerts } from '$stores/weather';
  import { aircraftList, selectAircraft, selectedAircraft } from '$stores/aircraft';
  import { selectedRegion } from '$stores/region';
  import { getSeverityColor, getIncidentTypeColor } from '$utils/format';
  import { getAgeBasedOpacity, isFreshIncident } from '$utils/time';
  import { fetchRadarFrame, type RadarFrameInfo } from '$services/radar';
  import type { Incident, Camera, WeatherAlert, Aircraft } from '$types';
  import type * as Leaflet from 'leaflet';

  // Recenter the map when the user picks a different region.
  $: if (map && $selectedRegion) {
    map.setView($selectedRegion.defaultCenter, $selectedRegion.defaultZoom);
  }

  // Third-party data (OpenSky metadata, Nominatim names, feed text) must be
  // escaped before interpolation into popup HTML — Leaflet assigns string
  // popup content via innerHTML.
  function escapeHtml(value: string | number | undefined | null): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let mapContainer: HTMLDivElement;
  let map: Leaflet.Map | null = null;
  let L: typeof import('leaflet') | null = null;
  let incidentMarkers: Leaflet.MarkerClusterGroup | null = null;
  let cameraMarkers: Leaflet.LayerGroup | null = null;
  let aircraftMarkers: Leaflet.LayerGroup | null = null;
  let userMarker: Leaflet.Marker | null = null;
  let searchMarker: Leaflet.Marker | null = null;
  let weatherLayers: Leaflet.LayerGroup | null = null;
  let heatmapLayer: Leaflet.Layer | null = null;
  let heatLayerLoaded = false;

  // Precipitation radar overlay. RainViewer frame paths expire out of a 2h
  // window, so the layer URL is rebuilt from a fresh index every 5 minutes.
  const RADAR_REFRESH_MS = 5 * 60 * 1000;
  let radarLayer: Leaflet.TileLayer | null = null;
  let radarRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let radarTemplate = '';
  let radarSource: 'rainviewer' | 'iem' | null = null;
  let radarAddInFlight = false;
  let radarRefreshInFlight = false;

  function createRadarLayer(frame: RadarFrameInfo): void {
    if (!map || !L) return;
    radarTemplate = frame.tileTemplate;
    radarSource = frame.source;
    radarLayer = L.tileLayer(frame.tileTemplate, {
      opacity: 0.6,
      // RainViewer's native pyramid tops out at z7 (Leaflet upscales
      // beyond); IEM serves native tiles much deeper.
      maxNativeZoom: frame.source === 'rainviewer' ? 7 : 12,
      maxZoom: 19,
      attribution: frame.attribution,
    }).addTo(map);
  }

  async function addRadarLayer(): Promise<void> {
    if (!map || !L || radarLayer || radarAddInFlight) return;
    radarAddInFlight = true;
    try {
      const frame = await fetchRadarFrame();
      // The toggle may have flipped off while the index was in flight.
      if (!map || !L || radarLayer || !$filters.showRadar) return;
      createRadarLayer(frame);
      radarRefreshTimer = setInterval(() => void refreshRadarFrame(), RADAR_REFRESH_MS);
    } finally {
      radarAddInFlight = false;
    }
  }

  async function refreshRadarFrame(): Promise<void> {
    const layer = radarLayer;
    if (!layer || radarRefreshInFlight) return;
    radarRefreshInFlight = true;
    try {
      const frame = await fetchRadarFrame();
      // Bail if the layer was removed OR replaced while fetching — applying
      // a stale frame to a newer layer would regress it for a full cycle.
      if (radarLayer !== layer || !map) return;
      if (frame.source !== radarSource) {
        // Attribution and zoom tuning are per-source — rebuild the layer.
        map.removeLayer(layer);
        radarLayer = null;
        createRadarLayer(frame);
      } else if (frame.tileTemplate !== radarTemplate) {
        radarTemplate = frame.tileTemplate;
        layer.setUrl(frame.tileTemplate);
      }
    } finally {
      radarRefreshInFlight = false;
    }
  }

  function removeRadarLayer(): void {
    if (radarRefreshTimer) {
      clearInterval(radarRefreshTimer);
      radarRefreshTimer = null;
    }
    if (radarLayer && map) {
      map.removeLayer(radarLayer);
    }
    radarLayer = null;
    radarTemplate = '';
    radarSource = null;
  }

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
      const MarkerClusterGroup = (markerClusterModule as any).MarkerClusterGroup || (markerClusterModule as any).default?.MarkerClusterGroup;
      console.log('MapContainer: MarkerCluster imported', MarkerClusterGroup);

      // Initialize map at the current region's center.
      map = L.map(mapContainer, {
        center: $selectedRegion.defaultCenter,
        zoom: $selectedRegion.defaultZoom,
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
          // Smaller radius = less aggressive clustering (markers must be closer to cluster)
          maxClusterRadius: 30,
          // Disable clustering entirely at zoom level 15+ (street level)
          disableClusteringAtZoom: 15,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          // Don't animate cluster splits for better performance
          animate: true,
          // Spiderfy immediately when clicking a cluster at max zoom
          spiderfyDistanceMultiplier: 1.5,
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
        }) as Leaflet.MarkerClusterGroup;
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

      // Stop aircraft tracking when user manually drags the map
      map.on('dragstart', () => {
        if (trackedAircraftId) {
          console.log('User dragged map, stopping aircraft tracking');
          selectAircraft(null);
        }
      });

      // Add location control
      const locationControl = L.Control.extend({
        onAdd: function() {
          const div = L!.DomUtil.create('div', 'leaflet-bar leaflet-control');
          div.innerHTML = `
            <a href="#" title="My Location" style="display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; background: white; border-radius: 4px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 2v2m0 16v2M2 12h2m16 0h2"/>
              </svg>
            </a>
          `;
          L!.DomEvent.on(div, 'click', function(e: any) {
            L!.DomEvent.stopPropagation(e);
            L!.DomEvent.preventDefault(e);
            if ($userLocation) {
              map?.setView($userLocation, 15);
            }
          });
          return div;
        }
      });
      new locationControl({ position: 'bottomright' }).addTo(map);

      // Add "center on region" control — label updates per region.
      const regionControl = L.Control.extend({
        onAdd: function() {
          const div = L!.DomUtil.create('div', 'leaflet-bar leaflet-control');
          div.innerHTML = `
            <a href="#" title="Center on ${$selectedRegion.label}" style="display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; background: white; border-radius: 4px; font-weight: bold; font-size: 10px;">
              ${$selectedRegion.label.slice(0, 5)}
            </a>
          `;
          L!.DomEvent.on(div, 'click', function(e: any) {
            L!.DomEvent.stopPropagation(e);
            L!.DomEvent.preventDefault(e);
            map?.setView($selectedRegion.defaultCenter, $selectedRegion.defaultZoom);
          });
          return div;
        }
      });
      new regionControl({ position: 'bottomright' }).addTo(map);

      console.log('MapContainer: Initialization complete!');
    } catch (error) {
      console.error('MapContainer: Fatal error during initialization:', error);
    }
  });

  onDestroy(() => {
    removeRadarLayer();
    if (map) {
      map.remove();
      map = null;
    }
  });

  // Precipitation radar overlay follows its toggle.
  $: if (map && L) {
    if ($filters.showRadar && !radarLayer) {
      void addRadarLayer();
    } else if (!$filters.showRadar && radarLayer) {
      removeRadarLayer();
    }
  }

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
    aircraftMarkerById.clear();
  }

  // Center map when incident is selected
  $: if (map && $selectedIncident) {
    map.setView([$selectedIncident.location.lat, $selectedIncident.location.lng], 17);
  }

  // Track selected aircraft ID for following
  let trackedAircraftId: string | null = null;
  let lastTrackedPosition: { lat: number; lng: number } | null = null;

  // When aircraft is selected, start tracking it
  $: if ($selectedAircraft) {
    trackedAircraftId = $selectedAircraft.id;
    // Initial center on selection
    if (map) {
      map.setView([$selectedAircraft.location.lat, $selectedAircraft.location.lng], 13);
      lastTrackedPosition = { lat: $selectedAircraft.location.lat, lng: $selectedAircraft.location.lng };
    }
  } else {
    trackedAircraftId = null;
    lastTrackedPosition = null;
  }

  // Follow tracked aircraft when its position updates
  $: if (map && trackedAircraftId && $aircraftList.length > 0) {
    const trackedAircraft = $aircraftList.find(a => a.id === trackedAircraftId);
    if (trackedAircraft) {
      const newLat = trackedAircraft.location.lat;
      const newLng = trackedAircraft.location.lng;
      // Only pan if position has actually changed
      if (!lastTrackedPosition || 
          Math.abs(newLat - lastTrackedPosition.lat) > 0.0001 || 
          Math.abs(newLng - lastTrackedPosition.lng) > 0.0001) {
        map.panTo([newLat, newLng], { animate: true, duration: 0.5 });
        lastTrackedPosition = { lat: newLat, lng: newLng };
      }
    }
  }

  // Pan to search location when user searches
  $: if (map && L && $searchLocation) {
    panToSearchLocation($searchLocation);
  }

  let searchMarkerTimer: ReturnType<typeof setTimeout> | null = null;

  function panToSearchLocation(location: { lat: number; lng: number; name: string }) {
    if (!map || !L) return;

    // A pending removal timer from a previous search would otherwise fire
    // and delete the NEW marker almost immediately.
    if (searchMarkerTimer) {
      clearTimeout(searchMarkerTimer);
      searchMarkerTimer = null;
    }

    // Pan to the location with a nice zoom level
    map.setView([location.lat, location.lng], 16);

    // Add or update search marker
    if (searchMarker) {
      searchMarker.setLatLng([location.lat, location.lng]);
      searchMarker.setPopupContent(`<strong>📍 ${escapeHtml(location.name)}</strong>`);
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
      searchMarker.bindPopup(`<strong>📍 ${escapeHtml(location.name)}</strong>`).openPopup();
    }

    // Clear the search marker after 10 seconds
    searchMarkerTimer = setTimeout(() => {
      searchMarkerTimer = null;
      if (searchMarker && map) {
        map.removeLayer(searchMarker);
        searchMarker = null;
      }
    }, 10000);
  }

  // Diff-based marker updates: rebuilding the whole cluster group on every
  // SSE event re-clustered all markers (visible flicker, O(N) DOM churn per
  // incoming incident, N² work during the connect snapshot burst).
  const incidentMarkerById = new Map<string, Leaflet.Marker>();
  const incidentMarkerState = new WeakMap<
    Leaflet.Marker,
    { html: string; lat: number; lng: number; incident: Incident }
  >();

  function buildIncidentIconHtml(incident: Incident): { html: string; size: number } {
    const color = getSeverityColor(incident.severity);
    const opacity = getAgeBasedOpacity(incident.timestamp);
    const isFresh = isFreshIncident(incident.timestamp);

    // Fresh incidents get a larger size and pulse animation
    const size = isFresh ? 28 : 24;
    const pulseClass = isFresh ? 'pulse-fresh' : '';

    const html = `
          <div class="incident-marker severity-${incident.severity} ${pulseClass}"
               style="width: ${size}px; height: ${size}px; background-color: ${color}; opacity: ${opacity};">
            <svg viewBox="0 0 24 24" width="${size - 10}" height="${size - 10}" fill="white" style="margin: ${(size - (size - 10)) / 2}px;">
              ${getIncidentIcon(incident.type)}
            </svg>
          </div>
        `;
    return { html, size };
  }

  function updateIncidentMarkers(incidents: Incident[]) {
    if (!incidentMarkers || !L) return;

    const seen = new Set<string>();
    const toAdd: Leaflet.Marker[] = [];

    for (const incident of incidents) {
      seen.add(incident.id);
      const { html, size } = buildIncidentIconHtml(incident);
      const existing = incidentMarkerById.get(incident.id);

      if (existing) {
        const state = incidentMarkerState.get(existing)!;
        // Icon html is stable between age buckets, so setIcon only fires on
        // real changes (severity, freshness, opacity bucket).
        if (state.html !== html) {
          existing.setIcon(L.divIcon({
            className: '',
            html,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          }));
          state.html = html;
        }
        if (state.lat !== incident.location.lat || state.lng !== incident.location.lng) {
          existing.setLatLng([incident.location.lat, incident.location.lng]);
          state.lat = incident.location.lat;
          state.lng = incident.location.lng;
        }
        state.incident = incident; // click handler reads the latest data
      } else {
        const icon = L.divIcon({
          className: '',
          html,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        const marker = L.marker([incident.location.lat, incident.location.lng], { icon });
        incidentMarkerState.set(marker, {
          html,
          lat: incident.location.lat,
          lng: incident.location.lng,
          incident,
        });
        marker.on('click', () => {
          const state = incidentMarkerState.get(marker);
          if (state) selectIncident(state.incident);
        });
        incidentMarkerById.set(incident.id, marker);
        toAdd.push(marker);
      }
    }

    const toRemove: Leaflet.Marker[] = [];
    for (const [id, marker] of incidentMarkerById) {
      if (!seen.has(id)) {
        toRemove.push(marker);
        incidentMarkerById.delete(id);
      }
    }

    // Batch cluster operations: one re-cluster per update, not per marker.
    if (toRemove.length > 0) incidentMarkers.removeLayers(toRemove);
    if (toAdd.length > 0) incidentMarkers.addLayers(toAdd);
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
        polygon.bindPopup(`<strong>${escapeHtml(alert.event)}</strong><br>${escapeHtml(alert.headline)}`);
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

  // Diff-based aircraft updates: the old clear-and-rebuild on every ~5s tick
  // destroyed the marker an open popup was anchored to, force-closing it.
  const aircraftMarkerById = new Map<string, Leaflet.Marker>();
  const aircraftMarkerState = new WeakMap<
    Leaflet.Marker,
    { iconHtml: string; popup: string; plane: Aircraft }
  >();

  function buildAircraftIconHtml(plane: Aircraft): { html: string; size: number } {
    const color = getAircraftColor(plane);
    const isHelicopter = plane.category === 'helicopter';
    // Larger sizes for better visibility
    const size = plane.category === 'commercial' ? 40 : isHelicopter ? 38 : 34;
    const opacity = plane.onGround ? 0.6 : 1;

    // Different SVG path for helicopters vs fixed-wing
    // Helicopter: top-down view with rotor blades
    const svgPath = isHelicopter
      ? '<g><ellipse cx="12" cy="12" rx="4" ry="3"/><rect x="11" y="6" width="2" height="12" rx="1"/><rect x="4" y="11" width="16" height="2" rx="1"/><circle cx="12" cy="12" r="1.5"/><path d="M10 18l-2 3h8l-2-3h-4z"/></g>'
      : '<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>';

    // Stroke color for outline effect (darker version of fill)
    const strokeColor = plane.isEmergency ? '#b91c1c' : (plane.onGround ? '#6b7280' : '#1f2937');
    const bgColor = plane.onGround ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.9)';

    const html = `
          <div class="aircraft-marker ${isHelicopter ? 'helicopter' : ''} ${plane.isEmergency ? 'emergency' : ''}"
               style="width: ${size}px; height: ${size}px; opacity: ${opacity}; transform: rotate(${plane.heading}deg);">
            <div style="
              width: ${size - 4}px;
              height: ${size - 4}px;
              background: ${bgColor};
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              border: 2px solid ${strokeColor};
              box-shadow: 0 2px 6px rgba(0,0,0,0.4);
            ">
              <svg viewBox="0 0 24 24" width="${size - 14}" height="${size - 14}" fill="${color}" stroke="${strokeColor}" stroke-width="0.5">
                ${svgPath}
              </svg>
            </div>
          </div>
        `;
    return { html, size };
  }

  function buildAircraftPopupContent(plane: Aircraft): string {
    const isHelicopter = plane.category === 'helicopter';
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
        parts.push(`<div><strong>Aircraft:</strong> ${escapeHtml(meta.manufacturer)} ${escapeHtml(meta.model)}</div>`);
      } else if (meta.model) {
        parts.push(`<div><strong>Model:</strong> ${escapeHtml(meta.model)}</div>`);
      }
      if (meta.registration) {
        parts.push(`<div><strong>Registration:</strong> ${escapeHtml(meta.registration)}</div>`);
      }
      if (meta.operator) {
        parts.push(`<div><strong>Operator:</strong> ${escapeHtml(meta.operator)}</div>`);
      } else if (meta.owner) {
        parts.push(`<div><strong>Owner:</strong> ${escapeHtml(meta.owner)}</div>`);
      }
      if (parts.length > 0) {
        metadataHtml = `<hr style="margin: 6px 0; border: none; border-top: 1px solid #eee;">${parts.join('')}`;
      }
    }

    return `
        <div style="min-width: 180px;">
          <strong style="font-size: 14px;">${categoryIcon} ${escapeHtml(plane.callsign)}</strong>
          <div style="font-size: 11px; color: #666; margin-top: 2px;">${escapeHtml(plane.origin)}</div>
          ${metadataHtml}
          <hr style="margin: 6px 0; border: none; border-top: 1px solid #eee;">
          <div style="font-size: 12px;">
            <div><strong>Altitude:</strong> ${altitudeStr} ft</div>
            <div><strong>Speed:</strong> ${speedStr} kts</div>
            <div><strong>Heading:</strong> ${Math.round(plane.heading)}°</div>
            <div>${verticalIndicator} (${plane.verticalRate > 0 ? '+' : ''}${plane.verticalRate} ft/min)</div>
            ${plane.squawk ? `<div><strong>Squawk:</strong> ${escapeHtml(plane.squawk)}${plane.isEmergency ? ' ⚠️' : ''}</div>` : ''}
          </div>
        </div>
      `;
  }

  function updateAircraftMarkers(aircraft: Aircraft[]) {
    if (!aircraftMarkers || !L) return;

    const seen = new Set<string>();

    for (const plane of aircraft) {
      seen.add(plane.id);
      const { html, size } = buildAircraftIconHtml(plane);
      const popupContent = buildAircraftPopupContent(plane);
      const existing = aircraftMarkerById.get(plane.id);

      if (existing) {
        const state = aircraftMarkerState.get(existing)!;
        existing.setLatLng([plane.location.lat, plane.location.lng]);
        if (state.iconHtml !== html) {
          existing.setIcon(L.divIcon({
            className: '',
            html,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          }));
          state.iconHtml = html;
        }
        if (state.popup !== popupContent) {
          // setContent updates an OPEN popup in place instead of closing it
          existing.getPopup()?.setContent(popupContent);
          state.popup = popupContent;
        }
        state.plane = plane;
      } else {
        const icon = L.divIcon({
          className: '',
          html,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        const marker = L.marker([plane.location.lat, plane.location.lng], { icon });
        marker.bindPopup(popupContent);
        aircraftMarkerState.set(marker, { iconHtml: html, popup: popupContent, plane });
        marker.on('click', () => {
          const state = aircraftMarkerState.get(marker);
          if (state) selectAircraft(state.plane);
        });
        aircraftMarkerById.set(plane.id, marker);
        aircraftMarkers.addLayer(marker);
      }
    }

    for (const [id, marker] of aircraftMarkerById) {
      if (!seen.has(id)) {
        aircraftMarkers.removeLayer(marker);
        aircraftMarkerById.delete(id);
      }
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

  /* Incident marker styles */
  :global(.incident-marker) {
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    border: 2px solid rgba(255, 255, 255, 0.8);
    transition: opacity 0.3s ease, transform 0.2s ease;
  }

  :global(.incident-marker:hover) {
    transform: scale(1.15);
    z-index: 1000 !important;
  }

  /* Fresh incident pulse animation */
  :global(.incident-marker.pulse-fresh) {
    animation: pulse-fresh 2s ease-in-out infinite;
  }

  @keyframes pulse-fresh {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7), 0 2px 6px rgba(0, 0, 0, 0.4);
    }
    50% {
      box-shadow: 0 0 0 8px rgba(255, 255, 255, 0), 0 2px 6px rgba(0, 0, 0, 0.4);
    }
  }

  /* Camera marker styles */
  :global(.camera-marker),
  :global(.dc-camera-marker),
  :global(.landmark-marker) {
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s ease;
  }

  :global(.camera-marker:hover),
  :global(.dc-camera-marker:hover),
  :global(.landmark-marker:hover) {
    transform: scale(1.15);
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
