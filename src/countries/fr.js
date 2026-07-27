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
  phone: { callingCode: '+33', normalizationStrategy: 'fr', placeholder: '06 12 34 56 78' },
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
