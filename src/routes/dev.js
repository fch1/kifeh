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

// Déclenche le brief quotidien SANS attendre 7 h (tests uniquement — ce
// routeur n'est jamais monté en production).
devRouter.post('/run-digest', async (req, res) => {
  const { sendDailyDigests } = await import('../services/emailAlerts.js');
  res.json(await sendDailyDigests({ force: true }));
});
