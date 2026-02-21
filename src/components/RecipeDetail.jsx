import { useState } from 'react';
import { NutritionPanel } from './NutritionPanel';
import styles from './RecipeDetail.module.css';

const STOP_WORDS = new Set([
  'the','a','an','and','or','with','in','on','of','for','my','our','easy',
  'best','quick','simple','classic','homemade','style','recipe',
]);

function buildImageUrl(recipe) {
  const words = recipe.title.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  const keywords = words.slice(0, 2).join(',');
  let hash = 0;
  for (const ch of recipe.id) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return `https://loremflickr.com/800/400/food,${keywords}?lock=${Math.abs(hash)}`;
}

const emptyRow = { quantity: '', measurement: '', ingredient: '' };
const ingredientFields = ['quantity', 'measurement', 'ingredient'];

function initFields(recipe) {
  const type = recipe.mealType || '';
  const presets = ['meat', 'pescatarian', 'vegan', 'vegetarian', ''];
  return {
    title: recipe.title || '',
    description: recipe.description || '',
    category: recipe.category || 'lunch-dinner',
    frequency: recipe.frequency || 'common',
    mealType: presets.includes(type) ? type : 'custom',
    customMealType: presets.includes(type) ? '' : type,
    servings: recipe.servings || '1',
    prepTime: recipe.prepTime || '',
    cookTime: recipe.cookTime || '',
    sourceUrl: recipe.sourceUrl || '',
    ingredients: recipe.ingredients.length > 0
      ? recipe.ingredients.map(r => ({ ...r }))
      : [{ ...emptyRow }],
    steps: (() => {
      const parsed = (recipe.instructions || '')
        .split('\n')
        .map(s => s.replace(/^\d+[\.\)]\s*/, '').trim())
        .filter(Boolean);
      return parsed.length > 0 ? parsed : [''];
    })(),
  };
}

