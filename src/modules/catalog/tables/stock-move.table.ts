import { integer, pgTable, serial, timestamp } from 'drizzle-orm/pg-core';
import { users } from '@/identity/tables/user.table';
import { products } from './product.table';

/**
 * Exists so the demo has a case that genuinely needs a transaction: restocking
 * writes the product AND its movement, and half of that is worse than neither.
 */
export const stockMoves = pgTable('demo_stock_moves', {
  id: serial('id').primaryKey(),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  quantity: integer('quantity').notNull(),
  /**
   * Who did it — a real foreign key, although `identity` owns that table.
   *
   * samble does not restrict relations across modules: `catalog` already
   * declares `requires: ['identity']`, so the resolver refuses to run without
   * it and the migrator runs identity's migrations first. Whether a reference
   * should be a constraint is the application's call, not the framework's.
   */
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type StockMove = typeof stockMoves.$inferSelect;
export type NewStockMove = typeof stockMoves.$inferInsert;
