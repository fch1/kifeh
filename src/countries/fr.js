// Profil pays — France (métropole + Corse).
// Couverture EXPLICITE : France métropolitaine et Corse uniquement — les
// territoires d'outre-mer ne sont pas couverts par les polygones ci-dessous
// et ne doivent pas être suggérés par l'interface.
export const fr = {
  code: 'FR',
  name: { fr: 'France', ar: 'فرنسا' },
  defaultLanguage: 'fr',
  supportedLanguages: ['fr', 'ar'],
  directionByLanguage: { fr: 'ltr', ar: 'rtl' },
  timezone: 'Europe/Paris', // IANA : gère heure d'été/hiver automatiquement
  localeByLanguage: { fr: 'fr-FR', ar: 'ar' },
  currency: 'EUR',
  // Numéros VÉRIFIÉS (service-public.fr) : pompiers 18, police 17, SAMU 15,
  // urgence européenne 112, SMS sourds/malentendants 114.
  emergencyNumbers: {
    fire: ['18', '112'],
    police: ['17', '112'],
    medical: ['15', '112'],
    deafSms: ['114'],
  },
  // Capacités du territoire — CONCEPTS génériques, fournisseurs = configuration.
  // Tout `enabled: true` correspond à une intégration RÉELLEMENT en production
  // (docs/FIRE_PLATFORM_CURRENT_STATE.md) ; les indisponibilités portent leur
  // raison (vocabulaire fermé de schema.js).
  capabilities: {
    citizenReports:    { enabled: true },
    thermalDetections: { enabled: true, provider: 'nasa-firms', settingFlag: 'fr_nasa_firms_enabled' },
    burnedAreas:       { enabled: true, provider: 'copernicus-effis' },
    weatherModel:      {
      enabled: true, provider: 'open-meteo',
      model: 'meteofrance_arome_france_hd',
      label: 'AROME France HD (Météo-France) via Open-Meteo',
    },
    airQuality:        { enabled: true, provider: 'open-meteo-air' },
    officialAlerts:    { enabled: true, provider: 'meteofrance-vigilance', requiresEnv: 'METEOFRANCE_API_KEY' },
    roadEvents:        { enabled: true, provider: 'bison-fute' },
    // Carroyage DFCI : CALCUL actif, AFFICHAGE public derrière drapeau
    // (décision opérationnelle en attente — docs/DFCI.md).
    emergencyGrid:     {
      enabled: true, provider: 'dfci-2km',
      computeFlag: 'dfci_enabled_fr', displayFlag: 'dfci_public_display_enabled',
    },
    // Licence airplanes.live VÉRIFIÉE (31/07) : non commercial ✓, 1 req/s,
    // sans clé. Ingestion serveur livrée (#82) — ouverture par drapeau à chaud
    // quand l'INTERFACE calques (Phase 1, maquette validée) saura l'accueillir.
    aircraft:          { enabled: true, provider: 'adsb-airplanes-live', label: 'ADS-B (airplanes.live)', settingFlag: 'fire_aircraft_enabled_fr' },
    smokeSimulation:   { enabled: false, reason: 'charter_decision_pending' },
    replay:            { enabled: true },
  },
  // Fonds de carte ACTUELS (raster OSM + repli Carto — réglages à chaud).
  // IGN orthophoto : accès sondé, conditions d'usage NON relues → candidat.
  basemaps: {
    default: 'osm-raster',
    fallback: 'carto-voyager',
    satellite: null,
    satelliteCandidate: { provider: 'ign-ortho', blocked: 'license_review_pending' },
  },
  phone: { callingCode: '+33', normalizationStrategy: 'fr', placeholder: '06 12 34 56 78' },
  // Zones SEO départementales (#83) : pages serveur UTILES par département —
  // départements à fort enjeu feu d'abord. Emprises APPROXIMATIVES (comptes
  // « autour de », jamais des frontières administratives exactes).
  seoZones: [
    { slug: 'gironde', name: { fr: 'Gironde', ar: 'جيروند' }, center: [44.84, -0.58], zoom: 9,
      bbox: { minLat: 44.19, maxLat: 45.57, minLng: -1.26, maxLng: 0.32 } },
    { slug: 'landes', name: { fr: 'Landes', ar: 'لاند' }, center: [43.9, -0.77], zoom: 9,
      bbox: { minLat: 43.49, maxLat: 44.53, minLng: -1.53, maxLng: 0.14 } },
    { slug: 'var', name: { fr: 'Var', ar: 'فار' }, center: [43.46, 6.24], zoom: 9,
      bbox: { minLat: 42.98, maxLat: 43.81, minLng: 5.66, maxLng: 6.93 } },
    { slug: 'bouches-du-rhone', name: { fr: 'Bouches-du-Rhône', ar: 'بوش دو رون' }, center: [43.44, 5.09], zoom: 9,
      bbox: { minLat: 43.16, maxLat: 43.92, minLng: 4.23, maxLng: 5.81 } },
    { slug: 'herault', name: { fr: 'Hérault', ar: 'إيرو' }, center: [43.58, 3.4], zoom: 9,
      bbox: { minLat: 43.21, maxLat: 43.97, minLng: 2.54, maxLng: 4.19 } },
    { slug: 'corse-du-sud', name: { fr: 'Corse-du-Sud', ar: 'كورسيكا الجنوبية' }, center: [41.86, 8.97], zoom: 9,
      bbox: { minLat: 41.33, maxLat: 42.38, minLng: 8.53, maxLng: 9.41 } },
    { slug: 'haute-corse', name: { fr: 'Haute-Corse', ar: 'كورسيكا العليا' }, center: [42.4, 9.2], zoom: 9,
      bbox: { minLat: 41.83, maxLat: 43.03, minLng: 8.57, maxLng: 9.56 } },
  ],
  map: {
    defaultCenter: [46.6, 2.4],
    defaultZoom: 6,
    maxBounds: [[40.5, -6.5], [51.8, 10.5]],
  },
  geocoding: {
    // Service officiel Géoplateforme d'abord, replis restreints à la France.
    providers: ['geoplateforme', 'nominatim', 'photon'],
    countryCodes: ['fr'],
    viewbox: '-5.2,51.2,9.7,41.2',
  },
  administrativeLevels: [
    { field: 'administrative_level_1', fr: 'Région', ar: 'جهة' },
    { field: 'administrative_level_2', fr: 'Département', ar: 'مقاطعة' },
    { field: 'administrative_level_3', fr: 'Commune', ar: 'بلدية' },
  ],
  firms: { bbox: '-5.2,41.2,9.7,51.2', enabledFlag: 'fr_nasa_firms_enabled' },
  enabledIncidentTypes: ['electricity', 'water', 'fire', 'internet'],
  // Le tracé côtier est volontairement décalé VERS LE LARGE : aucune ville
  // côtière réelle (Marseille, Calais, Le Havre, Dunkerque…) ne doit jamais
  // tomber « hors France » à cause d'une simplification du littoral.
  polygons: [
    // Métropole (frontière simplifiée)
    [
      [51.20, 2.60], [51.05, 1.70], [50.85, 1.45], [50.20, 1.35], [49.90, 0.55],
      [49.55, -0.10], [49.45, -0.60], [49.75, -1.35], [49.75, -2.00], [48.85, -1.70], [48.70, -2.45],
      [48.80, -3.60], [48.60, -4.85], [48.00, -4.90], [47.75, -4.30], [47.25, -3.00],
      [46.85, -2.30], [46.25, -1.90], [45.55, -1.35], [44.60, -1.40], [43.50, -1.75],
      [43.35, -1.80], [42.95, -1.40], [42.80, -0.60], [42.85, 0.65], [42.60, 1.45],
      [42.45, 2.05], [42.30, 3.20], [43.05, 3.25], [43.30, 4.00], [43.35, 4.85],
      [43.15, 5.40], [42.95, 5.95], [43.00, 6.60], [43.50, 7.15], [43.70, 7.60],
      [44.15, 7.05], [44.85, 6.90], [45.20, 7.15], [45.90, 6.85], [46.25, 5.95],
      [46.45, 6.85], [47.05, 7.05], [47.55, 7.60], [48.05, 7.60], [48.95, 8.25],
      [49.20, 6.75], [49.50, 5.90], [49.55, 4.85], [50.15, 4.20], [50.55, 3.90],
      [50.80, 3.15], [51.20, 2.60],
    ],
    // Corse (simplifiée, décalée vers le large)
    [
      [43.10, 9.40], [42.65, 9.60], [42.00, 9.70], [41.50, 9.40], [41.30, 9.15],
      [41.50, 8.65], [42.10, 8.45], [42.70, 8.45], [43.05, 9.00], [43.10, 9.40],
    ],
  ],
};
