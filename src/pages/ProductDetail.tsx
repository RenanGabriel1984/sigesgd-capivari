import { useParams, Link, useNavigate } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Package,
  Tag,
  BarChart3,
  Clock,
  User,
  Boxes,
} from "lucide-react";
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPE_COLORS, type MovementType } from "@/types/constants";

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const product = useQuery(
    api.products.getById,
    id ? { id: id as any } : "skip"
  );

  if (product === undefined) {
    return (
      <AppShell>
        <div className="max-w-5xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 bg-muted rounded" />
            <div className="h-64 bg-muted rounded-lg" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (product === null) {
    return (
      <AppShell>
        <div className="max-w-5xl mx-auto text-center py-20">
          <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Product not found</h2>
          <p className="text-muted-foreground mb-6">
            The product you are looking for does not exist or has been removed.
          </p>
          <Button asChild>
            <Link to="/products">Back to Catalog</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const stock = product.stock;
  const physical = stock.physicalQuantity;
  const reserved = stock.reservedQuantity;
  const available = physical - reserved;
  const maxStock = product.maximumStock || 100;
  const stockPercentage = Math.min(100, (physical / maxStock) * 100);
  const isLow = physical < product.minimumStock;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Back button */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 -ml-1"
          onClick={() => navigate("/products")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Catalog
        </Button>

        {/* Product header */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                <Package className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight truncate">
                  {product.name}
                </h1>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  {product.category && (
                    <Badge variant="secondary" className="text-xs">
                      <Tag className="h-3 w-3 mr-1" />
                      {product.category.name}
                    </Badge>
                  )}
                  <Badge variant={product.active ? "default" : "secondary"} className="text-[10px]">
                    {product.active ? "Active" : "Inactive"}
                  </Badge>
                  {isLow && (
                    <Badge variant="destructive" className="text-[10px]">
                      Low Stock
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stock overview */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-border/50">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Boxes className="h-4.5 w-4.5" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Physical Stock</span>
              </div>
              <p className="text-3xl font-bold">{physical}</p>
              <p className="text-xs text-muted-foreground mt-1">
                of {maxStock} maximum
              </p>
              <Progress value={stockPercentage} className="h-1.5 mt-3" />
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                  <Clock className="h-4.5 w-4.5" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Reserved</span>
              </div>
              <p className="text-3xl font-bold">{reserved}</p>
              <p className="text-xs text-muted-foreground mt-1">
                committed to approved requests
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <BarChart3 className="h-4.5 w-4.5" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Available</span>
              </div>
              <p className="text-3xl font-bold">{available}</p>
              <p className="text-xs text-muted-foreground mt-1">
                ready for new requests
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Product details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                {product.description && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Description</dt>
                    <dd className="text-sm mt-0.5">{product.description}</dd>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">Internal Code</dt>
                    <dd className="text-sm font-mono mt-0.5">{product.internalCode || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Unit</dt>
                    <dd className="text-sm mt-0.5">{product.unitOfMeasure}</dd>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">Manufacturer</dt>
                    <dd className="text-sm mt-0.5">{product.manufacturer || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Model</dt>
                    <dd className="text-sm mt-0.5">{product.model || "—"}</dd>
                  </div>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Stock Thresholds</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-muted-foreground">Minimum</dt>
                  <dd className="text-sm font-semibold">{product.minimumStock} {product.unitOfMeasure}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-muted-foreground">Ideal</dt>
                  <dd className="text-sm font-semibold">{product.idealStock} {product.unitOfMeasure}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-muted-foreground">Maximum</dt>
                  <dd className="text-sm font-semibold">{product.maximumStock} {product.unitOfMeasure}</dd>
                </div>
                {product.observation && (
                  <div className="pt-2 border-t border-border/50">
                    <dt className="text-xs text-muted-foreground">Notes</dt>
                    <dd className="text-sm mt-0.5">{product.observation}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>
        </div>

        {/* Recent movements */}
        {product.recentMovements && product.recentMovements.length > 0 && (
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {product.recentMovements.map((m) => (
                  <div
                    key={m._id}
                    className="flex items-center justify-between py-2 border-b border-border/30 last:border-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {m.user?.name ?? "System"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(m.timestamp).toLocaleString("pt-BR")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <Badge
                        variant="secondary"
                        className={MOVEMENT_TYPE_COLORS[m.type as MovementType]}
                      >
                        {MOVEMENT_TYPE_LABELS[m.type as MovementType]}
                      </Badge>
                      <span className="font-mono text-sm font-semibold">
                        {m.type === "entry" || m.type === "return" ? "+" : m.type === "exit" ? "-" : ""}
                        {m.quantity}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
