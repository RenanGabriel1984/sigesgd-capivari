import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, Minus, Plus, MapPin, User, ChevronLeft, ChevronRight,
  CheckCircle2, PackageSearch, Building2, PackageCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { UNIT_LABELS } from "@/types/constants";
import { cn } from "@/lib/utils";

const REASONS = [
  "Atendimento de chamado",
  "Manutenção",
  "Instalação",
  "Substituição",
  "Consumo",
  "Outro",
] as const;

const STEPS = [
  "Material",
  "Quantidade",
  "Destino",
  "Motivo",
  "Confirmação",
];

type ProductRow = NonNullable<ReturnType<typeof useQuery<typeof api.products.listActive>>>[number];

export default function Exit() {
  const { user } = useAuth();
  const products = useQuery(api.products.listActive);
  const locSummary = useQuery(api.stockSetup.productLocationSummary);
  const users = useQuery(api.users.listUsers);
  const quickExit = useMutation(api.stockSetup.quickExit);

  const [step, setStep] = useState(0);
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [receiverId, setReceiverId] = useState<string>(user?._id ?? "");
  const [receiverName, setReceiverName] = useState(user?.name ?? "");
  const [secretaria, setSecretaria] = useState("");
  const [departamento, setDepartamento] = useState("");
  const [unidade, setUnidade] = useState("");
  const [locationId, setLocationId] = useState("");
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [osNumber, setOsNumber] = useState("");
  const [observation, setObservation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ product: string; quantity: number; newAvailable: number } | null>(null);

  const locationsByProduct = useMemo(() => {
    const map = new Map<string, Array<{ locationId: string; locationName: string; quantity: number }>>();
    for (const entry of locSummary ?? []) {
      map.set(entry.productId, entry.locations);
    }
    return map;
  }, [locSummary]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (products ?? []).filter((p) => {
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        (p.brand ?? "").toLowerCase().includes(term) ||
        (p.internalCode ?? "").toLowerCase().includes(term) ||
        (p.category?.name ?? "").toLowerCase().includes(term)
      );
    });
  }, [products, search]);

  const selectedProduct: ProductRow | undefined =
    products?.find((p) => p._id === productId) ?? undefined;

  const available = selectedProduct
    ? Math.max(0, (selectedProduct.stock?.physicalQuantity ?? 0) - (selectedProduct.stock?.reservedQuantity ?? 0))
    : 0;
  const qty = Math.max(0, Number(quantity) || 0);
  const afterExit = Math.max(0, available - qty);

  const activeUsers = (users ?? []).filter((u: any) => u.active !== false);
  const destination = [secretaria, departamento, unidade].filter(Boolean).join(" → ");

  if (products === undefined) {
    return (
      <AppShell>
        <div className="space-y-6 max-w-3xl mx-auto">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-12 w-full" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </AppShell>
    );
  }

  const pickProduct = (id: string) => {
    setProductId(id);
    const locs = locationsByProduct.get(id) ?? [];
    if (locs.length > 0 && !locs.some((l) => l.locationId === locationId)) {
      setLocationId(locs[0].locationId);
    }
    setStep(1);
  };

  const confirm = async () => {
    if (!selectedProduct) return;
    if (qty <= 0) { toast.error("Informe uma quantidade maior que zero"); return; }
    if (qty > available) { toast.error(`Disponível: ${available} ${UNIT_LABELS[selectedProduct.unitOfMeasure] ?? selectedProduct.unitOfMeasure}`); return; }
    setSubmitting(true);
    try {
      const res = await quickExit({
        productId: selectedProduct._id as any,
        quantity: qty,
        locationId: locationId ? (locationId as any) : undefined,
        destination: destination || "Não informado",
        receiverName: receiverName.trim() || (activeUsers.find((u: any) => u._id === receiverId)?.name ?? user?.name ?? "Não informado"),
        reason,
        osNumber: osNumber.trim() || undefined,
        observation: observation.trim() || undefined,
      });
      setResult({ product: selectedProduct.name, quantity: qty, newAvailable: res.newAvailable });
      setStep(4);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar saída");
    }
    setSubmitting(false);
  };

  const reset = () => {
    setStep(0); setSearch(""); setProductId(null); setQuantity("1");
    setSecretaria(""); setDepartamento(""); setUnidade(""); setLocationId("");
    setReason(REASONS[0]); setOsNumber(""); setObservation(""); setResult(null);
  };

  const next = () => setStep((s) => Math.min(s + 1, 4));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dar saída</h1>
          <p className="text-sm text-muted-foreground">
            Registre a retirada de um material do estoque
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1.5">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1">
              <div className={cn("h-1.5 rounded-full transition-colors", i <= step ? "bg-[var(--capivari-green)]" : "bg-muted")} />
              <p className={cn("text-[10px] mt-1 truncate", i === step ? "font-semibold text-[var(--capivari-green)]" : "text-muted-foreground")}>
                {label}
              </p>
            </div>
          ))}
        </div>

        {result ? (
          /* ─── Sucesso ─── */
          <Card className="border-emerald-200">
            <CardContent className="py-12 text-center space-y-3">
              <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-600" />
              <h2 className="text-xl font-bold">Saída registrada</h2>
              <p className="text-sm text-muted-foreground">
                {result.quantity} unidade(s) de <strong>{result.product}</strong>
              </p>
              <p className="text-sm">
                Saldo atual: <strong className="text-[var(--capivari-green)]">{result.newAvailable} unidade(s)</strong>
              </p>
              <Button className="mt-4 gap-2" onClick={reset}>
                <PackageCheck className="h-4 w-4" /> Fazer outra saída
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/50">
            <CardContent className="p-4 sm:p-6">
              {/* PASSO 1 — material */}
              {step === 0 && (
                <div className="space-y-4">
                  <div>
                    <Label className="text-base font-semibold">Qual material será retirado?</Label>
                    <div className="relative mt-2">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input
                        autoFocus
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Digite o nome do material..."
                        className="pl-10 h-12 text-base"
                      />
                    </div>
                  </div>
                  <div className="space-y-2 max-h-[420px] overflow-y-auto">
                    {filtered.length === 0 && (
                      <div className="text-center py-10 text-sm text-muted-foreground">
                        <PackageSearch className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                        Nenhum material encontrado
                      </div>
                    )}
                    {filtered.map((p) => {
                      const av = Math.max(0, (p.stock?.physicalQuantity ?? 0) - (p.stock?.reservedQuantity ?? 0));
                      const locs = locationsByProduct.get(p._id as string) ?? [];
                      return (
                        <button
                          key={p._id}
                          type="button"
                          onClick={() => pickProduct(p._id as string)}
                          className="w-full text-left border rounded-lg p-3 hover:border-[var(--capivari-green)] hover:bg-[var(--capivari-green)]/5 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{p.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {p.brand ?? p.category?.name ?? "—"}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className={cn("text-sm font-semibold", av === 0 ? "text-rose-600" : "text-[var(--capivari-green)]")}>
                                {av} {UNIT_LABELS[p.unitOfMeasure] ?? p.unitOfMeasure}
                              </p>
                              <p className="text-[10px] text-muted-foreground">Disponível</p>
                            </div>
                          </div>
                          {locs.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {locs.map((l) => (
                                <Badge key={l.locationId} variant="outline" className="text-[10px] gap-1">
                                  <MapPin className="h-2.5 w-2.5" /> {l.locationName} · {l.quantity}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* PASSO 2 — quantidade */}
              {step === 1 && selectedProduct && (
                <div className="space-y-5">
                  <div>
                    <Label className="text-base font-semibold">Quanto será retirado?</Label>
                    <p className="text-sm text-muted-foreground mt-1">{selectedProduct.name}{selectedProduct.brand ? ` — ${selectedProduct.brand}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-3 justify-center py-4">
                    <Button variant="outline" size="icon" className="h-14 w-14 rounded-full" onClick={() => setQuantity(String(Math.max(0, qty - 1)))} disabled={qty <= 0}>
                      <Minus className="h-6 w-6" />
                    </Button>
                    <Input
                      type="number"
                      min="0"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="h-14 w-24 text-center text-2xl font-bold"
                    />
                    <Button variant="outline" size="icon" className="h-14 w-14 rounded-full" onClick={() => setQuantity(String(qty + 1))}>
                      <Plus className="h-6 w-6" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="border rounded-lg p-3">
                      <p className="text-lg font-bold">{available}</p>
                      <p className="text-[10px] text-muted-foreground">Disponível</p>
                    </div>
                    <div className="border rounded-lg p-3">
                      <p className="text-lg font-bold text-blue-600">{qty}</p>
                      <p className="text-[10px] text-muted-foreground">Retirada</p>
                    </div>
                    <div className="border rounded-lg p-3">
                      <p className={cn("text-lg font-bold", afterExit === 0 ? "text-rose-600" : "text-[var(--capivari-green)]")}>{afterExit}</p>
                      <p className="text-[10px] text-muted-foreground">Saldo após saída</p>
                    </div>
                  </div>
                  {qty > available && (
                    <p className="text-sm text-rose-600 text-center">Quantidade maior que o disponível ({available})</p>
                  )}
                </div>
              )}

              {/* PASSO 3 — quem / para onde */}
              {step === 2 && (
                <div className="space-y-4">
                  <div>
                    <Label className="text-base font-semibold flex items-center gap-2"><User className="h-4 w-4" /> Quem está retirando?</Label>
                    <div className="flex gap-2 mt-2">
                      <Select value={receiverId} onValueChange={(v) => { setReceiverId(v); setReceiverName(activeUsers.find((u: any) => u._id === v)?.name ?? receiverName); }}>
                        <SelectTrigger className="flex-1"><SelectValue placeholder="Selecionar pessoa" /></SelectTrigger>
                        <SelectContent>
                          {activeUsers.map((u: any) => (
                            <SelectItem key={u._id} value={u._id}>{u.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={receiverName}
                        onChange={(e) => setReceiverName(e.target.value)}
                        placeholder="Nome"
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-base font-semibold flex items-center gap-2"><Building2 className="h-4 w-4" /> Para onde vai?</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                      <Input value={secretaria} onChange={(e) => setSecretaria(e.target.value)} placeholder="Secretaria" />
                      <Input value={departamento} onChange={(e) => setDepartamento(e.target.value)} placeholder="Departamento (opcional)" />
                      <Input value={unidade} onChange={(e) => setUnidade(e.target.value)} placeholder="Unidade (opcional)" />
                    </div>
                  </div>
                  {selectedProduct && (
                    <div>
                      <Label className="text-sm font-medium">De qual local?</Label>
                      <Select value={locationId} onValueChange={setLocationId}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Qualquer local" /></SelectTrigger>
                        <SelectContent>
                          {(locationsByProduct.get(selectedProduct._id as string) ?? []).map((l) => (
                            <SelectItem key={l.locationId} value={l.locationId}>
                              {l.locationName} · {l.quantity} disponível
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}

              {/* PASSO 4 — motivo */}
              {step === 3 && (
                <div className="space-y-4">
                  <Label className="text-base font-semibold">Por que está retirando?</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setReason(r)}
                        className={cn(
                          "border rounded-lg p-3 text-sm font-medium transition-colors",
                          reason === r
                            ? "border-[var(--capivari-green)] bg-[var(--capivari-green)]/5 text-[var(--capivari-green)]"
                            : "hover:border-border"
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  {reason === "Atendimento de chamado" && (
                    <div>
                      <Label className="text-sm font-medium">Nº da O.S. (opcional)</Label>
                      <Input value={osNumber} onChange={(e) => setOsNumber(e.target.value)} placeholder="Ex: 12345" className="mt-1" />
                    </div>
                  )}
                  <div>
                    <Label className="text-sm font-medium">Observação (opcional)</Label>
                    <Input value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="Detalhes adicionais" className="mt-1" />
                  </div>
                </div>
              )}

              {/* PASSO 5 — resumo */}
              {step === 4 && selectedProduct && (
                <div className="space-y-4">
                  <Label className="text-base font-semibold">Confira antes de confirmar</Label>
                  <div className="border rounded-lg divide-y">
                    {[
                      ["Material", selectedProduct.name],
                      ["Quantidade", `${qty} ${UNIT_LABELS[selectedProduct.unitOfMeasure] ?? selectedProduct.unitOfMeasure}`],
                      ["Destino", destination || "Não informado"],
                      ["Responsável", receiverName.trim() || (activeUsers.find((u: any) => u._id === receiverId)?.name ?? "—")],
                      ["Motivo", reason],
                      ...(osNumber ? [["O.S.", osNumber]] : []),
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <span className="text-muted-foreground">{k}</span>
                        <span className="font-medium text-right">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Nav buttons */}
              {!result && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t">
                  <Button variant="ghost" onClick={back} disabled={step === 0} className="gap-1">
                    <ChevronLeft className="h-4 w-4" /> Voltar
                  </Button>
                  {step < 3 && (
                    <Button onClick={next} disabled={step === 0 ? !selectedProduct : step === 1 ? qty <= 0 || qty > available : false} className="gap-1 bg-[var(--capivari-green)] hover:bg-[var(--capivari-green-dark)]">
                      Continuar <ChevronRight className="h-4 w-4" />
                    </Button>
                  )}
                  {step === 3 && (
                    <Button onClick={next} className="gap-1 bg-[var(--capivari-green)] hover:bg-[var(--capivari-green-dark)]">
                      Ver resumo <ChevronRight className="h-4 w-4" />
                    </Button>
                  )}
                  {step === 4 && (
                    <Button onClick={confirm} disabled={submitting || qty <= 0 || qty > available} className="gap-2 bg-[var(--capivari-green)] hover:bg-[var(--capivari-green-dark)]">
                      <PackageCheck className="h-4 w-4" />
                      {submitting ? "Confirmando..." : "Confirmar saída"}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}