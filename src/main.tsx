import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Lazy load route components
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Products = lazy(() => import("./pages/Products.tsx"));
const ProductDetail = lazy(() => import("./pages/ProductDetail.tsx"));
const Categories = lazy(() => import("./pages/Categories.tsx"));
const Stock = lazy(() => import("./pages/Stock.tsx"));
const Entries = lazy(() => import("./pages/Entries.tsx"));
const Lots = lazy(() => import("./pages/Lots.tsx"));
const StorageLocationsPage = lazy(() => import("./pages/StorageLocations.tsx"));
const InventoryPage = lazy(() => import("./pages/Inventory.tsx"));
const Requests = lazy(() => import("./pages/Requests.tsx"));
const ReturnsPage = lazy(() => import("./pages/Returns.tsx"));
const StockTransfersPage = lazy(() => import("./pages/StockTransfers.tsx"));
const GomaQPage = lazy(() => import("./pages/GomaQ.tsx"));
const AssetsPage = lazy(() => import("./pages/Assets.tsx"));
const AssetDetailPage = lazy(() => import("./pages/AssetDetail.tsx"));
const LicensesPage = lazy(() => import("./pages/Licenses.tsx"));
const Movements = lazy(() => import("./pages/Movements.tsx"));
const Organization = lazy(() => import("./pages/Organization.tsx"));
const UsersPage = lazy(() => import("./pages/Users.tsx"));
const Suppliers = lazy(() => import("./pages/Suppliers.tsx"));
const PrintersPage = lazy(() => import("./pages/Printers.tsx"));
const Reports = lazy(() => import("./pages/Reports.tsx"));
const Audit = lazy(() => import("./pages/Audit.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: Error) { console.warn("[VlyToolbar] Caught error:", err.message); }
  render() { return this.state.hasError ? null : this.props.children; }
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message || "Unknown error", stack: error.stack || "" };
  }
  componentDidCatch(err: Error) { console.error("[Preview] Root crash:", err); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">{this.state.message}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage({ type: "iframe-route-change", path: location.pathname }, "*");
  }, [location.pathname]);
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/auth" element={<AuthPage redirectAfterAuth="/dashboard" />} />
              {/* Protected routes */}
              <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
              <Route path="/stock" element={<RequireAuth><Stock /></RequireAuth>} />
              <Route path="/products" element={<RequireAuth><Products /></RequireAuth>} />
              <Route path="/products/:id" element={<RequireAuth><ProductDetail /></RequireAuth>} />
              <Route path="/categories" element={<RequireAuth><Categories /></RequireAuth>} />
              <Route path="/entries" element={<RequireAuth><Entries /></RequireAuth>} />
              <Route path="/lots" element={<RequireAuth><Lots /></RequireAuth>} />
              <Route path="/storage-locations" element={<RequireAuth><StorageLocationsPage /></RequireAuth>} />
              <Route path="/inventory" element={<RequireAuth><InventoryPage /></RequireAuth>} />
              <Route path="/requests" element={<RequireAuth><Requests /></RequireAuth>} />
              <Route path="/returns" element={<RequireAuth><ReturnsPage /></RequireAuth>} />
              <Route path="/transfers" element={<RequireAuth><StockTransfersPage /></RequireAuth>} />
              <Route path="/gomaq" element={<RequireAuth><GomaQPage /></RequireAuth>} />
              <Route path="/assets" element={<RequireAuth><AssetsPage /></RequireAuth>} />
              <Route path="/assets/:id" element={<RequireAuth><AssetDetailPage /></RequireAuth>} />
              <Route path="/licenses" element={<RequireAuth><LicensesPage /></RequireAuth>} />
              <Route path="/movements" element={<RequireAuth><Movements /></RequireAuth>} />
              <Route path="/organization" element={<RequireAuth><Organization /></RequireAuth>} />
              <Route path="/users" element={<RequireAuth><UsersPage /></RequireAuth>} />
              <Route path="/suppliers" element={<RequireAuth><Suppliers /></RequireAuth>} />
              <Route path="/printers" element={<RequireAuth><PrintersPage /></RequireAuth>} />
              <Route path="/reports" element={<RequireAuth><Reports /></RequireAuth>} />
              <Route path="/audit" element={<RequireAuth><Audit /></RequireAuth>} />
              <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
