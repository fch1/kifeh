// Profil pays — Tunisie (pays historique de Kifeh).
export const tn = {
  code: 'TN',
  name: { fr: 'Tunisie', ar: 'تونس' },
  defaultLanguage: 'fr',
  supportedLanguages: ['fr', 'ar'],
  directionByLanguage: { fr: 'ltr', ar: 'rtl' },
  timezone: 'Africa/Tunis',
  localeByLanguage: { fr: 'fr-TN', ar: 'ar-TN' },
  phone: { callingCode: '+216', normalizationStrategy: 'tn', placeholder: '+216 20 123 456' },
  map: {
    defaultCenter: [34.2, 9.6],
    defaultZoom: 6,
    maxBounds: [[29.5, 6.5], [38.5, 12.5]],
  },
  geocoding: {
    providers: ['nominatim', 'photon'],
    countryCodes: ['tn'],
    viewbox: '7.5,37.6,11.6,30.2', // lon1,lat1,lon2,lat2 (Nominatim)
  },
  // Niveaux administratifs : libellés locaux pour des champs génériques en base.
  administrativeLevels: [
    { field: 'administrative_level_1', fr: 'Gouvernorat', ar: 'ولاية' },
    { field: 'administrative_level_2', fr: 'Délégation', ar: 'معتمدية' },
    { field: 'administrative_level_3', fr: 'Municipalité', ar: 'بلدية' },
  ],
  // NASA FIRMS : zone rectangulaire d'appel + filtrage fin par polygone.
  firms: { bbox: '7.5,30.2,11.6,37.6', enabledFlag: 'nasa_firms_enabled' },
  enabledIncidentTypes: ['electricity', 'water', 'fire', 'internet'],
  // Frontière simplifiée (validation serveur ; l'affichage n'en a pas besoin).
  // Le tracé côtier est volontairement décalé VERS LE LARGE : aucune ville
  // côtière réelle (Kélibia, Monastir, Mahdia, Djerba, Zarzis…) ne doit jamais
  // tomber « hors Tunisie » à cause d'une simplification du littoral.
  polygons: [[
    [37.40, 9.75], [37.30, 10.25], [37.15, 10.80], [37.12, 11.12],
    [36.80, 11.25], [36.40, 10.95], [36.00, 10.75], [35.75, 11.00],
    [35.40, 11.25], [34.75, 11.35], [34.30, 10.50], [33.95, 10.80],
    [33.75, 11.15], [33.35, 11.45], [32.95, 11.65], [32.40, 11.60],
    [31.95, 10.75], [31.45, 10.30], [30.85, 10.05],
    [30.20, 9.90], [30.20, 9.30], [30.90, 9.05], [31.60, 9.10], [32.20, 8.60],
    [32.75, 8.35], [33.30, 8.15], [33.90, 7.75], [34.45, 7.85], [34.95, 8.30],
    [35.55, 8.35], [36.10, 8.25], [36.60, 8.30], [36.95, 8.65], [37.15, 9.05],
    [37.40, 9.75],
  ]],
};
