/**
 * OrderVideoPage — Stream Video SDK removed.
 * This stub redirects to the standalone Video Meet page.
 */
import { Navigate } from "react-router";

function OrderVideoPage() {
  return <Navigate to="/meet" replace />;
}

export default OrderVideoPage;
