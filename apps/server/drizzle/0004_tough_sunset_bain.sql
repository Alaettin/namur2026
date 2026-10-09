CREATE TABLE `avatare` (
	`datei_id` text PRIMARY KEY NOT NULL,
	`sortierung` integer NOT NULL,
	`angelegt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`datei_id`) REFERENCES `dateien`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `ansprechpartner` ADD `titel` text;--> statement-breakpoint
ALTER TABLE `besucher` ADD `titel` text;