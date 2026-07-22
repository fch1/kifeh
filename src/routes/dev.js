// Outils de développement — montés UNIQUEMENT hors production.
// Permet de consulter la boîte d'envoi simulée (OTP, liens) et de déclencher
// le scheduler manuellement pour les tests.
import { Router } from 'express';
import { devOutbox } from '../services/notifier.js';
import { tick } from '../services/scheduler.js';

export const devRouter = Router();

devRouter.get('/outbox', (req, res) => {
  res.json({ outbox: devOutbox.slice(-50).reverse() });
});

devRouter.post('/tick', async (req, res) => {
  await tick();
  res.json({ ok: true });
});
