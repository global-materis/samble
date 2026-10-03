import { ConfigService } from '../../lib';
import connectPgSimple from 'connect-pg-simple';
import { Express } from 'express';
import session from 'express-session';
import type { Pool } from 'pg';

/**
 * Cookie sessions in this demo's Postgres, over the SAME pool samble opened
 * (`app.db.$client`): no second connection. The store package is the
 * application's choice because the engine is — samble installs none.
 */
export default function enableSession(app: Express, pool: Pool) {
  const PgSession = connectPgSimple(session);

  const store = new PgSession({
    tableName: 'session',
    pool,
    createTableIfMissing: true,
  });

  const isProd = app.get('env') === 'production';
  app.set('trust proxy', 1);

  return session({
    store,
    secret: ConfigService.get('SECRET_KEY'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 1,
      secure: isProd,
      httpOnly: true,
      sameSite: isProd ? 'none' : 'lax',
    },
  });
}
