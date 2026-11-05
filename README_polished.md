# Personalized Weekly Meal Planning DSS

## 1. Project Overview

**Personalized Weekly Meal Planning DSS** is a mobile-friendly Progressive Web App (PWA) that helps users plan meals, manage household food inventory, and make practical food decisions throughout the week.

Meal planning may seem simple, but deciding what to cook repeatedly requires considering available ingredients, nutritional balance, cost, preparation time, food freshness, and personal preferences. These recurring decisions can consume mental energy that could be devoted to studies, work, and other responsibilities.

The proposed Decision Support System (DSS) reduces this burden by organizing ingredient information and evaluating meal options against multiple criteria. It recommends and ranks suitable meals for each day or meal period and provides a short explanation of why each option fits the user's current needs.

The goal is not to make every decision automatically. Instead, the system provides useful, understandable recommendations while allowing the user to make the final choice.

## 2. Main Objectives

- Reduce the time and mental effort needed to decide what to cook.
- Keep an organized, editable record of ingredients and household food supplies.
- Prioritize ingredients that are nearing their recorded expiration dates.
- Recommend meals based on available ingredients, budget, preparation time, nutrition goals, dietary preferences, and meal variety.
- Help users plan meals for a full week while making it easy to revise individual meals.
- Provide a usable experience on phones, tablets, and desktop computers.

## 3. Core Features

### 3.1 Ingredient Inventory

Store every ingredient in a database, including vegetables, fruit, meat, seafood, grains, canned goods, condiments, spices, cooking oils, and other pantry items.

Each inventory record should support the following fields where applicable:

- **Item name** — the ingredient's common name.
- **Category** — for example, vegetable, meat, condiment, canned good, grain, or dairy.
- **Quantity and unit** — for example, 3 pieces, 500 grams, or 1 bottle.
- **Purchase date** — the date the item was bought.
- **Expiration or best-before date** — when known and applicable.
- **Storage location** — optional, such as pantry, refrigerator, or freezer.
- **Notes** — optional details such as brand or preparation state.

Users must be able to add, view, edit, and delete inventory items. The **purchase date must be editable through a date-picker control**, not restricted to the date the item was first entered. Users should also be able to update quantities when ingredients are used or replenished.

The interface should distinguish between items nearing their recorded expiration date, items already past that date, and items with no expiration date recorded. Date labels are reminders, not guarantees that food is safe or unsafe to eat.

### 3.2 Personalized Meal Recommendations

Recommend and rank candidate meals using configurable decision criteria, such as:

- How many required ingredients are already available.
- Whether ingredients are nearing their recorded expiration dates.
- Estimated cost of missing ingredients and the meal's overall cost.
- Preparation and cooking time.
- Nutrition goals selected by the user.
- Dietary restrictions, dislikes, and food preferences.
- Variety across the week's planned meals.

Recommendations should include a brief, understandable explanation. For example: *“Recommended because most ingredients are already available, it takes about 20 minutes to prepare, and it uses spinach that is nearing its recorded best-before date.”*

The system should not claim medical or nutritional precision unless reliable nutrition data is integrated. Nutrition information and meal suitability should be presented as estimates where appropriate.

### 3.3 Weekly Meal Calendar

- Display a seven-day meal plan with configurable meal periods, such as breakfast, lunch, and dinner.
- Let users assign a recommended meal to a day and meal period.
- Allow users to replace, remove, or manually select a meal.
- Show the planned meal's estimated preparation time, cost, and ingredient availability when this information is available.
- Support meal variety so the same dish is not recommended too frequently.
- Keep the user's final choices editable; recommendations should never lock the plan.

### 3.4 Ingredient and Shopping Guidance

- Identify ingredients needed for a selected meal that are not currently in inventory.
- Create a shopping list from missing ingredients across the weekly plan.
- Avoid listing an ingredient as missing when the recorded inventory quantity is sufficient.
- Allow users to mark shopping-list items as purchased and add them to inventory.

### 3.5 Preferences and Settings

Allow users to set relevant preferences, including budget, maximum cooking time, dietary preferences or restrictions, disliked ingredients, nutrition goals, and preferred meal variety. Users should be able to change these settings at any time.

## 4. Decision-Support Workflow

1. **Record inventory:** Add ingredients and enter their quantities, purchase dates, and expiration dates when known.
2. **Set preferences:** Enter budget, available cooking time, dietary preferences, and other decision criteria.
3. **Generate recommendations:** Evaluate candidate meals against the recorded inventory and preferences.
4. **Review the ranking:** Show recommended meals and explain the main reasons behind their rankings.
5. **Build the weekly plan:** Assign meals to days and meal periods, then adjust the plan as needed.
6. **Review missing ingredients:** Generate a consolidated shopping list from the selected meals.
7. **Update inventory:** Record purchases and adjust quantities as ingredients are used.

