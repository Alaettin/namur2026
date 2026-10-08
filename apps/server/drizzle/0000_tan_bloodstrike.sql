CREATE TABLE `abrufe` (
	`id` text PRIMARY KEY NOT NULL,
	`zeitpunkt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`endpunkt` text NOT NULL,
	`item_id` text,
	`status` integer NOT NULL,
	`dauer_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `abrufe_zeitpunkt_idx` ON `abrufe` (`zeitpunkt`);--> statement-breakpoint
CREATE TABLE `ansprechpartner` (
	`id` text PRIMARY KEY NOT NULL,
	`vorname` text NOT NULL,
	`nachname` text NOT NULL,
	`firma` text,
	`position` text,
	`email` text,
	`strasse` text,
	`plz` text,
	`ort` text,
	`land` text,
	`website` text,
	`angelegt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`geaendert` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_nutzer` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`passwort_hash` text NOT NULL,
	`rolle` text NOT NULL,
	`aktiv` integer DEFAULT true NOT NULL,
	`angelegt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`zuletzt_angemeldet` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_nutzer_email_unique` ON `app_nutzer` (`email`);--> statement-breakpoint
CREATE INDEX `app_nutzer_email_idx` ON `app_nutzer` (`email`);--> statement-breakpoint
CREATE TABLE `besucher` (
	`guid` text PRIMARY KEY NOT NULL,
	`vorname` text NOT NULL,
	`nachname` text NOT NULL,
	`firma` text,
	`position` text,
	`email` text,
	`strasse` text,
	`plz` text,
	`ort` text,
	`land` text,
	`website` text,
	`avatar_datei_id` text,
	`angelegt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`geaendert` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`avatar_datei_id`) REFERENCES `dateien`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `dateien` (
	`id` text PRIMARY KEY NOT NULL,
	`pfad` text NOT NULL,
	`mime_type` text NOT NULL,
	`groesse` integer NOT NULL,
	`original_name` text NOT NULL,
	`sha256` text NOT NULL,
	`angelegt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exponat_ansprechpartner` (
	`exponat_id` text NOT NULL,
	`ansprechpartner_id` text NOT NULL,
	`platz` integer NOT NULL,
	FOREIGN KEY (`exponat_id`) REFERENCES `exponate`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ansprechpartner_id`) REFERENCES `ansprechpartner`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exponat_ansprechpartner_person_idx` ON `exponat_ansprechpartner` (`ansprechpartner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `exponat_ansprechpartner_platz` ON `exponat_ansprechpartner` (`exponat_id`,`platz`);--> statement-breakpoint
CREATE UNIQUE INDEX `exponat_ansprechpartner_paar` ON `exponat_ansprechpartner` (`exponat_id`,`ansprechpartner_id`);--> statement-breakpoint
CREATE TABLE `exponat_betreuer` (
	`exponat_id` text NOT NULL,
	`app_nutzer_id` text NOT NULL,
	FOREIGN KEY (`exponat_id`) REFERENCES `exponate`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_nutzer_id`) REFERENCES `app_nutzer`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exponat_betreuer_nutzer_idx` ON `exponat_betreuer` (`app_nutzer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `exponat_betreuer_paar` ON `exponat_betreuer` (`exponat_id`,`app_nutzer_id`);--> statement-breakpoint
CREATE TABLE `exponat_dokumente` (
	`id` text PRIMARY KEY NOT NULL,
	`exponat_id` text NOT NULL,
	`platz` integer NOT NULL,
	`datei_id` text NOT NULL,
	`titel` text NOT NULL,
	`beschreibung` text,
	FOREIGN KEY (`exponat_id`) REFERENCES `exponate`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`datei_id`) REFERENCES `dateien`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exponat_dokumente_platz` ON `exponat_dokumente` (`exponat_id`,`platz`);--> statement-breakpoint
CREATE TABLE `exponat_links` (
	`id` text PRIMARY KEY NOT NULL,
	`exponat_id` text NOT NULL,
	`platz` integer NOT NULL,
	`url` text NOT NULL,
	`titel` text NOT NULL,
	FOREIGN KEY (`exponat_id`) REFERENCES `exponate`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exponat_links_platz` ON `exponat_links` (`exponat_id`,`platz`);--> statement-breakpoint
CREATE TABLE `exponate` (
	`id` text PRIMARY KEY NOT NULL,
	`kennung` text NOT NULL,
	`name` text NOT NULL,
	`beschreibung` text,
	`angelegt` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exponate_kennung_unique` ON `exponate` (`kennung`);--> statement-breakpoint
CREATE TABLE `zuordnungen` (
	`id` text PRIMARY KEY NOT NULL,
	`besucher_guid` text NOT NULL,
	`exponat_id` text NOT NULL,
	`art` text NOT NULL,
	`ziel_id` text NOT NULL,
	`app_nutzer_id` text NOT NULL,
	`zeitpunkt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`besucher_guid`) REFERENCES `besucher`(`guid`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exponat_id`) REFERENCES `exponate`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_nutzer_id`) REFERENCES `app_nutzer`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `zuordnungen_besucher_idx` ON `zuordnungen` (`besucher_guid`);--> statement-breakpoint
CREATE INDEX `zuordnungen_exponat_idx` ON `zuordnungen` (`exponat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `zuordnungen_eindeutig` ON `zuordnungen` (`besucher_guid`,`art`,`ziel_id`);