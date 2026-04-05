import styles from './FeaturesPage.module.css';

const FEATURE_SECTIONS = [
  {
    title: 'Recipe Management',
    icon: '📖',
    features: [
      { name: 'Smart Recipe Collection', desc: 'Organize recipes by breakfast, lunch/dinner, snacks, desserts, and drinks with customizable layouts.' },
      { name: 'Import From Anywhere', desc: 'Pull recipes from URLs, Instagram, TikTok, Pinterest, or paste text — automatic ingredient and instruction parsing.' },
      { name: 'AI Recipe Generation', desc: 'Generate new recipe ideas based on your dietary preferences, favorite cuisines, and available ingredients.' },
      { name: 'Cook Mode', desc: 'Step-by-step instructions with large text, ingredient highlighting per step, and screen-awake for hands-free cooking.' },
      { name: 'AI Improvement Tips', desc: 'Get smart suggestions for ingredient swaps, healthy additions, and cooking techniques for any recipe.' },
      { name: 'Cuisine Detection', desc: 'Automatic cuisine classification based on ingredients and recipe names.' },
    ],
  },
  {
    title: 'Weekly Meal Planning',
    icon: '📅',
    features: [
      { name: 'Drag & Drop Planner', desc: 'Build your weekly menu by dragging recipes into your plan with adjustable servings per meal.' },
      { name: 'Suggested Meals', desc: 'Smart suggestions based on what you haven\'t cooked recently, neglected ingredients, and seasonal availability.' },
      { name: 'AI Meal Recommendations', desc: 'Personalized meal ideas based on your cooking history, favorite cuisines, and top ingredients.' },
      { name: 'Plan History', desc: 'Save and restore past meal plans. Browse what you\'ve cooked over the weeks.' },
    ],
  },
  {
    title: 'Shopping List',
    icon: '🛒',
    features: [
      { name: 'Auto-Generated Lists', desc: 'Shopping list built automatically from your weekly plan with smart quantity aggregation across recipes.' },
      { name: 'Grocery Store Sections', desc: 'Items sorted by produce, meat, dairy, bakery, frozen, grains, and more — shop aisle by aisle.' },
      { name: 'Pantry Matching', desc: 'Items you already have in your pantry are flagged so you don\'t buy duplicates.' },
      { name: 'Unit Conversions', desc: 'See gram equivalents next to volume measurements for precise shopping.' },
      { name: 'Custom Items & Staples', desc: 'Add extra items and maintain a grocery staples list that\'s always included.' },
    ],
  },
  {
    title: 'Nutrition Tracking',
    icon: '🥗',
    features: [
      { name: 'Daily Food Log', desc: 'Log meals across breakfast, lunch, dinner, and snacks. Track recipes, individual ingredients, or custom meals.' },
      { name: 'Nutrition Goals', desc: 'Set targets for calories, protein, carbs, fat, fiber, vitamins, minerals, and more — see daily progress bars.' },
      { name: 'Per-Ingredient Breakdown', desc: 'See exactly which ingredients contribute what nutrients in every meal you log.' },
      { name: 'Meal Scoring', desc: 'Each meal gets a quality score (0-100) based on protein, fiber, saturated fat, and sugar ratios.' },
      { name: 'USDA Nutrition Lookup', desc: 'Automatic nutrition data from USDA FoodData Central, Open Food Facts, and the Canadian Nutrient File.' },
      { name: 'Custom Meal Logging', desc: 'Create custom meals on the fly with multiple ingredients — nutrition calculated automatically.' },
      { name: 'Weight-Based Portions', desc: 'Log meals by weight in grams for precise tracking, with per-ingredient weight adjustments.' },
      { name: 'AI Meal Estimation', desc: 'Describe a restaurant meal and get an AI-estimated nutrition breakdown.' },
    ],
  },
  {
    title: 'Weight & Body Tracking',
    icon: '⚖️',
    features: [
      { name: 'Weight Logger', desc: 'Track your weight over time with trend visualization and goal progress.' },
      { name: 'Body Stats', desc: 'Store height, weight, age, sex, and activity level for personalized nutrition targets.' },
      { name: 'TDEE Calculator', desc: 'Auto-calculate your Total Daily Energy Expenditure and macro targets based on your body stats and goals.' },
      { name: 'SMS Reminders', desc: 'Get text reminders to log your weight and meals on your schedule.' },
    ],
  },
  {
    title: 'Ingredients & Pantry',
    icon: '🧂',
    features: [
      { name: 'Ingredient Database', desc: 'Comprehensive nutrition database with per-100g values, measurements, and grocery section assignments.' },
      { name: 'Barcode Scanner', desc: 'Scan product barcodes to look up nutrition data from Open Food Facts instantly.' },
      { name: 'Key Ingredients', desc: 'Select your favorite healthy ingredients and see which recipes use them.' },
      { name: 'Pantry Tracker', desc: 'Keep track of your spices, sauces, and staples so you know what you have on hand.' },
      { name: 'Seasonal Produce Guide', desc: 'See what\'s in season in your region — 6 US regions with monthly ingredient availability.' },
    ],
  },
  {
    title: 'Social & Sharing',
    icon: '👥',
    features: [
      { name: 'Friends List', desc: 'Add friends by username, email, or name. Manage friend requests and connections.' },
      { name: 'Recipe Sharing', desc: 'Share recipes directly with friends. Accept or decline shared recipes with one click.' },
      { name: 'Share Links', desc: 'Generate shareable links for any recipe that anyone can view and import.' },
      { name: 'Cooking Profile', desc: 'View your cooking stats — favorite cuisines, most-made recipes, and ingredient patterns.' },
    ],
  },
  {
    title: 'Fitness',
    icon: '💪',
    features: [
      { name: 'Workout Tracker', desc: 'Log exercises by muscle group with sets, reps, weight, and duration tracking.' },
      { name: 'Exercise History', desc: 'View past workouts with stats and progress over time.' },
      { name: 'Custom Gyms', desc: 'Save different gym setups with available equipment for context-aware exercise selection.' },
    ],
  },
  {
    title: 'Data & Sync',
    icon: '☁️',
    features: [
      { name: 'Cloud Sync', desc: 'All data syncs to Firebase in real-time. Access your recipes and logs from any device.' },
      { name: 'Offline Support', desc: 'Works offline with local caching — syncs automatically when you\'re back online.' },
      { name: 'CSV Export & Import', desc: 'Export your recipes and meal history to CSV for backup, or import from spreadsheets.' },
      { name: 'Mobile App', desc: 'Native iOS app with the same features and real-time sync with the website.' },
    ],
  },
];