export function RecipeDetail({ recipe, onSave, onDelete, onBack }) {
  const [imgError, setImgError] = useState(false);
  const [fields, setFields] = useState(() => recipe ? initFields(recipe) : null);

  function setField(key, value) {
    setFields(prev => ({ ...prev, [key]: value }));
  }

  function updateIngredient(index, field, value) {
    setFields(prev => ({
      ...prev,
      ingredients: prev.ingredients.map((row, i) =>
        i === index ? { ...row, [field]: value } : row
      ),
    }));
  }

  function addRow() {
    setFields(prev => ({
      ...prev,
      ingredients: [...prev.ingredients, { ...emptyRow }],
    }));
  }

  function removeRow(index) {
    setFields(prev => ({
      ...prev,
      ingredients: prev.ingredients.filter((_, i) => i !== index),
    }));
  }

  function handlePaste(e, rowIndex, colIndex) {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();

    const pastedRows = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trimEnd()
      .split('\n')
      .map(line => line.split('\t'));

    setFields(prev => {
      const updated = prev.ingredients.map(row => ({ ...row }));
      const neededRows = rowIndex + pastedRows.length;
      while (updated.length < neededRows) updated.push({ ...emptyRow });

      for (let r = 0; r < pastedRows.length; r++) {
        const cells = pastedRows[r];
        for (let c = 0; c < cells.length; c++) {
          const targetCol = colIndex + c;
          if (targetCol < ingredientFields.length) {
            updated[rowIndex + r][ingredientFields[targetCol]] = cells[c].trim();
          }
        }
      }
      return { ...prev, ingredients: updated };
    });
  }

  function updateStep(index, value) {
    setFields(prev => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === index ? value : s)),
    }));
  }

  function addStep() {
    setFields(prev => ({ ...prev, steps: [...prev.steps, ''] }));
  }

  function removeStep(index) {
    setFields(prev => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== index),
    }));
  }

  function handleSave() {
    onSave({
      title: fields.title.trim(),
      description: fields.description.trim(),
      category: fields.category,
      frequency: fields.frequency,
      mealType: fields.mealType === 'custom' ? fields.customMealType.trim() : fields.mealType,
      servings: fields.servings.trim() || '1',
      prepTime: fields.prepTime.trim(),
      cookTime: fields.cookTime.trim(),
      sourceUrl: fields.sourceUrl.trim(),
      ingredients: fields.ingredients.filter(row => row.ingredient.trim() !== ''),
      instructions: fields.steps.filter(s => s.trim()).join('\n'),
    });
  }

  function handleCancel() {
    setFields(initFields(recipe));
    onBack();
  }

  if (!recipe) {
    return (
      <div className={styles.container}>
        <button className={styles.backBtn} onClick={onBack}>
          &larr; Back to recipes
        </button>
        <p>Recipe not found.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onBack}>
        &larr; Back to recipes
      </button>

      {!imgError && (
        <div className={styles.heroWrap}>
          <img
            className={styles.heroImg}
            src={buildImageUrl(recipe)}
            alt={recipe.title}
            onError={() => setImgError(true)}
          />
        </div>
      )}

      <input
        className={`${styles.inlineInput} ${styles.titleInput}`}
        type="text"
        value={fields.title}
        onChange={e => setField('title', e.target.value)}
      />

      <input
        className={styles.inlineInput}
        type="text"
        value={fields.description}
        onChange={e => setField('description', e.target.value)}
        placeholder="Short description"
      />

      <div className={styles.metaRow}>
        <label className={styles.metaLabel}>
          Serves
          <input
            className={`${styles.inlineInput} ${styles.metaInput}`}
            type="number"
            min="1"
            value={fields.servings}
            onChange={e => setField('servings', e.target.value)}
          />
        </label>
        <label className={styles.metaLabel}>
          Prep
          <input
            className={`${styles.inlineInput} ${styles.metaInput}`}
            type="text"
            value={fields.prepTime}
            onChange={e => setField('prepTime', e.target.value)}
            placeholder="15 min"
          />
        </label>
        <label className={styles.metaLabel}>
          Cook
          <input
            className={`${styles.inlineInput} ${styles.metaInput}`}
            type="text"
            value={fields.cookTime}
            onChange={e => setField('cookTime', e.target.value)}
            placeholder="30 min"
          />
        </label>
      </div>

      <div className={styles.metaRow}>
        <label className={styles.metaLabel}>
          Category
          <select
            className={styles.inlineSelect}
            value={fields.category}
            onChange={e => setField('category', e.target.value)}
          >
            <option value="breakfast">Breakfast</option>
            <option value="lunch-dinner">Lunch & Dinner</option>
            <option value="snacks">Snacks</option>
            <option value="desserts">Desserts</option>
            <option value="drinks">Drinks</option>
          </select>
        </label>
        <label className={styles.metaLabel}>
          Frequency
          <select
            className={styles.inlineSelect}
            value={fields.frequency}
            onChange={e => setField('frequency', e.target.value)}
          >
            <option value="common">Common</option>
            <option value="rare">Rare</option>
            <option value="retired">Retired</option>
          </select>
        </label>
        <label className={styles.metaLabel}>
          Meal Type
          <select
            className={styles.inlineSelect}
            value={fields.mealType}
            onChange={e => {
              setField('mealType', e.target.value);
              if (e.target.value !== 'custom') setField('customMealType', '');
            }}
          >
            <option value="">— None —</option>
            <option value="meat">Meat</option>
            <option value="pescatarian">Pescatarian</option>
            <option value="vegan">Vegan</option>
            <option value="vegetarian">Vegetarian</option>
            <option value="custom">Custom...</option>
          </select>
        </label>
        {fields.mealType === 'custom' && (
          <input
            className={`${styles.inlineInput} ${styles.metaInput}`}
            type="text"
            value={fields.customMealType}
            onChange={e => setField('customMealType', e.target.value)}
            placeholder="e.g. Keto, Paleo"
          />
        )}
      </div>

      <div className={styles.metaRow}>
        <label className={styles.metaLabel} style={{ flex: 1 }}>
          Source URL
          <input
            className={styles.inlineInput}
            type="text"
            value={fields.sourceUrl}
            onChange={e => setField('sourceUrl', e.target.value)}
            placeholder="Recipe link"
          />
        </label>
      </div>

      <div className={styles.columns}>
        <div className={styles.ingredientsCol}>
          <h3>Ingredients</h3>
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
              {fields.ingredients.map((row, i) => (
                <tr key={i}>
                  {ingredientFields.map((field, colIdx) => (
                    <td key={field}>
                      <input
                        className={styles.cellInput}
                        type="text"
                        value={row[field]}
                        onChange={e => updateIngredient(i, field, e.target.value)}
                        onPaste={e => handlePaste(e, i, colIdx)}
                        placeholder={
                          field === 'quantity' ? '1' :
                          field === 'measurement' ? 'cup' : 'flour'
                        }
                      />
                    </td>
                  ))}
                  <td>
                    {fields.ingredients.length > 1 && (
                      <button
                        className={styles.removeBtn}
                        type="button"
                        onClick={() => removeRow(i)}
                      >
                        &times;
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className={styles.addRowBtn} type="button" onClick={addRow}>
            + Add ingredient
          </button>
        </div>

        <div className={styles.nutritionCol}>
          <NutritionPanel recipeId={recipe.id} ingredients={recipe.ingredients} servings={parseInt(recipe.servings) || 1} />
        </div>
      </div>

      <div className={styles.section}>
        <h3>Instructions</h3>
        <ol className={styles.stepsList}>
          {fields.steps.map((step, i) => (
            <li key={i} className={styles.stepRow}>
              <span className={styles.stepLabel}>Step {i + 1}</span>
              <div className={styles.stepInputWrap}>
                <textarea
                  className={styles.stepInput}
                  value={step}
                  rows={2}
                  onChange={e => updateStep(i, e.target.value)}
                  placeholder={`Step ${i + 1}...`}
                />
                {fields.steps.length > 1 && (
                  <button
                    className={styles.removeBtn}
                    type="button"
                    onClick={() => removeStep(i)}
                  >
                    &times;
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
        <button className={styles.addRowBtn} type="button" onClick={addStep}>
          + Add step
        </button>
      </div>

      <div className={styles.actions}>
        <button className={styles.saveBtn} onClick={handleSave}>
          Save
        </button>
        <button className={styles.cancelBtn} onClick={handleCancel}>
          Cancel
        </button>
        <button
          className={styles.deleteBtn}
          onClick={() => {
            if (confirm('Delete this recipe?')) onDelete(recipe.id);
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
