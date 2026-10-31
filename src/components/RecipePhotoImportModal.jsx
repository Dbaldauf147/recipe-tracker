import React, { useEffect, useRef, useState } from 'react';
import { MAX_RECIPE_PHOTOS, imageFileToDataUrl, parseRecipePhotos } from '../utils/recipePhotos';
import { parseIngredientLine } from '../utils/parseRecipeText';
import { parsePastedSteps } from '../utils/pastedSteps';
import { pastedImageFile } from '../utils/clipboardImage';
import styles from './RecipeDetail.module.css';

/**
 * Read an existing recipe's ingredients OR instructions from a photo /
 * screenshot (paste, drop, or pick a file) via /api/parse-recipe-image, then
 * Append or Replace — same choices as the spreadsheet paste panels.
 *
 * kind: 'ingredients' → onApply(rows[{quantity,measurement,ingredient,notes?}], mode)
 *       'steps'       → onApply(steps[string], mode)
 */
export function RecipePhotoImportModal({ kind, onApply, onClose }) {
  const [photos, setPhotos] = useState([]); // [{ file, url }]
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const isSteps = kind === 'steps';
  const noun = isSteps ? 'instructions' : 'ingredients';

  function addFiles(files) {
    const imgs = Array.from(files || []).filter(f => f && (f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name || '')));
    if (imgs.length === 0) return;
    setError('');
    setResult(null);
    setPhotos(prev => {
      const room = MAX_RECIPE_PHOTOS - prev.length;
      if (imgs.length > room) setError(`Up to ${MAX_RECIPE_PHOTOS} photos at a time.`);
      return [...prev, ...imgs.slice(0, Math.max(0, room)).map(file => ({ file, url: URL.createObjectURL(file) }))];
    });
  }

  // Capture-phase on window so this runs before RecipeDetail's page-wide
  // paste listener (on document), which would otherwise take the screenshot
  // as the recipe's meal image.
  useEffect(() => {
    function onPaste(e) {
      const file = pastedImageFile(e);
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      addFiles([file]);
    }
    window.addEventListener('paste', onPaste, true);
    return () => window.removeEventListener('paste', onPaste, true);
  }, []);

  useEffect(() => () => photosRef.current.forEach(p => URL.revokeObjectURL(p.url)), []);

  function removePhoto(i) {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[i].url);
      return prev.filter((_, j) => j !== i);
    });
    setResult(null);
  }

  async function read() {
    if (photos.length === 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      const dataUrls = [];
      for (const p of photos) dataUrls.push(await imageFileToDataUrl(p.file));
      const recipe = await parseRecipePhotos(dataUrls, async images => {
        const res = await fetch('/api/parse-recipe-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || (res.status === 413 ? 'Those photos are too large to send together — try fewer at a time.' : `Server error ${res.status}`));
        }
        return res.json();
      });
      let items;
      if (isSteps) {
        items = parsePastedSteps(recipe.instructions || '');
      } else {
        items = (recipe.ingredients || [])
          .map(s => String(s).trim()).filter(Boolean)
          .map(line => parseIngredientLine(line))
          .filter(r => r && (r.ingredient || r.quantity));
      }
      if (items.length === 0) throw new Error(`Couldn't find any ${noun} in ${photos.length > 1 ? 'those photos' : 'that photo'} — try a clearer shot.`);
      setResult(items);
    } catch (err) {
      setError(err.message || 'Failed to read the photo');
    } finally {
      setBusy(false);
    }
  }

  const PREVIEW_LIMIT = 20;
  return (
    <div className={styles.pasteOverlay} onClick={onClose}>
      <div className={styles.pasteModal} onClick={e => e.stopPropagation()}>
        <div className={styles.pasteHeader}>
          <h3 className={styles.pasteTitle}>{isSteps ? 'Instructions from a photo' : 'Ingredients from a photo'}</h3>
          <button type="button" className={styles.pasteCloseBtn} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.pasteBody}>
          <div className={styles.pasteHint}>
            Paste a screenshot (Ctrl/Cmd-V), drop a picture here, or upload one. Only the {noun} are read from it.
          </div>
          <div
            className={`${styles.photoDrop} ${dragOver ? styles.photoDropActive : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
            onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            role="button"
            tabIndex={0}
          >
            📷 Paste, drop, or <u>choose photo{MAX_RECIPE_PHOTOS > 1 ? 's' : ''}</u>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              hidden
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
            />
          </div>
          {photos.length > 0 && (
            <div className={styles.photoThumbs}>
              {photos.map((p, i) => (
                <div key={p.url} className={styles.photoThumb}>
                  <img src={p.url} alt={`Photo ${i + 1}`} />
                  <button type="button" onClick={() => removePhoto(i)} aria-label="Remove photo">×</button>
                </div>
              ))}
            </div>
          )}
          {error && <div className={styles.photoError}>{error}</div>}
          {result && (
            <>
              <div className={styles.pasteCount}>
                {result.length} {isSteps ? `step${result.length === 1 ? '' : 's'}` : `ingredient${result.length === 1 ? '' : 's'}`} found
              </div>
              <div className={styles.previewWrap}>
                {isSteps ? (
                  <ol style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    {result.slice(0, PREVIEW_LIMIT).map((s, i) => (
                      <li key={i} style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>{s}</li>
                    ))}
                  </ol>
                ) : (
                  <table className={styles.previewTable}>
                    <thead><tr><th>Quantity</th><th>Measurement</th><th>Ingredient</th></tr></thead>
                    <tbody>
                      {result.slice(0, PREVIEW_LIMIT).map((r, i) => (
                        <tr key={i}><td>{r.quantity}</td><td>{r.measurement}</td><td>{r.ingredient}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {result.length > PREVIEW_LIMIT && (
                  <div className={styles.previewMore}>+ {result.length - PREVIEW_LIMIT} more</div>
                )}
              </div>
            </>
          )}
        </div>
        <div className={styles.pasteFooter}>
          {result ? (
            <>
              <button className={styles.pasteAppendBtn} type="button" onClick={() => onApply(result, 'append')}>
                Append {isSteps ? 'steps' : 'ingredients'}
              </button>
              <button className={styles.pasteReplaceBtn} type="button" onClick={() => onApply(result, 'replace')}>
                Replace existing
              </button>
            </>
          ) : (
            <button className={styles.pasteAppendBtn} type="button" onClick={read} disabled={photos.length === 0 || busy}>
              {busy ? 'Reading…' : `Read ${noun}${photos.length > 1 ? ` from ${photos.length} photos` : ''}`}
            </button>
          )}
          <button className={styles.pasteCancelBtn} type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
