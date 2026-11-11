import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, check, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('platform_workspaces', {
  owner: text('owner').primaryKey(),
  revision: integer('revision').notNull(),
  data: text('data').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const adminControl = sqliteTable('platform_admin_control', {
  id: integer('id').primaryKey(),
  etag: integer('etag').notNull(),
  data: text('data').notNull(),
}, table => [check('one_admin_control_record', sql`${table.id} = 1`)]);

export const tradeShops = sqliteTable('platform_trade_shops', {
  id: text('id').primaryKey(), merchantId: text('merchant_id').notNull().unique(),
  owner: text('owner').notNull(), name: text('name').notNull(), enabled: integer('enabled').notNull(),
  revision: integer('revision').notNull(), receipts: text('receipts').notNull()
}, t => [index('trade_visible_shops').on(t.enabled, t.id)]);

export const tradeThreads = sqliteTable('platform_trade_threads', {
  id: text('id').primaryKey(), shopId: text('shop_id').notNull(), buyerId: text('buyer_id').notNull(),
  merchantId: text('merchant_id').notNull(), buyerOwner: text('buyer_owner').notNull(),
  createKey: text('create_key').notNull(), createDigest: text('create_digest').notNull(),
  revision: integer('revision').notNull(), lastSeq: integer('last_seq').notNull(), updatedAt: integer('updated_at').notNull(),
  buyerRead: integer('buyer_read').notNull(), merchantRead: integer('merchant_read').notNull(),
  buyerUnread: integer('buyer_unread').notNull(), merchantUnread: integer('merchant_unread').notNull(),
  summary: text('summary').notNull(), data: text('data').notNull()
}, t => [
  uniqueIndex('trade_create_retry').on(t.buyerId,t.createKey),
  index('trade_buyer_inbox').on(t.buyerId,t.updatedAt,t.id),
  index('trade_merchant_inbox').on(t.merchantId,t.updatedAt,t.id)
]);
