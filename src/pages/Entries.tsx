import { useMutation, useQuery } from "convex/react";
import { useState, useCallback, useMemo, useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { formatAccessKeyPrint, formatCnpj, formatCurrency, formatIsoDateBrazilian } from "@/lib/br-validators";
import { NfeReviewTable, NfeReviewProduct, type NfeReviewRow } from "@/components/NfeReviewTable";
import { QuickProductForm } from "@/components/QuickProductForm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { NfeItem, ProductForMatch } from "@/lib/nfe";
import { quickProductPrefill, type QuickProductFormState } from "@/lib/quickProduct";

export default function EntriesPage() {
  useAuth();
  const [nfeOpen, setNfeOpen] = useState(false);
  const [nfe, setNfe] = useState<{
    accessKey: string;
    number: string;
    series: string;
    emissionDate: string;
    supplier: { legalName: string; cnpj: string } | null;
    items: NfeItem[];
    totalValue: number | null;
    sourceLabel: string;
  } | null>(null);
  const [nfeAccessKey, setNfeAccessKey] = useState("");
  const [nfeAccessKeyDigits, setNfeAccessKeyDigits] = useState("");
  const [nfeItems, setNfeItems] = useState<NfeReviewRow[]>([]);
  const [nfeSupplier, setNfeSupplier] = useState<{ legalName: string; cnpj: string } | null>(null);

  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [quickProductItemIndex, setQuickProductItemIndex] = useState<number | null>(null);
  const [quickProductForm, setQuickProductForm] = useState<QuickProductFormState>({
    name: "",
    description: "",
    categoryId: "",
    unitOfMeasure: "un",
    brand: "",
    model: "",
    specification: "",
  });
  const [quickProductSnapshot, setQuickProductSnapshot] = useState<NfeReviewRow[]>([]);
  const [quickProductLoading, setQuickProductLoading] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const createProduct = useMutation(api.products.create);
  const upsertNfeProductAlias = useMutation(api.nfeProductAliases.upsert);
  const createEntry = useMutation(api.entries.create);
  const confirmEntry = useMutation(api.entries.confirm);
  const listActiveCategories = useQuery(api.categories.listActive);
  const createCategory = useMutation(api.categories.create);

  const [categories, setCategories] = useState<Array<{ _id: string; name: string }>>([]);

  useEffect(() => {
    const cat = listActiveCategories;
    if (!cat) return;
    setCategories(cat.map((c) => ({ _id: c._id, name: c.name })));
  }, [listActiveCategories]);

  const openQuickProductForRow = useCallback(
    (index: number) => {
      const row = nfeItems[index];
      if (!row) return;
      setQuickProductSnapshot([...nfeItems]);
      setQuickProductItemIndex(index);
      setQuickProductForm(quickProductPrefill(row.item));
      setQuickProductOpen(true);
      setFormError(null);
    },
    [nfeItems, setQuickProductSnapshot, setQuickProductItemIndex, setQuickProductForm, setQuickProductOpen],
  );

  const cancelQuickProduct = useCallback(() => {
    setQuickProductOpen(false);
    setQuickProductItemIndex(null);
    setQuickProductForm({
      name: "",
      description: "",
      categoryId: "",
      unitOfMeasure: "un",
      brand: "",
      model: "",
      specification: "",
    });
    setQuickProductSnapshot(quickProductSnapshot);
    setFormError(null);
  }, [setQuickProductSnapshot, quickProductSnapshot]);

  const handleQuickProductSave = useCallback(async () => {
    if (!nfeItems.length) return;
    const index = quickProductItemIndex;
    if (index == null || index < 0 || index >= nfeItems.length) return;

    const name = quickProductForm.name.trim();
    if (!name) {
      setFormError("Informe o nome do produto.");
      return;
    }
    if (!quickProductForm.categoryId) {
      setFormError("Selecione ou crie uma categoria para o produto.");
      return;
    }

    setQuickProductLoading(true);
    setFormError(null);
    try {
      const productId = await createProduct({
        name,
        description: quickProductForm.description.trim(),
        categoryId: quickProductForm.categoryId,
        unitOfMeasure: quickProductForm.unitOfMeasure,
        brand: quickProductForm.brand,
        model: quickProductForm.model,
        specification: quickProductForm.specification,
        minimumStock: 0,
        idealStock: 0,
        maximumStock: 0,
      });

      setNfeItems((current) =>
        current.map((row, position) =>
          position === index
            ? {
                ...row,
                productId,
                matchStatus: "found" as const,
                matchScore: 100,
                matchSource: "new_product" as const,
                associationType: "created" as const,
              }
            : row,
        ),
      );

      if (nfeSupplier && name) {
        await upsertNfeProductAlias({
          supplierId: "fornecedor-1",
          supplierCode: nfeItems[index]?.item.code ?? "",
          description: name,
          productId,
        }).catch(() => {});
      }

      setQuickProductOpen(false);
      setQuickProductItemIndex(null);
      setQuickProductForm({
        name: "",
        description: "",
        categoryId: "",
        unitOfMeasure: "un",
        brand: "",
        model: "",
        specification: "",
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível criar o produto.");
    } finally {
      setQuickProductLoading(false);
    }
  }, [
    nfeItems,
    quickProductItemIndex,
    quickProductForm,
    nfeSupplier,
    createProduct,
    upsertNfeProductAlias,
    setNfeItems,
    setQuickProductOpen,
    setQuickProductItemIndex,
    setQuickProductForm,
  ]);

  const handleCreateCategory = useCallback(async () => {
    if (!newCategoryName.trim()) return;
    setCategoryLoading(true);
    try {
      const created = await createCategory({ name: newCategoryName.trim() });
      const newCatId = created as unknown as string;
      setCategories((prev) => [...prev, { _id: newCatId, name: newCategoryName.trim() }]);
      setNewCategoryName("");
      setCategoryOpen(false);
    } finally {
      setCategoryLoading(false);
    }
  }, [newCategoryName, setCategories, setNewCategoryName, setCategoryOpen]);

  const handleImportNfe = useCallback(
    (nfeData: {
      accessKey: string;
      number: string;
      series: string;
      emissionDate: string;
      supplier: { legalName: string; cnpj: string } | null;
      items: NfeItem[];
      totalValue: number | null;
      sourceLabel: string;
    }) => {
      const digits = nfeData.accessKey.replace(/\D/g, "");
      setNfeAccessKey(digits);
      setNfeAccessKeyDigits(digits);
      setNfe({
        ...nfeData,
        items: nfeData.items.map((item, idx) => ({
          item,
          productId: "",
          matchStatus: "not_found" as const,
          matchScore: 0,
          associationType: "automatic" as const,
        })),
      });
      setNfeItems(
        nfeData.items.map((item, idx) => ({
          item,
          productId: "",
          matchStatus: "not_found" as const,
          matchScore: 0,
          associationType: "automatic" as const,
        })),
      ) as unknown as void;
      setNfeSupplier(nfeData.supplier);
      setNfeOpen(true);
    },
    [setNfeAccessKey, setNfeAccessKeyDigits, setNfe, setNfeItems, setNfeSupplier, setNfeOpen],
  );

  const handleContinueNfe = useCallback(() => {
    if (!nfe) return;
    setNfeOpen(false);
  }, [nfe, setNfeOpen]);

  const handleCloseNfe = useCallback(() => {
    setNfeOpen(false);
    setNfe(null);
    setNfeItems([]);
    setNfeSupplier(null);
  }, [setNfe, setNfeItems, setNfeSupplier]);

  const handleCategoryOpenChange = useCallback((value: boolean) => {
    setCategoryOpen(value);
    if (!value) {
      setNewCategoryName("");
    }
  }, [setCategoryOpen, setNewCategoryName]);

  const handleNewCategoryNameChange = useCallback((value: string) => {
    setNewCategoryName(value);
  }, [setNewCategoryName]);

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">Entradas</h1>
        <p className="text-sm text-muted-foreground">
          Importação e conferência de NF-e para entradas de estoque.
        </p>
      </header>

      {nfeOpen && nfe && (
        <section className="rounded-lg border bg-card p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">NF-e {nfe.number}/{nfe.series}</h2>
              <p className="text-sm text-muted-foreground">
                Emitida em {formatIsoDateBrazilian(nfe.emissionDate)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Chave de acesso:</span>
              <div className="relative">
                <input
                  type="text"
                  className="w-48 h-8 px-2 text-sm font-mono border bg-background rounded"
                  value={nfeAccessKey}
                  onChange={(event) => {
                    const raw = event.target.value;
                    const digits = raw.replace(/\D/g, "");
                    if (digits.length <= 44) {
                      setNfeAccessKey(digits);
                      setNfeAccessKeyDigits(digits);
                    }
                  }}
                  placeholder="44 dígitos"
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 px-2 text-xs border rounded bg-background text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    navigator.clipboard.writeText(nfeAccessKeyDigits);
                  }}
                >
                  Copiar chave (44 dígitos)
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Itens da nota:</span>
              <p className="font-mono font-medium">{nfe.items.length}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Código do item (fornecedor):</span>
              <p className="font-mono font-medium break-all">{nfe.items[0]?.code ?? "—"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Descrição:</span>
              <p className="font-medium break-words">{nfe.items[0]?.description ?? "—"}</p>
            </div>
            {(nfe.items[0]?.ncm || nfe.items[0]?.cst) && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Identificadores fiscais:</span>
                {nfe.items[0].ncm && (
                  <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs">
                    NCM {nfe.items[0].ncm}
                  </span>
                )}
                {nfe.items[0].cst && (
                  <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs">
                    CST {nfe.items[0].cst}
                  </span>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Quantidade:</span>
              <p className="font-mono font-medium">
                {nfe.items[0]?.quantity ?? "—"} {nfe.items[0]?.unit ?? "un"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Valor unitário:</span>
              <p className="font-mono font-medium">
                {formatCurrency(nfe.items[0]?.unitValue ?? 0)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Total da NF-e:</span>
              <p className="font-mono font-medium">
                {formatCurrency(nfe.totalValue ?? 0)}
              </p>
            </div>
          </div>

          {nfeSupplier && (
            <div className="rounded-md border bg-muted/50 p-3 space-y-1 text-sm">
              <p className="font-medium">Fornecedor identificado: {nfeSupplier.legalName}</p>
              <p className="text-muted-foreground">CNPJ {formatCnpj(nfeSupplier.cnpj)}</p>
            </div>
          )}

          <NfeReviewTable
            items={nfeItems}
            products={categories as unknown as NfeReviewProduct[]}
            onUpdate={(index, patch) => {
              setNfeItems((prev) => {
                const next = [...prev];
                next[index] = { ...next[index], ...patch };
                return next;
              });
            }}
            onNewProduct={openQuickProductForRow}
            onContinue={handleContinueNfe}
            sourceLabel={nfe.sourceLabel}
          />

          {quickProductOpen && quickProductItemIndex != null && (
            <QuickProductForm
              open={quickProductOpen}
              onClose={() => {
                setQuickProductOpen(false);
                setQuickProductItemIndex(null);
                setQuickProductForm({
                  name: "",
                  description: "",
                  categoryId: "",
                  unitOfMeasure: "un",
                  brand: "",
                  model: "",
                  specification: "",
                });
              }}
              targetIndex={quickProductItemIndex}
              form={quickProductForm}
              onFormChange={(patch) => setQuickProductForm((prev) => ({ ...prev, ...patch }))}
              loading={quickProductLoading}
              categories={categories}
              onSave={handleQuickProductSave}
              onCancel={cancelQuickProduct}
              onCreateCategory={handleCreateCategory}
              newCategoryName={newCategoryName}
              onNewCategoryNameChange={handleNewCategoryNameChange}
              categoryOpen={categoryOpen}
              onCategoryOpenChange={handleCategoryOpenChange}
            />
          )}

          {categoryOpen && (
            <Dialog
              open={categoryOpen}
              onOpenChange={handleCategoryOpenChange}
            >
              <DialogContent className="sm:max-w-xs">
                <DialogHeader>
                  <DialogTitle>Nova categoria</DialogTitle>
                  <DialogDescription>
                    Crie uma categoria para classificar o produto recém-cadastrado.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  <label className="text-sm text-muted-foreground">Nome da categoria *</label>
                  <Input
                    className="min-w-0 flex-1"
                    value={newCategoryName}
                    onChange={(event) => handleNewCategoryNameChange(event.target.value)}
                    placeholder="Nome da categoria"
                  />
                </div>

                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => handleCategoryOpenChange(false)} type="button" disabled={categoryLoading}>
                    Cancelar
                  </Button>
                  <Button onClick={handleCreateCategory} type="button" disabled={categoryLoading || !newCategoryName.trim()}>
                    Criar categoria
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {formError && (
            <div className="rounded-md border bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}
        </section>
      )}

      {!nfeOpen && (
        <section className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="text-lg font-semibold">Importar NF-e</h2>
          <p className="text-sm text-muted-foreground">
            Importe uma NF-e para iniciar a conferência dos itens.
          </p>
          <button
            type="button"
            className="inline-flex h-10 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => {
              // Placeholder para importação futura
            }}
          >
            Importar NF-e
          </button>
        </section>
      )}
    </div>
  );
}
