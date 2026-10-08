CREATE TABLE `einstellungen` (
	`schluessel` text PRIMARY KEY NOT NULL,
	`wert` text NOT NULL,
	`geaendert` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
