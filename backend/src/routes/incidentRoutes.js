import { Router } from 'express';
import { getIncident, listIncidents, createIncident, advanceStep, resolveIncident, getIncidentReport, saveIncidentReport, signIncidentReport, createNotaDinas, incidentQueue, dutyStatus, takeIncident, setAwaitingPart, remindIncident, addIncidentNote, listTeknisi, inviteCollaborators } from '../controllers/incidentController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { withIncidentDoc } from '../middleware/upload.js';

const router = Router();
router.use(requireAuth);
router.get('/', listIncidents);
router.get('/queue', incidentQueue);
router.get('/duty-status', dutyStatus);
router.get('/teknisi-list', listTeknisi);
router.post('/:id/collaborators', inviteCollaborators);
router.post('/', createIncident);
router.post('/:id/take', takeIncident);
router.put('/:id/awaiting-part', setAwaitingPart);
router.post('/:id/advance', withIncidentDoc, advanceStep);
router.post('/:id/remind', requireRole('koordinator', 'admin'), remindIncident);
router.post('/:id/note', addIncidentNote);
router.post('/:id/resolve', resolveIncident);
router.get('/:id', getIncident);
router.get('/:id/report', getIncidentReport);
router.put('/:id/report', saveIncidentReport);
router.post('/:id/report/sign', requireRole('koordinator', 'admin'), signIncidentReport);
router.post('/:id/nota-dinas', requireRole('koordinator', 'admin'), createNotaDinas);

export default router;
