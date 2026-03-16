// ============================================================
// i18n — Bilingual support (FR / EN)
// ============================================================

const translations = {
  en: {
    // Header
    siteTitle: "EV Charging Prices",
    siteSubtitle: "Canada",
    navMap: "Map",
    navTable: "Table",
    navCompare: "Comparison",
    navAbout: "About",

    // Hero
    avgLabelDC: "National Average\nDC Fast",
    avgLabelL2: "National Average\nLevel 2",
    statPorts: "Public Ports",
    statStations: "Stations",
    statDCFast: "DC Fast Ports",

    // Level selector
    levelLabel: "Show prices:",
    level1: "Level 1",
    level2: "Level 2",
    dcFast: "DC Fast",

    // Map section
    mapTitle: "Pricing Map by Province",
    mapDesc: "The map shows the daily average cost per kilowatt-hour for all commercial/public charging. Hover over a province for details.",
    legendTitle: "Cost / kWh (CAD)",

    // Table section
    tableTitle: "Prices by Province and Territory",
    tableDesc: "Click column headers to sort the table.",
    thProvince: "Province / Territory",
    thLevel1: "Level 1",
    thLevel2: "Level 2",
    thDCFast: "DC Fast",
    thPorts: "Ports",
    thStations: "Stations",
    thModel: "Model",

    // Pricing models
    modelFixed: "Fixed",
    modelTime: "Time",
    modelPower: "Power",
    modelMixed: "Mixed",
    modelNA: "N/A",

    // Comparison section
    compareTitle: "Comparison by Charging Level",
    compareDesc: "Compare costs between Level 1, Level 2 and DC Fast Charging for each province.",
    chartTitle: "Cost per kWh by province and charging level",
    chartYAxis: "CAD / kWh",
    chartXAxis: "Province",
    chartLevel1: "Level 1 ($/kWh)",
    chartLevel2: "Level 2 ($/kWh)",
    chartDCFast: "DC Fast ($/kWh)",

    // About section
    aboutTitle: "About the Data",
    aboutSourcesTitle: "Sources",
    aboutSourcesText: "Data is compiled from Natural Resources Canada (NRCan), Paren Q4 2025 report, BC Hydro, Hydro-Québec, and other provincial providers.",
    aboutLevelsTitle: "Charging Levels",
    aboutLevelsText: "<strong>Level 1</strong> — Standard 120V outlet, ~5 km/h of charge.<br><strong>Level 2</strong> — 240V, ~30-40 km/h of charge.<br><strong>DC Fast</strong> — 400V+, ~250-350 km/h of charge.",
    aboutMethodTitle: "Methodology",
    aboutMethodText: "Prices shown are provincial averages for public/commercial charging. Residential rates, subscriptions and member rates are not included.",
    lastUpdated: "Last updated:",

    // Footer
    footerText: "© 2026 EV Charging Prices Canada — Data for informational purposes only",

    // Popup
    popupLevel1: "Level 1",
    popupLevel2: "Level 2",
    popupDCFast: "DC Fast",
    popupTotalPorts: "Total Ports",
    popupStations: "Stations",
    popupDCFastPorts: "DC Fast Ports",
    popupNetwork: "Network",
    popupNA: "N/A",
    perKwh: "/kWh",

    // Province names
    provinces: {
      AB: "Alberta",
      BC: "British Columbia",
      MB: "Manitoba",
      NB: "New Brunswick",
      NL: "Newfoundland and Labrador",
      NS: "Nova Scotia",
      NT: "Northwest Territories",
      NU: "Nunavut",
      ON: "Ontario",
      PE: "Prince Edward Island",
      QC: "Quebec",
      SK: "Saskatchewan",
      YT: "Yukon"
    }
  },

  fr: {
    // Header
    siteTitle: "Prix Recharge VE",
    siteSubtitle: "Canada",
    navMap: "Carte",
    navTable: "Tableau",
    navCompare: "Comparaison",
    navAbout: "À propos",

    // Hero
    avgLabelDC: "Moyenne nationale\nDC Rapide",
    avgLabelL2: "Moyenne nationale\nNiveau 2",
    statPorts: "Bornes publiques",
    statStations: "Stations",
    statDCFast: "Bornes DC rapide",

    // Level selector
    levelLabel: "Afficher les prix :",
    level1: "Niveau 1",
    level2: "Niveau 2",
    dcFast: "DC Rapide",

    // Map section
    mapTitle: "Carte des prix par province",
    mapDesc: "La carte représente le coût moyen journalier par kilowattheure pour la recharge publique/commerciale. Survolez une province pour voir les détails.",
    legendTitle: "Coût / kWh (CAD)",

    // Table section
    tableTitle: "Prix par province et territoire",
    tableDesc: "Cliquez sur les en-têtes de colonnes pour trier le tableau.",
    thProvince: "Province / Territoire",
    thLevel1: "Niveau 1",
    thLevel2: "Niveau 2",
    thDCFast: "DC Rapide",
    thPorts: "Bornes",
    thStations: "Stations",
    thModel: "Modèle",

    // Pricing models
    modelFixed: "Fixe",
    modelTime: "Temps",
    modelPower: "Puissance",
    modelMixed: "Mixte",
    modelNA: "N/D",

    // Comparison section
    compareTitle: "Comparaison par niveau de recharge",
    compareDesc: "Comparez les coûts entre Niveau 1, Niveau 2 et DC Rapide pour chaque province.",
    chartTitle: "Coût par kWh par province et niveau de recharge",
    chartYAxis: "CAD / kWh",
    chartXAxis: "Province",
    chartLevel1: "Niveau 1 ($/kWh)",
    chartLevel2: "Niveau 2 ($/kWh)",
    chartDCFast: "DC Rapide ($/kWh)",

    // About section
    aboutTitle: "À propos des données",
    aboutSourcesTitle: "Sources",
    aboutSourcesText: "Les données sont compilées à partir de Ressources naturelles Canada (RNCan), du rapport Paren Q4 2025, BC Hydro, Hydro-Québec, et d'autres fournisseurs provinciaux.",
    aboutLevelsTitle: "Niveaux de recharge",
    aboutLevelsText: "<strong>Niveau 1</strong> — Prise domestique 120V, ~5 km/h de charge.<br><strong>Niveau 2</strong> — 240V, ~30-40 km/h de charge.<br><strong>DC Rapide</strong> — 400V+, ~250-350 km/h de charge.",
    aboutMethodTitle: "Méthodologie",
    aboutMethodText: "Les prix affichés sont des moyennes provinciales pour la recharge publique/commerciale. Les tarifs résidentiels, les abonnements et les tarifs membres ne sont pas inclus.",
    lastUpdated: "Dernière mise à jour :",

    // Footer
    footerText: "© 2026 Prix Recharge VE Canada — Données à titre indicatif seulement",

    // Popup
    popupLevel1: "Niveau 1",
    popupLevel2: "Niveau 2",
    popupDCFast: "DC Rapide",
    popupTotalPorts: "Bornes totales",
    popupStations: "Stations",
    popupDCFastPorts: "Bornes DC rapide",
    popupNetwork: "Réseau",
    popupNA: "N/D",
    perKwh: "/kWh",

    // Province names
    provinces: {
      AB: "Alberta",
      BC: "Colombie-Britannique",
      MB: "Manitoba",
      NB: "Nouveau-Brunswick",
      NL: "Terre-Neuve-et-Labrador",
      NS: "Nouvelle-Écosse",
      NT: "Territoires du Nord-Ouest",
      NU: "Nunavut",
      ON: "Ontario",
      PE: "Île-du-Prince-Édouard",
      QC: "Québec",
      SK: "Saskatchewan",
      YT: "Yukon"
    }
  }
};

