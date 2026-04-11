-- Browser Dials — MySQL / MariaDB schema
-- Run with: mysql -u <user> -p <dbname> < schema.sql

SET FOREIGN_KEY_CHECKS = 0;

-- ─── API keys ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `api_keys` (
  `id`         VARCHAR(36)  NOT NULL,
  `key_value`  VARCHAR(128) NOT NULL,
  `label`      VARCHAR(100) NOT NULL DEFAULT '',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_key_value` (`key_value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `users` (
  `id`            VARCHAR(36)  NOT NULL,
  `username`      VARCHAR(100) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `is_active`     TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Profiles ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `profiles` (
  `id`         VARCHAR(36)  NOT NULL,
  `user_id`    VARCHAR(36)  NOT NULL,
  `name`       VARCHAR(100) NOT NULL,
  `position`   INT          NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_profiles_user` (`user_id`),
  CONSTRAINT `fk_profiles_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Dials ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `dials` (
  `id`         VARCHAR(36)  NOT NULL,
  `profile_id` VARCHAR(36)  NOT NULL,
  `title`      VARCHAR(200) NOT NULL DEFAULT '',
  `url`        VARCHAR(2048) NOT NULL,
  `position`   INT           NOT NULL DEFAULT 0,
  `icon_path`  VARCHAR(512)  NULL,
  `created_at` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_dials_profile`
    FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
