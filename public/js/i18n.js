// Internationalisation côté client : français / arabe (RTL).
// Langue par défaut = langue de l'appareil (arabe si le device est en arabe,
// français sinon) ; le choix de l'utilisateur est sauvegardé.
'use strict';

const I18N = {
  fr: {
    app_name: 'Kifeh',
    // Communs
    back: 'Retour', continue: 'Continuer', validate: 'Valider', send: 'Envoyer',
    save: 'Enregistrer', loading: 'Chargement…', see_map: 'Voir la carte', back_map: 'Retour à la carte',
    sms: '📱 SMS', email: '✉️ E-mail',
    phone_label: 'Numéro de téléphone (indicatif international)', phone_ph: '+216 20 123 456',
    email_label: 'Adresse e-mail', email_ph: 'vous@exemple.tn',
    offline_banner: 'Connexion instable — mode hors-ligne. Vos saisies sont conservées.',
    err_offline: 'Connexion internet indisponible. Vos saisies sont conservées, réessayez.',
    err_server: 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.',
    lang_button: 'العربية',
    sandbox_banner: '🧪 Environnement de test (sandbox) — les données sont fictives et effacées automatiquement.',
    // Types / statuts / gravité
    type_electricity: 'Électricité', type_water: 'Eau', type_fire: 'Incendie',
    type_internet: 'Internet', type_other: 'Autre',
    status_active: 'En cours', status_resolved: 'Résolu', status_expired: 'Expiré',
    status_pending_review: 'En cours de validation', status_pending_verification: 'En attente de vérification',
    status_possible_duplicate: 'Potentiellement dupliqué', status_verified: 'Vérifié',
    status_rejected: 'Rejeté', status_deleted: 'Supprimé', status_draft: 'Brouillon',
    sev_low: 'Faible', sev_moderate: 'Modéré', sev_high: 'Important', sev_immediate_danger: 'Danger immédiat',
    time_now: 'à l’instant', time_min: 'il y a {n} min', time_h: 'il y a {n} h', time_d: 'il y a {n} j',
    // Accueil
    search_ph: 'Rechercher une adresse, ville, code postal…',
    search_aria: 'Rechercher une adresse, une ville, un code postal ou un quartier',
    filters_aria: 'Filtres rapides par type d’incident',
    chip_ongoing: 'En cours uniquement', chip_filters: 'Plus de filtres',
    counter_none: 'Aucun incident en cours dans cette zone',
    counter_one: '1 incident en cours dans cette zone',
    counter_n: '{n} incidents en cours dans cette zone',
    my_position: '📍 Ma position', list_btn: '☰ Liste', legal_aria: 'Informations légales et urgences',
    declare_btn: 'Déclarer un incident',
    filters_title: 'Filtres', filter_status: 'Statut',
    filter_status_all: 'En cours + récemment résolus', filter_status_active: 'En cours uniquement',
    filter_status_resolved: 'Récemment résolus',
    filter_types: 'Types d’incident',
    filter_period: 'Période de signalement', filter_period_all: 'Toute la période',
    filter_1h: 'Dernière heure', filter_3h: 'Trois dernières heures', filter_24h: 'Dernières 24 heures',
    reset: 'Réinitialiser les filtres', apply: 'Appliquer',
    filter_results_none: 'Aucun incident ne correspond à ces filtres.',
    filter_results_one: '1 incident correspond à ces filtres',
    filter_results_n: '{n} incidents correspondent à ces filtres',
    list_title: 'Incidents visibles', sort_aria: 'Trier la liste',
    sort_time: 'Plus récents', sort_near: 'Proximité', sort_severity: 'Gravité',
    list_empty: 'Aucun incident dans la zone affichée.',
    detail_aria: 'Détail de l’incident', sheet_filters_aria: 'Filtres des incidents', sheet_list_aria: 'Liste des incidents',
    area_approx: 'Zone approximative', ref: 'réf.', started: 'Début :', ended: 'Fin :',
    severity_label: 'Gravité :', last_update: 'Dernière mise à jour :', approx_suffix: '(approximatif)',
    started_ago: 'débuté', severity_short: 'gravité',
    confirmed_one: '👥 1 personne a confirmé cet incident.',
    confirmed_n: '👥 {n} personnes ont confirmé cet incident.',
    im_affected: 'Je suis aussi concerné', report_content: 'Signaler un contenu incorrect',
    you_confirmed: '✔ Vous avez confirmé cet incident',
    affected_one: '1 personne est concernée', affected_n: '{n} personnes sont concernées',
    // Incendies — confirmation communautaire
    fire_to_confirm: 'Incendie à confirmer',
    fire_confirmed_comm: 'Incendie confirmé par la communauté',
    confirm_fire_btn: '🔥 Confirmer cet incendie',
    fire_progress: '{n} confirmation(s) sur {total}',
    fire_progress_done: '{total} confirmations — confirmé par la communauté',
    fire_not_official: 'Signal communautaire uniquement — ne représente pas une confirmation officielle des services de secours.',
    // Fin d'incident signalée par la communauté
    ended_report_btn: 'Signaler que cet incident est terminé',
    ended_q: 'Cet incident est-il vraiment terminé ?',
    ended_time_label: 'Heure de fin approximative',
    ended_comment_label: 'Commentaire (facultatif)',
    ended_send: 'Confirmer la fin de l’incident',
    ended_reports_one: '1 personne signale que cet incident est terminé',
    ended_reports_n: '{n} personnes signalent que cet incident est terminé',
    // Correction de localisation
    loc_correct_title: 'Corriger la localisation',
    loc_correct_hint_public: 'Déplacez le repère, recherchez une adresse ou utilisez votre position. La proposition sera vérifiée avant d’être appliquée à l’incident existant.',
    loc_correct_hint_owner: 'Déplacez le repère, recherchez une adresse ou utilisez votre position. La correction est appliquée immédiatement à votre déclaration.',
    loc_correct_send: 'Envoyer la proposition de correction',
    loc_correct_apply: 'Appliquer la nouvelle position',
    loc_correct_preview: 'Nouvelle position :',
    // Numéros utiles / urgences (les numéros viennent de l'annuaire vérifié)
    emergency_title: 'En cas d’urgence',
    useful_numbers: 'Numéros utiles',
    call_btn: '📞 Appeler {name} — {num}',
    fire_safety_msg: 'En cas de danger immédiat, éloignez-vous de la zone et appelez immédiatement la Protection civile au 198. Votre déclaration sur Kifeh ne contacte pas automatiquement les secours.',
    fire_safety_donts: 'N’approchez pas du feu, n’entrez pas dans un bâtiment enfumé, et n’attendez ni confirmations communautaires, ni détection satellite, ni modération pour appeler les secours.',
    provider_note_electricity: 'Kifeh enregistre un signalement communautaire : il n’est pas transmis automatiquement à la STEG. Pour une intervention officielle, contactez directement la STEG (la référence client de votre facture peut vous être demandée).',
    provider_note_water: 'Kifeh enregistre un signalement communautaire : il n’est pas transmis automatiquement à la SONEDE. Pour une réclamation officielle ou une intervention, contactez directement la SONEDE.',
    provider_note_danger: 'En cas de danger immédiat (incendie, câbles exposés, inondation dangereuse), appelez d’abord la Protection civile au 198.',
    done_success_note: 'Votre signalement a été enregistré. Il contribue à informer les personnes présentes dans la zone, mais ne remplace pas un appel aux autorités.',
    kifeh_disclaimer: 'Kifeh est une initiative citoyenne tunisienne indépendante. Elle permet de partager des informations avec la communauté, mais ne remplace pas les autorités, les services d’urgence, la STEG ou la SONEDE.',
    map_aria: 'Carte des incidents', you_are_here: 'Vous êtes ici (position non partagée)',
    geo_unavailable: 'La géolocalisation n’est pas disponible sur cet appareil.',
    geo_not_found: 'Position indisponible. Vous pouvez rechercher une adresse à la place.',
    addr_not_found: 'Adresse introuvable — essayez une formulation plus simple',
    search_error: 'Recherche momentanément indisponible — réessayez, ou pointez la carte directement.',
    cluster_title: '{n} incidents — toucher pour zoomer',
    // Confirmation « aussi concerné »
    confirm_title: 'Confirmer : je suis aussi concerné',
    confirm_hint: 'Une vérification rapide évite les faux signalements. Aucune donnée n’est publiée.',
    confirm_method_aria: 'Moyen de vérification',
    consent_confirm: 'J’accepte que mon contact soit utilisé pour vérifier cette confirmation et prévenir les abus.',
    receive_code: 'Recevoir le code', code_label: 'Code reçu (6 chiffres)',
    validate_confirm: 'Valider ma confirmation',
    thanks_one: 'Merci ! 1 personne a confirmé cet incident.',
    thanks_n: 'Merci ! {n} personnes ont confirmé cet incident.',
    // Signalement
    report_reason: 'Motif', report_detail: 'Précisions (facultatif)', report_send: 'Envoyer le signalement',
    reason_wrong_location: 'La localisation est incorrecte', reason_not_real: 'Cet incident n’existe pas',
    reason_resolved: 'L’incident est déjà résolu', reason_inappropriate: 'Contenu inapproprié', reason_other: 'Autre',
    // Déclaration — navigation
    step_of: 'Étape {n} sur 6', step_done_hint: 'Terminé', step_verif_hint: 'Vérification',
    t_type: 'Type d’incident', t_location: 'Localisation', t_period: 'Période', t_desc: 'Description',
    t_dup: 'Incident similaire', t_contact: 'Vos coordonnées', t_verif: 'Vérification', t_done: 'Confirmation',
    back_aria: 'Revenir à l’étape précédente',
    // Étape 1
    type_q: 'Quel est le type d’incident ?', type_group_aria: 'Type d’incident',
    card_electricity: 'Panne d’électricité', card_water: 'Coupure / panne d’eau',
    card_fire: 'Incendie', card_internet: 'Coupure internet', card_other: 'Autre incident',
    fire_warning: 'En cas de danger immédiat, éloignez-vous de la zone et contactez immédiatement les services d’urgence : 198 (protection civile) ou 190 (SAMU).',
    fire_warning_suffix: 'Cette déclaration ne déclenche pas automatiquement l’intervention des secours.',
    // Étape 2
    loc_q: 'Où se situe l’incident ?',
    loc_privacy: '🔒 Votre adresse exacte ne sera jamais publiée : la carte publique affiche une position approximative (~250 m). La localisation précise n’est visible que des opérateurs autorisés.',
    use_position: '📍 Utiliser ma position actuelle',
    or_address: 'Ou saisissez une adresse', addr_ph: '12 rue Exemple, Tunis…',
    move_marker: 'Vous pouvez aussi déplacer le repère directement sur la carte.',
    minimap_aria: 'Carte pour positionner l’incident',
    confirm_position: 'Confirmer cette position',
    addr_searching: 'Recherche de l’adresse…',
    addr_saved: '📍 Position enregistrée (adresse non résolue — vous pouvez continuer)',
    addr_manual_hint: 'Adresse introuvable — vous pouvez pointer la carte directement',
    geo_denied: 'Autorisation refusée. Saisissez une adresse ou positionnez le repère sur la carte.',
    geo_failed: 'Position introuvable. Saisissez une adresse ou positionnez le repère sur la carte.',
    geo_imprecise: 'Position imprécise (±{m} m). Ajustez le repère ou saisissez une adresse.',
    geo_device_unavailable: 'Géolocalisation indisponible sur cet appareil. Saisissez une adresse ou pointez la carte.',
    // Étape 3
    time_q: 'Quand a lieu l’incident ?', temporal_aria: 'Statut temporel',
    temporal_ongoing: 'En cours', temporal_finished: 'Terminé', temporal_planned: 'Prévu',
    start_label: 'Date et heure de début', now_btn: 'Maintenant',
    end_label: 'Date et heure de fin',
    approx_check: 'Je ne connais pas l’heure exacte (heure approximative)',
    ongoing_hint: 'Pas d’heure de fin à indiquer : vous pourrez revenir clôturer l’incident plus tard grâce à un lien de suivi.',
    err_start_required: 'Indiquez la date et l’heure de début (bouton « Maintenant » si l’incident vient de commencer).',
    err_start_future: 'La date de début ne peut pas être dans le futur.',
    err_end_required: 'Indiquez la date et l’heure de fin.',
    err_end_before: 'L’heure de fin ne peut pas être antérieure à l’heure de début.',
    // Étape 4
    desc_q: 'Décrivez l’incident', desc_label: 'Courte description (facultatif)',
    desc_ph: 'Ex. : coupure d’électricité dans tout l’immeuble depuis 20 h',
    sev_q: 'Niveau de gravité perçu', sev_aria: 'Gravité', sev_danger_short: 'Danger',
    affected_label: 'Logements ou personnes affectés (facultatif)', affected_ph: 'Ex. : 40',
    photo_label: 'Photo ou vidéo (facultatif)',
    photo_note: 'Les métadonnées (dont la position GPS) sont automatiquement retirées des photos.',
    comment_label: 'Commentaire complémentaire (facultatif)',
    err_desc_required: 'Une courte description est nécessaire.',
    publish_now: 'Publier le signalement',
    // Doublons
    dup_title: 'Un incident similaire existe déjà',
    dup_text: 'Un incident du même type a été signalé à proximité. Êtes-vous concerné par celui-ci ?',
    dup_near: 'Zone proche', dup_confirm: '✔ Confirmer que je suis également concerné',
    dup_new: 'Continuer avec une nouvelle déclaration',
    dup_confirmations_one: '1 confirmation', dup_confirmations_n: '{n} confirmations',
    // Étape 5
    contact_q: 'Vérification du déclarant',
    contact_hint: 'Pour publier votre déclaration, nous devons vérifier un moyen de contact. Aucun compte n’est créé.',
    method_aria: 'Moyen de vérification', method_sms: '📱 Téléphone (SMS)', method_email: '✉️ E-mail',
    email_link_pref: 'Recevoir un lien de confirmation (sinon, un code à saisir)',
    honeypot_label: 'Ne pas remplir',
    consent_strong: 'Obligatoire :',
    consent_text: 'j’accepte que mes coordonnées soient utilisées pour vérifier cette déclaration, prévenir les abus et permettre la mise à jour de l’incident. Elles ne seront jamais publiées.',
    consent_more: 'En savoir plus',
    err_consent: 'Vous devez accepter l’utilisation de vos coordonnées pour la vérification.',
    get_code_btn: 'Recevoir le code de vérification',
    // Étape 6
    otp_title: 'Saisissez le code reçu', otp_label: 'Code à 6 chiffres',
    otp_hint_sms: 'Code envoyé par SMS au {phone}. Valable 10 minutes.',
    otp_hint_email: 'Code envoyé par e-mail à {email}. Valable 10 minutes.',
    err_otp_format: 'Le code comporte 6 chiffres.',
    resend_code: 'Renvoyer le code', resend_link: 'Renvoyer le lien',
    email_wait_title: 'Consultez votre boîte mail',
    email_sent_to: 'Nous avons envoyé un lien de confirmation à',
    email_wait_hint: 'Ouvrez le lien depuis cet appareil pour finaliser votre déclaration. Le lien est valable 60 minutes et ne peut être utilisé qu’une seule fois.',
    waiting: 'En attente de confirmation…', email_confirmed: 'Déclaration confirmée !',
    email_confirmed_alt: 'Si vous avez confirmé via l’e-mail, votre déclaration est publiée. Consultez le lien de gestion reçu par e-mail, ou retournez à la carte.',
    // Confirmation finale
    done_saved: 'Votre déclaration est enregistrée.',
    done_follow: 'Suivi de votre déclaration',
    done_follow_hint: 'Conservez ce lien : il permet de mettre à jour, clôturer ou supprimer votre déclaration. Il vous a aussi été envoyé par SMS ou e-mail.',
    manage_my: 'Gérer ma déclaration', copy_link: 'Copier le lien', link_copied: 'Lien copié ✓',
    copy_prompt: 'Copiez ce lien :',
    pending_review_note: 'Votre déclaration sera visible après une rapide validation par nos équipes.',
    visible_note: 'Votre déclaration est visible sur la carte publique (position approximative).',
    email_link_sent_note: 'Le lien de gestion vous a été envoyé par e-mail.',
    // Gestion
    manage_title: 'Ma déclaration',
    manage_missing: 'Lien de gestion manquant. Utilisez le lien reçu par SMS ou e-mail.',
    expires_in: 'Expire automatiquement sans confirmation :',
    confirmed_people: '👥 {n} personne(s) ont confirmé',
    visible_only_you: '(visible uniquement par vous et les opérateurs)',
    position_saved: 'Position enregistrée',
    still_q: 'L’incident est-il toujours en cours ?',
    yes_ongoing: 'Oui, toujours en cours', no_finished: 'Non, il est terminé',
    close_incident: 'Clôturer l’incident',
    end_time: 'Heure de fin', end_approx: 'Heure approximative', confirm_close: 'Confirmer la clôture',
    update_desc_title: 'Mettre à jour la description',
    other_actions: 'Autres actions',
    report_loc: 'Signaler une erreur de localisation', describe_error: 'Décrivez l’erreur (facultatif)',
    delete_mine: 'Supprimer ma déclaration',
    delete_note: 'La suppression retire l’incident de la carte et programme l’effacement de vos coordonnées.',
    confirm_delete: 'Supprimer définitivement cette déclaration ?',
    deleted_ok: 'Votre déclaration a été supprimée.',
    thanks_extended: 'Merci ! L’incident reste affiché comme en cours.',
    closed_thanks: 'Incident clôturé. Merci pour votre mise à jour !',
    desc_updated: 'Description mise à jour.',
    // Vérification e-mail (page)
    verify_title: 'Confirmation de votre déclaration',
    verifying: 'Vérification du lien en cours…',
    verify_ok: 'Votre déclaration est confirmée et enregistrée.',
    verify_follow: 'Suivi',
    verify_follow_hint: 'Ce lien permet de mettre à jour ou clôturer votre déclaration (il vous a aussi été envoyé par e-mail) :',
    verify_invalid: 'Lien invalide ou incomplet.',
    verify_expired_hint: 'Si le lien a expiré ou a déjà été utilisé, retournez sur l’écran de déclaration pour demander un nouvel envoi, ou consultez l’e-mail le plus récent.',
  },
  ar: {
    app_name: 'كيفاه',
    back: 'رجوع', continue: 'متابعة', validate: 'تأكيد', send: 'إرسال',
    save: 'حفظ', loading: 'جارٍ التحميل…', see_map: 'عرض الخريطة', back_map: 'العودة إلى الخريطة',
    sms: '📱 رسالة نصية', email: '✉️ بريد إلكتروني',
    phone_label: 'رقم الهاتف (بالصيغة الدولية)', phone_ph: '+216 20 123 456',
    email_label: 'البريد الإلكتروني', email_ph: 'you@example.tn',
    offline_banner: 'الاتصال غير مستقر — وضع عدم الاتصال. مدخلاتك محفوظة.',
    err_offline: 'لا يوجد اتصال بالإنترنت. مدخلاتك محفوظة، حاول مرة أخرى.',
    err_server: 'الخادم لا يستجيب. تحقق من اتصالك وحاول مرة أخرى.',
    lang_button: 'Français',
    sandbox_banner: '🧪 بيئة تجريبية (Sandbox) — البيانات وهمية وتُحذف تلقائيًا.',
    type_electricity: 'كهرباء', type_water: 'ماء', type_fire: 'حريق',
    type_internet: 'إنترنت', type_other: 'أخرى',
    status_active: 'جارٍ', status_resolved: 'تمت المعالجة', status_expired: 'منتهي',
    status_pending_review: 'قيد المراجعة', status_pending_verification: 'في انتظار التحقق',
    status_possible_duplicate: 'قد يكون مكررًا', status_verified: 'تم التحقق',
    status_rejected: 'مرفوض', status_deleted: 'محذوف', status_draft: 'مسودة',
    sev_low: 'خفيفة', sev_moderate: 'متوسطة', sev_high: 'كبيرة', sev_immediate_danger: 'خطر فوري',
    time_now: 'منذ لحظات', time_min: 'منذ {n} دقيقة', time_h: 'منذ {n} ساعة', time_d: 'منذ {n} يوم',
    search_ph: 'ابحث عن عنوان أو مدينة أو ترقيم بريدي…',
    search_aria: 'البحث عن عنوان أو مدينة أو ترقيم بريدي أو حي',
    filters_aria: 'تصفية سريعة حسب نوع الحادث',
    chip_ongoing: 'الجارية فقط', chip_filters: 'مزيد من الفلاتر',
    counter_none: 'لا توجد حوادث جارية في هذه المنطقة',
    counter_one: 'حادث واحد جارٍ في هذه المنطقة',
    counter_n: '{n} حوادث جارية في هذه المنطقة',
    my_position: '📍 موقعي', list_btn: '☰ القائمة', legal_aria: 'معلومات قانونية وأرقام النجدة',
    declare_btn: 'التبليغ عن حادث',
    filters_title: 'الفلاتر', filter_status: 'الحالة',
    filter_status_all: 'الجارية + المعالجة حديثًا', filter_status_active: 'الجارية فقط',
    filter_status_resolved: 'المعالجة حديثًا',
    filter_types: 'أنواع الحوادث',
    filter_period: 'فترة التبليغ', filter_period_all: 'كامل الفترة',
    filter_1h: 'آخر ساعة', filter_3h: 'آخر ثلاث ساعات', filter_24h: 'آخر 24 ساعة',
    reset: 'إعادة تعيين الفلاتر', apply: 'تطبيق',
    filter_results_none: 'لا يوجد أي حادث مطابق لهذه الفلاتر.',
    filter_results_one: 'حادث واحد مطابق لهذه الفلاتر',
    filter_results_n: '{n} حوادث مطابقة لهذه الفلاتر',
    list_title: 'الحوادث الظاهرة', sort_aria: 'ترتيب القائمة',
    sort_time: 'الأحدث', sort_near: 'الأقرب', sort_severity: 'الخطورة',
    list_empty: 'لا توجد حوادث في المنطقة المعروضة.',
    detail_aria: 'تفاصيل الحادث', sheet_filters_aria: 'فلاتر الحوادث', sheet_list_aria: 'قائمة الحوادث',
    area_approx: 'منطقة تقريبية', ref: 'مرجع', started: 'البداية:', ended: 'النهاية:',
    severity_label: 'الخطورة:', last_update: 'آخر تحديث:', approx_suffix: '(تقريبي)',
    started_ago: 'بدأ', severity_short: 'الخطورة',
    confirmed_one: '👥 أكّد شخص واحد هذا الحادث.',
    confirmed_n: '👥 أكّد {n} أشخاص هذا الحادث.',
    im_affected: 'أنا معني أيضًا', report_content: 'الإبلاغ عن محتوى غير صحيح',
    you_confirmed: '✔ لقد أكّدت هذا الحادث',
    affected_one: 'شخص واحد معني بهذا الحادث', affected_n: '{n} أشخاص معنيون بهذا الحادث',
    fire_to_confirm: 'حريق في انتظار التأكيد',
    fire_confirmed_comm: 'حريق مؤكّد من المجتمع',
    confirm_fire_btn: '🔥 تأكيد هذا الحريق',
    fire_progress: '{n} تأكيد من {total}',
    fire_progress_done: '{total} تأكيدات — مؤكّد من المجتمع',
    fire_not_official: 'إشارة مجتمعية فقط — لا تمثّل تأكيدًا رسميًا من مصالح النجدة.',
    ended_report_btn: 'الإبلاغ عن انتهاء هذا الحادث',
    ended_q: 'هل انتهى هذا الحادث فعلاً؟',
    ended_time_label: 'وقت الانتهاء التقريبي',
    ended_comment_label: 'تعليق (اختياري)',
    ended_send: 'تأكيد انتهاء الحادث',
    ended_reports_one: 'شخص واحد يبلّغ عن انتهاء هذا الحادث',
    ended_reports_n: '{n} أشخاص يبلّغون عن انتهاء هذا الحادث',
    loc_correct_title: 'تصحيح الموقع',
    loc_correct_hint_public: 'حرّك العلامة أو ابحث عن عنوان أو استعمل موقعك. سيتم التحقق من الاقتراح قبل اعتماده على الحادث الموجود.',
    loc_correct_hint_owner: 'حرّك العلامة أو ابحث عن عنوان أو استعمل موقعك. يُعتمد التصحيح فورًا على تبليغك.',
    loc_correct_send: 'إرسال اقتراح التصحيح',
    loc_correct_apply: 'اعتماد الموقع الجديد',
    loc_correct_preview: 'الموقع الجديد:',
    emergency_title: 'في حالة الطوارئ',
    useful_numbers: 'أرقام مفيدة',
    call_btn: '📞 الاتصال: {name} — {num}',
    fire_safety_msg: 'في حالة وجود خطر مباشر، ابتعد عن المكان واتصل فورًا بالحماية المدنية على الرقم 198. الإبلاغ عبر Kifeh لا يعني أنه تم الاتصال تلقائيًا بفرق النجدة.',
    fire_safety_donts: 'لا تقترب من النار، ولا تدخل مبنى مليئًا بالدخان، ولا تنتظر تأكيدات المجتمع أو الرصد عبر الأقمار الاصطناعية أو المراجعة للاتصال بالنجدة.',
    provider_note_electricity: 'يسجّل «كيفاه» بلاغًا مجتمعيًا لا يُحال تلقائيًا إلى الشركة التونسية للكهرباء والغاز. للتدخل الرسمي، اتصل بالشركة مباشرة (قد يُطلب منك المعرّف الموجود على فاتورتك).',
    provider_note_water: 'يسجّل «كيفاه» بلاغًا مجتمعيًا لا يُحال تلقائيًا إلى الشركة الوطنية لاستغلال وتوزيع المياه. للشكاوى الرسمية أو التدخل، اتصل بالشركة مباشرة.',
    provider_note_danger: 'في حالة الخطر المباشر (حريق، أسلاك مكشوفة، فيضان خطير)، اتصل أولاً بالحماية المدنية على الرقم 198.',
    done_success_note: 'تم تسجيل بلاغك. يساهم البلاغ في إعلام الأشخاص الموجودين في المنطقة، لكنه لا يعوّض الاتصال بالسلطات المختصة.',
    kifeh_disclaimer: 'Kifeh مبادرة مواطنية تونسية مستقلة تهدف إلى مشاركة المعلومات مع المجتمع، ولا تعوّض السلطات أو خدمات النجدة أو الشركة التونسية للكهرباء والغاز أو الشركة الوطنية لاستغلال وتوزيع المياه.',
    map_aria: 'خريطة الحوادث', you_are_here: 'أنت هنا (موقعك غير منشور)',
    geo_unavailable: 'تحديد الموقع غير متاح على هذا الجهاز.',
    geo_not_found: 'تعذّر تحديد الموقع. يمكنك البحث عن عنوان بدلاً من ذلك.',
    addr_not_found: 'العنوان غير موجود — جرّب صيغة أبسط',
    search_error: 'البحث غير متاح مؤقتًا — أعد المحاولة أو حدّد الموقع على الخريطة مباشرة.',
    cluster_title: '{n} حوادث — اضغط للتكبير',
    confirm_title: 'تأكيد: أنا معني أيضًا',
    confirm_hint: 'تحقق سريع يمنع البلاغات الكاذبة. لا يتم نشر أي بيانات.',
    confirm_method_aria: 'وسيلة التحقق',
    consent_confirm: 'أوافق على استعمال وسيلة الاتصال الخاصة بي للتحقق من هذا التأكيد ومنع التجاوزات.',
    receive_code: 'استلام الرمز', code_label: 'الرمز المستلم (6 أرقام)',
    validate_confirm: 'تأكيد مشاركتي',
    thanks_one: 'شكرًا! أكّد شخص واحد هذا الحادث.',
    thanks_n: 'شكرًا! أكّد {n} أشخاص هذا الحادث.',
    report_reason: 'السبب', report_detail: 'توضيحات (اختياري)', report_send: 'إرسال الإشعار',
    reason_wrong_location: 'الموقع غير صحيح', reason_not_real: 'هذا الحادث غير موجود',
    reason_resolved: 'تمت معالجة الحادث', reason_inappropriate: 'محتوى غير لائق', reason_other: 'أخرى',
    step_of: 'الخطوة {n} من 6', step_done_hint: 'تمّ', step_verif_hint: 'تحقق',
    t_type: 'نوع الحادث', t_location: 'الموقع', t_period: 'الفترة', t_desc: 'الوصف',
    t_dup: 'حادث مشابه', t_contact: 'بيانات الاتصال', t_verif: 'التحقق', t_done: 'التأكيد',
    back_aria: 'العودة إلى الخطوة السابقة',
    type_q: 'ما نوع الحادث؟', type_group_aria: 'نوع الحادث',
    card_electricity: 'انقطاع الكهرباء', card_water: 'انقطاع الماء',
    card_fire: 'حريق', card_internet: 'انقطاع الإنترنت', card_other: 'حادث آخر',
    fire_warning: 'في حالة الخطر الفوري، ابتعد عن المنطقة واتصل فورًا بمصالح النجدة: 198 (الحماية المدنية) أو 190 (الإسعاف).',
    fire_warning_suffix: 'هذا التبليغ لا يؤدي تلقائيًا إلى تدخل فرق الإنقاذ.',
    loc_q: 'أين يقع الحادث؟',
    loc_privacy: '🔒 لن يُنشر عنوانك الدقيق أبدًا: تعرض الخريطة العمومية موقعًا تقريبيًا (~250 م). الموقع الدقيق لا يراه إلا الأعوان المخوّلون.',
    use_position: '📍 استعمال موقعي الحالي',
    or_address: 'أو أدخل عنوانًا', addr_ph: 'مثال: شارع الحبيب بورقيبة، تونس…',
    move_marker: 'يمكنك أيضًا تحريك العلامة مباشرة على الخريطة.',
    minimap_aria: 'خريطة لتحديد موقع الحادث',
    confirm_position: 'تأكيد هذا الموقع',
    addr_searching: 'جارٍ البحث عن العنوان…',
    addr_saved: '📍 تم حفظ الموقع (لم يُعثر على العنوان — يمكنك المتابعة)',
    addr_manual_hint: 'العنوان غير موجود — يمكنك تحديد الموقع على الخريطة مباشرة',
    geo_denied: 'تم رفض الإذن. أدخل عنوانًا أو ضع العلامة على الخريطة.',
    geo_failed: 'تعذّر تحديد الموقع. أدخل عنوانًا أو ضع العلامة على الخريطة.',
    geo_imprecise: 'الموقع غير دقيق (±{m} م). عدّل العلامة أو أدخل عنوانًا.',
    geo_device_unavailable: 'تحديد الموقع غير متاح على هذا الجهاز. أدخل عنوانًا أو حدّد الموقع على الخريطة.',
    time_q: 'متى وقع الحادث؟', temporal_aria: 'الحالة الزمنية',
    temporal_ongoing: 'جارٍ', temporal_finished: 'انتهى', temporal_planned: 'مبرمج',
    start_label: 'تاريخ ووقت البداية', now_btn: 'الآن',
    end_label: 'تاريخ ووقت النهاية',
    approx_check: 'لا أعرف الوقت بالضبط (وقت تقريبي)',
    ongoing_hint: 'لا حاجة لوقت النهاية: يمكنك العودة لاحقًا لإغلاق الحادث عبر رابط المتابعة.',
    err_start_required: 'حدّد تاريخ ووقت البداية (زر «الآن» إذا بدأ الحادث للتو).',
    err_start_future: 'لا يمكن أن يكون تاريخ البداية في المستقبل.',
    err_end_required: 'حدّد تاريخ ووقت النهاية.',
    err_end_before: 'لا يمكن أن يكون وقت النهاية قبل وقت البداية.',
    desc_q: 'صف الحادث', desc_label: 'وصف قصير (اختياري)',
    desc_ph: 'مثال: انقطاع الكهرباء في كامل العمارة منذ الساعة الثامنة مساءً',
    sev_q: 'درجة الخطورة حسب تقديرك', sev_aria: 'الخطورة', sev_danger_short: 'خطر',
    affected_label: 'عدد المساكن أو الأشخاص المتضررين (اختياري)', affected_ph: 'مثال: 40',
    photo_label: 'صورة أو فيديو (اختياري)',
    photo_note: 'تُحذف البيانات الوصفية (بما فيها موقع GPS) تلقائيًا من الصور.',
    comment_label: 'تعليق إضافي (اختياري)',
    err_desc_required: 'الوصف القصير ضروري.',
    publish_now: 'نشر التبليغ',
    dup_title: 'يوجد حادث مشابه بالفعل',
    dup_text: 'تم التبليغ عن حادث من نفس النوع بالقرب منك. هل أنت معني بهذا الحادث؟',
    dup_near: 'منطقة قريبة', dup_confirm: '✔ تأكيد أنني معني أيضًا',
    dup_new: 'المتابعة بتبليغ جديد',
    dup_confirmations_one: 'تأكيد واحد', dup_confirmations_n: '{n} تأكيدات',
    contact_q: 'التحقق من المبلّغ',
    contact_hint: 'لنشر تبليغك، يجب التحقق من وسيلة اتصال. لا يتم إنشاء أي حساب.',
    method_aria: 'وسيلة التحقق', method_sms: '📱 هاتف (SMS)', method_email: '✉️ بريد إلكتروني',
    email_link_pref: 'استلام رابط تأكيد (وإلا رمزًا للإدخال)',
    honeypot_label: 'لا تملأ هذا الحقل',
    consent_strong: 'إلزامي:',
    consent_text: 'أوافق على استعمال بياناتي للتحقق من هذا التبليغ ومنع التجاوزات وتمكين تحديث الحادث. لن تُنشر أبدًا.',
    consent_more: 'اعرف المزيد',
    err_consent: 'يجب الموافقة على استعمال بياناتك من أجل التحقق.',
    get_code_btn: 'استلام رمز التحقق',
    otp_title: 'أدخل الرمز المستلم', otp_label: 'رمز من 6 أرقام',
    otp_hint_sms: 'تم إرسال الرمز عبر SMS إلى {phone}. صالح لمدة 10 دقائق.',
    otp_hint_email: 'تم إرسال الرمز إلى بريدك {email}. صالح لمدة 10 دقائق.',
    err_otp_format: 'الرمز مكوّن من 6 أرقام.',
    resend_code: 'إعادة إرسال الرمز', resend_link: 'إعادة إرسال الرابط',
    email_wait_title: 'راجع بريدك الإلكتروني',
    email_sent_to: 'أرسلنا رابط تأكيد إلى',
    email_wait_hint: 'افتح الرابط من هذا الجهاز لإتمام تبليغك. الرابط صالح لمدة 60 دقيقة ويُستعمل مرة واحدة فقط.',
    waiting: 'في انتظار التأكيد…', email_confirmed: 'تم تأكيد التبليغ!',
    email_confirmed_alt: 'إذا أكّدت عبر البريد الإلكتروني، فقد تم نشر تبليغك. راجع رابط المتابعة المرسل إليك، أو عد إلى الخريطة.',
    done_saved: 'تم تسجيل تبليغك.',
    done_follow: 'متابعة تبليغك',
    done_follow_hint: 'احتفظ بهذا الرابط: يتيح لك تحديث تبليغك أو إغلاقه أو حذفه. كما أُرسل إليك عبر SMS أو البريد الإلكتروني.',
    manage_my: 'إدارة تبليغي', copy_link: 'نسخ الرابط', link_copied: 'تم النسخ ✓',
    copy_prompt: 'انسخ هذا الرابط:',
    pending_review_note: 'سيظهر تبليغك بعد مراجعة سريعة من فريقنا.',
    visible_note: 'تبليغك ظاهر على الخريطة العمومية (موقع تقريبي).',
    email_link_sent_note: 'أُرسل رابط المتابعة إلى بريدك الإلكتروني.',
    manage_title: 'تبليغي',
    manage_missing: 'رابط المتابعة مفقود. استعمل الرابط المرسل إليك عبر SMS أو البريد.',
    expires_in: 'ينتهي تلقائيًا دون تأكيد:',
    confirmed_people: '👥 أكّد {n} شخصًا/أشخاص',
    visible_only_you: '(لا يراه إلا أنت والأعوان المخوّلون)',
    position_saved: 'تم حفظ الموقع',
    still_q: 'هل ما زال الحادث جاريًا؟',
    yes_ongoing: 'نعم، ما زال جاريًا', no_finished: 'لا، لقد انتهى',
    close_incident: 'إغلاق الحادث',
    end_time: 'وقت النهاية', end_approx: 'وقت تقريبي', confirm_close: 'تأكيد الإغلاق',
    update_desc_title: 'تحديث الوصف',
    other_actions: 'إجراءات أخرى',
    report_loc: 'الإبلاغ عن خطأ في الموقع', describe_error: 'صف الخطأ (اختياري)',
    delete_mine: 'حذف تبليغي',
    delete_note: 'الحذف يزيل الحادث من الخريطة ويبرمج مسح بياناتك.',
    confirm_delete: 'حذف هذا التبليغ نهائيًا؟',
    deleted_ok: 'تم حذف تبليغك.',
    thanks_extended: 'شكرًا! سيبقى الحادث معروضًا كجارٍ.',
    closed_thanks: 'تم إغلاق الحادث. شكرًا على التحديث!',
    desc_updated: 'تم تحديث الوصف.',
    verify_title: 'تأكيد تبليغك',
    verifying: 'جارٍ التحقق من الرابط…',
    verify_ok: 'تم تأكيد تبليغك وتسجيله.',
    verify_follow: 'المتابعة',
    verify_follow_hint: 'يتيح هذا الرابط تحديث تبليغك أو إغلاقه (كما أُرسل إليك عبر البريد):',
    verify_invalid: 'رابط غير صالح أو غير مكتمل.',
    verify_expired_hint: 'إذا انتهت صلاحية الرابط أو سبق استعماله، عد إلى شاشة التبليغ لطلب إرسال جديد، أو راجع أحدث بريد إلكتروني.',
  },
};

