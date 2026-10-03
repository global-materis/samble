import { int, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

// `int().autoincrement()` and not `serial()`: Drizzle Kit writes a serial as
// `serial AUTO_INCREMENT`, which MySQL takes and MariaDB refuses.
export const notes = mysqlTable('notes', {
  id: int('id').autoincrement().primaryKey(),
  text: varchar('text', { length: 255 }).notNull(),
});
