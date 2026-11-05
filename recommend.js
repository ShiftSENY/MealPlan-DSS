// ==========================================================================
// Recommendation engine (pure, rule-based, explainable)
// --------------------------------------------------------------------------
// Scores each meal in the user's catalog against their inventory and
// preferences. Higher = better match. Every result carries human-readable
// reasons so the ranking is never a black box.
// ==========================================================================

const DAY_MS = 86400000;

export function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function dayDiff(from, to) {
  return Math.round((to - from) / DAY_MS);
}

// Parse a date column (Date object or "YYYY-MM-DD") as a local calendar day.
function parseLocalDate(value) {
  if (value instanceof Date && !isNaN(value)) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Build a lookup of inventory by normalised name with total qty + earliest expiry.
function buildInventoryMap(inventory) {
  const map = new Map();
  inventory.forEach((item) => {
    const key = normalizeName(item.item_name);
    if (!key) return;
    const qty = Number(item.quantity) || 0;
    const existing = map.get(key);
    if (existing) {
      existing.quantity += qty;
      if (
        item.expiration_date &&
        (!existing.expiration_date || item.expiration_date < existing.expiration_date)
      ) {
        existing.expiration_date = item.expiration_date;
      }
    } else {
      map.set(key, {
        quantity: qty,
        unit: item.unit || "",
        expiration_date: item.expiration_date || null,
      });
    }
  });
  return map;
}

/**
 * Rank meals.
 * @param {Array} meals      meal_catalog rows
 * @param {Array} inventory  inventory rows
 * @param {Object} profile   preferences (budget, max_cook_time_minutes, ...)
 * @param {Array} weekPlan   weekly_plan rows (for variety)
 * @param {Function} [nameOf] optional map from meal id -> display name
 * @returns {Array} sorted results with { meal, score, reasons, missing, ... }
 */
export function rankMeals(meals, inventory, profile, weekPlan, nameOf) {
  const prefs = profile || {};
  const maxCook = Number(prefs.max_cook_time_minutes) || 0;
  const budget = Number(prefs.budget) || 0;
  const dietary = toArray(prefs.dietary_preferences).map(normalizeName);
  const disliked = toArray(prefs.disliked_ingredients).map(normalizeName);
  const varietyPref = (prefs.meal_variety || "balanced").toLowerCase();

  const invMap = buildInventoryMap(inventory || []);
  const usedMealIds = new Set((weekPlan || []).map((p) => p.meal_id).filter(Boolean));

  // How much of each ingredient the plan already consumes (per inventory key).
  const mealsById = new Map((meals || []).map((m) => [m.id, toArray(m.ingredients)]));
  const usageMap = new Map();
  (weekPlan || []).forEach((p) => {
    if (!p.meal_id || p.leftover_from) return;
    const ingredients = mealsById.get(p.meal_id) || [];
    ingredients.forEach((ing) => {
      if (!ing.main) return;
      const key = normalizeName(ing.name);
      usageMap.set(key, (usageMap.get(key) || 0) + (Number(ing.quantity) || 0));
    });
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const results = (meals || []).map((meal) => {
    const ingredients = toArray(meal.ingredients);
    const total = ingredients.length || 1;

    let availableCount = 0;
    // Main ingredients are weighted more heavily, so a meal loses more
    // availability when its main ingredient is missing.
    const MAIN_INGREDIENT_WEIGHT = 3;
    let availableWeight = 0;
    let totalWeight = 0;
    let missingMain = null;
    const expiring = [];
    const missing = [];
    const ingredientStatus = [];

    ingredients.forEach((ing) => {
      const key = normalizeName(ing.name);
      const info = invMap.get(key);
      const need = Number(ing.quantity) || 0;
      const have = info ? info.quantity : 0;
      const enough = !!info && (need <= 0 || have >= need);
      const weight = ing.main ? MAIN_INGREDIENT_WEIGHT : 1;
      totalWeight += weight;

      ingredientStatus.push({
        name: ing.name,
        quantity: ing.quantity ?? null,
        unit: ing.unit || "",
        need,
        have,
        available: enough,
        main: Boolean(ing.main),
      });

      if (enough) {
        availableCount += 1;
        availableWeight += weight;
        if (info.expiration_date) {
          const exp = parseLocalDate(info.expiration_date);
          if (exp) {
            const days = dayDiff(today, exp);
            if (days <= 3) {
              expiring.push({ name: ing.name, days });
            }
          }
        }
      } else {
        missing.push(ing);
        if (ing.main && !missingMain) missingMain = ing;
      }
    });

    const availability = totalWeight > 0 ? availableWeight / totalWeight : 0;

    // --- time ---
    const totalTime = (Number(meal.prep_time_minutes) || 0) + (Number(meal.cook_time_minutes) || 0);
    let timeScore = 1;
    if (maxCook > 0) {
      timeScore = totalTime <= maxCook ? 1 : Math.max(0, maxCook / (totalTime || 1));
    }

    // --- cost (kept within a rough per-meal share of the weekly budget) ---
    const cost = Number(meal.estimated_cost) || 0;
    let costScore = 1;
    if (budget > 0 && cost > 0) {
      const perMealShare = budget / 21; // weekly budget spread over ~3 meals x 7 days
      costScore = cost <= perMealShare ? 1 : Math.max(0, perMealShare / cost);
    }

    // --- diet & dislikes ---
    const tags = toArray(meal.dietary_tags).map(normalizeName);
    const hasDisliked = ingredients.some((ing) => disliked.includes(normalizeName(ing.name)));
    let dietScore = 1;
    let unsuitable = false;
    if (hasDisliked) {
      dietScore = 0.15;
      unsuitable = true;
    }
    if (dietary.length) {
      const matches = dietary.some(
        (d) => tags.includes(d) || normalizeName(meal.name).includes(d)
      );
      if (!matches) dietScore *= 0.55;
    }

    // --- planned usage of main ingredients ---
    // When a meal is placed on the plan, its main ingredients consume stock.
    // A meal whose main ingredient stock is already exhausted by earlier
    // slots this week suggests less.
    let remainingMain = null; // depletion factor 0..1 (1 = still has stock)
    const mainNeeds = ingredients.filter((ing) => ing.main);
    if (mainNeeds.length) {
      const ratios = mainNeeds.map((ing) => {
        const info = invMap.get(normalizeName(ing.name));
        const need = Number(ing.quantity) || 0;
        if (!info || need <= 0) return 1;
        const used = usageMap.get(normalizeName(ing.name)) || 0;
        const left = info.quantity - used;
        return left <= 0 ? 0 : Math.min(1, left / need);
      });
      remainingMain = Math.min(...ratios);
    }

    // --- variety ---
    const alreadyUsed = usedMealIds.has(meal.id);
    let varietyScore = 1;
    if (alreadyUsed) {
      varietyScore = varietyPref === "high" ? 0.4 : varietyPref === "low" ? 0.9 : 0.65;
    }

    // --- expiry bonus ---
    const expiryScore = Math.min(1, expiring.length / 2);

    // Main-ingredient penalty: if a main ingredient is missing or its stock
    // is exhausted, greatly reduce the score; meals without a main
    // ingredient (remainingMain === null) are unaffected.
    const hasUnavailableMain = Boolean(missingMain) || remainingMain === 0;
    const depletion = remainingMain === null ? 1 : hasUnavailableMain ? 0.05 : 0.35 + 0.65 * remainingMain;

    // Weighted total (weights sum to 1).
    const score =
      (
        availability * 0.32 +
        expiryScore * 0.1 +
        timeScore * 0.16 +
        costScore * 0.14 +
        dietScore * 0.16 +
        varietyScore * 0.12
      ) * depletion;

    // --- explanations ---
    const reasons = [];
    if (missingMain) {
      reasons.push(`Main ingredient "${missingMain.name}" is not in your inventory.`);
    }
    if (remainingMain === 0) {
      reasons.push("Main ingredient already used up in this week's plan.");
    }
    if (availableCount === total && total > 0) {
      reasons.push("All ingredients are already in your inventory.");
    } else if (availableCount > 0) {
      reasons.push(`Uses ${availableCount} of ${total} ingredients you already have.`);
    } else {
      reasons.push("You will need to buy most of the ingredients.");
    }

    if (expiring.length) {
      const names = expiring
        .sort((a, b) => a.days - b.days)
        .map((e) => e.name)
        .slice(0, 3)
        .join(", ");
      reasons.push(`Uses ${names} that should be eaten soon.`);
    }

    if (maxCook > 0) {
      reasons.push(
        totalTime <= maxCook
          ? `Ready in about ${totalTime} min, within your ${maxCook} min limit.`
          : `Takes about ${totalTime} min, over your ${maxCook} min limit.`
      );
    } else if (totalTime > 0) {
      reasons.push(`Ready in about ${totalTime} min.`);
    }

    if (cost > 0) {
      reasons.push(`Estimated cost around ₱${cost.toLocaleString("en-PH")}.`);
    }

    if (hasDisliked) {
      reasons.push("Contains an ingredient on your dislike list.");
    }
    if (alreadyUsed) {
      reasons.push("Already planned this week.");
    }
    if (dietary.length && dietScore >= 1) {
      reasons.push("Matches your dietary preference.");
    }

    return {
      meal,
      score,
      reasons,
      availableCount,
      totalIngredients: total,
      missing,
      expiring,
      ingredientStatus,
      hasMissingMain: Boolean(missingMain),
      hasUnavailableMain,
      missingMain,
      remainingMain,
      totalTime,
      cost,
      unsuitable,
    };
  });

  return results.sort((a, b) => b.score - a.score);
}
