import { Router } from "express";
import { getOrder, listOrders, getOrderTracking, cancelOrderShipment } from "../controllers/orderController";

const router = Router();

router.get("/", listOrders);
router.get("/:id", getOrder);
router.get("/:id/tracking", getOrderTracking);
router.post("/:id/cancel-shipment", cancelOrderShipment);

export default router;
