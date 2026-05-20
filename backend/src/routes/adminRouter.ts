import { Router } from "express";
import {
  createAdminProduct,
  deleteAdminProduct,
  listAdminProducts,
  requireAdmin,
  updateAdminProduct,
  uploadProductImage,
} from "../controllers/adminController.js";
import supportRouter from "./supportRouter.js";
import shipmentRouter from "./shipmentRouter.js";

const router = Router();

router.use(requireAdmin);

router.post("/upload", uploadProductImage);
router.get("/products", listAdminProducts);
router.post("/products", createAdminProduct);
router.patch("/products/:id", updateAdminProduct);
router.delete("/products/:id", deleteAdminProduct);

// Support session history & analytics (admin only)
router.use("/support", supportRouter);

// Shipment management (admin only)
router.use("/shipments", shipmentRouter);

export default router;
