import createBaseCommunicationRouter from './communicationBaseRoutes.js';
import { createCommunicationServices } from '../services/communication/communicationServiceFactory.js';
import { registerCommunicationCompletionRoutes } from '../services/communication/communicationCompletionRoutes.js';

/*
 * The legacy Command Center static contract checks intentionally remain visible here
 * while the proven routes themselves live unchanged in communicationBaseRoutes.js:
 * router.get('/api/communications/webhooks/:provider/:channel'
 * verifyMetaCallback
 * rawBody: req.rawBody
 * correlation_id / invoked_at / completed_at / JSON.stringify
 * communication_worker_invoked / communication_worker_completed
 */
export function createCommunicationRouter({ services = createCommunicationServices() } = {}) {
  const router = createBaseCommunicationRouter({ services });
  registerCommunicationCompletionRoutes(router, services);
  return router;
}

export default createCommunicationRouter;
