/**
 * Gestão de Estoque SGGD — GESTÃO DE SUPRIMENTOS DE IMPRESSÃO (/gomaq).
 *
 * Painel operacional do estoque REAL recortado pela Área/Subestoque
 * "Impressoras" — não é um segundo estoque. Estrutura:
 *
 *   ESTOQUE            → Estoque atual · Retirada rápida
 *   MOVIMENTAÇÃO       → Entradas (módulo Entradas) · Consumo mensal · Reposição
 *   LOGÍSTICA REVERSA  → Carcaças · Trocas · Coletas · Pedido mensal (fornecedores)
 *
 * RBAC: consulta exige stock.view; retirada exige stock.mutate no backend
 * (o botão é ocultado sem a permissão; a autorização REAL é no servidor).
 */
import { Fragment, useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import {
  Printer, PackageMinus, Download, Settings2, Loader2, Search,
  RefreshCcw, Truck, ShoppingCart, ArrowLeftRight,
  ChevronDown, ChevronRight, ShieldCheck, TriangleAlert,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { buildEstimatedNeedRow, NEED_SOURCE_LABELS } from "@/lib/supply-requests";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { getPermissions } from "@/types/constants";
import type { UserRole } from "@/types/constants";
import {
  computeCardTotals,
  validateWithdrawal,
  normalizeOrgList,
  planPackOperation,
  extractColor,
  tonerDisplayLabel,
  buildLowStockWarning,
  buildWithdrawalConfirmation,
  canConfirmWithdrawal,
  type SupplyRow,
  type StockStatus,
  type PackagingConversion,
} from "@/lib/print-supplies";

const SUPPLY_CATEGORY_ID = "k57fk85xwpj3b3xj9dc31jwqpd8dgk3a";

type DashboardData = {
  rows: Array<SupplyRow & { inArea?: number }>;
  families: SupplyFamilyView[];
  totals: ReturnType<typeof computeCardTotals>;
  areaQuantity: number;
};

type OrgDoc = { _id: string; name: string; parentId?: string | null };

type FamilyMemberView = {
  productId: string;
  productName: string;
  unitOfMeasure: string;
  currentStock: number;
  inArea: number;
  baseUnits: number;
  packaging: PackagingConversion | null;
};

type SupplyFamilyView = {
  familyKey: string;
  familyName: string;
  brand: string | null;
  type: string;
  model: string | null;
  baseUnit: string;
  baseStock: number;
  baseStockInArea: number;
  compositionLabel: string;
  members: FamilyMemberView[];
  minimumStock: number | null;
  idealStock: number | null;
  monthlyConsumptionTarget: number | null;
  status: StockStatus;
  withdrawMemberId: string | null;
  suggestedReorder: number | null;
  parametersDefined: boolean;
};

function StatusBadge({ status }: { status: StockStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STOCK_BADGE[status]}`}>
      {status}
    </span>
  );
}

const STOCK_BADGE: Record<StockStatus, string> = {
  Normal: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  Baixo: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "Crítico": "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

function Card({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ═══ Aba ESTOQUE ═══════════════════════════════════════════════════════════ */

function EstoqueTab() {
  const { user } = useAuth();
  const permissions = getPermissions((user?.role ?? "technician") as UserRole);

  const dashboard = useQuery(api.printSupplies.getSupplyDashboard) as DashboardData | undefined;
  const families = dashboard?.families ?? [];

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("todos");
  const [withdrawFor, setWithdrawFor] = useState<SupplyFamilyView | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const filtered = useMemo(() => {
    return families.filter((f) => {
      if (typeFilter !== "todos" && f.type !== typeFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        f.familyName.toLowerCase().includes(q) ||
        (f.brand ?? "").toLowerCase().includes(q) ||
        (f.model ?? "").toLowerCase().includes(q) ||
        f.members.some((m) => m.productName.toLowerCase().includes(q))
      );
    });
  }, [families, search, typeFilter]);

  const totals = dashboard?.totals ?? computeCardTotals([]);
  const types = ["Toner", "Cartão", "Ribbon", "Papel", "Etiqueta", "Outros"];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card label="Toners" value={totals.toners} />
        <Card label="Cartões" value={totals.cartoes} />
        <Card label="Ribbons" value={totals.ribbons} />
        <Card label="Papéis" value={totals.papeis} />
        <Card label="Etiquetas" value={totals.etiquetas} />
        <Card label="Estoque baixo" value={totals.lowStock} hint="Baixo ou crítico" />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar produto, marca ou modelo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <Table className="min-w-[900px]">
          <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead>Marca</TableHead>
              <TableHead>Modelo/Compat.</TableHead>
              <TableHead>Cor</TableHead>
              <TableHead>Un.</TableHead>
              <TableHead className="text-right">Atual</TableHead>
              <TableHead className="text-right">Mín.</TableHead>
              <TableHead className="text-right">Ideal</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((f) => {
              const multi = f.members.length > 1;
              const open = expanded.has(f.familyKey);
              const tonerLabel = f.type === "Toner" ? tonerDisplayLabel(f.familyName) : null;
              return (
                <Fragment key={f.familyKey}>
                  <TableRow
                    className={multi ? "cursor-pointer" : undefined}
                    onClick={multi ? () => toggleExpanded(f.familyKey) : undefined}
                  >
                    <TableCell className="font-medium">{f.type}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-start gap-1.5">
                        {multi &&
                          (open ? (
                            <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          ))}
                        <span>
                          {tonerLabel ? (
                            <span>
                              <span className="font-medium">{tonerLabel.split(" — ")[0]}</span>
                              {" — "}
                              <span className="text-muted-foreground">{tonerLabel.split(" — ").slice(1).join(" — ")}</span>
                            </span>
                          ) : (
                            <span className="font-medium">{f.familyName}</span>
                          )}
                          {multi && (
                            <span className="block text-xs text-muted-foreground">{f.compositionLabel}</span>
                          )}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{f.brand ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{f.model ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{extractColor(f.familyName) ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{f.baseUnit}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{f.baseStock}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {f.minimumStock != null && f.minimumStock > 0 ? f.minimumStock : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {f.idealStock != null && f.idealStock > 0 ? f.idealStock : "—"}
                    </TableCell>
                    <TableCell><StatusBadge status={f.status} /></TableCell>
                    <TableCell className="text-right">
                      {permissions.canCreateEntries ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setWithdrawFor(f);
                          }}
                        >
                          Retirar
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                  {multi &&
                    open &&
                    f.members.map((m) => (
                      <TableRow key={m.productId} className="bg-muted/30 text-sm">
                        <TableCell />
                        <TableCell className="pl-7 text-muted-foreground">{m.productName}</TableCell>
                        <TableCell colSpan={3} className="text-xs text-muted-foreground">
                          {m.packaging
                            ? `Conversão: 1 ${m.packaging.packagingUnit} = ${m.packaging.factor} ${m.packaging.baseUnit}`
                            : "Registro original — unidade de estoque"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{m.unitOfMeasure}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.currentStock}</TableCell>
                        <TableCell colSpan={2} />
                        <TableCell colSpan={2} className="text-right text-xs text-muted-foreground">
                          {m.inArea} na área Impressoras
                        </TableCell>
                      </TableRow>
                    ))}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  {dashboard === undefined ? "Carregando..." : "Nenhum suprimento encontrado."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {withdrawFor && (
        <WithdrawDialog family={withdrawFor} open={!!withdrawFor} onClose={() => setWithdrawFor(null)} />
      )}
    </div>
  );
}

/* ═══ Retirada rápida ═══════════════════════════════════════════════════════ */

function WithdrawDialog({ family, open, onClose }: { family: SupplyFamilyView; open: boolean; onClose: () => void }) {
  const orgsQuery = useQuery(api.organizations.list);
  const withdraw = useMutation(api.printSupplies.withdraw);
  const withdrawFamily = useMutation(api.printSupplies.withdrawFamily);

  const [quantity, setQuantity] = useState("1");
  const [secretariaId, setSecretariaId] = useState("");
  const [departamentoId, setDepartamentoId] = useState("");
  const [unidadeId, setUnidadeId] = useState("");
  const [reason, setReason] = useState("");
  const [osNumber, setOsNumber] = useState("");
  const [observation, setObservation] = useState("");
  const [saving, setSaving] = useState(false);
  // Etapa 1 = formulário · Etapa 2 = confirmação "Confirmar retirada?".
  // Nenhuma escrita acontece antes da confirmação explícita.
  const [step, setStep] = useState<"form" | "confirm">("form");

  // Contrato defensivo: `organizations.list` retorna { orgs, byParent } —
  // normalizado SEMPRE para array plano (nunca cast cego); erro em formato
  // inesperado. Garante que todo `.filter()` do modal receba um array.
  let orgs: OrgDoc[];
  try {
    orgs = normalizeOrgList<OrgDoc>(orgsQuery);
  } catch (e) {
    orgs = [];
    toast.error(e instanceof Error ? e.message : "Formato inesperado de organizações");
  }

  const packager = family.members.find((m) => m.packaging) ?? null;
  const inBaseUnits = !!packager?.packaging;
  const conv = packager?.packaging ?? null;
  const qty = Number(quantity) || 0;
  const check = useMemo(() => validateWithdrawal(qty, family.baseStock), [qty, family.baseStock]);
  const plan = useMemo(
    () =>
      conv
        ? planPackOperation(qty, {
            closedPacks: packager?.currentStock ?? 0,
            looseUnits: family.baseStock - (packager?.currentStock ?? 0) * conv.factor,
            factor: conv.factor,
          })
        : null,
    [conv, qty, packager, family.baseStock],
  );
  const planLabel = (() => {
    if (!conv || !plan || !check.ok) return null;
    if (plan.operation === "open_pack") {
      const loose = family.baseStock - (packager?.currentStock ?? 0) * conv.factor;
      return `Sai das ${loose} un. avulsas e abre ${plan.packs} ${conv.packagingUnit}${plan.packs > 1 ? "s" : ""} fechada${plan.packs > 1 ? "s" : ""} (abertura integral registrada).`;
    }
    if (plan.packs > 0) {
      const avulsas = qty - plan.packs * conv.factor;
      return `Retira ${plan.packs} ${conv.packagingUnit}${plan.packs > 1 ? "s" : ""} fechada${plan.packs > 1 ? "s" : ""}${avulsas > 0 ? ` + ${avulsas} un. avulsas` : ""}.`;
    }
    return `Retira ${qty} un. avulsa${qty > 1 ? "s" : ""}.`;
  })();

  const orgList = orgs ?? [];
  const secretarias = orgList.filter((o) => !o.parentId);
  const departamentos = secretariaId ? orgList.filter((o) => o.parentId === secretariaId) : [];
  const unidades = departamentoId ? orgList.filter((o) => o.parentId === departamentoId) : [];

  const nameOf = (id: string) => orgList.find((o) => o._id === id)?.name ?? null;
  const lowStock = buildLowStockWarning(family.baseStock, family.minimumStock, qty);
  const confirmRows = buildWithdrawalConfirmation({
    productLabel: family.familyName,
    quantity: qty,
    baseUnit: inBaseUnits && conv ? conv.baseUnit : family.baseUnit,
    currentStock: family.baseStock,
    minimumStock: family.minimumStock,
    secretaria: nameOf(secretariaId),
    departamento: nameOf(departamentoId),
    unidade: nameOf(unidadeId),
    reason,
    osNumber,
    observation,
  });
  const canConfirm = canConfirmWithdrawal({ quantity: qty, available: family.baseStock, reason });

  // Cancelar (em qualquer etapa) e fechar o modal são a MESMA ação: nenhum
  // estado de estoque é tocado, apenas o estado local do formulário.
  const cancel = () => {
    setStep("form");
    onClose();
  };

  const submit = async () => {
    if (!check.ok) {
      toast.error(check.reason ?? "Quantidade inválida");
      return;
    }
    const destino = {
      secretariaId: (secretariaId || undefined) as Id<"organizations"> | undefined,
      departamentoId: (departamentoId || undefined) as Id<"organizations"> | undefined,
      unidadeId: (unidadeId || undefined) as Id<"organizations"> | undefined,
      reason: reason || undefined,
      osNumber: osNumber || undefined,
      observation: observation || undefined,
    };
    setSaving(true);
    try {
      if (inBaseUnits && conv && packager) {
        await withdrawFamily({ productId: packager.productId as Id<"products">, quantity: qty, ...destino });
      } else {
        const single = family.members[0];
        await withdraw({ productId: single.productId as Id<"products">, quantity: qty, ...destino });
      }
      toast.success(`Retirada registrada: ${qty} ${inBaseUnits && conv ? conv.baseUnit : family.baseUnit} — ${family.familyName}`);
      setStep("form");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na retirada");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && cancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === "confirm" ? "Confirmar retirada?" : "Retirada de suprimento"}
          </DialogTitle>
          <DialogDescription>
            {step === "confirm"
              ? "Confira os dados abaixo antes de registrar a saída de estoque."
              : "Dispensação/entrega de material — o produto permanece vinculado à área Impressoras."}
          </DialogDescription>
        </DialogHeader>

        {step === "confirm" ? (
          <div className="grid gap-3 py-2">
            <dl className="divide-y rounded-lg border text-sm">
              {confirmRows.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 px-3 py-2">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="text-right font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>

            {lowStock.warn && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="flex items-start gap-1.5 font-medium">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  Esta retirada deixará o estoque abaixo do mínimo.
                </p>
              </div>
            )}

            {planLabel && (
              <p className="text-xs text-muted-foreground">{planLabel}</p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 py-2">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{family.familyName}</p>
            <p className="text-xs text-muted-foreground">
              Marca: {family.brand ?? "—"} · Modelo: {family.model ?? "—"} · Unidade:{" "}
              {inBaseUnits && conv ? conv.baseUnit : family.baseUnit}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-center text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Estoque disponível</p>
              <p className="font-semibold tabular-nums">{family.baseStock}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Quantidade solicitada</p>
              <p className={`font-semibold tabular-nums ${!check.ok ? "text-destructive" : ""}`}>{qty}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Saldo após retirada</p>
              <p className="font-semibold tabular-nums">{check.ok ? check.balanceAfter : "—"}</p>
            </div>
          </div>

          {inBaseUnits && conv && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
              <p className="flex items-start gap-1.5 font-medium">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                Composição: {family.compositionLabel} · 1 {conv.packagingUnit} = {conv.factor} {conv.baseUnit}
              </p>
              {planLabel && <p className="mt-1 text-blue-800 dark:text-blue-300">{planLabel}</p>}
            </div>
          )}
          {!inBaseUnits && (
            <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
              Unidade de estoque: {family.members[0]?.unitOfMeasure} (sem conversão configurada)
            </div>
          )}

          <div>
            <Label>Quantidade em {family.baseUnit} *</Label>
            <Input
              type="number" min={1} max={family.baseStock} value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              aria-invalid={!check.ok}
            />
            {!check.ok && <p className="mt-1 text-xs text-destructive">{check.reason}</p>}
          </div>

          {/* ALERTA (não bloqueio): saldo abaixo do mínimo apenas avisa.
              A única regra que bloqueia é a falta de saldo físico, tratada
              por `validateWithdrawal` e, na autoridade final, pelo backend. */}
          {lowStock.warn && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="flex items-start gap-1.5 font-medium">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                Atenção — Esta retirada deixará o estoque abaixo do mínimo.
              </p>
              <div className="mt-1.5 grid grid-cols-3 gap-2 text-center tabular-nums">
                <div>
                  <p className="opacity-70">Atual</p>
                  <p className="font-semibold">{lowStock.current}</p>
                </div>
                <div>
                  <p className="opacity-70">Mínimo</p>
                  <p className="font-semibold">{lowStock.minimum}</p>
                </div>
                <div>
                  <p className="opacity-70">Saldo após retirada</p>
                  <p className="font-semibold">{lowStock.balanceAfter}</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Secretaria</Label>
              <Select value={secretariaId} onValueChange={(v) => { setSecretariaId(v); setDepartamentoId(""); setUnidadeId(""); }}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {secretarias.map((o) => (
                    <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Departamento</Label>
              <Select value={departamentoId} onValueChange={(v) => { setDepartamentoId(v); setUnidadeId(""); }} disabled={!secretariaId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {departamentos.map((o) => (
                    <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Unidade</Label>
              <Select value={unidadeId} onValueChange={setUnidadeId} disabled={!departamentoId}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {unidades.map((o) => (
                    <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Motivo *</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: Reposição de impressora" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>O.S. (opcional)</Label>
              <Input value={osNumber} onChange={(e) => setOsNumber(e.target.value)} />
            </div>
            <div>
              <Label>Observação</Label>
              <Input value={observation} onChange={(e) => setObservation(e.target.value)} />
            </div>
          </div>
        </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={cancel} disabled={saving}>
            {step === "confirm" ? "Voltar" : "Cancelar"}
          </Button>
          {step === "confirm" ? (
            <Button onClick={submit} disabled={saving || !canConfirm} className="gap-1.5">
              {saving && <Loader2 className="size-4 animate-spin" />}
              Confirmar retirada
            </Button>
          ) : (
            <Button onClick={() => setStep("confirm")} disabled={!canConfirm} className="gap-1.5">
              <PackageMinus className="size-4" />
              Continuar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══ Aba CONSUMO MENSAL ════════════════════════════════════════════════════ */

type ConsumptionLine = {
  productId: string; productName: string; type: string; brand: string | null;
  unitOfMeasure: string; entries: number; exits: number; currentStock: number;
};
type ConsumptionData = {
  lines: ConsumptionLine[];
  byOrg: Array<{ orgName: string; productLabel: string; type: string; quantity: number }>;
};

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function ConsumoTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [exporting, setExporting] = useState(false);

  const consumption = useQuery(api.printSupplies.getMonthlyConsumption, { year, month }) as ConsumptionData | undefined;

  const exportXlsx = async () => {
    if (!consumption) return;
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const header = ["Produto", "Tipo", "Marca", "Unidade", "Entradas", "Saídas (consumo)", "Saldo atual"];
      const body = consumption.lines.map((l) => [
        l.productName, l.type, l.brand ?? "—", l.unitOfMeasure, l.entries, l.exits, l.currentStock,
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        [`Consumo de Suprimentos de Impressão — ${MONTHS[month - 1]}/${year}`],
        [], header, ...body,
      ]), "Consumo");

      const orgWs = XLSX.utils.aoa_to_sheet([
        ["Secretaria", "Produto / Tipo", "Quantidade consumida"],
        ...consumption.byOrg.map((o) => [o.orgName, `${o.productLabel} (${o.type})`, o.quantity]),
      ]);
      XLSX.utils.book_append_sheet(wb, orgWs, "Por Secretaria");

      XLSX.writeFile(wb, `consumo-suprimentos-${year}-${String(month).padStart(2, "0")}.xlsx`);
      toast.success("Planilha de consumo gerada");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label>Mês</Label>
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Ano</Label>
          <Input
            type="number" value={year}
            onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())}
            className="w-24"
          />
        </div>
        <Button variant="outline" onClick={exportXlsx} disabled={!consumption?.lines.length || exporting} className="gap-1.5">
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Gerar planilha de consumo
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table className="min-w-[680px]">
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Marca</TableHead>
              <TableHead className="text-right">Entradas</TableHead>
              <TableHead className="text-right">Saídas</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(consumption?.lines ?? []).map((l) => (
              <TableRow key={l.productId}>
                <TableCell className="font-medium">{l.productName}</TableCell>
                <TableCell>{l.type}</TableCell>
                <TableCell className="text-muted-foreground">{l.brand ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{l.entries}</TableCell>
                <TableCell className="text-right tabular-nums">{l.exits}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{l.currentStock}</TableCell>
              </TableRow>
            ))}
            {(consumption?.lines.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  {consumption === undefined ? "Carregando..." : "Sem movimentações de suprimentos neste mês."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Consumo por secretaria (entregas)</h3>
        <div className="rounded-lg border">
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>Secretaria</TableHead>
                <TableHead>Produto / Tipo</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(consumption?.byOrg ?? []).map((o, i) => (
                <TableRow key={`${o.orgName}-${o.productLabel}-${i}`}>
                  <TableCell className="font-medium">{o.orgName}</TableCell>
                  <TableCell>{o.productLabel} <span className="text-muted-foreground">({o.type})</span></TableCell>
                  <TableCell className="text-right tabular-nums">{o.quantity}</TableCell>
                </TableRow>
              ))}
              {(consumption?.byOrg.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    Sem entregas de suprimentos neste mês.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

/* ═══ Aba REPOSIÇÃO ═════════════════════════════════════════════════════════ */

function ReposicaoTab() {
  const dashboard = useQuery(api.printSupplies.getSupplyDashboard) as DashboardData | undefined;
  const updateParams = useMutation(api.printSupplies.updateStockParameters);
  const { user } = useAuth();
  const permissions = getPermissions((user?.role ?? "technician") as UserRole);

  const [editing, setEditing] = useState<SupplyRow | null>(null);
  const [minVal, setMinVal] = useState("");
  const [idealVal, setIdealVal] = useState("");

  const reorder = (dashboard?.rows ?? []).filter((r) => r.status !== "Normal");

  const submitParams = async () => {
    if (!editing) return;
    try {
      await updateParams({
        productId: editing.productId as Id<"products">,
        minimumStock: minVal === "" ? undefined : Number(minVal),
        idealStock: idealVal === "" ? undefined : Number(idealVal),
      });
      toast.success("Parâmetros atualizados");
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar parâmetros");
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Produtos com estoque igual ou abaixo do mínimo. A quantidade sugerida
        (ideal − atual) só aparece quando mínimo e ideal estão definidos.
      </p>
      <div className="rounded-lg border">
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Estoque atual</TableHead>
              <TableHead className="text-right">Mínimo</TableHead>
              <TableHead className="text-right">Ideal</TableHead>
              <TableHead className="text-right">Quantidade sugerida</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reorder.map((r) => (
              <TableRow key={r.productId}>
                <TableCell className="font-medium">{r.displayLabel}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{r.currentStock}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.minimumStock != null && r.minimumStock > 0 ? r.minimumStock : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.idealStock != null && r.idealStock > 0 ? r.idealStock : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.suggestedReorder != null ? (
                    <strong>{r.suggestedReorder}</strong>
                  ) : (
                    <span className="text-xs text-muted-foreground">Parâmetros não definidos</span>
                  )}
                </TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell className="text-right">
                  {permissions.canManageProducts ? (
                    <Button
                      variant="outline" size="sm" className="gap-1.5"
                      onClick={() => {
                        setEditing(r);
                        setMinVal(r.minimumStock != null && r.minimumStock > 0 ? String(r.minimumStock) : "");
                        setIdealVal(r.idealStock != null && r.idealStock > 0 ? String(r.idealStock) : "");
                      }}
                    >
                      <Settings2 className="size-3.5" /> Parâmetros
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {reorder.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  {dashboard === undefined ? "Carregando..." : "Nenhum item abaixo do mínimo."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Parâmetros de estoque</DialogTitle>
            <DialogDescription>{editing?.displayLabel}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <Label>Estoque mínimo</Label>
              <Input type="number" min={0} value={minVal} onChange={(e) => setMinVal(e.target.value)} placeholder="—" />
            </div>
            <div>
              <Label>Estoque ideal</Label>
              <Input type="number" min={0} value={idealVal} onChange={(e) => setIdealVal(e.target.value)} placeholder="—" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={submitParams}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═══ Planejamento de reposição (SUPLEMENTO ao painel de suprimentos) ════════ */

/**
 * "Planejamento de Reposição" — seção de APOIO dentro da Gestão de
 * Suprimentos de Impressão. Ela lê os MESMOS produtos reais da área
 * Impressoras: nenhuma cópia de produto, nenhum segundo estoque.
 *
 * A "necessidade estimada" é SEMPRE o parâmetro manual de consumo mensal
 * cadastrado pelo gestor. Nunca é calculada a partir de movimentações e nunca
 * é inventada quando o parâmetro não existe (`—`).
 */
function PlanejamentoReposicaoTab() {
  const dashboard = useQuery(api.printSupplies.getSupplyDashboard) as DashboardData | undefined;
  const families = dashboard?.families ?? [];

  const rows = useMemo(
    () =>
      families.map((f) =>
        buildEstimatedNeedRow({
          currentStock: f.baseStock,
          minimumStock: f.minimumStock,
          idealStock: f.idealStock,
          monthlyConsumptionTarget: f.monthlyConsumptionTarget ?? null,
        })
      ),
    [families]
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Base de planejamento para a solicitação mensal. A necessidade estimada é o
        <strong> consumo mensal cadastrado pelo gestor</strong> — quando não há parâmetro,
        o campo fica vazio em vez de estimar um número.
      </p>

      <div className="rounded-lg border">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Estoque atual</TableHead>
              <TableHead className="text-right">Mínimo</TableHead>
              <TableHead className="text-right">Ideal</TableHead>
              <TableHead className="text-right">Consumo mensal</TableHead>
              <TableHead className="text-right">Necessidade estimada</TableHead>
              <TableHead className="text-right">Sugestão de reposição</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {families.map((f, i) => {
              const row = rows[i];
              return (
                <TableRow key={f.familyKey}>
                  <TableCell className="font-medium">{f.familyName}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.baseStock}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {f.minimumStock != null ? f.minimumStock : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {f.idealStock != null ? f.idealStock : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {f.monthlyConsumptionTarget != null ? f.monthlyConsumptionTarget : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.estimatedNeed === null ? (
                      <span className="text-xs text-muted-foreground">
                        — <span className="italic">({NEED_SOURCE_LABELS[row.needSource]})</span>
                      </span>
                    ) : (
                      <span className="tabular-nums">
                        {row.estimatedNeed}
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          ({NEED_SOURCE_LABELS[row.needSource]})
                        </span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {row.suggestedReplenishment}
                  </TableCell>
                </TableRow>
              );
            })}
            {families.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  {dashboard === undefined ? "Carregando..." : "Nenhum suprimento na área Impressoras."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        A sugestão de reposição é <code className="font-mono">max(ideal − estoque, 0)</code>:
        um número de apoio. Ela não cria pedido, não reserva e não movimenta estoque.
      </p>
    </div>
  );
}

/* ═══ Aba LOGÍSTICA REVERSA (funcionalidades GomaQ existentes) ══════════════ */

type Exchange = {
  _id: string; exchangeNumber: string; productId: string;
  quantityDelivered: number; quantityEmptyReceived: number; exchangedAt: number;
};
type Cartridge = {
  _id: string; productId: string; quantity: number;
  status: "awaiting_collection" | "collected"; generatedAt: number;
};
type Collection = {
  _id: string; collectionNumber: string; collectedAt: number; items?: Array<{ productLabel?: string; quantity?: number }>;
};
type OrderItem = {
  productId: string; productName: string; brand?: string | null;
  availableQuantity: number; idealStock?: number; suggestedQuantity: number;
};

function ReversaTab() {
  const exchanges = useQuery(api.gomaQ.listExchanges, {}) as Exchange[] | undefined;
  const cartridges = useQuery(api.gomaQ.listEmptyCartridges, {}) as Cartridge[] | undefined;
  const collections = useQuery(api.gomaQ.listCollections, {}) as Collection[] | undefined;
  const order = useQuery(api.gomaQ.monthlyOrder, {}) as OrderItem[] | undefined;
  const { user } = useAuth();
  const permissions = getPermissions((user?.role ?? "technician") as UserRole);

  const awaiting = (cartridges ?? []).filter((c) => c.status === "awaiting_collection").length;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const exchangesThisMonth = (exchanges ?? []).filter((e) => e.exchangedAt >= monthStart).length;

  const exportOrder = async () => {
    if (!order) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Pedido mensal de suprimentos — Gerado em " + new Date().toLocaleDateString("pt-BR")],
      [],
      ["Produto", "Marca", "Disponível", "Ideal", "Quantidade sugerida"],
      ...order.map((i) => [i.productName, i.brand ?? "—", i.availableQuantity, i.idealStock ?? 0, i.suggestedQuantity]),
    ]), "Pedido");
    XLSX.writeFile(wb, `pedido-suprimentos-${new Date().toISOString().slice(0, 7)}.xlsx`);
    toast.success("Pedido mensal exportado");
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Carcaças p/ coleta" value={awaiting} />
        <Card label="Trocas no mês" value={exchangesThisMonth} />
        <Card label="Coletas registradas" value={collections?.length ?? 0} />
        <Card label="Itens no pedido" value={order?.length ?? 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <RefreshCcw className="size-4 text-muted-foreground" /> Últimas trocas
          </h3>
          <div className="space-y-1.5">
            {(exchanges ?? []).slice(0, 6).map((e) => (
              <div key={e._id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{e.exchangeNumber}</span>
                <span className="tabular-nums">{e.quantityDelivered} entregue(s) · {e.quantityEmptyReceived} carcaça(s)</span>
              </div>
            ))}
            {(exchanges ?? []).length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">Sem trocas registradas.</p>
            )}
          </div>
        </section>

        <section className="rounded-lg border p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Truck className="size-4 text-muted-foreground" /> Últimas coletas
          </h3>
          <div className="space-y-1.5">
            {(collections ?? []).slice(0, 6).map((c) => (
              <div key={c._id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{c.collectionNumber}</span>
                <span>{new Date(c.collectedAt).toLocaleDateString("pt-BR")}</span>
              </div>
            ))}
            {(collections ?? []).length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">Sem coletas registradas.</p>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <ShoppingCart className="size-4 text-muted-foreground" /> Pedido mensal
          </h3>
          {permissions.canManageGomaQ && (
            <Button variant="outline" size="sm" onClick={exportOrder} disabled={!order?.length} className="gap-1.5">
              <Download className="size-3.5" /> Exportar
            </Button>
          )}
        </div>
        <div className="rounded-lg border">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Marca</TableHead>
                <TableHead className="text-right">Disponível</TableHead>
                <TableHead className="text-right">Ideal</TableHead>
                <TableHead className="text-right">Sugerido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(order ?? []).map((i) => (
                <TableRow key={i.productId}>
                  <TableCell className="font-medium">{i.productName}</TableCell>
                  <TableCell className="text-muted-foreground">{i.brand ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.availableQuantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.idealStock ?? 0}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{i.suggestedQuantity}</TableCell>
                </TableRow>
              ))}
              {(order ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Sem itens no pedido mensal.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

/* ═══ Página ════════════════════════════════════════════════════════════════ */

export default function GomaQPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Printer className="size-5 text-primary" />
              Gestão de Suprimentos de Impressão
            </h1>
            <p className="text-sm text-muted-foreground">
              Controle de estoque, consumo, retiradas e abastecimento
            </p>
          </div>
          <Badge variant="outline" className="gap-1.5">
            <ArrowLeftRight className="size-3.5" /> Área: Impressoras
          </Badge>
        </div>

        <Tabs defaultValue="estoque">
          <TabsList className="flex-wrap">
            <TabsTrigger value="estoque">Estoque</TabsTrigger>
            <TabsTrigger value="consumo">Consumo Mensal</TabsTrigger>
            <TabsTrigger value="reposicao">Reposição</TabsTrigger>
            <TabsTrigger value="planejamento">Planejamento de Reposição</TabsTrigger>
            <TabsTrigger value="reversa">Logística Reversa</TabsTrigger>
          </TabsList>
          <TabsContent value="estoque"><EstoqueTab /></TabsContent>
          <TabsContent value="consumo"><ConsumoTab /></TabsContent>
          <TabsContent value="reposicao"><ReposicaoTab /></TabsContent>
          <TabsContent value="planejamento"><PlanejamentoReposicaoTab /></TabsContent>
          <TabsContent value="reversa"><ReversaTab /></TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
