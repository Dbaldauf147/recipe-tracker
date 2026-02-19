# Recipe Tracker

A React web app for tracking recipes with nutrition lookup powered by the USDA FoodData Central API.

## Features

- **Add, view, edit, and delete recipes** with localStorage persistence
- **Structured ingredient table** with Quantity, Measurement, and Ingredient columns
- **Spreadsheet-style paste** — copy 3 columns from Excel/Google Sheets and paste directly into the ingredients table
- **Nutrition calculator** — fetches data from the USDA FoodData Central API with 17 tracked nutrients:
  - Macros: Calories, Protein, Carbs, Fat, Saturated Fat
  - Sugars & Fiber: Sugar, Added Sugar, Fiber
  - Minerals: Salt, Potassium, Calcium, Iron, Magnesium, Zinc
  - Vitamins & Aminos: B12, Vitamin C, Leucine
- **Per-ingredient breakdown** showing USDA matches and individual nutrient values

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)

### Install

```bash
git clone https://github.com/Dbaldauf147/recipe-tracker.git
cd recipe-tracker
npm install
```

### Configure API Key

Get a free API key from [USDA FoodData Central](https://fdc.nal.usda.gov/api-key-signup/).

Create a `.env` file in the project root:

```
VITE_USDA_API_KEY=your_api_key_here
```

Without a key, the app falls back to `DEMO_KEY` (limited to ~30 requests/hour).

### Run

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

### Build for Production

```bash
npm run build
```

Output goes to the `dist/` folder.

## Tech Stack

- React + Vite
- CSS Modules
- localStorage for data persistence
- USDA FoodData Central API for nutrition data
