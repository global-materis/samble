import { sql } from 'drizzle-orm';
import type { Migration, Transaction } from '@samble/core';
import { hashPassword } from '../services/password';

/**
 * The class name ENDS IN A TIMESTAMP, and that is not decoration: samble orders
 * a module's migrations by it, and refuses to start without one.
 */
export class CreateUsers1758000000000 implements Migration {
  public async up(db: Transaction): Promise<void> {
    await db.execute(
      sql.raw(`
        create type demo_user_role as enum ('owner', 'staff')
      `),
    );

    await db.execute(
      sql.raw(`
        create table demo_users (
          id serial primary key,
          username text not null unique,
          full_name text not null,
          password text not null,
          role demo_user_role not null default 'staff'
        )
      `),
    );

    // Seeding from a migration keeps the demo runnable with one command. Note
    // the values are INTERPOLATED, not pasted: `sql` parameterizes them, which
    // is the difference between a seed and an injection.
    await db.execute(sql`
      insert into demo_users (username, full_name, password, role)
      values
        ('owner', 'Demo Owner', ${hashPassword('demo1234')}, 'owner'),
        ('staff', 'Demo Staff', ${hashPassword('demo1234')}, 'staff')
    `);
  }

  public async down(db: Transaction): Promise<void> {
    await db.execute(sql.raw('drop table demo_users'));
    await db.execute(sql.raw('drop type demo_user_role'));
  }
}
