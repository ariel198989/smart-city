export const SB_URL = 'https://eaawnjvabcnznukewnlj.supabase.co';
export const SB_KEY = 'sb_publishable_tiGoGAebIqTF-gDldacKAw_IIlaYifh';
export const COLAB = 'https://colab.research.google.com/gist/ariel198989/ea2262e3b42826f94b7fdf6771afbadd/yolo-train.ipynb';
export const ADMINS = ['ariel@ao-fin.co.il', 'dahanlid555@gmail.com'];

export const BUCKET = 'smartcity';        // frames, crops, models
export const POOL_BUCKET = 'thinkcv';     // shared dataset ZIPs (proven pipeline)

export const DEFAULT_CITY = { name: 'שדרות', center_lat: 31.525, center_lng: 34.597, zoom: 14.5 };

export const CLASS_PALETTE = ['#35E1FF', '#FFB627', '#FF6B6B', '#7CFFCB', '#C792EA', '#F78C6C', '#5aa9e6', '#e6c45a'];

// dark basemap matching the command-center design language (free, no key)
export const MAP_STYLE = {
  version: 8 as const,
  sources: {
    carto: {
      type: 'raster' as const,
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap © CARTO',
    },
    // real aerial photos of the city (free, no API key)
    satellite: {
      type: 'raster' as const,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Imagery © Esri',
    },
    // street labels overlay so satellite view still reads street names
    labels: {
      type: 'raster' as const,
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© CARTO',
    },
  },
  // satellite is the DEFAULT basemap (set at the style level so it never
  // depends on post-load JS, which raced/hit the wrong map instance).
  // Toggling "לוויין" off flips carto on / satellite+labels off at runtime.
  layers: [
    { id: 'carto', type: 'raster' as const, source: 'carto', layout: { visibility: 'none' as const } },
    { id: 'satellite', type: 'raster' as const, source: 'satellite' },
    { id: 'labels', type: 'raster' as const, source: 'labels' },
  ],
};
