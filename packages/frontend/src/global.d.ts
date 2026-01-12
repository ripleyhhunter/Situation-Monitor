// Type declarations for leaflet.heat
declare module 'leaflet.heat' {
  // This module extends Leaflet with heatLayer when imported
  export {};
}

// Extend Leaflet types
declare namespace L {
  interface HeatLayerOptions {
    minOpacity?: number;
    maxZoom?: number;
    max?: number;
    radius?: number;
    blur?: number;
    gradient?: { [key: number]: string };
  }

  function heatLayer(
    latlngs: Array<[number, number] | [number, number, number]>,
    options?: HeatLayerOptions
  ): Layer;
}