export function FeaturesPage({ onClose }) {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.title}>Prep Day</h1>
          <p className={styles.subtitle}>Your complete meal prep companion — from recipe to plate.</p>
          {onClose && (
            <button className={styles.backBtn} onClick={onClose}>← Back to App</button>
          )}
        </div>
      </div>

      <div className={styles.hero}>
        <h2 className={styles.heroTitle}>Everything you need to eat better</h2>
        <p className={styles.heroDesc}>
          Plan your meals, track your nutrition, shop smarter, and cook with confidence.
          50+ features designed for people who take their food seriously.
        </p>
        <div className={styles.statRow}>
          <div className={styles.stat}>
            <span className={styles.statNum}>50+</span>
            <span className={styles.statLabel}>Features</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNum}>45</span>
            <span className={styles.statLabel}>Nutrients Tracked</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNum}>6</span>
            <span className={styles.statLabel}>US Regions</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNum}>∞</span>
            <span className={styles.statLabel}>Recipes</span>
          </div>
        </div>
      </div>

      <div className={styles.sections}>
        {FEATURE_SECTIONS.map(section => (
          <div key={section.title} className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionIcon}>{section.icon}</span>
              <h3 className={styles.sectionTitle}>{section.title}</h3>
            </div>
            <div className={styles.featureGrid}>
              {section.features.map(f => (
                <div key={f.name} className={styles.featureCard}>
                  <h4 className={styles.featureName}>{f.name}</h4>
                  <p className={styles.featureDesc}>{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <p className={styles.footerText}>Built with love for meal preppers everywhere.</p>
        <a href="https://apps.apple.com/app/prep-day/id6760323206" target="_blank" rel="noopener noreferrer" className={styles.appStoreLink}>
          Download on the App Store →
        </a>
      </div>
    </div>
  );
}
