import { ConfigService } from '../../lib';

/** Una entrada que falla por configuración, para probar `samble doctor`. */
export async function createApp() {
  ConfigService.require(['DOCTOR_FALTA_A', 'DOCTOR_FALTA_B']);
  throw new Error('no debería llegar acá');
}
