/**
 * Un ConfigError de OTRA copia del módulo.
 *
 * Es lo que pasa de verdad con un `npm link`, un monorepo, dos versiones de
 * samble en el árbol, o el código fuente corriendo al lado de un build:
 * `instanceof` da falso contra un error que SÍ lo es. Por eso el nombre.
 */
export async function createApp() {
  const ajeno = new Error('Missing environment variables: DE_OTRA_COPIA.');
  ajeno.name = 'ConfigError';
  throw ajeno;
}
