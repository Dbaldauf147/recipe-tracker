import styles from './SourcesPage.module.css';

const NUTRITION_SOURCES = [
  {
    name: 'USDA FoodData Central — Foundation Foods',
    description: 'Gold-standard source for raw ingredient nutrition data. Provides analytically-derived, comprehensive nutrient values for minimally processed foods.',
    url: 'https://fdc.nal.usda.gov/',
  },
  {
    name: 'USDA SR Legacy (SR28)',
    description: 'The USDA National Nutrient Database for Standard Reference, containing nutrient data for over 8,000 food items. Used as a primary fallback for Foundation Foods.',
    url: 'https://fdc.nal.usda.gov/',
  },
  {
    name: 'USDA Branded Food Products (FDC UPC)',
    description: 'Nutrition data for branded and packaged foods from the Global Branded Food Products Database, including restaurant and fast food items.',
    url: 'https://fdc.nal.usda.gov/',
  },
  {
    name: 'USDA Survey (FNDDS)',
    description: 'Food and Nutrient Database for Dietary Studies. Provides nutrient values for foods and beverages as typically consumed in the US.',
    url: 'https://fdc.nal.usda.gov/',
  },
  {
    name: 'Open Food Facts',
    description: 'Open-source international food product database with over 3 million products. Used for barcode lookups and as a fallback for name-based searches. Aggregates data contributed from products worldwide including German (BLS), Dutch (NEVO), British (CoFID), Australian (NUTTAB), Danish (Frida), and Irish (IFCDB) sources.',
    url: 'https://world.openfoodfacts.org/',
  },
  {
    name: 'Canadian Nutrient File (CNF)',
    description: 'Health Canada\'s national food composition database containing nutrient values for foods commonly consumed in Canada.',
    url: 'https://food-nutrition.canada.ca/cnf-fce/index-eng.jsp',
  },
  {
    name: 'Custom Ingredient Database',
    description: 'A curated local database of ingredient nutrition values that takes priority over all external lookups, allowing for more accurate and customized data.',
  },
];

const HEALTH_SOURCES = [
  {
    name: 'USDA Dietary Guidelines for Americans (2020–2025)',
    description: 'Provides the foundation for daily calorie, macro, and micronutrient recommendations used in nutrition goal defaults.',
    url: 'https://www.dietaryguidelines.gov/',
  },
  {
    name: 'National Institutes of Health (NIH) — Dietary Reference Intakes',
    description: 'Source for recommended daily intake values for vitamins, minerals, and other nutrients.',
    url: 'https://ods.od.nih.gov/HealthInformation/Dietary-Reference-Intakes',
  },
  {
    name: 'Institute of Medicine (IOM)',
    description: 'Provides reference values for macronutrient distribution ranges and tolerable upper intake levels.',
    url: 'https://nap.nationalacademies.org/',
  },
  {
    name: 'American College of Sports Medicine (ACSM)',
    description: 'Source for activity multiplier values used in TDEE calculations and protein recommendations for active individuals.',
    url: 'https://www.acsm.org/',
  },
  {
    name: 'Mifflin-St Jeor Equation',
    description: 'The formula used to estimate Basal Metabolic Rate (BMR). Widely considered the most accurate predictive equation for estimating resting energy expenditure.',
  },
  {
    name: 'World Health Organization (WHO)',
    description: 'Standard for fruit and vegetable serving sizes (80g per serving), used in the daily servings tracker.',
    url: 'https://www.who.int/',
  },
];

const SEASONAL_SOURCES = [
  {
    name: 'USDA Seasonal Produce Guide',
    description: 'Provides regional seasonal availability data for fruits and vegetables across US regions.',
    url: 'https://snaped.fns.usda.gov/seasonal-produce-guide',
  },
  {
    name: 'State Agricultural Extensions',
    description: 'Regional growing season data from university agricultural extension programs, supplementing USDA data.',
  },
  {
    name: 'Claude AI (Anthropic)',
    description: 'AI-powered lookups for seasonal data on ingredients not in the static database. Results are cached to minimize API usage.',
    url: 'https://www.anthropic.com/',
  },
];

function SourceCard({ source }) {
  return (
    <div className={styles.card}>
      <h4 className={styles.cardTitle}>
        {source.url ? (
          <a href={source.url} target="_blank" rel="noopener noreferrer" className={styles.cardLink}>
            {source.name}
          </a>
        ) : (
          source.name
        )}
      </h4>
      <p className={styles.cardDesc}>{source.description}</p>
    </div>
  );
}

export function SourcesPage({ onClose }) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>&larr; Back</button>
        <h2 className={styles.title}>Sources</h2>
      </div>

      <p className={styles.intro}>
        The nutrition data, health recommendations, and seasonal information in this app come from the following sources. These values are general guidelines and should not be considered medical advice.
      </p>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Nutrition Data</h3>
        {NUTRITION_SOURCES.map(s => <SourceCard key={s.name} source={s} />)}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Health Recommendations</h3>
        {HEALTH_SOURCES.map(s => <SourceCard key={s.name} source={s} />)}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Seasonal Data</h3>
        {SEASONAL_SOURCES.map(s => <SourceCard key={s.name} source={s} />)}
      </section>
    </div>
  );
}
