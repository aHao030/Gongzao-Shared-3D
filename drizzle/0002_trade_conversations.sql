CREATE TABLE `platform_trade_shops` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer NOT NULL,
	`revision` integer NOT NULL,
	`receipts` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_trade_shops_merchant_id_unique` ON `platform_trade_shops` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `trade_visible_shops` ON `platform_trade_shops` (`enabled`,`id`);--> statement-breakpoint
CREATE TABLE `platform_trade_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`buyer_owner` text NOT NULL,
	`create_key` text NOT NULL,
	`create_digest` text NOT NULL,
	`revision` integer NOT NULL,
	`last_seq` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`buyer_read` integer NOT NULL,
	`merchant_read` integer NOT NULL,
	`buyer_unread` integer NOT NULL,
	`merchant_unread` integer NOT NULL,
	`summary` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_create_retry` ON `platform_trade_threads` (`buyer_id`,`create_key`);--> statement-breakpoint
CREATE INDEX `trade_buyer_inbox` ON `platform_trade_threads` (`buyer_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `trade_merchant_inbox` ON `platform_trade_threads` (`merchant_id`,`updated_at`,`id`);