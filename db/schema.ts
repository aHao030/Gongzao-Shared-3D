import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('platform_workspaces', {
  owner: text('owner').primaryKey(),
  revision: integer('revision').notNull(),
  data: text('data').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