// --- i18n Engine ---
// Detect browser language: if French, default to 'fr', otherwise 'en'
let currentLang = (navigator.language || navigator.userLanguage || 'en').startsWith('fr') ? 'fr' : 'en';

function t(key) {
  const keys = key.split('.');
  let val = translations[currentLang];
  for (const k of keys) {
    if (val && val[k] !== undefined) {
      val = val[k];
    } else {
      // Fallback to English
      let fb = translations['en'];
      for (const fk of keys) {
        if (fb && fb[fk] !== undefined) fb = fb[fk];
        else return key; // return key if not found at all
      }
      return fb;
    }
  }
  return val;
}

function getProvinceName(code) {
  return t(`provinces.${code}`) || code;
}

function setLanguage(lang) {
  currentLang = lang;
  document.documentElement.lang = lang === 'fr' ? 'fr' : 'en';

  // Update toggle buttons
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  // Update all translatable elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const value = t(key);
    if (el.dataset.i18nAttr) {
      el.setAttribute(el.dataset.i18nAttr, value);
    } else if (el.hasAttribute('data-i18n-html')) {
      el.innerHTML = value.replace(/\n/g, '<br>');
    } else {
      el.textContent = value;
    }
  });

  // Rebuild dynamic content
  if (typeof rebuildAllContent === 'function') {
    rebuildAllContent();
  }
}

function initI18n() {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setLanguage(btn.dataset.lang);
    });
  });

  // Set initial language
  setLanguage(currentLang);
}
