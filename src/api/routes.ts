import { getPeakHistoryRecords } from './controllers/history.controller.js';
import { sendPacket } from './controllers/packet.controller.js';
import { getPeakRankInfo, getVoteInfo } from './controllers/peak.controller.js';
import {
  getAutoCardRankInfo,
  getBookAndAchieveRankInfo,
} from './controllers/rank.controller.js';
import {
  getTeamInfo,
  getUserBagPetInfo,
  getUserInfo,
  getUserOnlineStatus,
} from './controllers/user.controller.js';
import { getWishInfo } from './controllers/wish.controller.js';
import { Hono } from 'hono';

const router = new Hono();

router.get('/users/:account', getUserInfo);
router.get('/users/:account/online-status', getUserOnlineStatus);
router.get('/users/:userId/bag-pets', getUserBagPetInfo);
router.get('/teams/:teamId', getTeamInfo);

router.get('/votes', getVoteInfo);
router.get('/peak/rank', getPeakRankInfo);
router.get('/peak/history', getPeakHistoryRecords);

router.get('/rankings/book-achievement', getBookAndAchieveRankInfo);
router.get('/rankings/auto-card', getAutoCardRankInfo);
router.get('/wishes', getWishInfo);

router.post('/packets/send', sendPacket);

export default router;
