import { useState } from 'react';
import { parseRecipeText } from '../utils/parseRecipeText';
import { fetchRecipeFromUrl } from '../utils/fetchRecipeFromUrl';
import { fetchInstagramCaption } from '../utils/fetchInstagramCaption';
import { fetchTikTokRecipe, fetchTikTokCaption } from '../utils/fetchTikTokRecipe';
import { RecipeForm } from './RecipeForm';
import styles from './ImportRecipePage.module.css';

export function ImportRecipePage({ onSave, onCancel }) {
  const [phase, setPhase] = useState('paste'); // 'paste' | 'review'
  const [importMode, setImportMode] = useState('url'); // 'url' | 'tiktok' | 'instagram' | 'paste'
  const [rawText, setRawText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [tiktokUrl, setTiktokUrl] = useState('');
  const [parsedRecipe, setParsedRecipe] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  function handleParse() {
    const result = parseRecipeText(rawText);
    const url = importMode === 'instagram' ? instagramUrl.trim()
      : importMode === 'tiktok' ? tiktokUrl.trim()
      : sourceUrl.trim();
    setParsedRecipe({
      title: result.title,
      description: '',
      category: 'lunch-dinner',
      frequency: 'common',
      mealType: '',
      servings: '1',
      prepTime: '',
      cookTime: '',
      sourceUrl: url,
      ingredients: result.ingredients.length > 0 ? result.ingredients : [],
      instructions: result.instructions,
    });
    setPhase('review');
  }

  async function handleFetchFromUrl() {
    const url = sourceUrl.trim();
    if (!url) return;
    setFetching(true);
    setFetchError('');
    try {
      const recipe = await fetchRecipeFromUrl(url);
      setParsedRecipe(recipe);
      setPhase('review');
    } catch (err) {
      setFetchError(err.message || 'Failed to fetch recipe from URL.');
    } finally {
      setFetching(false);
    }
  }

  async function handleFetchCaption() {
    const url = instagramUrl.trim();
    if (!url) return;
    setFetching(true);
    setFetchError('');
    try {
      const caption = await fetchInstagramCaption(url);
      setRawText(caption);
    } catch (err) {
      setFetchError(err.message || 'Failed to fetch Instagram caption.');
    } finally {
      setFetching(false);
    }
  }

  async function handleFetchTikTok() {
    const url = tiktokUrl.trim();
    if (!url) return;
    setFetching(true);
    setFetchError('');
    try {
      const recipe = await fetchTikTokRecipe(url);
      setParsedRecipe(recipe);
      setPhase('review');
    } catch (err) {
      setFetchError(err.message || 'Failed to fetch recipe from TikTok.');
    } finally {
      setFetching(false);
    }
  }

  async function handleFetchTikTokCaption() {
    const url = tiktokUrl.trim();
    if (!url) return;
    setFetching(true);
    setFetchError('');
    try {
      const caption = await fetchTikTokCaption(url);
      setRawText(caption);
    } catch (err) {
      setFetchError(err.message || 'Failed to fetch TikTok caption.');
    } finally {
      setFetching(false);
    }
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

      <div className={styles.tabs}>
        {[
          ['url', 'URL'],
          ['tiktok', 'TikTok'],
          ['instagram', 'Instagram'],
          ['paste', 'Paste'],
        ].map(([mode, label]) => (
          <button
            key={mode}
            className={`${styles.tab} ${importMode === mode ? styles.tabActive : ''}`}
            onClick={() => setImportMode(mode)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.card}>
        {importMode === 'url' && (
          <>
            <label className={styles.label}>
              Recipe URL
              <input
                className={styles.input}
                type="url"
                value={sourceUrl}
                onChange={e => setSourceUrl(e.target.value)}
                placeholder="https://www.allrecipes.com/recipe/..."
                disabled={fetching}
              />
            </label>

            <div className={styles.urlActions}>
              <button
                className={styles.fetchBtn}
                onClick={handleFetchFromUrl}
                disabled={!sourceUrl.trim() || fetching}
              >
                {fetching ? 'Fetching...' : 'Fetch from URL'}
              </button>
            </div>

            {fetchError && (
              <div className={styles.fetchError}>{fetchError}</div>
            )}
          </>
        )}

        {importMode === 'tiktok' && (
          <>
            <label className={styles.label}>
              TikTok Video URL
              <input
                className={styles.input}
                type="url"
                value={tiktokUrl}
                onChange={e => setTiktokUrl(e.target.value)}
                placeholder="https://www.tiktok.com/@user/video/..."
                disabled={fetching}
              />
            </label>

            <div className={styles.urlActions}>
              <button
                className={styles.fetchBtn}
                onClick={handleFetchTikTok}
                disabled={!tiktokUrl.trim() || fetching}
              >
                {fetching ? 'Fetching...' : 'Fetch Recipe'}
              </button>
              <button
                className={styles.fetchBtn}
                onClick={handleFetchTikTokCaption}
                disabled={!tiktokUrl.trim() || fetching}
              >
                {fetching ? 'Fetching...' : 'Fetch Caption Only'}
              </button>
            </div>

            {fetchError && (
              <div className={styles.fetchError}>{fetchError}</div>
            )}

            <p className={styles.instagramHelp}>
              Or copy the description text from TikTok and paste it below.
            </p>

            <label className={styles.label}>
              Caption Text
              <textarea
                className={styles.textarea}
                rows={14}
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                placeholder="Paste the TikTok caption here..."
                disabled={fetching}
              />
            </label>

            <button
              className={styles.parseBtn}
              onClick={handleParse}
              disabled={!rawText.trim() || fetching}
            >
              Parse Recipe
            </button>
          </>
        )}

        {importMode === 'instagram' && (
          <>
            <label className={styles.label}>
              Instagram Post URL
              <input
                className={styles.input}
                type="url"
                value={instagramUrl}
                onChange={e => setInstagramUrl(e.target.value)}
                placeholder="https://www.instagram.com/p/..."
                disabled={fetching}
              />
            </label>

            <div className={styles.urlActions}>
              <button
                className={styles.fetchBtn}
                onClick={handleFetchCaption}
                disabled={!instagramUrl.trim() || fetching}
              >
                {fetching ? 'Fetching...' : 'Fetch Caption'}
              </button>
            </div>

            {fetchError && (
              <div className={styles.fetchError}>{fetchError}</div>
            )}

            <p className={styles.instagramHelp}>
              Or copy the caption text from the Instagram app and paste it below.
            </p>

            <label className={styles.label}>
              Caption Text
              <textarea
                className={styles.textarea}
                rows={14}
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                placeholder="Paste the Instagram caption here..."
                disabled={fetching}
              />
            </label>

            <button
              className={styles.parseBtn}
              onClick={handleParse}
              disabled={!rawText.trim() || fetching}
            >
              Parse Recipe
            </button>
          </>
        )}

        {importMode === 'paste' && (
          <>
            <label className={styles.label}>
              Recipe Text
              <textarea
                className={styles.textarea}
                rows={14}
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                placeholder={"Paste recipe text in any format. For best results:\n\nRecipe Title\n\nIngredients:\n2 cups flour\n1 tsp salt\nOlive oil\n\nInstructions:\nMix ingredients together.\nBake at 350°F for 30 min."}
                disabled={fetching}
              />
            </label>

            <button
              className={styles.parseBtn}
              onClick={handleParse}
              disabled={!rawText.trim() || fetching}
            >
              Parse Recipe
            </button>
          </>
        )}
      </div>
    </div>
  );
}
