// ==========================================================================
// Grocery CSV parser (pure, no DOM / no DB — unit-test friendly)
// --------------------------------------------------------------------------
// Handles the three side-by-side groups used in the weekly grocery lists:
//
//   Quantity,Food,,Quantity,Condiment,,Quantity,Ingredient
//   18,Eggs,,1,Soy Sauce,,4,Onions
//   3,Bags of Mung beans,,1,Vinegar,,3,Garlic
//
// Output items: { category, ingredient_name, quantity, unit, raw_name }
// ==========================================================================

const GROUPS = [
  { qtyIndex: 0, nameIndex: 1, category: "Food" },
  { qtyIndex: 3, nameIndex: 4, category: "Condiment" },
  { qtyIndex: 6, nameIndex: 7, category: "Ingredient" },
];

// Leading unit words mapped to a canonical unit.
const UNIT_MAP = {
  bag: "bag", bags: "bag",
  bundle: "bundle", bundles: "bundle", bungle: "bundle",
  bottle: "bottle", bottles: "bottle",
  pack: "pack", packs: "pack",
  can: "can", cans: "can",
  piece: "piece", pieces: "piece", pcs: "piece", pc: "piece",
  kilo: "kg", kilos: "kg", kg: "kg",
  gram: "g", grams: "g", g: "g",
  liter: "L", liters: "L", litre: "L", litres: "L", l: "L",
  dozen: "dozen", dozens: "dozen",
  box: "box", boxes: "box",
  sachet: "sachet", sachets: "sachet",
  jar: "jar", jars: "jar",
  bunch: "bunch", bunches: "bunch",
};

// Split one CSV line respecting double quotes.
export function splitCsvLine(line) {
  const out = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

// "1/2" -> 0.5, "1 1/2" -> 1.5, "3" -> 3, "" -> null
export function parseQuantity(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  let m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);

  m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// "Bags of Mung beans" -> { unit: "bag", name: "Mung beans" }
export function extractUnit(rawName) {
  const name = String(rawName ?? "").trim();
  const m = name.match(/^([A-Za-z]+)\s+(?:of\s+)?(.+)$/);
  if (m) {
    const unit = UNIT_MAP[m[1].toLowerCase()];
    if (unit) return { unit, name: m[2].trim() };
  }
  return { unit: "", name };
}

function isHeaderRow(fields) {
  return /quantity/i.test(fields[0] || "") || /quantity/i.test(fields[3] || "");
}

/**
 * Parse a grocery-list CSV string.
 * @param {string} text
 * @returns {{ items: Array, errors: string[] }}
 */
export function parseGroceryCsv(text) {
  const items = [];
  const errors = [];
  const source = String(text || "").replace(/^\uFEFF/, "");

  const lines = source.split(/\r?\n/);

  lines.forEach((line, lineNo) => {
    if (!line.trim()) return;
    const fields = splitCsvLine(line);
    if (isHeaderRow(fields)) return;

    GROUPS.forEach((group) => {
      const rawName = fields[group.nameIndex];
      if (!rawName || !String(rawName).trim()) return;

      const rawQty = fields[group.qtyIndex];
      const quantity = parseQuantity(rawQty);
      if (rawQty && String(rawQty).trim() && quantity === null) {
        errors.push(`Line ${lineNo + 1}: could not read quantity "${rawQty}"`);
      }

      const { unit, name } = extractUnit(rawName);
      items.push({
        category: group.category,
        ingredient_name: name,
        quantity,
        unit,
        raw_name: String(rawName).trim(),
      });
    });
  });

  return { items, errors };
}