// --- Sélection de la langue -------------------------------------------------
// La préférence est mémorisée dans localStorage ET dans un cookie (1 an) :
// certains WebViews (navigation privée, restrictions iOS/Android) bloquent
// localStorage — le cookie sert alors de mémoire durable de secours.
function readStoredLang() {
  try {
    const v = localStorage.getItem('lang');
    if (v === 'fr' || v === 'ar') return v;
  } catch { /* stockage indisponible */ }
  const m = document.cookie.match(/(?:^|;\s*)kifeh_lang=(fr|ar)/);
  return m ? m[1] : null;
}

function writeStoredLang(l) {
  try { localStorage.setItem('lang', l); } catch { /* stockage indisponible */ }
  try { document.cookie = `kifeh_lang=${l}; path=/; max-age=31536000; SameSite=Lax`; } catch {}
}

function detectLang() {
  // 1. Préférence enregistrée → 2. paramètre d'URL → 3. langue de l'appareil → 4. français.
  const saved = readStoredLang();
  if (saved) return saved;
  const url = new URLSearchParams(location.search).get('lang');
  if (url === 'fr' || url === 'ar') return url;
  const device = (navigator.languages || [navigator.language || 'fr']).map((l) => String(l).toLowerCase());
  return device.some((l) => l.startsWith('ar')) ? 'ar' : 'fr';
}

