CREATE TABLE `runden` (
	`lap_id` text PRIMARY KEY NOT NULL,
	`besucher_guid` text NOT NULL,
	`platz` integer NOT NULL,
	`race_id` text,
	`event_id` text,
	`event_name` text,
	`identity_namespace` text,
	`pseudonym` text,
	`installation_label` text,
	`is_anonymous` integer,
	`lane_number` integer,
	`target_lap_count` integer,
	`lap_number` integer,
	`started_utc_ms` integer,
	`local_date` text,
	`local_utc_offset_minutes` integer,
	`duration_ms` integer NOT NULL,
	`angelegt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`besucher_guid`) REFERENCES `besucher`(`guid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runden_besucher_idx` ON `runden` (`besucher_guid`);--> statement-breakpoint
CREATE UNIQUE INDEX `runden_platz` ON `runden` (`besucher_guid`,`platz`);