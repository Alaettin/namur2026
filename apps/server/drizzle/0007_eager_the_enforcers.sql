CREATE TABLE `globale_daten` (
	`id` text PRIMARY KEY NOT NULL,
	`nummer` integer NOT NULL,
	`name` text NOT NULL,
	`art` text NOT NULL,
	`text` text,
	`datei_id` text,
	`angelegt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`datei_id`) REFERENCES `dateien`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `globale_daten_nummer_unique` ON `globale_daten` (`nummer`);