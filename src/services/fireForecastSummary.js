// Synthèse TEXTUELLE déterministe des conditions (master prévisions §9).
// Des RÈGLES transparentes — jamais un texte génératif, jamais un score.
// Vocabulaire imposé : « conditions favorisant » / « tendance » ; le texte
// compare les prochains jours entre eux (rafales, humidité, pluie) et dit
// ce qui change et pourquoi. fr + ar, testé (aggravation / amélioration /
// stabilité / données partielles).

const DAY_NAMES = {
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};
const dayName = (iso, lang) => {
  const i = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return (DAY_NAMES[lang] || DAY_NAMES.fr)[i] || iso;
};

// « Sévérité conditionnelle » interne pour COMPARER deux jours entre eux —
// jamais affichée, jamais un score : seulement le sens de l'évolution.
function drynessSignal(d) {
  let s = 0;
  if (d.gustsMaxKmh != null && d.gustsMaxKmh >= 40) s += 2;
  else if (d.gustsMaxKmh != null && d.gustsMaxKmh >= 25) s += 1;
  if (d.rhMinPct != null && d.rhMinPct <= 25) s += 2;
  else if (d.rhMinPct != null && d.rhMinPct <= 35) s += 1;
  if (d.tMaxC != null && d.tMaxC >= 35) s += 1;
  if (d.precipMm != null && d.precipMm >= 5) s -= 2;
  else if (d.precipMm != null && d.precipMm >= 1) s -= 1;
  return s;
}

// Facteurs expliquant un ÉCART entre deux jours (le « pourquoi » du texte).
function factors(worse, better, lang) {
  const out = [];
  const F = (fr, ar) => out.push(lang === 'ar' ? ar : fr);
  if (worse.gustsMaxKmh != null && better.gustsMaxKmh != null
    && worse.gustsMaxKmh - better.gustsMaxKmh >= 10) F('des rafales plus fortes', 'رياح أقوى');
  if (worse.rhMinPct != null && better.rhMinPct != null
    && better.rhMinPct - worse.rhMinPct >= 8) F('une humidité plus faible', 'رطوبة أدنى');
  if (worse.tMaxC != null && better.tMaxC != null
    && worse.tMaxC - better.tMaxC >= 4) F('des températures plus élevées', 'حرارة أعلى');
  if ((better.precipMm ?? 0) - (worse.precipMm ?? 0) >= 3) F('l’absence de pluie', 'غياب الأمطار');
  return out;
}

// Synthèse sur les 3 prochains jours. Retourne null si données insuffisantes
// (jamais une phrase inventée sur du vide).
export function summarizeConditions(days, lang = 'fr') {
  const window3 = (days || []).slice(0, 3)
    .filter((d) => d && (d.gustsMaxKmh != null || d.rhMinPct != null));
  if (window3.length < 2) return null;
  const signals = window3.map(drynessSignal);
  const iMax = signals.indexOf(Math.max(...signals));
  const iMin = signals.indexOf(Math.min(...signals));
  const spread = signals[iMax] - signals[iMin];
  const ar = lang === 'ar';

  if (spread <= 1) {
    return ar
      ? 'الظروف الجوية مستقرة نسبيًا خلال الأيام الثلاثة القادمة.'
      : 'Les conditions météorologiques restent relativement stables sur les trois prochains jours.';
  }
  const worse = window3[iMax], better = window3[iMin];
  const why = factors(worse, better, lang);
  const whyTxt = why.length
    ? (ar ? `، أساسًا بسبب ${why.join(' و')}` : `, principalement en raison de ${why.join(' et de ')}`)
    : '';
  const when = dayName(worse.date, lang);
  if (iMax > iMin) {
    return ar
      ? `قد تصبح الظروف أكثر ملاءمة لانتشار الحرائق يوم ${when}${whyTxt}.`
      : `Les conditions pourraient devenir plus favorables à une propagation ${when}${whyTxt}.`;
  }
  return ar
    ? `يُنتظر أن تتحسّن الظروف بعد يوم ${when}${whyTxt ? whyTxt : ''}.`
    : `Les conditions devraient devenir moins favorables aux départs de feux après ${when}${whyTxt}.`;
}
