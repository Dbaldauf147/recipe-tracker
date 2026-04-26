import { useState, useEffect, useRef, useMemo } from 'react';
import { parseRecipeText, parseIngredientLine } from '../utils/parseRecipeText';
import { fetchRecipeFromUrl, fetchAllRecipesFromUrl } from '../utils/fetchRecipeFromUrl';
import { fetchInstagramCaption } from '../utils/fetchInstagramCaption';
import { fetchTikTokRecipe, fetchTikTokCaption } from '../utils/fetchTikTokRecipe';
import { classifyMealType } from '../utils/classifyMealType';
import { loadStarterRecipes } from '../utils/starterRecipes';
import { getPendingSharedRecipes, acceptSharedRecipe, declineSharedRecipe, loadFriends, removeFriend, searchByUsername, searchByEmail, searchByName, sendFriendRequest, getUsername } from '../utils/firestoreSync';
import { useAuth } from '../contexts/AuthContext';
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

const RECIPE_SOURCE_OPTIONS = [
  { key: 'online', icon: '🌐', label: 'Online', desc: 'Websites, social media, blogs' },
  { key: 'docs', icon: '📄', label: 'Written down', desc: 'Word docs, notes app, PDFs' },
  { key: 'head', icon: '🧠', label: 'In my head', desc: "I know my recipes by heart" },
  { key: 'none', icon: '🆕', label: "Don't have any yet", desc: "We'll help you discover or create recipes" },
];

