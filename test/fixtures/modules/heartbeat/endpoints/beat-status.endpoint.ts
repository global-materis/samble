import { Endpoint, HttpGet, Group } from '../../../../../lib';
import { Heartbeat } from '../shared';

/**
 * Existe para una sola cosa: probar que el Scheduler LLEGA a un endpoint.
 *
 * Es el camino que se rompe en silencio — el campo se asigna sobre el prototipo
 * desde `endpoint-handler`, así que un nombre que no coincide compila igual y
 * deja `this.schedule()` tirando "esta aplicación no tiene horarios".
 */
@Group('latido')
@HttpGet('/estado')
export class BeatStatusEndpoint extends Endpoint {
  async main() {
    const horario = this.schedule(Heartbeat);
    return {
      programado: horario.isScheduled(),
      ejecutando: horario.isExecuting(),
    };
  }
}
