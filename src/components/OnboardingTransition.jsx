import { useState, useEffect } from 'react';
import styles from './OnboardingTransition.module.css';

const TRANSITIONS = {
  nutrition: {
    emoji: '🥗',
    title: "Let's personalize your nutrition!",
    subtitle: "We'll gather some key info about you to calculate personalized targets and help you hit your health goals.",
    features: [
      { icon: '📊', text: 'Calculate your ideal daily calories & macros' },
      { icon: '🎯', text: 'Set protein, carb, and fat targets' },
      { icon: '📈', text: 'Track progress and see trends over time' },
    ],
  },
  'meal-planning': {
    emoji: '📋',
    title: "Let's plan some amazing meals!",
    subtitle: "We'll help you build weekly menus, create shopping lists, and discover recipes you'll love.",
    features: [
      { icon: '🍽️', text: 'Build your weekly meal plan' },
      { icon: '🛒', text: 'Auto-generate smart shopping lists' },
      { icon: '✨', text: 'Get personalized recipe suggestions' },
    ],
  },
  both: {
    emoji: '🚀',
    title: "Let's set you up for success!",
    subtitle: "We'll personalize your nutrition targets and help you plan meals that fit your goals perfectly.",
    features: [
      { icon: '📊', text: 'Calculate your ideal daily macros' },
      { icon: '🍽️', text: 'Build weekly meal plans around your targets' },
      { icon: '🛒', text: 'Smart shopping lists from your recipes' },
      { icon: '✨', text: 'AI-powered meal recommendations' },
    ],
  },
};

export function OnboardingTransition({ focus, onContinue }) {
  const [visible, setVisible] = useState(false);
  const [featuresVisible, setFeaturesVisible] = useState([]);

  const hasNutrition = focus.has('nutrition');
  const hasMealPlanning = focus.has('meal-planning');
  const key = hasNutrition && hasMealPlanning ? 'both' : hasNutrition ? 'nutrition' : 'meal-planning';
  const config = TRANSITIONS[key];

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
    // Stagger feature animations
    config.features.forEach((_, i) => {
      setTimeout(() => setFeaturesVisible(prev => [...prev, i]), 400 + i * 200);
    });
    // Auto-advance after animations complete
    const timer = setTimeout(() => onContinue(), 6000 + config.features.length * 200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={styles.page}>
      <div className={`${styles.content} ${visible ? styles.contentVisible : ''}`}>
        <div className={styles.emojiWrap}>
          <span className={styles.emoji}>{config.emoji}</span>
          <div className={styles.ring} />
          <div className={styles.ring2} />
        </div>

        <h1 className={styles.title}>{config.title}</h1>
        <p className={styles.subtitle}>{config.subtitle}</p>

        <div className={styles.features}>
          {config.features.map((f, i) => (
            <div key={i} className={`${styles.featureRow} ${featuresVisible.includes(i) ? styles.featureVisible : ''}`}>
              <span className={styles.featureIcon}>{f.icon}</span>
              <span className={styles.featureText}>{f.text}</span>
            </div>
          ))}
        </div>

        <div className={styles.loader}>
          <div className={styles.loaderBar} />
        </div>

        <button className={styles.skipBtn} onClick={onContinue}>
          Continue →
        </button>
      </div>

      {/* Floating particles */}
      <div className={styles.particles}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={styles.particle} style={{
            left: `${10 + Math.random() * 80}%`,
            animationDelay: `${Math.random() * 2}s`,
            animationDuration: `${3 + Math.random() * 3}s`,
            fontSize: `${0.8 + Math.random() * 1.2}rem`,
            opacity: 0.15 + Math.random() * 0.2,
          }}>
            {['🥑', '🍎', '🥦', '🍗', '🥕', '🍳', '🥩', '🫐'][i]}
          </div>
        ))}
      </div>
    </div>
  );
}
