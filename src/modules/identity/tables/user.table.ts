import { pgEnum, pgTable, serial, text } from 'drizzle-orm/pg-core';

/**
 * Roles this demo knows. The mapping to permissions is the APPLICATION's, in
 * `src/config/roles.ts`: the module declares which keys exist, not who holds
 * them.
 *
 * Exported, and not only used by the column below: a schema that does not carry
 * the enum generates DDL that references a type nothing creates.
 */
export const userRole = pgEnum('demo_user_role', ['owner', 'staff']);

export type UserRole = (typeof userRole.enumValues)[number];

export const users = pgTable('demo_users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  fullName: text('full_name').notNull(),
  /** `salt:hash`, see `services/password.ts`. */
  password: text('password').notNull(),
  role: userRole('role').notNull().default('staff'),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
