import { sql } from 'drizzle-orm';
import type { Migration, Transaction } from 'samble';

export class CreateProducts1758000100000 implements Migration {
  public async up(db: Transaction): Promise<void> {
    await db.execute(
      sql.raw(`
        create table demo_products (
          id serial primary key,
          name text not null,
          stock int not null default 0,
          enabled boolean not null default true
        )
      `),
    );

    await db.execute(
      sql.raw(`
        create table demo_stock_moves (
          id serial primary key,
          product_id int not null references demo_products(id),
          quantity int not null,
          user_id int not null references demo_users(id),
          created_at timestamptz not null default now()
        )
      `),
    );

    await db.execute(sql`
      insert into demo_products (name, stock)
      values (${'Antenna 5GHz'}, ${12}), (${'PoE Injector'}, ${40})
    `);
  }

  public async down(db: Transaction): Promise<void> {
    await db.execute(sql.raw('drop table demo_stock_moves'));
    await db.execute(sql.raw('drop table demo_products'));
  }
}