export function ImportRecipePage({ onSave, onAddWithoutClose, onCancel, userRecipes, isOnboarding = false }) {
  const { user } = useAuth();
  const [showSourcePicker, setShowSourcePicker] = useState(() => {
    if (isOnboarding) return true; // Always show during onboarding
    if (userRecipes && userRecipes.length > 0) return false;
    try { return !localStorage.getItem('sunday-recipe-source-seen'); } catch { return true; }
  });
  const [selectedSources, setSelectedSources] = useState(new Set());
  const [cameFromSourcePicker, setCameFromSourcePicker] = useState(false);
  const [showUrlPopup, setShowUrlPopup] = useState(false);
  const [urlLinks, setUrlLinks] = useState(['']);
  const [phase, setPhase] = useState('paste'); // 'paste' | 'review' | 'ai-results'
  const [importMode, setImportMode] = useState(''); // '' | 'url' | 'tiktok' | 'instagram' | 'pinterest' | 'paste' | 'manual' | 'restaurant' | 'ai' | 'shared'
  const [pendingShares, setPendingShares] = useState([]);
  const [sharedSearch, setSharedSearch] = useState('');
  const [sharedFriends, setSharedFriends] = useState([]);
  const [friendSearch, setFriendSearch] = useState('');
  const [friendSearchResult, setFriendSearchResult] = useState(null);
  const [friendStatus, setFriendStatus] = useState('');

  // Load pending shared recipes and friends
  useEffect(() => {
    if (!user) return;
    getPendingSharedRecipes(user.uid).then(setPendingShares).catch(() => {});
    loadFriends(user.uid).then(setSharedFriends).catch(() => {});
  }, [user]);
  const [bulkRecipes, setBulkRecipes] = useState([]);
  const [bulkPreview, setBulkPreview] = useState(null); // index of recipe to preview
  const [urlRecipes, setUrlRecipes] = useState([]); // multiple recipes from a single URL
  const [urlRecipePreview, setUrlRecipePreview] = useState(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkAdded, setBulkAdded] = useState(new Set());
  const bulkFileRef = useRef(null);
  const [rawText, setRawText] = useState('');
  const [rawText2, setRawText2] = useState('');
  const [pasteFormat, setPasteFormat] = useState('text'); // 'text' | 'table'
  const [restaurantQuery, setRestaurantQuery] = useState('');
  const [restaurantResults, setRestaurantResults] = useState([]);
  const [restaurantLoading, setRestaurantLoading] = useState(false);
  const [tableRows, setTableRows] = useState([
    { quantity: '', measurement: '', ingredient: '' },
    { quantity: '', measurement: '', ingredient: '' },
    { quantity: '', measurement: '', ingredient: '' },
  ]);
  const [bulkPasteMode, setBulkPasteMode] = useState('text'); // 'text' | 'sheet' | 'image'
  const [bulkSheetRows, setBulkSheetRows] = useState(() =>
    Array.from({ length: 8 }, () => ({ title: '', ingredients: '', instructions: '', servings: '', category: '' }))
  );
  const [bulkImageProcessing, setBulkImageProcessing] = useState(false);
  const [bulkImageError, setBulkImageError] = useState('');
  const bulkImageFileRef = useRef(null);
  const [recipeTitle, setRecipeTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [multiUrls, setMultiUrls] = useState(['', '']);
  const [multiImporting, setMultiImporting] = useState(false);
  const [multiResults, setMultiResults] = useState([]);
  const [instagramUrl, setInstagramUrl] = useState('');
  const [tiktokUrl, setTiktokUrl] = useState('');
  const [pinterestUrl, setPinterestUrl] = useState('');
  const [parsedRecipe, setParsedRecipe] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [urlImportError, setUrlImportError] = useState('');
  const [urlImporting, setUrlImporting] = useState(false);

  // AI generate state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiCount, setAiCount] = useState(2);
  const [aiRecipes, setAiRecipes] = useState([]);
  const [aiEditing, setAiEditing] = useState(null);

  async function extractDocxText(file) {
    // .docx is a zip file; document.xml contains the text
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(file);
    const docXml = await zip.file('word/document.xml')?.async('string');
    if (!docXml) return { text: '', title: '' };

    // Extract title from heading/title styled paragraphs
    let docTitle = '';
    const titleMatch = docXml.match(/<w:pStyle w:val="(?:Title|Heading1|Heading 1)"[^/]*\/>[^]*?<w:t[^>]*>([^<]+)<\/w:t>/i);
    if (titleMatch) {
      docTitle = titleMatch[1].trim();
    }
    // Also try core.xml for document title
    if (!docTitle) {
      try {
        const coreXml = await zip.file('docProps/core.xml')?.async('string');
        if (coreXml) {
          const coreTitleMatch = coreXml.match(/<dc:title>([^<]+)<\/dc:title>/);
          if (coreTitleMatch && coreTitleMatch[1].trim()) {
            docTitle = coreTitleMatch[1].trim();
          }
        }
      } catch {}
    }

    // Also extract title by finding the first paragraph with heading style
    if (!docTitle) {
      // Look for any heading-styled paragraph
      const headingRegex = /<w:p [^>]*>(?:[^]*?<w:pStyle w:val="(?:Title|Heading\d?|Heading \d)"[^/]*\/>)?[^]*?<w:t[^>]*>([^<]+)<\/w:t>[^]*?<\/w:p>/gi;
      const firstPara = headingRegex.exec(docXml);
      if (firstPara) {
        // Check if this paragraph has a heading style
        const paraBlock = firstPara[0];
        if (/w:pStyle w:val="(?:Title|Heading)/i.test(paraBlock)) {
          docTitle = firstPara[1].trim();
        }
      }
    }

    // Strip XML tags, keep text content
    const text = docXml
      .replace(/<w:br[^>]*\/>/gi, '\n')
      .replace(/<w:p[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { text, title: docTitle };
  }

  async function handleBulkUpload(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setBulkProcessing(true);
    setBulkRecipes([]);
    setBulkAdded(new Set());

    const allRecipes = [];

    for (const file of files) {
      let text = '';
      let docTitle = '';
      const name = file.name.toLowerCase();
      // Derive title from filename (strip extension)
      const fileTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').trim();

      if (name.endsWith('.docx')) {
        const result = await extractDocxText(file);
        text = result.text;
        docTitle = result.title;
      } else if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.rtf')) {
        text = await file.text();
      } else if (name.endsWith('.doc')) {
        text = await file.text();
      } else {
        text = await file.text();
      }

      if (!text.trim()) continue;

      // Split by common recipe separators (--- or === or multiple blank lines)
      const sections = text.split(/(?:\n\s*[-=]{3,}\s*\n)|(?:\n{3,})/).filter(s => s.trim());

      if (sections.length > 1) {
        // Multiple recipes in one file
        for (const section of sections) {
          const parsed = parseRecipeText(section);
          if (parsed.title || parsed.ingredients.length > 0) {
            allRecipes.push({
              ...parsed,
              title: parsed.title || docTitle || fileTitle,
              category: 'lunch-dinner',
              frequency: 'common',
              servings: '1',
              mealType: parsed.ingredients.length > 0 ? classifyMealType(parsed.ingredients) : '',
              sourceFile: file.name,
            });
          }
        }
      } else {
        // Single recipe per file — use doc title or filename as fallback
        const parsed = parseRecipeText(text);
        const title = parsed.title || docTitle || fileTitle;
        if (title || parsed.ingredients.length > 0) {
          allRecipes.push({
            ...parsed,
            title,
            category: 'lunch-dinner',
            frequency: 'common',
            servings: '1',
            mealType: parsed.ingredients.length > 0 ? classifyMealType(parsed.ingredients) : '',
            sourceFile: file.name,
          });
        }
      }
    }

    setBulkRecipes(allRecipes);
    setBulkProcessing(false);
    e.target.value = '';
  }

  function handleBulkAdd(index) {
    const recipe = bulkRecipes[index];
    if (!recipe) return;
    const save = onAddWithoutClose || onSave;
    save({
      title: recipe.title,
      category: recipe.category,
      frequency: recipe.frequency,
      servings: recipe.servings,
      mealType: recipe.mealType,
      ingredients: recipe.ingredients,
      instructions: recipe.instructions,
      source: 'bulk',
    });
    setBulkAdded(prev => new Set(prev).add(index));
  }

  function handleBulkAddAll() {
    const save = onAddWithoutClose || onSave;
    bulkRecipes.forEach((recipe, i) => {
      if (bulkAdded.has(i)) return;
      save({
        title: recipe.title,
        category: recipe.category,
        frequency: recipe.frequency,
        servings: recipe.servings,
        mealType: recipe.mealType,
        ingredients: recipe.ingredients,
        instructions: recipe.instructions,
        source: 'bulk',
      });
    });
    setBulkAdded(new Set(bulkRecipes.map((_, i) => i)));
  }

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

  // Parse a clipboard payload from Excel/Sheets into a rectangular grid.
  // Handles double-quote escaping so cells containing embedded newlines or
  // tabs (Alt-Enter inside Excel cells) survive intact.
  function parseClipboardSheet(text) {
    const rows = [];
    let row = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === '"' && cur === '') inQ = true;
        else if (c === '\t') { row.push(cur); cur = ''; }
        else if (c === '\n' || c === '\r') {
          if (c === '\r' && text[i + 1] === '\n') i++;
          row.push(cur);
          rows.push(row);
          row = [];
          cur = '';
        } else cur += c;
      }
    }
    if (cur !== '' || row.length > 0) {
      row.push(cur);
      rows.push(row);
    }
    while (rows.length && rows[rows.length - 1].every(c => c.trim() === '')) rows.pop();
    return rows;
  }

  const BULK_SHEET_COLS = ['title', 'ingredients', 'instructions', 'servings', 'category'];

  // Look at a header row and return the column indexes if it looks like a
  // per-ingredient table (Quantity / Measurement / Ingredient, optionally
  // with Instructions). Returns null otherwise so the paste falls through
  // to the normal Excel cell-distribution behaviour.
  function detectIngredientHeaders(headerRow) {
    if (!Array.isArray(headerRow)) return null;
    const norm = headerRow.map(h => (h || '').trim().toLowerCase());
    const ingIdx = norm.findIndex(h => /^ingredient(s)?$|^item(s)?$/.test(h));
    if (ingIdx < 0) return null;
    return {
      instructions: norm.findIndex(h => /^instruction(s)?$|^step(s)?$|^direction(s)?$|^method$/.test(h)),
      quantity: norm.findIndex(h => /^quantity$|^qty$|^amount$/.test(h)),
      measurement: norm.findIndex(h => /^measurement$|^unit$|^measure$/.test(h)),
      ingredient: ingIdx,
    };
  }

  function trimNumber(s) {
    const t = (s || '').trim();
    if (!t) return '';
    // Strip trailing zeros from decimals: "9.00" → "9", "1.50" → "1.5"
    if (/^-?\d+\.\d+$/.test(t)) return t.replace(/\.?0+$/, '');
    return t;
  }

  function handleBulkSheetPaste(e, rowIdx, colKey) {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\t') && !text.includes('\n')) return; // single-cell paste — let default fire
    e.preventDefault();
    const grid = parseClipboardSheet(text);
    if (grid.length === 0) return;

    // Vertical-ingredient layout: header row + one row per ingredient
    // (with an optional Instructions column whose cells make up the steps).
    // Collapses the entire pasted block into a single recipe in the
    // current sheet row.
    const headers = detectIngredientHeaders(grid[0]);
    if (headers && grid.length > 1) {
      const ingredients = [];
      const instructions = [];
      for (let r = 1; r < grid.length; r++) {
        const cells = grid[r];
        const qty = headers.quantity >= 0 ? trimNumber(cells[headers.quantity]) : '';
        const meas = headers.measurement >= 0 ? (cells[headers.measurement] || '').trim() : '';
        const ing = headers.ingredient >= 0 ? (cells[headers.ingredient] || '').trim() : '';
        const inst = headers.instructions >= 0 ? (cells[headers.instructions] || '').trim() : '';
        if (ing) ingredients.push([qty, meas, ing].filter(Boolean).join(' '));
        if (inst) instructions.push(inst);
      }
      setBulkSheetRows(prev => {
        const next = [...prev];
        const target = rowIdx < next.length ? rowIdx : 0;
        next[target] = {
          ...next[target],
          ingredients: ingredients.join('\n'),
          instructions: instructions.join('\n\n'),
        };
        return next;
      });
      return;
    }

    // Default: Excel-style cell distribution starting at the focused cell.
    const startCol = BULK_SHEET_COLS.indexOf(colKey);
    setBulkSheetRows(prev => {
      const next = [...prev];
      for (let r = 0; r < grid.length; r++) {
        const target = rowIdx + r;
        while (next.length <= target) next.push({ title: '', ingredients: '', instructions: '', servings: '', category: '' });
        const merged = { ...next[target] };
        for (let c = 0; c < grid[r].length; c++) {
          const key = BULK_SHEET_COLS[startCol + c];
          if (!key) break;
          merged[key] = grid[r][c];
        }
        next[target] = merged;
      }
      return next;
    });
  }

  function updateBulkSheetRow(idx, field, value) {
    setBulkSheetRows(prev => {
      const next = prev.map((r, i) => i === idx ? { ...r, [field]: value } : r);
      // Auto-grow: add a fresh blank row when user starts typing in the
      // last row, so the grid always has an empty row underneath.
      if (idx === next.length - 1 && value && !prev[idx][field]) {
        next.push({ title: '', ingredients: '', instructions: '', servings: '', category: '' });
      }
      return next;
    });
  }
  function addBulkSheetRow() {
    setBulkSheetRows(prev => [...prev, { title: '', ingredients: '', instructions: '', servings: '', category: '' }]);
  }
  function removeBulkSheetRow(idx) {
    setBulkSheetRows(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  }

  function parseBulkSheetRows() {
    const recipes = [];
    for (const r of bulkSheetRows) {
      const title = r.title.trim();
      const ingRaw = r.ingredients.trim();
      if (!title && !ingRaw) continue;
      const ingredients = ingRaw
        .split(/\n|;/)
        .map(s => s.trim())
        .filter(Boolean);
      const instructions = r.instructions.trim();
      recipes.push({
        title,
        description: '',
        category: r.category.trim() || 'lunch-dinner',
        frequency: 'common',
        servings: r.servings.trim() || '1',
        mealType: ingredients.length > 0 ? classifyMealType(ingredients) : '',
        ingredients,
        instructions,
        sourceFile: 'Pasted spreadsheet',
      });
    }
    if (recipes.length === 0) return;
    setBulkRecipes(prev => [...prev, ...recipes]);
    setBulkSheetRows(Array.from({ length: 8 }, () => ({ title: '', ingredients: '', instructions: '', servings: '', category: '' })));
  }

  async function handleBulkImage(blob) {
    if (!blob) return;
    setBulkImageError('');
    setBulkImageProcessing(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
      const res = await fetch('/api/parse-recipe-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }
      const recipe = await res.json();
      const ingredients = (recipe.ingredients || []).map(s => String(s).trim()).filter(Boolean);
      if (!recipe.title && ingredients.length === 0) {
        throw new Error("Couldn't read a recipe from that image — try a clearer screenshot.");
      }
      setBulkRecipes(prev => [...prev, {
        title: recipe.title || '',
        description: '',
        category: recipe.category || 'lunch-dinner',
        frequency: 'common',
        servings: recipe.servings || '1',
        mealType: ingredients.length > 0 ? classifyMealType(ingredients) : '',
        ingredients,
        instructions: recipe.instructions || '',
        sourceFile: 'Pasted screenshot',
      }]);
    } catch (err) {
      setBulkImageError(err.message || 'Failed to read image');
    } finally {
      setBulkImageProcessing(false);
    }
  }

  // Listen for clipboard image paste while the bulk Screenshot mode is
  // active. Works regardless of which element is focused so the user can
  // hit Cmd/Ctrl-V immediately after taking a screenshot without first
  // clicking into the dropzone.
  useEffect(() => {
    if (importMode !== 'bulk' || bulkPasteMode !== 'image') return;
    function onPaste(e) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type?.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            handleBulkImage(blob);
            return;
          }
        }
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importMode, bulkPasteMode]);

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

  function titleCase(str) {
    if (!str) return '';
    // Strip emojis and special symbols, then capitalize
    const textOnly = str.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}✨⭐️🔥💯🥗🍽️⏱️▪️●•►▸🔸🔹]/gu, '').replace(/\s+/g, ' ').trim();
    return textOnly.replace(/\b\w/g, c => c.toUpperCase());
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
    if (type === 'tiktok' || type === 'instagram') {
      if (type === 'tiktok') setTiktokUrl(url);
      else setInstagramUrl(url);
      setFetching(true);
      setFetchError('');
      try {
        // Step 1: Try to get caption text
        let captionText = '';
        try {
          if (type === 'tiktok') {
            const recipe = await fetchTikTokRecipe(url);
            if (recipe?.title) {
              setParsedRecipe({ ...recipe, title: titleCase(recipe.title), mealType: recipe.mealType || classifyMealType(recipe.ingredients || []) });
              setPhase('review');
              setFetching(false);
              return;
            }
          } else {
            captionText = await fetchInstagramCaption(url) || '';
          }
        } catch {}

        // Step 2: Also transcribe the video audio
        setFetchError(captionText ? 'Got caption. Also transcribing audio for more details...' : 'Transcribing video audio...');
        let audioText = '';
        try {
          const transRes = await fetch(`/api/transcribe-video?url=${encodeURIComponent(url)}`);
          const transData = await transRes.json();
          if (transData.text) audioText = transData.text;
        } catch {}

        // Step 3: Combine caption + audio transcript
        const combined = [captionText, audioText].filter(Boolean).join('\n\n');
        if (combined.trim()) {
          const parsed = parseRecipeText(combined);
          if (parsed?.title || parsed?.ingredients?.length > 0) {
            setParsedRecipe({ ...parsed, title: titleCase(parsed.title || ''), sourceUrl: url, mealType: classifyMealType(parsed.ingredients || []) });
            setPhase('review');
            setFetchError('');
          } else {
            setRawText(combined);
            setPhase('paste');
            setFetchError('');
          }
        } else {
          setFetchError('Could not extract recipe from caption or audio. The post may be private or restricted.');
        }
      } catch (err) {
        setFetchError(err.message || `Failed to fetch recipe from ${type === 'tiktok' ? 'TikTok' : 'Instagram'}.`);
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
      setUrlRecipes([]);
      try {
        const allRecipes = await fetchAllRecipesFromUrl(url);
        if (allRecipes.length > 1) {
          // Multiple recipes found — let user choose
          setUrlRecipes(allRecipes.map(r => ({ ...r, mealType: r.mealType || classifyMealType(r.ingredients || []) })));
          setPhase('paste'); // stay on page to show selection
        } else if (allRecipes.length === 1) {
          setParsedRecipe({ ...allRecipes[0], mealType: allRecipes[0].mealType || classifyMealType(allRecipes[0].ingredients || []) });
          setPhase('review');
        } else {
          setFetchError('No recipe found on this page.');
        }
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
    onSave({ ...data, title: titleCase(data.title || ''), source: importMode });
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
    if (importMode === 'manual') {
      return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }}>
          <div style={{ background: 'var(--color-surface)', borderRadius: '16px', maxWidth: '680px', width: '100%', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', padding: '1.5rem' }}>
            {parsedRecipe.estimated && (
              <div style={{ padding: '0.75rem 1rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '8px', marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>⚠️</span>
                <div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#92400E', marginBottom: '0.2rem' }}>AI-Estimated Ingredients</div>
                  <div style={{ fontSize: '0.82rem', color: '#A16207', lineHeight: 1.4 }}>
                    The original video didn't list specific ingredients. These were estimated by AI based on the dish name. Please review and adjust.
                  </div>
                </div>
              </div>
            )}
            <RecipeForm
              recipe={parsedRecipe}
              onSave={handleSave}
              onCancel={onCancel}
              titleOverride="Add Recipe Manually"
              headerAction={
                <button
                  onClick={() => {
                    setParsedRecipe(null); setPhase('paste'); setImportMode('');
                    if (cameFromSourcePicker || isOnboarding) { setShowSourcePicker(true); setSelectedSources(new Set()); setCameFromSourcePicker(false); }
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: '0.25rem 0.5rem' }}
                >
                  ← Back
                </button>
              }
            />
          </div>
        </div>
      );
    }
    return (
      <div className={styles.container}>
        <button className={styles.backToPaste} onClick={handleBackToPaste}>
          &larr; Back to import
        </button>
        {parsedRecipe.estimated && (
          <div style={{ padding: '0.75rem 1rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '8px', marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>⚠️</span>
            <div>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#92400E', marginBottom: '0.2rem' }}>AI-Estimated Ingredients</div>
              <div style={{ fontSize: '0.82rem', color: '#A16207', lineHeight: 1.4 }}>
                The original video caption didn't list specific ingredients. These ingredients and instructions were estimated by AI based on the dish name. Please review and adjust as needed.
              </div>
            </div>
          </div>
        )}
        <RecipeForm
          recipe={parsedRecipe}
          onSave={handleSave}
          onCancel={onCancel}
        />
      </div>
    );
  }

  // Multi-import derived state (computed outside JSX to avoid IIFE render issues)
  const multiPending = multiResults.filter(r => r._status === 'success');
  const multiFailed = multiResults.filter(r => r._status === 'failed');
  const multiAdded = multiResults.filter(r => r._status === 'added');
  const multiFront = multiPending[0] || null;
  const multiTotal = multiResults.filter(r => r._status !== 'failed').length;
  const multiBehind = multiPending.length - 1;
  const showMultiModal = multiResults.length > 0 && (multiPending.length > 0 || (multiPending.length === 0 && multiAdded.length > 0));

  function handleSourceContinue() {
    localStorage.setItem('sunday-recipe-source-seen', 'true');
    // Route to the first selected option in priority order
    const sources = selectedSources;
    if (sources.has('online')) {
      setShowUrlPopup(true);
      setUrlLinks(['', '']);
      return;
    }
    setShowSourcePicker(false);
    setCameFromSourcePicker(true);
    if (sources.has('docs')) {
      setImportMode('bulk');
      setPhase('paste');
    } else if (sources.has('head')) {
      handleStartManual();
    } else if (sources.has('none')) {
      setImportMode('discover');
      setPhase('paste');
    }
  }

  if (showSourcePicker) {
    return (
      <div>
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: showUrlPopup ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }}>
          <div style={{ background: 'var(--color-surface)', borderRadius: '16px', padding: '2rem', maxWidth: '480px', width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 0.25rem', textAlign: 'center' }}>Where are your recipes now?</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 1.25rem', textAlign: 'center' }}>Select all that apply — we'll help you get them into Prep Day.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
              {RECIPE_SOURCE_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setSelectedSources(prev => {
                    const next = new Set(prev);
                    if (next.has(opt.key)) next.delete(opt.key); else next.add(opt.key);
                    return next;
                  })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem',
                    border: selectedSources.has(opt.key) ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                    borderRadius: '10px', background: selectedSources.has(opt.key) ? 'var(--color-accent-light)' : 'var(--color-surface)',
                    cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>{opt.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text)' }}>{opt.label}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{opt.desc}</div>
                  </div>
                  <div style={{ width: '20px', height: '20px', borderRadius: '4px', border: selectedSources.has(opt.key) ? '2px solid var(--color-accent)' : '2px solid var(--color-border)', background: selectedSources.has(opt.key) ? 'var(--color-accent)' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {selectedSources.has(opt.key) && <span style={{ color: '#fff', fontSize: '0.75rem', fontWeight: 700 }}>✓</span>}
                  </div>
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              {isOnboarding && onCancel && (
                <button
                  onClick={onCancel}
                  style={{ padding: '0.6rem 1.25rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)', fontSize: '0.9rem', fontWeight: 500, fontFamily: 'inherit', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
                >
                  ← Back
                </button>
              )}
              <button
                onClick={handleSourceContinue}
                disabled={selectedSources.size === 0}
                style={{ padding: '0.6rem 1.5rem', border: 'none', borderRadius: '8px', background: 'var(--color-accent)', fontSize: '0.9rem', fontWeight: 600, fontFamily: 'inherit', color: '#fff', cursor: 'pointer', opacity: selectedSources.size === 0 ? 0.4 : 1 }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>

        {/* Dedicated Online Import Popup */}
        {showUrlPopup && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: '1rem' }}>
            <div style={{ background: 'var(--color-surface)', borderRadius: '16px', padding: '2rem', maxWidth: '600px', width: '100%', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 0.25rem' }}>Import Recipes from the Web</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '0 0 1.25rem' }}>Paste links from any recipe website or social media platform and we'll extract the recipe for you.</p>

              {/* Supported platforms */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', padding: '0.6rem 0.75rem', background: 'var(--color-surface-alt)', borderRadius: '10px' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>Supported</span>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {['TikTok', 'Instagram', 'Pinterest', 'AllRecipes', 'Any recipe website'].map(name => (
                    <span key={name} style={{ fontSize: '0.8rem', color: 'var(--color-text)', background: 'var(--color-surface)', padding: '0.2rem 0.55rem', borderRadius: '6px', border: '1px solid var(--color-border-light)' }}>{name}</span>
                  ))}
                </div>
              </div>

              {/* URL input fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {urlLinks.map((link, i) => {
                  const type = link.trim() ? detectUrlType(link.trim()) : null;
                  const typeLabel = type === 'tiktok' ? 'TikTok' : type === 'instagram' ? 'Instagram' : type === 'pinterest' ? 'Pinterest' : type === 'url' && link.trim() ? 'Website' : null;
                  return (
                    <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <div style={{ position: 'relative', flex: 1 }}>
                        <input
                          type="url"
                          value={link}
                          onChange={e => {
                            const val = e.target.value;
                            setUrlLinks(prev => {
                              const next = prev.map((l, j) => j === i ? val : l);
                              // Auto-add a new row when all rows have content
                              if (val.trim() && next.every(l => l.trim())) next.push('');
                              return next;
                            });
                          }}
                          placeholder={i === 0 ? 'https://www.allrecipes.com/recipe/...' : i === 1 ? 'https://www.tiktok.com/@user/video/...' : 'Paste another recipe URL...'}
                          autoFocus={i === 0}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && link.trim()) {
                              if (i === urlLinks.length - 1) setUrlLinks(prev => [...prev, '']);
                            }
                          }}
                          style={{ width: '100%', padding: '0.65rem 0.75rem', paddingRight: typeLabel ? '5.5rem' : '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '0.9rem', fontFamily: 'inherit', color: 'var(--color-text)' }}
                        />
                        {typeLabel && (
                          <span style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-accent)', background: 'var(--color-accent-light)', padding: '0.15rem 0.45rem', borderRadius: '4px' }}>{typeLabel}</span>
                        )}
                      </div>
                      {urlLinks.length > 1 && (
                        <button onClick={() => setUrlLinks(prev => prev.filter((_, j) => j !== i))} style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', flexShrink: 0 }}>×</button>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                onClick={() => setUrlLinks(prev => [...prev, ''])}
                style={{ background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: '0.25rem 0', marginBottom: '1.25rem' }}
              >
                + Add another URL
              </button>

              {urlImportError && <div style={{ fontSize: '0.85rem', color: 'var(--color-danger)', marginBottom: '0.75rem' }}>{urlImportError}</div>}

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  onClick={() => { setShowUrlPopup(false); setUrlImportError(''); setSelectedSources(new Set()); }}
                  style={{ padding: '0.6rem 1.25rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)', fontSize: '0.9rem', fontWeight: 500, fontFamily: 'inherit', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
                >
                  ← Back
                </button>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                    {urlLinks.filter(l => l.trim()).length} URL{urlLinks.filter(l => l.trim()).length !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={async () => {
                      const validLinks = urlLinks.filter(l => l.trim());
                      if (validLinks.length === 0) return;
                      setUrlImportError('');
                      localStorage.setItem('sunday-recipe-source-seen', 'true');
                      setShowUrlPopup(false);
                      setShowSourcePicker(false);
                      // Use multi-import flow
                      setMultiUrls(validLinks);
                      setMultiImporting(true);
                      setMultiResults([]);
                      const results = [];
                      for (const url of validLinks) {
                        try {
                          const type = detectUrlType(url);
                          if (type === 'tiktok' || type === 'instagram') {
                            let captionText = '';
                            try {
                              if (type === 'tiktok') {
                                const recipe = await fetchTikTokRecipe(url);
                                if (recipe?.title) { results.push({ ...recipe, title: titleCase(recipe.title), sourceUrl: url, mealType: recipe.mealType || classifyMealType(recipe.ingredients || []), _status: 'success' }); continue; }
                              } else {
                                captionText = await fetchInstagramCaption(url) || '';
                              }
                            } catch {}
                            let audioText = '';
                            try {
                              const tr = await fetch(`/api/transcribe-video?url=${encodeURIComponent(url)}`).then(r => r.json());
                              if (tr.text) audioText = tr.text;
                            } catch {}
                            const combined = [captionText, audioText].filter(Boolean).join('\n\n');
                            if (combined.trim()) {
                              const parsed = parseRecipeText(combined);
                              if (parsed?.title || parsed?.ingredients?.length > 0) {
                                results.push({ ...parsed, title: titleCase(parsed.title || ''), sourceUrl: url, mealType: classifyMealType(parsed.ingredients || []), _status: 'success' });
                              } else {
                                results.push({ title: url, _status: 'failed', sourceUrl: url, _error: 'Could not parse a recipe from this post' });
                              }
                            } else {
                              results.push({ title: url, _status: 'failed', sourceUrl: url, _error: 'Could not extract content. Post may be private.' });
                            }
                          } else if (type === 'pinterest') {
                            const extractRes = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}&pinterest=true`);
                            if (extractRes.ok) {
                              const { sourceUrl: recipeUrl } = await extractRes.json();
                              const recipe = await fetchRecipeFromUrl(recipeUrl);
                              if (recipe?.title) results.push({ ...recipe, sourceUrl: recipeUrl, mealType: recipe.mealType || classifyMealType(recipe.ingredients || []), _status: 'success' });
                              else results.push({ title: url, _status: 'failed', sourceUrl: url, _error: 'Could not find recipe on linked page' });
                            } else results.push({ title: url, _status: 'failed', sourceUrl: url, _error: 'Could not extract source URL from Pinterest' });
                          } else {
                            const data = await fetchAllRecipesFromUrl(url);
                            if (data && data.length > 0) {
                              for (const r of data) results.push({ ...r, title: titleCase(r.title || ''), sourceUrl: url, mealType: r.mealType || classifyMealType(r.ingredients || []), _status: 'success' });
                            } else {
                              results.push({ title: url, _status: 'failed', sourceUrl: url, _error: 'Could not find recipe data on this page' });
                            }
                          }
                        } catch (err) {
                          results.push({ title: url, _status: 'failed', sourceUrl: url, _error: err.message });
                        }
                      }
                      setMultiResults(results);
                      setMultiImporting(false);
                    }}
                    disabled={!urlLinks.some(l => l.trim()) || urlImporting}
                    style={{ padding: '0.6rem 1.5rem', border: 'none', borderRadius: '8px', background: 'var(--color-accent)', fontSize: '0.9rem', fontWeight: 600, fontFamily: 'inherit', color: '#fff', cursor: 'pointer', opacity: urlLinks.some(l => l.trim()) ? 1 : 0.4 }}
                  >
                    {urlImporting ? 'Importing...' : `Import ${urlLinks.filter(l => l.trim()).length || ''} Recipe${urlLinks.filter(l => l.trim()).length !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
    <div className={styles.container} style={showMultiModal || multiImporting ? { visibility: 'hidden' } : undefined}>
      <div className={styles.header}>
        {!importMode && onCancel && (
          <button className={styles.backBtn} onClick={onCancel} title="Back">
            &#8592; Back
          </button>
        )}
        <h2 className={styles.title}>Import Recipes</h2>
        {onCancel && (
          <button className={styles.skipBtn} onClick={onCancel} style={{ marginLeft: 'auto' }}>
            {importMode ? 'Continue to Homepage' : 'Skip for Now'}
          </button>
        )}
      </div>
      {!importMode && <p className={styles.importDesc}>Add recipes to your profile from websites, social media, AI, or type them in manually.</p>}

      {!importMode && (
        <div className={styles.menuList}>
          {/* Add Prep Day Recipes */}
          <button
            className={styles.menuItemBtn}
            onClick={() => { setImportMode('discover'); setPhase('paste'); }}
          >
            <div className={styles.menuItemTop}>
              <span className={styles.menuItemLabel}>Add Prep Day Recipes</span>
              <span className={styles.menuItemDesc}>Browse our curated meal collection</span>
            </div>
            <span className={styles.menuItemArrow}>&rsaquo;</span>
          </button>

          {/* Import from Link */}
          <div className={styles.menuItem}>
            <div className={styles.menuItemTop}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span className={styles.menuItemLabel}>Import from a Website</span>
                <div className={styles.platformIcons} style={{ margin: 0, gap: '0.3rem' }}>
              <a href="https://www.tiktok.com/search?q=healthy%20recipes" target="_blank" rel="noopener noreferrer" className={styles.platformLink} title="Browse TikTok Recipes">
                <svg className={styles.platformIcon} viewBox="0 0 48 48"><path fill="#25F4EE" d="M33.3 8.4h-4.1v21.9a5.4 5.4 0 0 1-5.4 5.1 5.4 5.4 0 0 1-2.5-.6 5.4 5.4 0 0 0 7.9-4.8V8.4h4.1z"/><path fill="#25F4EE" d="M34.8 15.2v4.2a13.5 13.5 0 0 1-7.9-2.5v11.4a10 10 0 0 1-10 10 9.9 9.9 0 0 1-5.8-1.9 10 10 0 0 0 17.3-6.8V18.2a13.5 13.5 0 0 0 7.9 2.5v-4.2a9.4 9.4 0 0 1-1.5-1.3z"/><path fill="#FE2C55" d="M26.9 16.9v11.4a10 10 0 0 1-10 10 9.9 9.9 0 0 1-5.8-1.9A10 10 0 0 0 19 40a10 10 0 0 0 10-10V18.6a13.5 13.5 0 0 0 7.9 2.5v-4.2a9.4 9.4 0 0 1-5.9-5.5h-4.1v21.9a5.4 5.4 0 0 1-7.9 4.8 5.4 5.4 0 0 0 8-4.8V16.9z"/></svg>
              </a>
              <a href="https://www.instagram.com/explore/tags/healthyrecipes/" target="_blank" rel="noopener noreferrer" className={styles.platformLink} title="Browse Instagram Recipes">
                <svg className={styles.platformIcon} viewBox="0 0 24 24"><defs><linearGradient id="igGrad" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#FFDC80"/><stop offset="25%" stopColor="#F77737"/><stop offset="50%" stopColor="#E1306C"/><stop offset="75%" stopColor="#C13584"/><stop offset="100%" stopColor="#833AB4"/></linearGradient></defs><path fill="url(#igGrad)" d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4H7.6m9.65 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10m0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>
              </a>
              <a href="https://www.pinterest.com/search/pins/?q=healthy%20meal%20prep%20recipes" target="_blank" rel="noopener noreferrer" className={styles.platformLink} title="Browse Pinterest Recipes">
                <svg className={styles.platformIcon} viewBox="0 0 24 24"><path fill="#E60023" d="M12 2C6.48 2 2 6.48 2 12c0 4.24 2.65 7.86 6.39 9.29-.09-.78-.17-1.98.04-2.83.19-.78 1.22-5.17 1.22-5.17s-.31-.62-.31-1.54c0-1.45.84-2.53 1.88-2.53.89 0 1.32.67 1.32 1.47 0 .89-.57 2.23-.86 3.47-.25 1.04.52 1.88 1.54 1.88 1.84 0 3.26-1.94 3.26-4.75 0-2.48-1.79-4.22-4.33-4.22-2.95 0-4.68 2.21-4.68 4.5 0 .89.34 1.85.77 2.37.08.1.1.19.07.3-.08.31-.25 1.04-.29 1.18-.05.19-.15.23-.35.14-1.31-.61-2.13-2.53-2.13-4.07 0-3.31 2.41-6.36 6.95-6.36 3.64 0 6.48 2.6 6.48 6.07 0 3.62-2.28 6.53-5.45 6.53-1.06 0-2.07-.55-2.41-1.21l-.66 2.5c-.24.91-.88 2.05-1.32 2.75.99.31 2.04.47 3.13.47 5.52 0 10-4.48 10-10S17.52 2 12 2z"/></svg>
              </a>
              <a href="https://www.allrecipes.com/" target="_blank" rel="noopener noreferrer" className={styles.platformLink} title="Browse AllRecipes">
                <svg className={styles.platformIcon} viewBox="0 0 24 24" style={{color: '#555'}}><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
              </a>
                </div>
              </div>
              <span className={styles.menuItemDesc}>Paste a URL or browse recipe sites</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {multiUrls.map((url, i) => (
                <div key={i} className={styles.menuItemInput} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <input
                    className={styles.menuInlineInput}
                    type="url"
                    value={url}
                    onChange={e => setMultiUrls(prev => prev.map((u, j) => j === i ? e.target.value : u))}
                    placeholder={i === 0 ? 'Paste a URL from any supported site...' : 'Paste another URL...'}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && url.trim()) {
                        // If this is the last filled row, add a new empty row
                        if (i === multiUrls.length - 1) setMultiUrls(prev => [...prev, '']);
                        // If only one URL, import it directly
                        const filled = multiUrls.filter(u => u.trim());
                        if (filled.length <= 1) { setLinkUrl(url.trim()); setTimeout(() => handleSmartImport(), 0); }
                      }
                    }}
                    onBlur={() => {
                      // Auto-add a new row when the last row has content
                      if (url.trim() && i === multiUrls.length - 1) setMultiUrls(prev => [...prev, '']);
                    }}
                    disabled={fetching || multiImporting}
                  />
                  {multiUrls.length > 2 && !url.trim() && i > 1 && (
                    <button onClick={() => setMultiUrls(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '50%', width: '24px', height: '24px', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem' }}>
                <button
                  className={styles.menuGoBtn}
                  disabled={!multiUrls.some(u => u.trim()) || fetching || multiImporting}
                  onClick={async () => {
                    const filled = multiUrls.filter(u => u.trim());
                    if (filled.length === 0) return;
                    if (filled.length === 1) {
                      setLinkUrl(filled[0]);
                      handleSmartImport();
                      return;
                    }
                    // Multi-import with smart URL detection
                    setMultiImporting(true);
                    setMultiResults([]);
                    const results = [];
                    for (const url of filled) {
                      try {
                        const type = detectUrlType(url);
                        if (type === 'tiktok' || type === 'instagram') {
                          // Get caption text
                          let captionText = '';
                          try {
                            if (type === 'tiktok') {
                              const recipe = await fetchTikTokRecipe(url);
                              if (recipe?.title) { results.push({ ...recipe, title: titleCase(recipe.title), sourceUrl: url, mealType: recipe.mealType || classifyMealType(recipe.ingredients || []), _status: 'success' }); continue; }
                            } else {
                              captionText = await fetchInstagramCaption(url) || '';
                            }
                          } catch {}
                          // Also transcribe audio
                          let audioText = '';
                          try {
                            const tr = await fetch(`/api/transcribe-video?url=${encodeURIComponent(url)}`).then(r => r.json());
                            if (tr.text) audioText = tr.text;
                          } catch {}
                          // Combine and parse
                          const combined = [captionText, audioText].filter(Boolean).join('\n\n');
                          if (combined.trim()) {
                            const parsed = parseRecipeText(combined);
                            if (parsed?.title || parsed?.ingredients?.length > 0) {
                              results.push({ ...parsed, title: titleCase(parsed.title || ''), sourceUrl: url, mealType: classifyMealType(parsed.ingredients || []), _status: 'success' });
                            } else {
                              results.push({ title: url, _status: 'failed', sourceUrl: url, _error: `${type === 'tiktok' ? 'TikTok' : 'Instagram'}: Got text but could not parse a recipe` });
                            }
                          } else {
                            results.push({ title: url, _status: 'failed', sourceUrl: url, _error: `${type === 'tiktok' ? 'TikTok' : 'Instagram'}: Could not extract caption or audio. Post may be private.` });
                          }
                        } else if (type === 'pinterest') {
                          const extractRes = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}&pinterest=true`);
                          if (extractRes.ok) {
                            const { sourceUrl: recipeUrl } = await extractRes.json();
                            const recipe = await fetchRecipeFromUrl(recipeUrl);
                            if (recipe?.title) results.push({ ...recipe, sourceUrl: recipeUrl, mealType: recipe.mealType || classifyMealType(recipe.ingredients || []), _status: 'success' });
                            else results.push({ title: url, _status: 'failed', sourceUrl: url, _error: 'Pinterest: Could not find recipe on linked page' });
                          } else results.push({ title: url, _status: 'failed', sourceUrl: url, _error: 'Pinterest: Could not extract source URL' });
                        } else {
                          const data = await fetchAllRecipesFromUrl(url);
                          if (data && data.length > 0) {
                            for (const r of data) results.push({ ...r, title: titleCase(r.title || ''), sourceUrl: url, mealType: r.mealType || classifyMealType(r.ingredients || []), _status: 'success' });
                          } else {
                            results.push({ title: url, _status: 'failed', sourceUrl: url, _error: 'Could not find recipe data on this page' });
                          }
                        }
                      } catch (err) {
                        results.push({ title: url, _status: 'failed', sourceUrl: url, _error: err.message });
                      }
                    }
                    setMultiResults(results);
                    setMultiImporting(false);
                  }}
                  style={{ flex: 'none', minWidth: '120px' }}
                >
                  {multiImporting ? 'Importing...' : fetching ? '...' : `Import ${multiUrls.filter(u => u.trim()).length || ''} Recipe${multiUrls.filter(u => u.trim()).length !== 1 ? 's' : ''}`}
                </button>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                  {multiUrls.filter(u => u.trim()).length} URL{multiUrls.filter(u => u.trim()).length !== 1 ? 's' : ''} added
                </span>
              </div>
            </div>

            {fetchError && !importMode && <div className={styles.fetchError}>{fetchError}</div>}
          </div>

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

          {/* Bulk Upload & Paste */}
          <button
            className={styles.menuItemBtn}
            onClick={() => { setImportMode('bulk'); setPhase('paste'); setBulkRecipes([]); setBulkAdded(new Set()); }}
          >
            <div className={styles.menuItemTop}>
              <span className={styles.menuItemLabel}>Paste or Upload Recipes</span>
              <span className={styles.menuItemDesc}>Paste recipe text or upload Word docs and text files</span>
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

          {/* Shared with Me */}
          <button
            className={styles.menuItemBtn}
            onClick={() => { setImportMode('shared'); setPhase('paste'); }}
          >
            <div className={styles.menuItemTop}>
              <span className={styles.menuItemLabel}>
                Shared with Me
                {pendingShares.length > 0 && <span className={styles.sharedBadge}>{pendingShares.length}</span>}
              </span>
              <span className={styles.menuItemDesc}>Recipes friends have sent you</span>
            </div>
            <span className={styles.menuItemArrow}>&rsaquo;</span>
          </button>
        </div>
      )}

      {importMode && <>
      <div className={styles.navBtnRow}>
        <button className={styles.backBtn} onClick={() => {
          setImportMode(''); setFetchError(''); setRawText(''); setRawText2('');
          if (cameFromSourcePicker || isOnboarding) { setShowSourcePicker(true); setSelectedSources(new Set()); setCameFromSourcePicker(false); }
        }}>
          &larr; Back
        </button>
      </div>
      {importMode === 'discover' && <p className={styles.subpageDesc}>Browse and add meals from our curated recipe collection.</p>}
      {importMode === 'url' && <p className={styles.subpageDesc}>Paste a URL from a recipe website, blog, or social media post to automatically import the recipe.</p>}
      {importMode === 'restaurant' && <p className={styles.subpageDesc}>Search for restaurant menu items to get nutrition data and add them to your recipes.</p>}
      {importMode === 'paste' && <p className={styles.subpageDesc}>Copy and paste recipe text from any source — we'll parse the title, ingredients, and instructions automatically.</p>}
      {importMode === 'manual' && <p className={styles.subpageDesc}>Enter a recipe from scratch by typing in the title, ingredients, and instructions.</p>}
      {importMode === 'bulk' && <p className={styles.subpageDesc}>Paste recipe text below or upload Word docs and text files to import recipes.</p>}
      {importMode === 'ai' && <p className={styles.subpageDesc}>Describe a meal and let AI generate the full recipe with ingredients and instructions.</p>}
      {importMode === 'shared' && <p className={styles.subpageDesc}>View and accept recipes that friends have shared with you.</p>}
      <div className={styles.card}>
        {importMode === 'discover' && (
          <DiscoverMealsPanel onSave={onAddWithoutClose || onSave} userRecipes={userRecipes} />
        )}

        {importMode === 'bulk' && (
          <div>
            <h3 className={styles.cardTitle}>Import Your Written Recipes</h3>

            {/* Drag & drop — compact bar at top */}
            <input
              ref={bulkFileRef}
              type="file"
              accept=".docx,.doc,.txt,.md,.rtf"
              multiple
              style={{ display: 'none' }}
              onChange={handleBulkUpload}
            />
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.5rem 1rem', border: '1.5px dashed var(--color-border)', borderRadius: '8px', cursor: 'pointer', marginBottom: '0.75rem', background: 'var(--color-surface-alt)', transition: 'border-color 0.15s' }}
              onClick={() => !bulkProcessing && bulkFileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = ''; }}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.style.borderColor = '';
                if (bulkProcessing) return;
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                  handleBulkUpload({ target: { files }, preventDefault: () => {} });
                }
              }}
            >
              {bulkProcessing ? (
                <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>Processing...</span>
              ) : (
                <>
                  <span style={{ fontSize: '1rem' }}>📄</span>
                  <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Drag & drop files here or click to browse</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>.docx, .txt, .md</span>
                </>
              )}
            </div>

            <div className={styles.pasteFormatToggle} style={{ marginBottom: '0.75rem' }}>
              <button
                className={`${styles.pasteFormatBtn} ${bulkPasteMode === 'text' ? styles.pasteFormatBtnActive : ''}`}
                onClick={() => setBulkPasteMode('text')}
              >Free Text</button>
              <button
                className={`${styles.pasteFormatBtn} ${bulkPasteMode === 'sheet' ? styles.pasteFormatBtnActive : ''}`}
                onClick={() => setBulkPasteMode('sheet')}
              >Spreadsheet</button>
              <button
                className={`${styles.pasteFormatBtn} ${bulkPasteMode === 'image' ? styles.pasteFormatBtnActive : ''}`}
                onClick={() => setBulkPasteMode('image')}
              >Screenshot</button>
            </div>

            {bulkPasteMode === 'image' && (
              <>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: '0 0 0.5rem', lineHeight: 1.5 }}>
                  Take a screenshot of any recipe (cookbook page, website, sticky note, even a sheet), click into the box below, and paste with <strong>Cmd/Ctrl-V</strong>. You can also drag & drop or browse for a file. We'll read the image with AI and add the recipe to the list below.
                </p>
                <input
                  ref={bulkImageFileRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleBulkImage(file);
                    e.target.value = '';
                  }}
                />
                {bulkImageProcessing ? (
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      gap: '0.5rem', padding: '2rem 1rem',
                      border: '2px dashed var(--color-border)', borderRadius: '8px',
                      cursor: 'wait',
                      marginBottom: '0.75rem',
                      background: 'var(--color-surface-alt)',
                      flexDirection: 'column', textAlign: 'center',
                    }}
                  >
                    <span style={{ fontSize: '1.2rem' }}>🧠</span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Reading recipe from image…</span>
                  </div>
                ) : (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <textarea
                      aria-label="Paste a screenshot here"
                      placeholder="📸 Click here and paste your screenshot with Cmd/Ctrl-V (or drag & drop an image)"
                      value=""
                      onChange={() => {}}
                      onPaste={e => {
                        const items = e.clipboardData?.items;
                        if (!items) return;
                        for (const item of items) {
                          if (item.type?.startsWith('image/')) {
                            const blob = item.getAsFile();
                            if (blob) {
                              e.preventDefault();
                              handleBulkImage(blob);
                              return;
                            }
                          }
                        }
                        e.preventDefault();
                      }}
                      onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
                      onDragLeave={e => { e.currentTarget.style.borderColor = ''; }}
                      onDrop={e => {
                        e.preventDefault();
                        e.currentTarget.style.borderColor = '';
                        const file = e.dataTransfer.files?.[0];
                        if (file?.type?.startsWith('image/')) handleBulkImage(file);
                      }}
                      style={{
                        width: '100%',
                        minHeight: '110px',
                        padding: '1rem',
                        border: '2px dashed var(--color-border)',
                        borderRadius: '8px',
                        background: 'var(--color-surface-alt)',
                        fontSize: '0.95rem',
                        fontFamily: 'inherit',
                        color: 'var(--color-text-primary)',
                        resize: 'vertical',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                      onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
                      onBlur={e => { e.currentTarget.style.borderColor = ''; }}
                    />
                    <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                      or <button type="button" onClick={() => bulkImageFileRef.current?.click()} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-accent)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>browse for a file</button> · PNG, JPG, GIF, WebP
                    </div>
                  </div>
                )}
                {bulkImageError && (
                  <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '0.5rem 0.75rem', borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.82rem' }}>
                    {bulkImageError}
                  </div>
                )}
              </>
            )}

            {bulkPasteMode === 'text' && (
              <>
                {/* Two side-by-side paste areas */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Recipe 1</span>
                    <textarea
                      className={styles.textarea}
                      rows={14}
                      value={rawText}
                      onChange={e => setRawText(e.target.value)}
                      placeholder={"Paste recipe text here...\n\nRecipe Title\n\nIngredients:\n2 cups flour\n1 tsp salt\n\nInstructions:\nMix together.\nBake at 350°F."}
                      style={{ resize: 'vertical', minHeight: '200px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Recipe 2</span>
                    <textarea
                      className={styles.textarea}
                      rows={14}
                      value={rawText2}
                      onChange={e => setRawText2(e.target.value)}
                      placeholder={"Paste another recipe here...\n\nRecipe Title\n\nIngredients:\n1 lb chicken\n2 tbsp olive oil\n\nInstructions:\nSeason and cook."}
                      style={{ resize: 'vertical', minHeight: '200px' }}
                    />
                  </div>
                </div>

                {(rawText.trim() || rawText2.trim()) && (
                  <button className={styles.menuGoBtn} style={{ marginBottom: '1rem' }} onClick={() => {
                    [rawText, rawText2].forEach((text) => {
                      if (!text.trim()) return;
                      const parsed = parseRecipeText(text);
                      if (parsed.title || parsed.ingredients.length > 0) {
                        setBulkRecipes(prev => [...prev, {
                          ...parsed,
                          category: 'lunch-dinner',
                          frequency: 'common',
                          servings: '1',
                          mealType: parsed.ingredients.length > 0 ? classifyMealType(parsed.ingredients) : '',
                          sourceFile: 'Pasted text',
                        }]);
                      }
                    });
                    setRawText('');
                    setRawText2('');
                  }}>Parse Recipe{rawText.trim() && rawText2.trim() ? 's' : ''}</button>
                )}
              </>
            )}

            {bulkPasteMode === 'sheet' && (
              <>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: '0 0 0.5rem', lineHeight: 1.5 }}>
                  Copy a block of cells from Excel or Google Sheets and paste anywhere in the table.
                  <strong> One row per recipe</strong> works as Excel-to-Excel paste.
                  Or paste a <strong>per-ingredient table</strong> with header columns like
                  <code style={{ margin: '0 0.2rem', fontSize: '0.78rem' }}>Quantity, Measurement, Ingredient</code>
                  (optionally with an <code style={{ fontSize: '0.78rem' }}>Instructions</code> column) and the entire block will be collapsed into a single recipe row.
                </p>
                <div className={styles.bulkSheetWrap}>
                  <table className={`${styles.ingredientTable} ${styles.bulkSheetTable}`}>
                    <colgroup>
                      <col style={{ width: '2.25rem' }} />
                      <col style={{ width: '20%' }} />
                      <col style={{ width: '28%' }} />
                      <col style={{ width: '28%' }} />
                      <col style={{ width: '8%' }} />
                      <col style={{ width: '14%' }} />
                      <col style={{ width: '2rem' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className={styles.bulkSheetCorner}></th>
                        <th>Title</th>
                        <th>Ingredients</th>
                        <th>Instructions</th>
                        <th>Servings</th>
                        <th>Category</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkSheetRows.map((row, i) => (
                        <tr key={i}>
                          <td className={styles.bulkSheetRowNum}>{i + 1}</td>
                          <td>
                            <input
                              className={`${styles.tableInput} ${styles.bulkSheetCell}`}
                              type="text"
                              value={row.title}
                              onChange={e => updateBulkSheetRow(i, 'title', e.target.value)}
                              onPaste={e => handleBulkSheetPaste(e, i, 'title')}
                              placeholder=""
                            />
                          </td>
                          <td>
                            <textarea
                              className={`${styles.tableInput} ${styles.bulkSheetCell}`}
                              rows={3}
                              value={row.ingredients}
                              onChange={e => updateBulkSheetRow(i, 'ingredients', e.target.value)}
                              onPaste={e => handleBulkSheetPaste(e, i, 'ingredients')}
                              placeholder=""
                              style={{ resize: 'vertical', minHeight: '60px', fontFamily: 'inherit' }}
                            />
                          </td>
                          <td>
                            <textarea
                              className={`${styles.tableInput} ${styles.bulkSheetCell}`}
                              rows={3}
                              value={row.instructions}
                              onChange={e => updateBulkSheetRow(i, 'instructions', e.target.value)}
                              onPaste={e => handleBulkSheetPaste(e, i, 'instructions')}
                              placeholder=""
                              style={{ resize: 'vertical', minHeight: '60px', fontFamily: 'inherit' }}
                            />
                          </td>
                          <td>
                            <input
                              className={`${styles.tableInput} ${styles.bulkSheetCell}`}
                              type="text"
                              value={row.servings}
                              onChange={e => updateBulkSheetRow(i, 'servings', e.target.value)}
                              onPaste={e => handleBulkSheetPaste(e, i, 'servings')}
                              placeholder=""
                            />
                          </td>
                          <td>
                            <input
                              className={`${styles.tableInput} ${styles.bulkSheetCell}`}
                              type="text"
                              value={row.category}
                              onChange={e => updateBulkSheetRow(i, 'category', e.target.value)}
                              onPaste={e => handleBulkSheetPaste(e, i, 'category')}
                              placeholder=""
                            />
                          </td>
                          <td>
                            {bulkSheetRows.length > 1 && (
                              <button
                                className={styles.tableRemoveBtn}
                                onClick={() => removeBulkSheetRow(i)}
                                type="button"
                                title="Remove row"
                              >×</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button className={styles.tableAddRowBtn} onClick={addBulkSheetRow} type="button">+ Add row</button>
                {bulkSheetRows.some(r => r.title.trim() || r.ingredients.trim()) && (
                  <button className={styles.menuGoBtn} style={{ marginBottom: '1rem', marginLeft: '0.75rem' }} onClick={parseBulkSheetRows}>
                    Parse {bulkSheetRows.filter(r => r.title.trim() || r.ingredients.trim()).length} Recipe{bulkSheetRows.filter(r => r.title.trim() || r.ingredients.trim()).length === 1 ? '' : 's'}
                  </button>
                )}
              </>
            )}

            {bulkRecipes.length > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontWeight: 600 }}>{bulkRecipes.length} recipe{bulkRecipes.length !== 1 ? 's' : ''} found</span>
                  {bulkAdded.size < bulkRecipes.length && (
                    <button className={styles.menuGoBtn} onClick={handleBulkAddAll}>
                      Add All ({bulkRecipes.length - bulkAdded.size})
                    </button>
                  )}
                </div>
                {bulkRecipes.map((recipe, i) => (
                  <div key={i}>
                    <div className={styles.sharedItem}>
                      <div className={styles.sharedInfo}>
                        <button
                          className={styles.bulkPreviewName}
                          onClick={() => setBulkPreview(bulkPreview === i ? null : i)}
                        >
                          {recipe.title || 'Untitled Recipe'}
                        </button>
                        <span className={styles.sharedMeta}>
                          {recipe.ingredients.length} ingredient{recipe.ingredients.length !== 1 ? 's' : ''}
                          {recipe.sourceFile && ` · ${recipe.sourceFile}`}
                        </span>
                      </div>
                      {bulkAdded.has(i) ? (
                        <span className={styles.sharedAddedLabel}>Added</span>
                      ) : (
                        <button className={styles.sharedAcceptBtn} onClick={() => handleBulkAdd(i)}>+ Add</button>
                      )}
                    </div>
                    {bulkPreview === i && (
                      <div className={styles.bulkPreviewCard}>
                        <h4 className={styles.bulkPreviewTitle}>{recipe.title || 'Untitled'}</h4>
                        {recipe.ingredients.length > 0 && (
                          <>
                            <h5 className={styles.bulkPreviewSection}>Ingredients</h5>
                            <ul className={styles.bulkPreviewList}>
                              {recipe.ingredients.map((ing, j) => (
                                <li key={j}>
                                  {ing.quantity && `${ing.quantity} `}{ing.measurement && `${ing.measurement} `}{ing.ingredient}
                                  {ing.notes && <span className={styles.bulkPreviewNote}> — {ing.notes}</span>}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        {recipe.instructions && (
                          <>
                            <h5 className={styles.bulkPreviewSection}>Instructions</h5>
                            <ol className={styles.bulkPreviewSteps}>
                              {recipe.instructions.split('\n').filter(s => s.trim()).map((step, j) => (
                                <li key={j}>{step}</li>
                              ))}
                            </ol>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {bulkRecipes.length > 0 && bulkAdded.size === bulkRecipes.length && (
              <div style={{ textAlign: 'center', padding: '1.5rem 0 0.5rem', borderTop: '1px solid var(--color-border-light)', marginTop: '1rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>🎉</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#166534' }}>All done!</div>
                <div style={{ fontSize: '0.88rem', color: '#4B7A5B', marginBottom: '1rem' }}>{bulkAdded.size} recipe{bulkAdded.size !== 1 ? 's' : ''} saved to your collection</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
                  {(() => {
                    const remaining = [];
                    if (selectedSources.has('online')) remaining.push({ key: 'online', icon: '🌐', label: 'Online', desc: 'Websites, social media, blogs', action: () => { setShowSourcePicker(true); setShowUrlPopup(true); setUrlLinks(['', '']); setBulkRecipes([]); setBulkAdded(new Set()); setImportMode(''); } });
                    if (selectedSources.has('head')) remaining.push({ key: 'head', icon: '🧠', label: 'In my head', desc: 'I know my recipes by heart', action: () => { setBulkRecipes([]); setBulkAdded(new Set()); setShowSourcePicker(false); setCameFromSourcePicker(true); handleStartManual(); } });
                    if (selectedSources.has('none')) remaining.push({ key: 'none', icon: '🆕', label: "Don't have any yet", desc: "We'll help you discover or create recipes", action: () => { setBulkRecipes([]); setBulkAdded(new Set()); setShowSourcePicker(false); setCameFromSourcePicker(true); setImportMode('discover'); setPhase('paste'); } });
                    if (remaining.length === 0) return null;
                    return (
                      <>
                        <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', fontWeight: 500, marginBottom: '0.25rem' }}>Continue importing from:</div>
                        {remaining.map(r => (
                          <button key={r.key} onClick={r.action} style={{
                            display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 1rem',
                            border: '1px solid var(--color-border)', borderRadius: '10px', background: 'var(--color-surface)',
                            cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%', maxWidth: '340px', transition: 'all 0.15s',
                          }}>
                            <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>{r.icon}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text)' }}>{r.label}</div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{r.desc}</div>
                            </div>
                            <span style={{ color: 'var(--color-accent)', fontWeight: 600, fontSize: '1.1rem' }}>→</span>
                          </button>
                        ))}
                      </>
                    );
                  })()}
                  <button onClick={() => { window.location.hash = '#list'; }} style={{ padding: '0.6rem 2rem', border: 'none', borderRadius: '8px', background: 'var(--color-accent)', color: '#fff', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginTop: '0.5rem' }}>Go to My Recipes</button>
                </div>
              </div>
            )}

            {bulkRecipes.length === 0 && !bulkProcessing && (
              <p className={styles.emptyState}>Select files to upload recipes.</p>
            )}
          </div>
        )}

        {importMode === 'shared' && (
          <div>
            {/* Friends section */}
            <h3 className={styles.cardTitle}>Your Friends</h3>
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
              <input
                className={styles.menuInlineInput}
                type="text"
                placeholder="Search by name, username, or email..."
                value={friendSearch}
                onChange={e => setFriendSearch(e.target.value)}
                onKeyDown={async e => {
                  if (e.key !== 'Enter' || !friendSearch.trim()) return;
                  setFriendSearchResult(null);
                  setFriendStatus('Searching...');
                  const val = friendSearch.trim().toLowerCase();
                  let result = await searchByUsername(val);
                  if (!result && val.includes('@')) result = await searchByEmail(val);
                  if (!result) result = await searchByName(val);
                  if (!result) { setFriendStatus('User not found'); setFriendSearchResult('none'); }
                  else if (result.uid === user?.uid) { setFriendStatus("That's you!"); setFriendSearchResult('none'); }
                  else { setFriendSearchResult(result); setFriendStatus(''); }
                }}
                style={{ flex: 1 }}
              />
              <button className={styles.menuGoBtn} onClick={async () => {
                if (!friendSearch.trim()) return;
                setFriendSearchResult(null);
                setFriendStatus('Searching...');
                const val = friendSearch.trim().toLowerCase();
                let result = await searchByUsername(val);
                if (!result && val.includes('@')) result = await searchByEmail(val);
                if (!result) result = await searchByName(val);
                if (!result) { setFriendStatus('User not found'); setFriendSearchResult('none'); }
                else if (result.uid === user?.uid) { setFriendStatus("That's you!"); setFriendSearchResult('none'); }
                else { setFriendSearchResult(result); setFriendStatus(''); }
              }}>Search</button>
            </div>
            {friendStatus && <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: '0 0 0.5rem' }}>{friendStatus}</p>}
            {friendSearchResult && friendSearchResult !== 'none' && (
              <div className={styles.sharedItem} style={{ marginBottom: '0.75rem', background: 'var(--color-accent-light)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)' }}>
                <div className={styles.sharedInfo}>
                  <span className={styles.sharedName}>{friendSearchResult.displayName || friendSearchResult.username || friendSearchResult.email}</span>
                  {friendSearchResult.username && <span className={styles.sharedMeta}>@{friendSearchResult.username}</span>}
                </div>
                {sharedFriends.some(f => f.uid === friendSearchResult.uid) ? (
                  <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>Already friends</span>
                ) : (
                  <button className={styles.sharedAcceptBtn} onClick={async () => {
                    try {
                      const myUsername = await getUsername(user.uid);
                      await sendFriendRequest(user.uid, friendSearchResult.uid, myUsername || user.displayName, '');
                      setFriendStatus('Friend request sent! When they accept and share their recipes, you can import them here.');
                      setFriendSearchResult(null);
                      setFriendSearch('');
                      setTimeout(() => setFriendStatus(''), 8000);
                    } catch (err) { setFriendStatus(err.message || 'Failed'); }
                  }}>+ Add Friend</button>
                )}
              </div>
            )}

            {sharedFriends.length > 0 && (
              <>
                <p className={styles.sharedSectionLabel}>Friends ({sharedFriends.length})</p>
                {sharedFriends.map(f => (
                  <div key={f.uid} className={styles.sharedItem}>
                    <div className={styles.sharedInfo}>
                      <span className={styles.sharedName}>{f.displayName || f.username || 'Friend'}</span>
                      {f.username && <span className={styles.sharedMeta}>@{f.username}</span>}
                    </div>
                    <button className={styles.sharedDeclineBtn} title="Remove friend" onClick={async () => {
                      if (!confirm(`Remove ${f.displayName || f.username || 'this friend'}?`)) return;
                      await removeFriend(user.uid, f.uid);
                      setSharedFriends(prev => prev.filter(x => x.uid !== f.uid));
                    }}>&times;</button>
                  </div>
                ))}
              </>
            )}

            {/* Shared recipes section */}
            <h3 className={styles.cardTitle} style={{ marginTop: '1.5rem' }}>Shared Recipes</h3>
            <input
              className={styles.menuInlineInput}
              type="text"
              placeholder="Search shared recipes..."
              value={sharedSearch}
              onChange={e => setSharedSearch(e.target.value)}
              style={{ marginBottom: '0.75rem', width: '100%' }}
            />
            {(() => {
              const acceptedShared = (userRecipes || []).filter(r => r.source === 'shared');
              const sq = sharedSearch.trim().toLowerCase();
              const filteredPending = sq
                ? pendingShares.filter(s => (s.recipe?.title || '').toLowerCase().includes(sq))
                : pendingShares;
              const filteredAccepted = sq
                ? acceptedShared.filter(r => r.title.toLowerCase().includes(sq))
                : acceptedShared;
              const hasAnything = filteredPending.length > 0 || filteredAccepted.length > 0;

              if (!hasAnything) return <p className={styles.emptyState}>No shared recipes yet. Add friends and ask them to share recipes!</p>;

              return <>
                {filteredPending.length > 0 && (
                  <>
                    <p className={styles.sharedSectionLabel}>New</p>
                    {filteredPending.map(share => (
                      <div key={share.id} className={styles.sharedItem}>
                        <div className={styles.sharedInfo}>
                          <span className={styles.sharedName}>{share.recipe?.title || 'Untitled'}</span>
                          <span className={styles.sharedMeta}>from @{share.fromUsername}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <button
                            className={styles.sharedAcceptBtn}
                            onClick={async () => {
                              if (share.recipe) {
                                const { id, ...rest } = share.recipe;
                                (onAddWithoutClose || onSave)({ ...rest, source: 'shared', sharedFrom: share.fromUsername || '' });
                              }
                              await acceptSharedRecipe(share.id);
                              setPendingShares(prev => prev.filter(s => s.id !== share.id));
                            }}
                          >+ Accept</button>
                          <button
                            className={styles.sharedDeclineBtn}
                            onClick={async () => {
                              await declineSharedRecipe(share.id);
                              setPendingShares(prev => prev.filter(s => s.id !== share.id));
                            }}
                          >&times;</button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {filteredAccepted.length > 0 && (
                  <>
                    {filteredPending.length > 0 && <p className={styles.sharedSectionLabel}>Added</p>}
                    {filteredAccepted.map(r => (
                      <div key={r.id} className={styles.sharedItem}>
                        <div className={styles.sharedInfo}>
                          <span className={styles.sharedName}>{r.title}</span>
                          <span className={styles.sharedMeta}>{r.category === 'breakfast' ? 'Breakfast' : 'Lunch/Dinner'}</span>
                        </div>
                        <span className={styles.sharedAddedLabel}>Added</span>
                      </div>
                    ))}
                  </>
                )}
              </>;
            })()}
          </div>
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

      {/* Multi-recipe selection modal */}
      {urlRecipes.length > 1 && (
        <div className={styles.overlay} onClick={() => setUrlRecipes([])}>
          <div className={styles.multiRecipeModal} onClick={e => e.stopPropagation()}>
            <div className={styles.multiRecipeHeader}>
              <h3 className={styles.multiRecipeTitle}>{urlRecipes.length} Recipes Found</h3>
              <button className={styles.multiRecipeClose} onClick={() => setUrlRecipes([])}>&times;</button>
            </div>
            <p className={styles.multiRecipeDesc}>Select which recipes you'd like to import:</p>
            <div className={styles.multiRecipeList}>
              {urlRecipes.map((recipe, i) => (
                <div key={i}>
                  <div className={styles.multiRecipeItem}>
                    <button
                      className={styles.bulkPreviewName}
                      onClick={() => setUrlRecipePreview(urlRecipePreview === i ? null : i)}
                    >
                      {recipe.title || 'Untitled Recipe'}
                    </button>
                    <span className={styles.sharedMeta}>
                      {recipe.ingredients.length} ingredient{recipe.ingredients.length !== 1 ? 's' : ''}
                    </span>
                    <button className={styles.sharedAcceptBtn} onClick={() => {
                      const save = onAddWithoutClose || onSave;
                      save({ ...recipe, source: importMode || 'url' });
                      setUrlRecipes(prev => {
                        const next = prev.filter((_, j) => j !== i);
                        return next;
                      });
                    }}>+ Import</button>
                  </div>
                  {urlRecipePreview === i && (
                    <div className={styles.bulkPreviewCard}>
                      <h4 className={styles.bulkPreviewTitle}>{recipe.title || 'Untitled'}</h4>
                      {recipe.ingredients.length > 0 && (
                        <>
                          <h5 className={styles.bulkPreviewSection}>Ingredients</h5>
                          <ul className={styles.bulkPreviewList}>
                            {recipe.ingredients.map((ing, j) => (
                              <li key={j}>{ing.quantity && `${ing.quantity} `}{ing.measurement && `${ing.measurement} `}{ing.ingredient}</li>
                            ))}
                          </ul>
                        </>
                      )}
                      {recipe.instructions && (
                        <>
                          <h5 className={styles.bulkPreviewSection}>Instructions</h5>
                          <ol className={styles.bulkPreviewSteps}>
                            {recipe.instructions.split('\n').filter(s => s.trim()).map((step, j) => (
                              <li key={j}>{step}</li>
                            ))}
                          </ol>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Multi-import pinwheel modal — rendered at top level outside all containers */}
    {showMultiModal && (
      <div key={`multi-modal-${multiAdded.length}`} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 250, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '1rem', overflowY: 'auto' }}>
        <div style={{ maxWidth: '1400px', width: '100%', position: 'relative', marginTop: '1rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', background: 'var(--color-surface)', borderRadius: '10px', padding: '0.6rem 1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)' }}>
              Recipe {Math.min(multiAdded.length + 1, multiTotal)} of {multiTotal}
            </span>
            <div style={{ flex: 1, height: '4px', background: 'var(--color-border-light)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'var(--color-accent)', borderRadius: '2px', width: `${multiTotal > 0 ? (multiAdded.length / multiTotal) * 100 : 0}%`, transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{multiAdded.length} saved</span>
            {multiBehind > 0 && <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', background: '#EDE9FE', padding: '2px 8px', borderRadius: '999px' }}>+{multiBehind} more</span>}
            {multiFailed.length > 0 && <span style={{ fontSize: '0.72rem', color: 'var(--color-danger)' }}>{multiFailed.length} failed</span>}
          </div>

          {multiFront && (
            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
              {/* Current recipe — full form, same width as recipe detail page */}
              <div style={{ flex: '1 1 0', maxWidth: '1100px', minWidth: 0, position: 'relative' }}>
                <div style={{ background: 'var(--color-surface)', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
                  <RecipeForm
                    key={multiFront.title + multiAdded.length}
                    recipe={multiFront}
                    titleOverride={(() => {
                      let source = '';
                      try {
                        const url = multiFront.sourceUrl || '';
                        const host = new URL(url).hostname.replace(/^www\./, '');
                        if (host.includes('tiktok')) source = 'TikTok';
                        else if (host.includes('instagram')) source = 'Instagram';
                        else if (host.includes('pinterest')) source = 'Pinterest';
                        else if (host.includes('allrecipes')) source = 'AllRecipes';
                        else source = host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1);
                      } catch { source = 'URL'; }
                      return `Import recipe from ${source} — Recipe ${Math.min(multiAdded.length + 1, multiTotal)} of ${multiTotal}`;
                    })()}
                    onSave={(data) => {
                      if (onAddWithoutClose) onAddWithoutClose(data);
                      else if (onSave) onSave(data);
                      setMultiResults(prev => prev.map(r => r === multiFront ? { ...r, _status: 'added' } : r));
                    }}
                    onCancel={() => setMultiResults(prev => prev.map(r => r === multiFront ? { ...r, _status: 'failed' } : r))}
                    saveLabel="Save & Next"
                    cancelLabel="Skip"
                  />
                </div>
              </div>

              {/* Next recipe peek — shown to the right */}
              {multiBehind > 0 && (() => {
                const next = multiPending[1];
                return (
                  <div style={{ flex: '0 0 240px', position: 'relative', opacity: 0.6, transform: 'scale(0.92) rotate(2deg)', transformOrigin: 'top left', pointerEvents: 'none', marginTop: '0.5rem' }}>
                    {multiBehind >= 2 && (
                      <div style={{ position: 'absolute', top: '4px', left: '4px', right: '-4px', bottom: '-4px', background: 'var(--color-surface-alt)', borderRadius: '12px', border: '1px solid var(--color-border-light)', transform: 'rotate(1deg)', zIndex: 0 }} />
                    )}
                    <div style={{ position: 'relative', zIndex: 1, background: 'var(--color-surface)', borderRadius: '12px', border: '1px solid var(--color-border)', boxShadow: '0 4px 16px rgba(0,0,0,0.06)', padding: '1rem', maxHeight: '500px', overflow: 'hidden', WebkitMaskImage: 'linear-gradient(180deg, black 70%, transparent 100%)' }}>
                      <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#7C3AED', background: '#EDE9FE', padding: '2px 8px', borderRadius: '999px', display: 'inline-block', marginBottom: '0.5rem' }}>Up Next</div>
                      <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>{next?.title || 'Next Recipe'}</h3>
                      {next?.servings && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>🍽 {next.servings} servings {next.prepTime ? `· ⏱ ${next.prepTime}` : ''}</div>}
                      {(next?.ingredients || []).length > 0 && (
                        <div style={{ marginBottom: '0.5rem' }}>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: '0.2rem' }}>Ingredients</div>
                          {next.ingredients.slice(0, 5).map((ing, i) => (
                            <div key={i} style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', padding: '0.1rem 0' }}>
                              {ing.quantity} {ing.measurement} {ing.ingredient}
                            </div>
                          ))}
                          {next.ingredients.length > 5 && <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>+{next.ingredients.length - 5} more...</div>}
                        </div>
                      )}
                      {next?.instructions && (
                        <div>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: '0.2rem' }}>Instructions</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                            {next.instructions.split('\n').filter(s => s.trim()).slice(0, 3).map((s, i) => (
                              <div key={i} style={{ marginBottom: '0.15rem' }}>{i + 1}. {s.replace(/^[\d]+[.)]\s*/, '').replace(/^[1-9]\uFE0F?\u20E3\s*/, '').trim()}</div>
                            ))}
                            {next.instructions.split('\n').filter(s => s.trim()).length > 3 && <div>...</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {multiPending.length === 0 && (
            <div style={{ background: 'var(--color-surface)', borderRadius: '14px', boxShadow: '0 8px 32px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
              <div style={{ textAlign: 'center', padding: '2rem 1rem 1rem' }}>
                <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🎉</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#166534' }}>All done!</div>
                <div style={{ fontSize: '0.95rem', color: '#4B7A5B', marginTop: '0.25rem' }}>{multiAdded.length} recipe{multiAdded.length !== 1 ? 's' : ''} saved to your collection</div>
              </div>
              {multiFailed.length > 0 && (
                <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--color-border-light)' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-danger)', marginBottom: '0.4rem' }}>{multiFailed.length} failed to import:</div>
                  {multiFailed.map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0', borderBottom: '1px solid var(--color-border-light)', fontSize: '0.82rem' }}>
                      <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>✗</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sourceUrl}</div>
                        {r._error && <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{r._error}</div>}
                      </div>
                      <button onClick={() => {
                        setMultiResults([]);
                        setMultiUrls([r.sourceUrl, '']);
                      }} style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: '6px', background: 'none', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Retry</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center', padding: '1rem' }}>
                {(() => {
                  // Check if there are remaining import sources to route to
                  const remaining = [];
                  if (selectedSources.has('docs')) remaining.push({ key: 'docs', icon: '📄', label: 'Written down', desc: 'Word docs, notes app, PDFs', action: () => { setMultiResults([]); setShowSourcePicker(false); setCameFromSourcePicker(true); setImportMode('bulk'); setPhase('paste'); } });
                  if (selectedSources.has('head')) remaining.push({ key: 'head', icon: '🧠', label: 'In my head', desc: 'I know my recipes by heart', action: () => { setMultiResults([]); setShowSourcePicker(false); setCameFromSourcePicker(true); handleStartManual(); } });
                  if (selectedSources.has('none')) remaining.push({ key: 'none', icon: '🆕', label: "Don't have any yet", desc: "We'll help you discover or create recipes", action: () => { setMultiResults([]); setShowSourcePicker(false); setCameFromSourcePicker(true); setImportMode('discover'); setPhase('paste'); } });
                  if (remaining.length === 0) return null;
                  return (
                    <>
                      <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', fontWeight: 500, marginBottom: '0.25rem' }}>Continue importing from:</div>
                      {remaining.map(r => (
                        <button key={r.key} onClick={r.action} style={{
                          display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 1rem',
                          border: '1px solid var(--color-border)', borderRadius: '10px', background: 'var(--color-surface)',
                          cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%', maxWidth: '340px', transition: 'all 0.15s',
                        }}>
                          <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>{r.icon}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text)' }}>{r.label}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{r.desc}</div>
                          </div>
                          <span style={{ color: 'var(--color-accent)', fontWeight: 600, fontSize: '1.1rem' }}>→</span>
                        </button>
                      ))}
                    </>
                  );
                })()}
                <button onClick={() => { setMultiResults([]); window.location.hash = '#list'; }} style={{ padding: '0.6rem 2rem', border: 'none', borderRadius: '8px', background: 'var(--color-accent)', color: '#fff', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Go to My Recipes</button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}
    </>
  );
}
