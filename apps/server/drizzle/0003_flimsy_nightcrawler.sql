CREATE TABLE `konnektor_abrufe` (
	`guid` text PRIMARY KEY NOT NULL,
	`hierarchy` integer DEFAULT 0 NOT NULL,
	`werte` integer DEFAULT 0 NOT NULL,
	`dokumente` integer DEFAULT 0 NOT NULL,
	`zuerst` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`zuletzt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`guid`) REFERENCES `besucher`(`guid`) ON UPDATE no action ON DELETE cascade
);
