// Profil pays — Tunisie (pays historique de Kifeh).
export const tn = {
  code: 'TN',
  name: { fr: 'Tunisie', ar: 'تونس' },
  defaultLanguage: 'fr',
  supportedLanguages: ['fr', 'ar'],
  directionByLanguage: { fr: 'ltr', ar: 'rtl' },
  timezone: 'Africa/Tunis',
  localeByLanguage: { fr: 'fr-TN', ar: 'ar-TN' },
  currency: 'TND',
  // Numéros VÉRIFIÉS (annuaire officiel — déjà servis par l'écran d'urgence) :
  // Protection civile 198, Police 197, SAMU 190. JAMAIS de numéro français ici.
  emergencyNumbers: {
    fire: ['198'],
    police: ['197'],
    medical: ['190'],
  },
  // Capacités du territoire — la Tunisie bénéficie de TOUTES les capacités
  // génériques compatibles avec ses sources vérifiées (FIRMS, signalements,
  // replay, alertes). Les capacités absentes portent leur raison honnête :
  // rien n'est simulé, aucun fournisseur français n'est utilisé hors de sa
  // couverture, aucune page tunisienne ne mentionne EFFIS/DFCI/AROME.
  capabilities: {
    citizenReports:    { enabled: true },
    thermalDetections: { enabled: true, provider: 'nasa-firms', settingFlag: 'nasa_firms_enabled' },
    burnedAreas:       { enabled: false, reason: 'coverage_to_verify' },   // couverture EFFIS hors UE à vérifier
    weatherModel:      { enabled: false, reason: 'model_to_integrate', candidateProvider: 'open-meteo' },
    airQuality:        { enabled: false, reason: 'not_yet_enabled', candidateProvider: 'open-meteo-air' },
    officialAlerts:    { enabled: false, reason: 'no_verified_source' },
    roadEvents:        { enabled: false, reason: 'no_verified_source' },
    emergencyGrid:     { enabled: false, reason: 'not_applicable' },       // carroyage type DFCI : concept français
    // Même mécanique que la France (#82) — couverture ADS-B tunisienne plus
    // clairsemée, dit honnêtement par la note ; drapeau à chaud, éteint.
    aircraft:          { enabled: true, provider: 'adsb-airplanes-live', label: 'ADS-B (airplanes.live)', settingFlag: 'fire_aircraft_enabled_tn' },
    // La charte fumée est actée (04/08) mais la Tunisie attend d'abord un
    // modèle de vent fin DÉCLARÉ (#82) — jamais un panache sur un vent flou.
    smokeSimulation:   { enabled: false, reason: 'model_to_integrate' },
    replay:            { enabled: true }, // détections FIRMS TN immuables + horodatées : rejouables
  },
  // Fonds de carte actuels (identiques : raster OSM + repli Carto).
  // Sentinel-2 cloudless : candidat satellite, conditions d'usage à relire.
  basemaps: {
    default: 'osm-raster',
    fallback: 'carto-voyager',
    satellite: null,
    satelliteCandidate: { provider: 'sentinel-2-cloudless', blocked: 'license_review_pending' },
  },
  phone: { callingCode: '+216', normalizationStrategy: 'tn', placeholder: '+216 20 123 456' },
  // Zones SEO par gouvernorat (#83) : l'audience réelle (GA4) est à Tunis et
  // Sfax — pages serveur UTILES là où vivent les gens. Emprises APPROXIMATIVES.
  seoZones: [
    { slug: 'tunis', name: { fr: 'Tunis', ar: 'تونس' }, center: [36.8, 10.18], zoom: 11,
      bbox: { minLat: 36.68, maxLat: 36.95, minLng: 10.05, maxLng: 10.35 } },
    { slug: 'sfax', name: { fr: 'Sfax', ar: 'صفاقس' }, center: [34.74, 10.76], zoom: 10,
      bbox: { minLat: 34.2, maxLat: 35.3, minLng: 9.8, maxLng: 11.2 } },
    { slug: 'sousse', name: { fr: 'Sousse', ar: 'سوسة' }, center: [35.83, 10.64], zoom: 11,
      bbox: { minLat: 35.5, maxLat: 36.1, minLng: 10.3, maxLng: 10.8 } },
    { slug: 'bizerte', name: { fr: 'Bizerte', ar: 'بنزرت' }, center: [37.27, 9.87], zoom: 10,
      bbox: { minLat: 36.9, maxLat: 37.35, minLng: 8.9, maxLng: 10.1 } },
    { slug: 'nabeul', name: { fr: 'Nabeul', ar: 'نابل' }, center: [36.45, 10.73], zoom: 10,
      bbox: { minLat: 36.35, maxLat: 37.1, minLng: 10.5, maxLng: 11.15 } },
  ],
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
