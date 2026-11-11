CREATE TABLE `platform_admin_control` (
	`id` integer PRIMARY KEY NOT NULL,
	`etag` integer NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT "one_admin_control_record" CHECK("platform_admin_control"."id" = 1)
);
