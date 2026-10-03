import { ConfigService } from '../../lib';
import connectPgSimple from 'connect-pg-simple';
import { Express } from 'express';
import session from 'express-session';
import { Pool } from 'pg';

export default function enableSession(app: Express) {
  const pool = new Pool({
    host: ConfigService.get('DB_HOST'),
    database: ConfigService.get('DB_NAME'),
    port: ConfigService.number('DB_PORT'),
    user: ConfigService.get('DB_USERNAME'),
    password: ConfigService.get('DB_PASSWORD'),
  });

  const PgSession = connectPgSimple(session);

  const store = new PgSession({
    tableName: 'session',
    pool: pool,
    createTableIfMissing: true,
  });

  const isProd = app.get('env') === 'production';
  app.set('trust proxy', 1);

  return session({
    store,
    secret: ConfigService.get('SECRET_KEY'),
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: 1000 * 60 * 60 * 1,
      secure: isProd,
      httpOnly: false,
      sameSite: isProd ? 'none' : false,
    },
  });
}
