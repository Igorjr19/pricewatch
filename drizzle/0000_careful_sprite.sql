CREATE TABLE `fetch_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`run_id` text,
	`started_at` text NOT NULL,
	`duration_ms` integer,
	`strategy` text NOT NULL,
	`outcome` text NOT NULL,
	`http_status` integer,
	`error_message` text,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`adapter_id` text NOT NULL,
	`url` text NOT NULL,
	`external_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`check_interval_minutes` integer,
	`next_check_at` text NOT NULL,
	`last_checked_at` text,
	`last_success_at` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_url_unique` ON `listings` (`url`);--> statement-breakpoint
CREATE INDEX `listings_status_next_check_idx` ON `listings` (`status`,`next_check_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text,
	`listing_id` text,
	`observation_id` text,
	`channel` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`payload` text,
	`error_message` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`observation_id`) REFERENCES `observations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`observed_at` text NOT NULL,
	`price_cents` integer,
	`pix_price_cents` integer,
	`effective_price_cents` integer,
	`installment_count` integer,
	`installment_price_cents` integer,
	`in_stock` integer NOT NULL,
	`seller` text,
	`title` text,
	`strategy` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `observations_listing_observed_idx` ON `observations` (`listing_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`type` text NOT NULL,
	`params` text NOT NULL,
	`channels` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`cooldown_minutes` integer,
	`state` text,
	`last_triggered_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `run_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`listings_due` integer DEFAULT 0 NOT NULL,
	`listings_checked` integer DEFAULT 0 NOT NULL,
	`successes` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`notifications_sent` integer DEFAULT 0 NOT NULL
);
