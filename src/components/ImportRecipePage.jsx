import { useState } from 'react';
import { parseRecipeText } from '../utils/parseRecipeText';
import { RecipeForm } from './RecipeForm';
import styles from './ImportRecipePage.module.css';

export function ImportRecipePage({ onSave, onCancel }) {
  const [phase, setPhase] = useState('paste'); // 'paste' | 'review'
  const [rawText, setRawText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [parsedRecipe, setParsedRecipe] = useState(null);

  function handleParse() {
    const result = parseRecipeText(rawText);
    setParsedRecipe({
      title: result.title,
      description: '',
      category: 'lunch-dinner',
      frequency: 'common',
      mealType: '',
      servings: '1',
      prepTime: '',
      cookTime: '',
      sourceUrl: sourceUrl.trim(),
      ingredients: result.ingredients.length > 0 ? result.ingredients : [],
      instructions: result.instructions,
    });
    setPhase('review');
  }

  function handleSave(data) {
    onSave(data);
  }

  function handleBackToPaste() {
    setPhase('paste');
    setParsedRecipe(null);
  }

  if (phase === 'review' && parsedRecipe) {
    return (
      <div className={styles.container}>
        <button className={styles.backToPaste} onClick={handleBackToPaste}>
          &larr; Back to paste
        </button>
        <RecipeForm
          recipe={parsedRecipe}
          onSave={handleSave}
          onCancel={onCancel}
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onCancel}>
          &larr; Back
        </button>
        <h2 className={styles.title}>Import Recipe</h2>
      </div>

      <div className={styles.card}>
        <label className={styles.label}>
          Source URL (optional)
          <input
            className={styles.input}
            type="url"
            value={sourceUrl}
            onChange={e => setSourceUrl(e.target.value)}
            placeholder="Instagram, TikTok, or recipe website link"
          />
        </label>
        <p className={styles.hint}>
          Save the link for your reference — paste the recipe text below.
        </p>

        <label className={styles.label}>
          Recipe Text
          <textarea
            className={styles.textarea}
            rows={14}
            value={rawText}
            onChange={e => setRawText(e.target.value)}
            placeholder="Paste recipe text from a website, Instagram caption, or TikTok description..."
          />
        </label>

        <button
          className={styles.parseBtn}
          onClick={handleParse}
          disabled={!rawText.trim()}
        >
          Parse Recipe
        </button>
      </div>
    </div>
  );
}
