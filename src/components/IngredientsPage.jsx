import { useState, useEffect } from 'react';
import styles from './IngredientsPage.module.css';

const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRg2H-pU53B_n0WCG3f_vz3ye-8IicvsqvTM2xohwVaEitNIZr6PbrgRn8-5qlTn-cSwnt2m3FjXIae/pub?gid=960892864&single=true&output=csv';

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// Columns to display (index into CSV row, label)
const COLUMNS = [
  { idx: 7, label: 'Ingredient' },
  { idx: 9, label: 'Measurement' },
  { idx: 23, label: 'Calories' },
  { idx: 10, label: 'Protein (g)' },
  { idx: 11, label: 'Carbs (g)' },
  { idx: 12, label: 'Fat (g)' },
  { idx: 19, label: 'Fiber (g)' },
  { idx: 13, label: 'Sugar (g)' },
  { idx: 25, label: 'Sat Fat' },
  { idx: 24, label: 'Added Sugar' },
  { idx: 14, label: 'Salt (mg)' },
  { idx: 15, label: 'Potassium (mg)' },
  { idx: 16, label: 'B12 (µg)' },
  { idx: 17, label: 'Vit C (mg)' },
  { idx: 18, label: 'Magnesium (mg)' },
  { idx: 20, label: 'Zinc (mg)' },
  { idx: 21, label: 'Iron (mg)' },
  { idx: 22, label: 'Calcium (mg)' },
  { idx: 26, label: 'Leucine (g)' },
  { idx: 35, label: 'Omega 3' },
  { idx: 37, label: 'Protein/Cal' },
  { idx: 38, label: 'Fiber/Cal' },
  { idx: 27, label: 'Notes' },
  { idx: 39, label: 'Last Bought' },
  { idx: 40, label: 'Storage' },
  { idx: 41, label: 'Min Shelf (days)' },
  { idx: 42, label: 'Max Shelf (days)' },
  { idx: 32, label: 'Processed?' },
  { idx: 31, label: 'Link' },
];

export function IngredientsPage({ onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    fetch(CSV_URL)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.text();
      })
      .then(text => {
        const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
        // Row 3 (index 2) is the header, data starts at index 3
        const dataRows = [];
        for (let i = 3; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i]);
          const ingredient = (cols[7] || '').trim();
          if (!ingredient) continue;
          dataRows.push(cols);
        }
        setRows(dataRows);
      })
      .catch(() => setError('Failed to load ingredients data.'))
      .finally(() => setLoading(false));
  }, []);

  function handleSort(colIdx) {
    if (sortCol === colIdx) {
      setSortAsc(prev => !prev);
    } else {
      setSortCol(colIdx);
      setSortAsc(true);
    }
  }

  const filtered = search
    ? rows.filter(r => (r[7] || '').toLowerCase().includes(search.toLowerCase()))
    : rows;

  const sorted = sortCol !== null
    ? [...filtered].sort((a, b) => {
        const aVal = (a[sortCol] || '').trim();
        const bVal = (b[sortCol] || '').trim();
        const aNum = parseFloat(aVal);
        const bNum = parseFloat(bVal);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortAsc ? aNum - bNum : bNum - aNum;
        }
        return sortAsc
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      })
    : filtered;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>
          &larr; Back
        </button>
        <h2 className={styles.title}>Ingredients Database</h2>
        <span className={styles.count}>{sorted.length} ingredients</span>
      </div>

      <input
        className={styles.search}
        type="text"
        placeholder="Search ingredients..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {loading && <p className={styles.loading}>Loading ingredients...</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {COLUMNS.map(col => (
                  <th
                    key={col.idx}
                    onClick={() => handleSort(col.idx)}
                    className={sortCol === col.idx ? styles.sortedTh : ''}
                  >
                    {col.label}
                    {sortCol === col.idx && (
                      <span className={styles.sortArrow}>
                        {sortAsc ? ' \u25B2' : ' \u25BC'}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr key={i}>
                  {COLUMNS.map(col => {
                    const val = (row[col.idx] || '').trim();
                    if (col.label === 'Link' && val) {
                      return (
                        <td key={col.idx}>
                          <a
                            href={val.startsWith('http') ? val : `https://${val}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.link}
                          >
                            View
                          </a>
                        </td>
                      );
                    }
                    return <td key={col.idx}>{val}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
