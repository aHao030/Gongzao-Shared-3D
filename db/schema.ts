import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, check } from 'drizzle-orm/sqlite-core';

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
