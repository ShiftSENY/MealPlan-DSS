<?php
/**
 * MealPlan DSS — database configuration (example).
 *
 * Copy this file to config.php, fill in your cPanel credentials, and
 * make sure config.php is never committed or exposed publicly.
 * config.example.php holds the same keys with placeholder values.
 * Point config.php at the same database you imported database/schema.sql into.
 */

return [
    // Database host — "localhost" works for most cPanel accounts.
    'db_host' => 'localhost',
    'db_name' => 'mealplan_dss',
    'db_user' => 'mealplan_dss_user',
    'db_pass' => 'CHANGE_ME',
];
