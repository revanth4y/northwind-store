import { Router } from "express";
import { getSupportStats, listSupportSessions } from "../controllers/supportController.js";

const router = Router();

// All routes here are already protected by requireAdmin (applied in adminRouter)
router.get("/stats",    getSupportStats);
router.get("/sessions", listSupportSessions);

export default router;
