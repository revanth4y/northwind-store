import { Show, SignInButton, useAuth } from "@clerk/react";
import PageLoader from "./components/PageLoader";
import Layout from "./components/Layout";
import { Routes, Route, Navigate } from "react-router";

import HomePage from "./pages/HomePage";
import CartPage from "./pages/CartPage";
import OrdersPage from "./pages/OrdersPage";
import CheckoutReturnPage from "./pages/CheckoutReturnPage";
import ProductDetailPage from "./pages/ProductDetailPage";
import { SentryDemoPage } from "./pages/SentryDemoPage";
import OrderDetailPage from "./pages/OrderDetailPage";
import OrderSummaryPage from "./pages/OrderSummaryPage";
import AdminProductsPage from "./pages/AdminProductsPage";
import VideoConferencePage from "./pages/VideoConferencePage";
import SupportPortalPage from "./pages/SupportPortalPage";
import NewTicketPage from "./pages/NewTicketPage";
import TicketDetailPage from "./pages/TicketDetailPage";
import AdminTicketsPage from "./pages/AdminTicketsPage";
import AdminTicketDetailPage from "./pages/AdminTicketDetailPage";
import AdminShipmentsPage from "./pages/AdminShipmentsPage";
import TrackOrderPage from "./pages/TrackOrderPage";

function App() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return <PageLoader />;

  return (
    <Routes>
      {/* ── Full-screen standalone page (no navbar / footer) ── */}
      <Route path="/meet" element={<VideoConferencePage />} />

      {/* ── All other pages wrapped in the shared Layout ── */}
      <Route
        path="*"
        element={
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/cart" element={<CartPage />} />
              <Route path="/product/:slug" element={<ProductDetailPage />} />

              <Route
                path="/orders"
                element={isSignedIn ? <OrdersPage /> : <Navigate to="/" replace />}
              />
              <Route path="/checkout/return" element={<CheckoutReturnPage />} />
              <Route path="/demo-sentry" element={<SentryDemoPage />} />

              <Route
                path="/admin"
                element={isSignedIn ? <AdminProductsPage /> : <Navigate to="/" replace />}
              />
              <Route
                path="/admin/tickets"
                element={isSignedIn ? <AdminTicketsPage /> : <Navigate to="/" replace />}
              />
              <Route
                path="/admin/tickets/:id"
                element={isSignedIn ? <AdminTicketDetailPage /> : <Navigate to="/" replace />}
              />
              <Route
                path="/admin/shipments"
                element={isSignedIn ? <AdminShipmentsPage /> : <Navigate to="/" replace />}
              />

              {/* Support portal */}
              <Route
                path="/support"
                element={isSignedIn ? <SupportPortalPage /> : <Navigate to="/" replace />}
              />
              <Route
                path="/support/tickets/new"
                element={isSignedIn ? <NewTicketPage /> : <Navigate to="/" replace />}
              />
              <Route
                path="/support/tickets/:id"
                element={isSignedIn ? <TicketDetailPage /> : <Navigate to="/" replace />}
              />

              {/* Nested order detail — summary only (chat removed with Stream) */}
              <Route path="/orders/:id" element={<OrderDetailPage />}>
                <Route index element={<OrderSummaryPage />} />
              </Route>

              {/* Shipment tracking */}
              <Route
                path="/orders/:id/track"
                element={isSignedIn ? <TrackOrderPage /> : <Navigate to="/" replace />}
              />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  );
}

export default App;
