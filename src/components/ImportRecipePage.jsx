import { useState, useEffect, useRef } from 'react';
import { parseRecipeText, parseIngredientLine } from '../utils/parseRecipeText';
import { fetchRecipeFromUrl } from '../utils/fetchRecipeFromUrl';
import { fetchInstagramCaption } from '../utils/fetchInstagramCaption';
import { fetchTikTokRecipe, fetchTikTokCaption } from '../utils/fetchTikTokRecipe';
import { classifyMealType } from '../utils/classifyMealType';
import { RecipeForm } from './RecipeForm';
import styles from './ImportRecipePage.module.css';

export function ImportRecipePage({ onSave, onCancel }) {
  const [phase, setPhase] = useState('paste'); // 'paste' | 'review' | 'ai-results'
  const [importMode, setImportMode] = useState('url'); // 'url' | 'tiktok' | 'instagram' | 'paste' | 'manual' | 'restaurant' | 'ai'
  const [rawText, setRawText] = useState('');
  const [pasteFormat, setPasteFormat] = useState('text'); // 'text' | 'table'
  const [restaurantQuery, setRestaurantQuery] = useState('');
  const [restaurantResults, setRestaurantResults] = useState([]);
  const [restaurantLoading, setRestaurantLoading] = useState(false);
  const [tableRows, setTableRows] = useState([
    { quantity: '', measurement: '', ingredient: '' },
    { quantity: '', measurement: '', ingredient: '' },
    { quantity: '', measurement: '', ingredient: '' },
  ]);
  const [recipeTitle, setRecipeTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [tiktokUrl, setTiktokUrl] = useState('');
  const [parsedRecipe, setParsedRecipe] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  // AI generate state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiCount, setAiCount] = useState(2);
  const [aiRecipes, setAiRecipes] = useState([]);
  const [aiEditing, setAiEditing] = useState(null);

  function updateTableRow(index, field, value) {
    setTableRows(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addTableRow() {
    setTableRows(prev => [...prev, { quantity: '', measurement: '', ingredient: '' }]);
  }

  function removeTableRow(index) {
    setTableRows(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== index));
  }

  function handleTablePaste(e, rowIndex, field) {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\t') && !text.includes('\n')) return; // normal paste
    e.preventDefault();
    const lines = text.trim().split('\n').filter(l => l.trim());
    const newRows = lines.map(line => {
      const cols = line.split('\t').map(c => c.trim());
      if (cols.length >= 3) return { quantity: cols[0], measurement: cols[1], ingredient: cols.slice(2).join(', ') };
      if (cols.length === 2) return /^\d/.test(cols[0])
        ? { quantity: cols[0], measurement: '', ingredient: cols[1] }
        : { quantity: '', measurement: cols[0], ingredient: cols[1] };
      return parseIngredientLine(line);
    });
    setTableRows(prev => {
      const before = prev.slice(0, rowIndex);
      const after = prev.slice(rowIndex + 1);
      return [...before, ...newRows, ...after];
    });
  }

  function handleParse() {
    const result = parseRecipeText(rawText);
    const url = importMode === 'instagram' ? instagramUrl.trim()
      : importMode === 'tiktok' ? tiktokUrl.trim()
      : sourceUrl.trim();
    const ingredients = result.ingredients.length > 0 ? result.ingredients : [];
    setParsedRecipe({
      title: result.title,
      description: '',
      category: 'lunch-dinner',
      frequency: 'common',
      mealType: classifyMealType(ingredients),
      servings: '1',
      prepTime: '',
      cookTime: '',
      sourceUrl: url,
      ingredients,
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
      setParsedRecipe({ ...recipe, mealType: recipe.mealType || classifyMealType(recipe.ingredients || []) });
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
      setParsedRecipe({ ...recipe, mealType: recipe.mealType || classifyMealType(recipe.ingredients || []) });
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

  function handleStartManual() {
    setParsedRecipe({
      title: '',
      description: '',
      category: 'lunch-dinner',
      frequency: 'common',
      mealType: '',
      servings: '1',
      prepTime: '',
      cookTime: '',
      sourceUrl: '',
      ingredients: [],
      instructions: '',
    });
    setImportMode('manual');
    setPhase('review');
  }

  const restaurantDebounceRef = useRef(null);

  useEffect(() => {
    const q = restaurantQuery.trim();
    if (q.length < 3) {
      setRestaurantResults([]);
      setFetchError('');
      return;
    }

    if (restaurantDebounceRef.current) clearTimeout(restaurantDebounceRef.current);

    restaurantDebounceRef.current = setTimeout(async () => {
      setRestaurantLoading(true);
      setFetchError('');
      try {
        const res = await fetch(`/api/restaurant-search?query=${encodeURIComponent(q)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          if (res.status === 429) {
            throw new Error('Too many requests. Wait a moment and try again.');
          }
          throw new Error(err.error || `Search failed (${res.status})`);
        }
        const data = await res.json();
        setRestaurantResults(data.results || []);
        if ((data.results || []).length === 0) {
          setFetchError('No results found. Try a different search.');
        }
      } catch (err) {
        setFetchError(err.message);
      } finally {
        setRestaurantLoading(false);
      }
    }, 800);

    return () => {
      if (restaurantDebounceRef.current) clearTimeout(restaurantDebounceRef.current);
    };
  }, [restaurantQuery]);

  async function handleSelectRestaurantItem(item) {
    setFetching(true);
    setFetchError('');
    try {
      const res = await fetch(`/api/restaurant-search?fdcId=${item.fdcId}&type=nutrients`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to load nutrition (${res.status})`);
      }
      const data = await res.json();
      const n = data.nutrients || {};
      const title = data.brandName
        ? `${data.brandName} - ${data.name}`
        : data.name;
      const servingDesc = data.servingDescription || data.servingSize || '1 serving';

      setParsedRecipe({
        title,
        description: `From ${data.brandName || 'restaurant'}. Serving: ${servingDesc}.`,
        category: 'lunch-dinner',
        frequency: 'common',
        mealType: '',
        servings: '1',
        prepTime: '',
        cookTime: '',
        sourceUrl: '',
        ingredients: [{
          quantity: '1',
          measurement: 'serving',
          ingredient: title,
          nutrition: n,
        }],
        instructions: '',
        nutrition: n,
      });
      setPhase('review');
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setFetching(false);
    }
  }

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return;
    setFetching(true);
    setFetchError('');
    setAiRecipes([]);
    try {
      let dietPreferences = [];
      try {
        const d = JSON.parse(localStorage.getItem('sunday-user-diet'));
        if (Array.isArray(d)) dietPreferences = d;
      } catch {}
      const res = await fetch('/api/generate-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt.trim(), dietPreferences, count: aiCount }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Generation failed (${res.status})`);
      }
      const data = await res.json();
      setAiRecipes(data.recipes || []);
      setPhase('ai-results');
    } catch (err) {
      setFetchError(err.message || 'Failed to generate recipes.');
    } finally {
      setFetching(false);
    }
  }

  function handleSaveAiRecipe(recipe) {
    const ingredients = (recipe.ingredients || []).map(ing => ({
      quantity: String(ing.quantity || ''),
      measurement: ing.measurement || '',
      ingredient: ing.ingredient || '',
    }));
    onSave({
      title: recipe.title || '',
      description: recipe.description || '',
      category: recipe.category || 'lunch-dinner',
      frequency: 'common',
      mealType: classifyMealType(ingredients),
      servings: String(recipe.servings || '1'),
      prepTime: recipe.prepTime || '',
      cookTime: recipe.cookTime || '',
      sourceUrl: '',
      ingredients,
      instructions: recipe.instructions || '',
      source: 'ai',
    });
  }

  function handleEditAiRecipe(index) {
    const recipe = aiRecipes[index];
    if (!recipe) return;
    const ingredients = (recipe.ingredients || []).map(ing => ({
      quantity: String(ing.quantity || ''),
      measurement: ing.measurement || '',
      ingredient: ing.ingredient || '',
    }));
    setParsedRecipe({
      title: recipe.title || '',
      description: recipe.description || '',
      category: recipe.category || 'lunch-dinner',
      frequency: 'common',
      mealType: classifyMealType(ingredients),
      servings: String(recipe.servings || '1'),
      prepTime: recipe.prepTime || '',
      cookTime: recipe.cookTime || '',
      sourceUrl: '',
      ingredients,
      instructions: recipe.instructions || '',
    });
    setPhase('review');
  }

  function handleSave(data) {
    onSave({ ...data, source: importMode });
  }

  function handleBackToPaste() {
    setPhase('paste');
    setParsedRecipe(null);
  }

  if (phase === 'ai-results' && aiRecipes.length > 0) {
    return (
      <div className={styles.container}>
        <button className={styles.backToPaste} onClick={() => { setPhase('paste'); setAiRecipes([]); }}>
          &larr; Back to prompt
        </button>
        <h2 className={styles.title}>AI Recipe Ideas</h2>
        <p className={styles.aiSubtitle}>Here are {aiRecipes.length} recipes based on your request. Save as-is or edit before saving.</p>
        <div className={styles.aiGrid}>
          {aiRecipes.map((recipe, idx) => recipe && (
            <div key={idx} className={styles.aiCard}>
              <h3 className={styles.aiCardTitle}>{recipe.title}</h3>
              {recipe.macrosPerServing && (
                <div className={styles.aiMacros}>
                  <span><strong>{recipe.macrosPerServing.calories}</strong> cal</span>
                  <span><strong>{recipe.macrosPerServing.protein}g</strong> protein</span>
                  <span><strong>{recipe.macrosPerServing.carbs}g</strong> carbs</span>
                  <span><strong>{recipe.macrosPerServing.fat}g</strong> fat</span>
                </div>
              )}
              {recipe.description && <p className={styles.aiCardDesc}>{recipe.description}</p>}
              {recipe.highlights && recipe.highlights.length > 0 && (
                <ul className={styles.aiHighlights}>
                  {recipe.highlights.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              )}
              <div className={styles.aiCardMeta}>
                {recipe.servings && <span>Serves {recipe.servings}</span>}
                {recipe.prepTime && <span>Prep: {recipe.prepTime}</span>}
                {recipe.cookTime && <span>Cook: {recipe.cookTime}</span>}
              </div>
              <div className={styles.aiCardSection}>
                <h4>Ingredients</h4>
                <ul className={styles.aiIngList}>
                  {(recipe.ingredients || []).map((ing, i) => (
                    <li key={i}>{ing.quantity} {ing.measurement} {ing.ingredient}</li>
                  ))}
                </ul>
              </div>
              <div className={styles.aiCardSection}>
                <h4>Instructions</h4>
                <p className={styles.aiInstructions}>{recipe.instructions}</p>
              </div>
              <div className={styles.aiCardActions}>
                <button className={styles.aiEditBtn} onClick={() => handleEditAiRecipe(idx)}>Edit &amp; Save</button>
                <button className={styles.aiSaveBtn} onClick={() => handleSaveAiRecipe(recipe)}>Save Recipe</button>
              </div>
            </div>
          ))}
        </div>
        <button className={styles.aiRegenerateBtn} onClick={() => { setPhase('paste'); }}>
          Try a different prompt
        </button>
      </div>
    );
  }

  if (phase === 'review' && parsedRecipe) {
    return (
      <div className={styles.container}>
        {importMode !== 'manual' && (
          <button className={styles.backToPaste} onClick={handleBackToPaste}>
            &larr; Back to import
          </button>
        )}
        {importMode === 'manual' && (
          <button className={styles.backToPaste} onClick={onCancel}>
            &larr; Back
          </button>
        )}
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
          ['ai', 'AI Generate'],
          ['manual', 'Manual'],
          ['url', 'URL'],
          ['restaurant', 'Restaurant'],
          ['tiktok', 'TikTok'],
          ['instagram', 'Instagram'],
          ['paste', 'Paste'],
        ].map(([mode, label]) => (
          <button
            key={mode}
            className={`${styles.tab} ${importMode === mode ? styles.tabActive : ''}`}
            onClick={() => mode === 'manual' ? handleStartManual() : (setImportMode(mode), setPhase('paste'))}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.card}>
        {importMode === 'ai' && (
          <>
            <label className={styles.label}>
              What kind of recipe are you looking for?
              <textarea
                className={styles.textarea}
                rows={4}
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                placeholder={"e.g. A healthy high-protein lunch with chicken\nA quick 30-minute vegetarian pasta dinner\nSomething with salmon and sweet potatoes"}
                disabled={fetching}
              />
            </label>

            <div className={styles.aiOptions}>
              <label className={styles.aiCountLabel}>
                Number of recipes
                <div className={styles.aiCountPicker}>
                  {[1, 2, 3, 4].map(n => (
                    <button
                      key={n}
                      className={`${styles.aiCountBtn} ${aiCount === n ? styles.aiCountBtnActive : ''}`}
                      onClick={() => setAiCount(n)}
                      type="button"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </label>
              <button
                className={styles.fetchBtn}
                onClick={handleAiGenerate}
                disabled={!aiPrompt.trim() || fetching}
              >
                {fetching ? 'Generating...' : 'Generate Recipes'}
              </button>
            </div>

            {fetchError && (
              <div className={styles.fetchError}>{fetchError}</div>
            )}

            {fetching && (
              <p className={styles.instagramHelp}>Claude is crafting your recipes... this may take a few seconds.</p>
            )}
          </>
        )}

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

        {importMode === 'restaurant' && (
          <>
            <label className={styles.label}>
              Search Restaurant Menu Items
              <input
                className={styles.input}
                type="text"
                value={restaurantQuery}
                onChange={e => setRestaurantQuery(e.target.value)}
                placeholder="e.g. Chipotle chicken burrito bowl"
                disabled={fetching}
              />
            </label>

            {restaurantLoading && (
              <p className={styles.instagramHelp}>Searching...</p>
            )}

            {fetchError && (
              <div className={styles.fetchError}>{fetchError}</div>
            )}

            {fetching && (
              <p className={styles.instagramHelp}>Loading nutrition data...</p>
            )}

            {restaurantResults.length > 0 && (
              <div className={styles.restaurantResults}>
                {restaurantResults.map(item => (
                  <button
                    key={item.fdcId}
                    className={styles.restaurantItem}
                    onClick={() => handleSelectRestaurantItem(item)}
                    disabled={fetching}
                  >
                    <div className={styles.restaurantInfo}>
                      <span className={styles.restaurantName}>{item.name}</span>
                      <span className={styles.restaurantBrand}>
                        {item.brandName}
                        {item.householdServing && ` · ${item.householdServing}`}
                      </span>
                    </div>
                    <div className={styles.restaurantMeta}>
                      {item.calories != null && (
                        <span className={styles.restaurantCal}>{item.calories} cal</span>
                      )}
                      {item.protein != null && (
                        <span className={styles.restaurantProtein}>{item.protein}g protein</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {importMode === 'paste' && (
          <>
            <div className={styles.pasteFormatToggle}>
              <button
                className={`${styles.pasteFormatBtn} ${pasteFormat === 'text' ? styles.pasteFormatBtnActive : ''}`}
                onClick={() => setPasteFormat('text')}
              >
                Free Text
              </button>
              <button
                className={`${styles.pasteFormatBtn} ${pasteFormat === 'table' ? styles.pasteFormatBtnActive : ''}`}
                onClick={() => setPasteFormat('table')}
              >
                Table Data
              </button>
            </div>

            {pasteFormat === 'text' && (
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

            {pasteFormat === 'table' && (
              <>
                <label className={styles.label}>
                  Recipe Title
                  <input
                    className={styles.input}
                    type="text"
                    value={recipeTitle}
                    onChange={e => setRecipeTitle(e.target.value)}
                    placeholder="e.g. Chicken Stir Fry"
                  />
                </label>
                <table className={styles.ingredientTable}>
                  <thead>
                    <tr>
                      <th>Quantity</th>
                      <th>Measurement</th>
                      <th>Ingredient</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, i) => (
                      <tr key={i}>
                        <td>
                          <input
                            className={styles.tableInput}
                            type="text"
                            value={row.quantity}
                            onChange={e => updateTableRow(i, 'quantity', e.target.value)}
                            onPaste={e => handleTablePaste(e, i, 'quantity')}
                            placeholder="2"
                          />
                        </td>
                        <td>
                          <input
                            className={styles.tableInput}
                            type="text"
                            value={row.measurement}
                            onChange={e => updateTableRow(i, 'measurement', e.target.value)}
                            onPaste={e => handleTablePaste(e, i, 'measurement')}
                            placeholder="cups"
                          />
                        </td>
                        <td>
                          <input
                            className={styles.tableInput}
                            type="text"
                            value={row.ingredient}
                            onChange={e => updateTableRow(i, 'ingredient', e.target.value)}
                            onPaste={e => handleTablePaste(e, i, 'ingredient')}
                            placeholder="flour"
                          />
                        </td>
                        <td>
                          <button
                            className={styles.tableRemoveBtn}
                            onClick={() => removeTableRow(i)}
                            aria-label="Remove row"
                          >
                            &times;
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className={styles.tableAddRowBtn} onClick={addTableRow} type="button">
                  + Add Row
                </button>
                <button
                  className={styles.parseBtn}
                  onClick={() => {
                    const ingredients = tableRows.filter(r => r.ingredient.trim());
                    setParsedRecipe({
                      title: recipeTitle.trim(),
                      description: '',
                      category: 'lunch-dinner',
                      frequency: 'common',
                      mealType: classifyMealType(ingredients),
                      servings: '1',
                      prepTime: '',
                      cookTime: '',
                      sourceUrl: '',
                      ingredients,
                      instructions: '',
                    });
                    setPhase('review');
                  }}
                  disabled={!tableRows.some(r => r.ingredient.trim()) || fetching}
                >
                  Import Table
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