let LANG = detectLang();
// Direction et langue appliquées IMMÉDIATEMENT au niveau du document
// (pas d'attente du DOM : évite tout éclair d'interface dans le mauvais sens).
document.documentElement.lang = LANG;
document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';

function t(key, params = {}) {
  let s = (I18N[LANG] && I18N[LANG][key]) ?? I18N.fr[key] ?? key;
  for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

function setLang(l) {
  if (l !== 'fr' && l !== 'ar') return;
  writeStoredLang(l);
  location.reload(); // ré-applique toutes les chaînes (statiques et dynamiques)
}

// Applique la direction + les traductions des attributs data-i18n*.
function applyI18n(root = document) {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  // Blocs réservés à une langue (textes longs, ex. page légale).
  root.querySelectorAll('[data-lang-block]').forEach((el) => { el.hidden = el.dataset.langBlock !== LANG; });
  // Bouton de langue générique.
  root.querySelectorAll('.lang-switch').forEach((btn) => {
    btn.textContent = t('lang_button');
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => setLang(LANG === 'ar' ? 'fr' : 'ar'));
    }
  });
  if (document.title.includes('—') || document.querySelector('[data-i18n-doc-title]')) {
    const el = document.querySelector('[data-i18n-doc-title]');
    if (el) document.title = `${t(el.dataset.i18nDocTitle)} — ${t('app_name')}`;
  }
}
document.addEventListener('DOMContentLoaded', () => applyI18n());

// --- Libellés partagés (utilisés par les scripts de page) --------------------
const TYPE_ICONS = { electricity: '⚡', water: '💧', fire: '🔥', internet: '📶', other: '❖' };
const TYPE_LABELS = new Proxy({}, { get: (_, k) => t(`type_${String(k)}`) });
const STATUS_LABELS = new Proxy({}, { get: (_, k) => t(`status_${String(k)}`) });
const SEVERITY_LABELS = new Proxy({}, { get: (_, k) => t(`sev_${String(k)}`) });

function fmtDate(iso) {
  if (!iso) return '—';
  // Stockage en UTC, affichage en heure de Tunis (Africa/Tunis) quel que soit
  // le fuseau de l'appareil.
  try {
    return new Date(iso).toLocaleString(LANG === 'ar' ? 'ar-TN' : 'fr-FR',
      { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Tunis' });
  } catch { return iso; }
}

function timeAgo(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return t('time_now');
  if (s < 3600) return t('time_min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('time_h', { n: Math.floor(s / 3600) });
  return t('time_d', { n: Math.floor(s / 86400) });
}
