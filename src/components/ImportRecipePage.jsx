import { useState, useEffect, useRef, useMemo } from 'react';
import { parseRecipeText, parseIngredientLine } from '../utils/parseRecipeText';
import { fetchRecipeFromUrl } from '../utils/fetchRecipeFromUrl';
import { fetchInstagramCaption } from '../utils/fetchInstagramCaption';
import { fetchTikTokRecipe, fetchTikTokCaption } from '../utils/fetchTikTokRecipe';
import { classifyMealType } from '../utils/classifyMealType';
import { loadStarterRecipes } from '../utils/starterRecipes';
import { RecipeForm } from './RecipeForm';
import styles from './ImportRecipePage.module.css';

const DISCOVER_CATEGORIES = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch-dinner', label: 'Lunch & Dinner' },
  { key: 'snacks', label: 'Snacks' },
  { key: 'desserts', label: 'Desserts' },
  { key: 'drinks', label: 'Drinks' },
];

function DiscoverMealsPanel({ onSave, userRecipes }) {
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [addedSet, setAddedSet] = useState(() => {
    // Pre-populate with user's existing recipe titles
    const set = new Set();
    if (userRecipes) {
      for (const r of userRecipes) {
        if (r.title) set.add(r.title.toLowerCase());
      }
    }
    return set;
  });

  useEffect(() => {
    loadStarterRecipes().then(r => { setRecipes(r); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = recipes;
    if (activeCategory !== 'all') {
      list = list.filter(r => (r.category || 'lunch-dinner') === activeCategory);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(r => r.title.toLowerCase().includes(q));
    }
    return list;
  }, [recipes, activeCategory, search]);

  const grouped = useMemo(() => {
    if (activeCategory !== 'all') return null;
    const groups = {};
    for (const cat of DISCOVER_CATEGORIES) groups[cat.key] = [];
    for (const r of filtered) {
      const cat = r.category || 'lunch-dinner';
      if (groups[cat]) groups[cat].push(r);
      else if (groups['lunch-dinner']) groups['lunch-dinner'].push(r);
    }
    return groups;
  }, [filtered, activeCategory]);

  function handleAdd(recipe) {
    const { id, createdAt, ...rest } = recipe;
    onSave({ ...rest, source: 'discover' });
    setAddedSet(prev => new Set(prev).add(recipe.title.toLowerCase()));
  }

  if (loading) return <p className={styles.instagramHelp}>Loading recipes...</p>;
  if (recipes.length === 0) return <p className={styles.instagramHelp}>No curated recipes available yet.</p>;

  return (
    <div>
      <input
        className={styles.input}
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search meals..."
        style={{ marginBottom: '0.75rem' }}
      />
      <div className={styles.discoverCategoryTabs}>
        <button className={`${styles.discoverTab} ${activeCategory === 'all' ? styles.discoverTabActive : ''}`} onClick={() => setActiveCategory('all')}>All</button>
        {DISCOVER_CATEGORIES.map(cat => (
          <button key={cat.key} className={`${styles.discoverTab} ${activeCategory === cat.key ? styles.discoverTabActive : ''}`} onClick={() => setActiveCategory(cat.key)}>{cat.label}</button>
        ))}
      </div>
      {activeCategory !== 'all' ? (
        <div className={styles.discoverGrid}>
          {filtered.map(r => (
            <div key={r.id || r.title} className={styles.discoverCard}>
              <span className={styles.discoverCardTitle}>{r.title}</span>
              {r.description && <span className={styles.discoverCardDesc}>{r.description}</span>}
              {r.servings && <span className={styles.discoverCardMeta}>{r.servings} servings</span>}
              {addedSet.has(r.title.toLowerCase()) ? (
                <span className={styles.discoverCardAdded}>Added to Shopping List</span>
              ) : (
                <button className={styles.discoverCardBtn} onClick={() => handleAdd(r)}>+ Add</button>
              )}
            </div>
          ))}
          {filtered.length === 0 && <p className={styles.instagramHelp}>No recipes found.</p>}
        </div>
      ) : (
        DISCOVER_CATEGORIES.map(cat => {
          const items = grouped?.[cat.key] || [];
          if (items.length === 0) return null;
          return (
            <div key={cat.key} style={{ marginBottom: '1.25rem' }}>
              <h4 className={styles.discoverSectionTitle}>{cat.label}</h4>
              <div className={styles.discoverGrid}>
                {items.slice(0, 6).map(r => (
                  <div key={r.id || r.title} className={styles.discoverCard}>
                    <span className={styles.discoverCardTitle}>{r.title}</span>
                    {addedSet.has(r.title.toLowerCase()) ? (
                      <span className={styles.discoverCardAdded}>Added to Shopping List</span>
                    ) : (
                      <button className={styles.discoverCardBtn} onClick={() => handleAdd(r)}>+ Add</button>
                    )}
                  </div>
                ))}
              </div>
              {items.length > 6 && (
                <button className={styles.discoverSeeAll} onClick={() => setActiveCategory(cat.key)}>See all {cat.label} ({items.length})</button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

export function ImportRecipePage({ onSave, onAddWithoutClose, onCancel, userRecipes }) {
  const [phase, setPhase] = useState('paste'); // 'paste' | 'review' | 'ai-results'
  const [importMode, setImportMode] = useState(''); // '' | 'url' | 'tiktok' | 'instagram' | 'pinterest' | 'paste' | 'manual' | 'restaurant' | 'ai'
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
  const [linkUrl, setLinkUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [tiktokUrl, setTiktokUrl] = useState('');
  const [pinterestUrl, setPinterestUrl] = useState('');
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

  async function handleFetchPinterest() {
    const url = pinterestUrl.trim();
    if (!url) return;
    setFetching(true);
    setFetchError('');
    try {
      // Step 1: Extract the source recipe URL from the Pinterest pin
      const extractRes = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}&pinterest=true`);
      if (!extractRes.ok) {
        const err = await extractRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to extract recipe link from Pinterest.');
      }
      const { sourceUrl: recipeUrl } = await extractRes.json();

      // Step 2: Fetch the actual recipe from the source URL
      const recipe = await fetchRecipeFromUrl(recipeUrl);
      setParsedRecipe({
        ...recipe,
        sourceUrl: recipeUrl,
        mealType: recipe.mealType || classifyMealType(recipe.ingredients || []),
      });
      setPhase('review');
    } catch (err) {
      setFetchError(err.message || 'Failed to import recipe from Pinterest.');
    } finally {
      setFetching(false);
    }
  }

  function detectUrlType(url) {
    const u = url.toLowerCase();
    if (u.includes('tiktok.com')) return 'tiktok';
    if (u.includes('instagram.com')) return 'instagram';
    if (u.includes('pinterest.com') || u.includes('pin.it')) return 'pinterest';
    return 'url';
  }

  async function handleSmartImport() {
    const url = linkUrl.trim();
    if (!url) return;
    const type = detectUrlType(url);
    setImportMode(type);
    if (type === 'tiktok') {
      setTiktokUrl(url);
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
    } else if (type === 'instagram') {
      setInstagramUrl(url);
      setFetching(true);
      setFetchError('');
      try {
        const caption = await fetchInstagramCaption(url);
        setRawText(caption);
        setPhase('paste');
      } catch (err) {
        setFetchError(err.message || 'Failed to fetch Instagram caption.');
      } finally {
        setFetching(false);
      }
    } else if (type === 'pinterest') {
      setPinterestUrl(url);
      setFetching(true);
      setFetchError('');
      try {
        const extractRes = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}&pinterest=true`);
        if (!extractRes.ok) {
          const err = await extractRes.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to extract recipe link from Pinterest.');
        }
        const { sourceUrl: recipeUrl } = await extractRes.json();
        const recipe = await fetchRecipeFromUrl(recipeUrl);
        setParsedRecipe({ ...recipe, sourceUrl: recipeUrl, mealType: recipe.mealType || classifyMealType(recipe.ingredients || []) });
        setPhase('review');
      } catch (err) {
        setFetchError(err.message || 'Failed to import recipe from Pinterest.');
      } finally {
        setFetching(false);
      }
    } else {
      setSourceUrl(url);
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
        <h2 className={styles.title}>Import Recipe</h2>
      </div>

      {!importMode && (
        <div className={styles.menuList}>
          {/* Discover Meals */}
          <button
            className={styles.menuItemBtn}
            onClick={() => { setImportMode('discover'); setPhase('paste'); }}
          >
            <div className={styles.menuItemTop}>
              <span className={styles.menuItemLabel}>Discover Meals</span>
              <span className={styles.menuItemDesc}>Browse our curated meal collection</span>
            </div>
            <span className={styles.menuItemArrow}>&rsaquo;</span>
          </button>

          {/* AI Generate */}
          <div className={styles.menuItem}>
            <div className={styles.menuItemTop}>
              <span className={styles.menuItemLabel}>AI Generate</span>
              <span className={styles.menuItemDesc}>Describe a meal and let AI create the recipe</span>
            </div>
            <div className={styles.menuItemInput}>
              <input
                className={styles.menuInlineInput}
                type="text"
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                placeholder="e.g. A healthy chicken lunch"
                onKeyDown={e => { if (e.key === 'Enter' && aiPrompt.trim()) { setImportMode('ai'); setPhase('paste'); handleAiGenerate(); } }}
              />
              <button
                className={styles.menuGoBtn}
                disabled={!aiPrompt.trim() || fetching}
                onClick={() => { setImportMode('ai'); setPhase('paste'); handleAiGenerate(); }}
              >
                Go
              </button>
            </div>
          </div>

          {/* Import from Link */}
          <div className={styles.menuItem}>
            <div className={styles.menuItemTop}>
              <span className={styles.menuItemLabel}>Import from Link</span>
              <span className={styles.menuItemDesc}>Websites, Instagram, TikTok, etc.</span>
            </div>
            <div className={styles.platformIcons}>
              <svg className={styles.platformIcon} viewBox="0 0 24 24" title="Website" style={{color: '#555'}}><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
              <svg className={styles.platformIcon} viewBox="0 0 48 48" title="TikTok"><path fill="#25F4EE" d="M33.3 8.4h-4.1v21.9a5.4 5.4 0 0 1-5.4 5.1 5.4 5.4 0 0 1-2.5-.6 5.4 5.4 0 0 0 7.9-4.8V8.4h4.1z"/><path fill="#25F4EE" d="M34.8 15.2v4.2a13.5 13.5 0 0 1-7.9-2.5v11.4a10 10 0 0 1-10 10 9.9 9.9 0 0 1-5.8-1.9 10 10 0 0 0 17.3-6.8V18.2a13.5 13.5 0 0 0 7.9 2.5v-4.2a9.4 9.4 0 0 1-1.5-1.3z"/><path fill="#FE2C55" d="M26.9 16.9v11.4a10 10 0 0 1-10 10 9.9 9.9 0 0 1-5.8-1.9A10 10 0 0 0 19 40a10 10 0 0 0 10-10V18.6a13.5 13.5 0 0 0 7.9 2.5v-4.2a9.4 9.4 0 0 1-5.9-5.5h-4.1v21.9a5.4 5.4 0 0 1-7.9 4.8 5.4 5.4 0 0 0 8-4.8V16.9z"/><path fill="#010101" d="M26.9 16.9v11.4a10 10 0 0 1-15.8 8.1A10 10 0 0 0 27 28.3V16.9a13.5 13.5 0 0 0 7.9 2.5v-4.2a9.4 9.4 0 0 1-5.9-5.5h-4.1v21.5a5.4 5.4 0 0 1-5.4 5.4 5.4 5.4 0 0 1-5.1-3.5 5.4 5.4 0 0 0 8-4.8V16.9h-1.5z" opacity="0"/></svg>
              <svg className={styles.platformIcon} viewBox="0 0 24 24" title="Instagram"><defs><linearGradient id="igGrad" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#FFDC80"/><stop offset="25%" stopColor="#F77737"/><stop offset="50%" stopColor="#E1306C"/><stop offset="75%" stopColor="#C13584"/><stop offset="100%" stopColor="#833AB4"/></linearGradient></defs><path fill="url(#igGrad)" d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4H7.6m9.65 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10m0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>
              <svg className={styles.platformIcon} viewBox="0 0 24 24" title="Pinterest"><path fill="#E60023" d="M12 2C6.48 2 2 6.48 2 12c0 4.24 2.65 7.86 6.39 9.29-.09-.78-.17-1.98.04-2.83.19-.78 1.22-5.17 1.22-5.17s-.31-.62-.31-1.54c0-1.45.84-2.53 1.88-2.53.89 0 1.32.67 1.32 1.47 0 .89-.57 2.23-.86 3.47-.25 1.04.52 1.88 1.54 1.88 1.84 0 3.26-1.94 3.26-4.75 0-2.48-1.79-4.22-4.33-4.22-2.95 0-4.68 2.21-4.68 4.5 0 .89.34 1.85.77 2.37.08.1.1.19.07.3-.08.31-.25 1.04-.29 1.18-.05.19-.15.23-.35.14-1.31-.61-2.13-2.53-2.13-4.07 0-3.31 2.41-6.36 6.95-6.36 3.64 0 6.48 2.6 6.48 6.07 0 3.62-2.28 6.53-5.45 6.53-1.06 0-2.07-.55-2.41-1.21l-.66 2.5c-.24.91-.88 2.05-1.32 2.75.99.31 2.04.47 3.13.47 5.52 0 10-4.48 10-10S17.52 2 12 2z"/></svg>
            </div>
            <div className={styles.menuItemInput}>
              <input
                className={styles.menuInlineInput}
                type="url"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                placeholder="Paste a URL from any supported site..."
                onKeyDown={e => { if (e.key === 'Enter' && linkUrl.trim()) handleSmartImport(); }}
                disabled={fetching}
              />
              <button
                className={styles.menuGoBtn}
                disabled={!linkUrl.trim() || fetching}
                onClick={handleSmartImport}
              >
                {fetching ? '...' : 'Go'}
              </button>
            </div>
            {fetchError && !importMode && <div className={styles.fetchError}>{fetchError}</div>}
          </div>

          {/* Restaurant */}
          <div className={styles.menuItem}>
            <div className={styles.menuItemTop}>
              <span className={styles.menuItemLabel}>Restaurant</span>
              <span className={styles.menuItemDesc}>Search restaurant menu items</span>
            </div>
            <div className={styles.menuItemInput}>
              <input
                className={styles.menuInlineInput}
                type="text"
                value={restaurantQuery}
                onChange={e => setRestaurantQuery(e.target.value)}
                placeholder="e.g. Chipotle chicken burrito bowl"
                onKeyDown={e => { if (e.key === 'Enter' && restaurantQuery.trim()) { setImportMode('restaurant'); setPhase('paste'); } }}
              />
              <button
                className={styles.menuGoBtn}
                disabled={!restaurantQuery.trim()}
                onClick={() => { setImportMode('restaurant'); setPhase('paste'); }}
              >
                Go
              </button>
            </div>
          </div>

          {/* Paste */}
          <button
            className={styles.menuItemBtn}
            onClick={() => { setImportMode('paste'); setPhase('paste'); }}
          >
            <div className={styles.menuItemTop}>
              <span className={styles.menuItemLabel}>Paste Text</span>
              <span className={styles.menuItemDesc}>Paste recipe text or a table</span>
            </div>
            <span className={styles.menuItemArrow}>&rsaquo;</span>
          </button>

          {/* Manual */}
          <button
            className={styles.menuItemBtn}
            onClick={handleStartManual}
          >
            <div className={styles.menuItemTop}>
              <span className={styles.menuItemLabel}>Manual Entry</span>
              <span className={styles.menuItemDesc}>Type in the recipe yourself</span>
            </div>
            <span className={styles.menuItemArrow}>&rsaquo;</span>
          </button>
        </div>
      )}

      {importMode && <>
      <div className={styles.navBtnRow}>
        <button className={styles.addMoreBtn} onClick={() => { setImportMode(''); setFetchError(''); setRawText(''); }}>
          + Add More Recipes
        </button>
        <button className={styles.continueHomeBtn} onClick={onCancel}>
          Continue to Homepage
        </button>
      </div>
      <div className={styles.card}>
        {importMode === 'discover' && (
          <DiscoverMealsPanel onSave={onAddWithoutClose || onSave} userRecipes={userRecipes} />
        )}

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

        {importMode === 'pinterest' && (
          <>
            <label className={styles.label}>
              Pinterest Pin URL
              <input
                className={styles.input}
                type="url"
                value={pinterestUrl}
                onChange={e => setPinterestUrl(e.target.value)}
                placeholder="https://www.pinterest.com/pin/..."
                disabled={fetching}
              />
            </label>

            <div className={styles.urlActions}>
              <button
                className={styles.fetchBtn}
                onClick={handleFetchPinterest}
                disabled={!pinterestUrl.trim() || fetching}
              >
                {fetching ? 'Fetching...' : 'Import from Pinterest'}
              </button>
            </div>

            {fetchError && (
              <div className={styles.fetchError}>{fetchError}</div>
            )}

            {fetching && (
              <p className={styles.instagramHelp}>Finding the recipe linked in this pin...</p>
            )}
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
      </>}
    </div>
  );
}
