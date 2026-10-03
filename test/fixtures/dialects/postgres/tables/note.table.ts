import { pgTable, serial, text } from 'drizzle-orm/pg-core';

export const notes = pgTable('notes', {
  id: serial('id').primaryKey(),
  text: text('text').notNull(),
});
