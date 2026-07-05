// Smart City — configuration
export const SB_URL = 'https://eaawnjvabcnznukewnlj.supabase.co';
export const SB_KEY = 'sb_publishable_tiGoGAebIqTF-gDldacKAw_IIlaYifh';
export const COLAB = 'https://colab.research.google.com/gist/ariel198989/ea2262e3b42826f94b7fdf6771afbadd/yolo-train.ipynb';
export const ADMINS = ['ariel@ao-fin.co.il', 'dahanlid555@gmail.com'];

export const BUCKET = 'smartcity';        // frames, crops, models
export const POOL_BUCKET = 'thinkcv';     // shared dataset ZIPs (proven pipeline)

export const DEFAULT_CITY = { name: 'שדרות', center_lat: 31.525, center_lng: 34.597, zoom: 14.5 };

export const CLASS_PALETTE = ['#22D3EE', '#F472B6', '#A78BFA', '#34D399', '#FBBF24', '#F87171', '#5aa9e6', '#e6c45a'];

// dark basemap that matches the design language (free, no key)
export const MAP_STYLE = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap © CARTO',
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
};
