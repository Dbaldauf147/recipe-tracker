const API_BASE = 'https://world.openfoodfacts.org/api/v2/product';

function parseServingSize(servingSize) {
  if (!servingSize) return { quantity: '', measurement: '' };
  const match = servingSize.match(/^([\d.]+)\s*(\w+)/);
  if (!match) return { quantity: '', measurement: '' };
  return { quantity: match[1], measurement: match[2] };
}

export async function lookupBarcode(barcode) {
  const res = await fetch(`${API_BASE}/${barcode}.json`);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;

  const p = data.product;
  const brand = (p.brands || '').split(',')[0].trim();
  const name = p.product_name || '';
  if (!name) return null;

  const ingredient = brand ? `${brand} ${name}` : name;
  const { quantity, measurement } = parseServingSize(p.serving_size);

  return {
    quantity,
    measurement,
    ingredient,
    notes: p.quantity || '',
  };
}
