<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { mapState, userLocation, setMapBounds, DC_CENTER, DEFAULT_ZOOM, centerOnDC } from '$stores/location';
  import { filteredIncidents } from '$stores/filters';
  import { cameraList, selectCamera } from '$stores/cameras';
  import { selectIncident, selectedIncident } from '$stores/incidents';
  import { filters } from '$stores/filters';
  import { activeWeatherAlerts } from '$stores/weather';
  import { getSeverityColor, getIncidentTypeColor } from '$utils/format';
  import type { Incident, Camera, WeatherAlert } from '$types';

  let mapContainer: HTMLDivElement;
  let map: L.Map | null = null;
  let L: typeof import('leaflet') | null = null;
  let incidentMarkers: L.MarkerClusterGroup | null = null;
  let cameraMarkers: L.LayerGroup | null = null;
  let userMarker: L.Marker | null = null;
  let weatherLayers: L.LayerGroup | null = null;

  onMount(async () => {
    if (!browser) return;

    // Dynamically import Leaflet
    L = await import('leaflet');
    const { MarkerClusterGroup } = await import('leaflet.markercluster');

    // Initialize map
    map = L.map(mapContainer, {
      center: DC_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
    });

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    // Initialize marker groups
    incidentMarkers = new MarkerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (cluster) => {
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

    cameraMarkers = L.layerGroup().addTo(map);
    weatherLayers = L.layerGroup().addTo(map);

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
    const locationControl = L.control({ position: 'bottomright' });
    locationControl.onAdd = () => {
      const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      div.innerHTML = `
        <a href="#" title="My Location" style="display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; background: white; border-radius: 4px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2"/>
          </svg>
        </a>
      `;
      div.onclick = (e) => {
        e.preventDefault();
        if ($userLocation) {
          map?.setView($userLocation, 15);
        }
      };
      return div;
    };
    locationControl.addTo(map);

    // Add DC center control
    const dcControl = L.control({ position: 'bottomright' });
    dcControl.onAdd = () => {
      const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      div.innerHTML = `
        <a href="#" title="Center on DC" style="display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; background: white; border-radius: 4px; font-weight: bold; font-size: 10px;">
          DC
        </a>
      `;
      div.onclick = (e) => {
        e.preventDefault();
        centerOnDC();
        map?.setView(DC_CENTER, DEFAULT_ZOOM);
      };
      return div;
    };
    dcControl.addTo(map);
  });

  onDestroy(() => {
    if (map) {
      map.remove();
      map = null;
    }
  });

  // Update incident markers when filtered incidents change
  $: if (incidentMarkers && L && $filteredIncidents) {
    updateIncidentMarkers($filteredIncidents);
  }

  // Update camera markers when cameras change
  $: if (cameraMarkers && L && $cameraList && $filters.showCameras) {
    updateCameraMarkers($cameraList);
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

  // Center map when incident is selected
  $: if (map && $selectedIncident) {
    map.setView([$selectedIncident.location.lat, $selectedIncident.location.lng], 15);
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
</script>

<div bind:this={mapContainer} class="w-full h-full"></div>

<style>
  :global(.leaflet-container) {
    font-family: inherit;
  }
</style>
