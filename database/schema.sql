-- ==========================================================================
-- MealPlan DSS — MySQL schema (cPanel / phpMyAdmin import)
--
-- Ported from the Neon (PostgreSQL) schema in schema.sql + migrations
-- 001-004. Table names match your JS query patterns in db.js exactly
-- (no prefixes), so the PHP API mirrors db.js 1:1.
--
-- Data is scoped per user by the Clerk user_id string (e.g. "user_2...
-- The same id you use today in Neon works here unchanged.
--
-- ENGINE=InnoDB / CHARSET=utf8mb4 throughout (required for JSON columns).
-- ==========================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

SET foreign_key_checks = 0;

DROP TABLE IF EXISTS `shopping_list`;
DROP TABLE IF EXISTS `weekly_plan`;
DROP TABLE IF EXISTS `meal_catalog`;
DROP TABLE IF EXISTS `inventory`;
DROP TABLE IF EXISTS `profiles`;

SET foreign_key_checks = 1;

-- --------------------------------------------------------------------------
-- profiles — per-user preferences
-- (dietary_preferences / disliked_ingredients / nutrition_goals are JSON
--  arrays, e.g. '["vegetarian"]', matching your JS JSON.stringify usage)
-- --------------------------------------------------------------------------
CREATE TABLE `profiles` (
  `user_id`                VARCHAR(64)  NOT NULL,             -- Clerk user id
  `budget`                 DECIMAL(10,2) DEFAULT NULL,
  `max_cook_time_minutes`  INT          DEFAULT NULL,
  `dietary_preferences`    JSON         DEFAULT NULL,
  `disliked_ingredients`   JSON         DEFAULT NULL,
  `nutrition_goals`        JSON         DEFAULT NULL,
  `meal_variety`           VARCHAR(30)  NOT NULL DEFAULT 'balanced',
  `created_at`             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- inventory — kitchen ingredients
-- --------------------------------------------------------------------------
CREATE TABLE `inventory` (
  `id`                CHAR(36)  NOT NULL,              -- UUID (matches Neon)
  `user_id`           VARCHAR(64) NOT NULL,             -- Clerk user id
  `item_name`         VARCHAR(200) NOT NULL,
  `category`          VARCHAR(100) DEFAULT NULL,
  `quantity`          DECIMAL(10,2) DEFAULT NULL,
  `unit`              VARCHAR(50)  DEFAULT NULL,
  `purchase_date`     DATE        DEFAULT NULL,
  `expiration_date`   DATE        DEFAULT NULL,
  `storage_location`  VARCHAR(100) DEFAULT NULL,
  `notes`             VARCHAR(255) DEFAULT NULL,
  `created_at`        TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `inventory_user_idx` (`user_id`),
  CONSTRAINT `inventory_user_fk` FOREIGN KEY (`user_id`)
    REFERENCES `profiles` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- meal_catalog — user-defined Filipino dishes
-- (meal_periods / ingredients / dietary_tags are JSON columns)
-- --------------------------------------------------------------------------
CREATE TABLE `meal_catalog` (
  `id`                  CHAR(36)  NOT NULL,              -- UUID
  `user_id`             VARCHAR(64) NOT NULL,             -- Clerk user id
  `name`                VARCHAR(200) NOT NULL,
  `meal_periods`        JSON        DEFAULT NULL,          -- ["breakfast","lunch",...]
  `ingredients`         JSON        DEFAULT NULL,          -- [{ name, quantity, unit }]
  `estimated_cost`      DECIMAL(10,2) DEFAULT NULL,
  `prep_time_minutes`   INT         DEFAULT NULL,
  `cook_time_minutes`   INT         DEFAULT NULL,
  `nutrition_notes`     VARCHAR(255) DEFAULT NULL,
  `dietary_tags`        JSON        DEFAULT NULL,
  `created_at`          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `meal_catalog_user_idx` (`user_id`),
  CONSTRAINT `meal_catalog_user_fk` FOREIGN KEY (`user_id`)
    REFERENCES `profiles` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- weekly_plan — one row per date + meal period
-- (migration_004: leftover_from marks a slot as "use leftovers from X")
-- --------------------------------------------------------------------------
CREATE TABLE `weekly_plan` (
  `id`            CHAR(36)  NOT NULL,              -- UUID
  `user_id`       VARCHAR(64) NOT NULL,             -- Clerk user id
  `meal_date`     DATE        NOT NULL,
  `meal_period`   VARCHAR(12) DEFAULT NULL,          -- breakfast/lunch/dinner
  `meal_id`       CHAR(36)  DEFAULT NULL,           -- UUID of meal_catalog
  `leftover_from` VARCHAR(12) DEFAULT NULL,          -- breakfast/lunch/dinner or NULL
  `assigned_at`   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `weekly_plan_user_date_period` (`user_id`, `meal_date`, `meal_period`),
  INDEX `weekly_plan_date_idx` (`user_id`, `meal_date`),
  CONSTRAINT `weekly_plan_user_fk` FOREIGN KEY (`user_id`)
    REFERENCES `profiles` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `weekly_plan_meal_fk` FOREIGN KEY (`meal_id`)
    REFERENCES `meal_catalog` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- shopping_list — dated lists, supports history
-- --------------------------------------------------------------------------
CREATE TABLE `shopping_list` (
  `id`               CHAR(36)  NOT NULL,              -- UUID
  `user_id`          VARCHAR(64) NOT NULL,             -- Clerk user id
  `list_date`        DATE        NOT NULL,
  `category`         VARCHAR(50)  DEFAULT NULL,          -- Food / Condiment / Ingredient
  `ingredient_name`  VARCHAR(200) NOT NULL,
  `quantity`         DECIMAL(10,2) DEFAULT NULL,
  `unit`             VARCHAR(50)  DEFAULT NULL,
  `purchased`        TINYINT(1)   NOT NULL DEFAULT 0,
  `source_meal_id`   CHAR(36)  DEFAULT NULL,           -- UUID of meal_catalog
  `created_at`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `shopping_date_idx` (`user_id`, `list_date`),
  CONSTRAINT `shopping_user_fk` FOREIGN KEY (`user_id`)
    REFERENCES `profiles` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `shopping_meal_fk` FOREIGN KEY (`source_meal_id`)
    REFERENCES `meal_catalog` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
