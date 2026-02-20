import { useState, useEffect } from 'react';
import styles from './RecipeForm.module.css';

const emptyRow = { quantity: '', measurement: '', ingredient: '' };
const fields = ['quantity', 'measurement', 'ingredient'];

export function RecipeForm({ recipe, onSave, onCancel }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('lunch-dinner');
  const [frequency, setFrequency] = useState('common');
  const [servings, setServings] = useState('1');
  const [sourceUrl, setSourceUrl] = useState('');
  const [ingredients, setIngredients] = useState([{ ...emptyRow }]);
  const [instructions, setInstructions] = useState('');

  useEffect(() => {
    if (recipe) {
      setTitle(recipe.title);
      setDescription(recipe.description);
      setCategory(recipe.category || 'lunch-dinner');
      setFrequency(recipe.frequency || 'common');
      setServings(recipe.servings || '1');
      setSourceUrl(recipe.sourceUrl || '');
      setIngredients(
        recipe.ingredients.length > 0
          ? recipe.ingredients
          : [{ ...emptyRow }]
      );
      setInstructions(recipe.instructions);
    }
  }, [recipe]);

  function updateIngredient(index, field, value) {
    setIngredients(prev =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  function addRow() {
    setIngredients(prev => [...prev, { ...emptyRow }]);
  }

  function removeRow(index) {
    setIngredients(prev => prev.filter((_, i) => i !== index));
  }

  function handlePaste(e, rowIndex, colIndex) {
    const text = e.clipboardData.getData('text');
    // Detect multi-cell paste: contains tabs or multiple lines
    if (!text.includes('\t') && !text.includes('\n')) return;

    e.preventDefault();

    const pastedRows = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trimEnd()
      .split('\n')
      .map(line => line.split('\t'));

    setIngredients(prev => {
      const updated = prev.map(row => ({ ...row }));

      // Ensure enough rows exist
      const neededRows = rowIndex + pastedRows.length;
      while (updated.length < neededRows) {
        updated.push({ ...emptyRow });
      }

      for (let r = 0; r < pastedRows.length; r++) {
        const cells = pastedRows[r];
        for (let c = 0; c < cells.length; c++) {
          const targetCol = colIndex + c;
          if (targetCol < fields.length) {
            updated[rowIndex + r][fields[targetCol]] = cells[c].trim();
          }
        }
      }

      return updated;
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSave({
      title: title.trim(),
      description: description.trim(),
      category,
      frequency,
      servings: servings.trim() || '1',
      sourceUrl: sourceUrl.trim(),
      ingredients: ingredients.filter(row => row.ingredient.trim() !== ''),
      instructions: instructions.trim(),
    });
  }

  const isEditing = Boolean(recipe);

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2>{isEditing ? 'Edit Recipe' : 'Add Recipe'}</h2>

      <label className={styles.label}>
        Title
        <input
          className={styles.input}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          required
        />
      </label>

      <label className={styles.label}>
        Description
        <input
          className={styles.input}
          type="text"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Short description"
        />
      </label>

      <label className={styles.label}>
        Category
        <select
          className={styles.select}
          value={category}
          onChange={e => setCategory(e.target.value)}
        >
          <option value="breakfast">Breakfast</option>
          <option value="lunch-dinner">Lunch & Dinner</option>
          <option value="snacks-desserts">Snacks & Desserts</option>
        </select>
      </label>

      <label className={styles.label}>
        Frequency
        <select
          className={styles.select}
          value={frequency}
          onChange={e => setFrequency(e.target.value)}
        >
          <option value="common">Common</option>
          <option value="rare">Rare</option>
          <option value="retired">Retired</option>
        </select>
      </label>

      <label className={styles.label}>
        Servings
        <input
          className={styles.input}
          type="number"
          min="1"
          value={servings}
          onChange={e => setServings(e.target.value)}
          placeholder="1"
        />
      </label>

      <label className={styles.label}>
        Source URL
        <input
          className={styles.input}
          type="url"
          value={sourceUrl}
          onChange={e => setSourceUrl(e.target.value)}
          placeholder="Instagram video or recipe website link"
        />
      </label>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Ingredients</legend>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Quantity</th>
              <th>Measurement</th>
              <th>Ingredient</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((row, i) => (
              <tr key={i}>
                {fields.map((field, colIdx) => (
                  <td key={field}>
                    <input
                      className={styles.tableInput}
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
                  {ingredients.length > 1 && (
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
      </fieldset>

      <label className={styles.label}>
        Instructions
        <textarea
          className={styles.textarea}
          rows={8}
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          placeholder="Step-by-step instructions..."
          required
        />
      </label>

      <div className={styles.actions}>
        <button className={styles.saveBtn} type="submit">
          {isEditing ? 'Save Changes' : 'Add Recipe'}
        </button>
        <button className={styles.cancelBtn} type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
