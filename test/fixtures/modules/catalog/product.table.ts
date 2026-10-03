import { integer, pgTable, text } from 'drizzle-orm/pg-core';

export const productos = pgTable('productos_demo', {
  id: integer('id').primaryKey(),
  nombre: text('nombre').notNull(),
});
