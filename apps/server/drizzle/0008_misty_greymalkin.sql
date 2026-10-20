PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_zuordnungen` (
	`id` text PRIMARY KEY NOT NULL,
	`besucher_guid` text NOT NULL,
	`exponat_id` text NOT NULL,
	`art` text NOT NULL,
	`ziel_id` text NOT NULL,
	`app_nutzer_id` text,
	`zeitpunkt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`besucher_guid`) REFERENCES `besucher`(`guid`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exponat_id`) REFERENCES `exponate`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_nutzer_id`) REFERENCES `app_nutzer`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_zuordnungen`("id", "besucher_guid", "exponat_id", "art", "ziel_id", "app_nutzer_id", "zeitpunkt") SELECT "id", "besucher_guid", "exponat_id", "art", "ziel_id", "app_nutzer_id", "zeitpunkt" FROM `zuordnungen`;--> statement-breakpoint
DROP TABLE `zuordnungen`;--> statement-breakpoint
ALTER TABLE `__new_zuordnungen` RENAME TO `zuordnungen`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `zuordnungen_besucher_idx` ON `zuordnungen` (`besucher_guid`);--> statement-breakpoint
CREATE INDEX `zuordnungen_exponat_idx` ON `zuordnungen` (`exponat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `zuordnungen_eindeutig` ON `zuordnungen` (`besucher_guid`,`art`,`ziel_id`);