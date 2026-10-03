import { boolean, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

export const products = pgTable('demo_products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  stock: integer('stock').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
});

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
