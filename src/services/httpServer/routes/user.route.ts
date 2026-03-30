import express from "express";
import {
  getUserOnlineStatus,
  getUserInfo,
  getTeamInfo,
} from "../controllers/user.controller";

const router: express.Router = express.Router();

router.get("/getUserOnlineStatus", getUserOnlineStatus);
router.get("/getUserInfo", getUserInfo);
router.get("/getTeamInfo", getTeamInfo);

export default router;