## 5. Landing Page / Homepage Requirements

The homepage should introduce the system clearly and give users an obvious path to sign in or begin using it.

### Required content

- **Application title:** “Personalized Weekly Meal Planning DSS.”
- **Logo:** Use the existing `MealPlan_Logo.svg` file from the project folder.
- **Hero section:** A concise value proposition, brief description, and prominent sign-in or “Get Started” button.
- **Introduction:** Explain how repeated meal decisions contribute to decision fatigue and how the DSS supports more informed choices.
- **How it works:** Show the main workflow from inventory entry to meal recommendations and weekly planning.
- **Key features:** Present inventory management, editable purchase dates, expiration reminders, personalized recommendations, weekly calendar, and shopping-list generation.
- **Illustrative demo:** Include sample interface previews or clearly labeled mock data showing inventory records, a recommendation with its explanation, and a weekly meal plan.
- **Access point:** Provide a sign-in form or prominent sign-in button. Do not present a decorative form as functional authentication if no authentication service is connected.
- **Footer:** Include appropriate navigation, project information, and contact details only when real information is available.

The landing page should communicate the system's purpose without overwhelming visitors with long blocks of text.

## 6. Design and Usability Requirements

- Use a **mobile-first, responsive layout** that works on small phones, tablets, laptops, and desktop screens.
- Use a calm, light-green theme supported by neutral backgrounds and readable text.
- Make common actions—adding an ingredient, editing a purchase date, viewing recommendations, and changing a meal—easy to find and use on a phone.
- Use responsive cards, flexible layouts, and appropriately sized touch targets.
- Ensure forms have visible labels, useful validation messages, and clear save/cancel actions.
- Use semantic HTML, accessible color contrast, keyboard navigation, visible focus states, and meaningful alternative text for informative images.
- Include empty states, loading states, and error messages where relevant.
- Keep the visual design consistent and practical, with readable typography and restrained decoration.

## 7. Progressive Web App (PWA) Requirements

- Provide a valid `manifest.json` with the application name, short name, theme color, background color, display mode, start URL, and appropriate icons.
- Implement a `service-worker.js` to cache suitable application assets and support reliable loading when offline.
- Include relevant viewport, theme-color, description, and other appropriate metadata in `index.html`.
- Make the app installable where supported by the browser.
- Provide a clear offline state and avoid implying that server-dependent features are available when disconnected.

**Offline and data note:** Caching the interface does not by itself make inventory data persistent or synchronized. Choose and document a storage approach. If local storage or IndexedDB is used, explain how local records are saved and what happens when a user changes devices. If a server database and account-based synchronization are required, implement those separately and handle offline changes deliberately.

## 8. Technical Structure and Deliverables

Use clean, maintainable code with semantic HTML5, responsive CSS, and lightweight JavaScript. Prefer Flexbox or CSS Grid and use a consistent naming convention such as BEM. Add concise comments for meaningful sections and non-obvious logic.

Expected files:

- `index.html` — landing page and application entry point.
- `style.css` — responsive layout, components, and visual styling.
- `script.js` — interface interactions and client-side behavior.
- `manifest.json` — PWA metadata and installation settings.
- `service-worker.js` — application asset caching and offline behavior.
- `MealPlan_Logo.svg` — supplied application logo.
- Additional files may be added for inventory management, meal data, recommendation logic, persistence, or authentication as the project grows.

Keep the implementation lightweight and easy to understand. Do not include fake integrations, nonfunctional controls, fabricated contact details, or claims that features work when they are only visual mockups.

## 9. Suggested Development Priorities

To keep the project manageable, build it in stages:

1. Create the responsive homepage and navigation.
2. Implement ingredient inventory CRUD operations, including the editable purchase-date picker.
3. Add data persistence and validation for quantities and dates.
4. Build meal records and a transparent, rule-based recommendation and ranking process.
5. Add the weekly calendar and shopping-list generation.
6. Add user preferences and improve recommendation explanations.
7. Configure PWA installation and offline behavior, then test across screen sizes and browsers.

## 10. Project Success Criteria

The initial version should allow a user to:

- Add, edit, and remove inventory records for different types of food and pantry items.
- Change an item's purchase date using a date picker.
- Record and update quantities and expiration dates where known.
- View inventory items that are nearing or past their recorded expiration dates.
- Receive ranked meal suggestions with clear explanations based on available data and selected preferences.
- Build and revise a seven-day meal plan.
- Identify missing ingredients and produce a shopping list.
- Use the interface comfortably on a mobile phone.
- Understand which features work offline and how their data is saved.

## 11. Design Principle

The system should **support decisions, not make them opaque**. Recommendations should be practical, explainable, editable, and based on the information the user has actually provided. Its main value is to reduce repetitive planning effort while helping the user use available ingredients thoughtfully.
