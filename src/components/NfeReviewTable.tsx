/** @license University of São Paulo (CC-BY-SA 4.0) / modifications allowed under LGPL-3.0-or-later. */

import React from "react";
import { useCallback, useMemo } from "react";
import type { NfeDataFields, NfeProductFields, OcrParadigm } from "@/components/DanfeImportDialog";

import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Text, Card, CardHeader, CardTitle, CardDescription, CardContent } from "@sjoy/eds";
import { CodeTemplate, ClassNotFoundSnackbar } from "@/components/common";

import { NfeItemPruner } from "../lib/nfe-pruner";

// ─── Constants ─────────────────────────────────────────────────────────────

const fieldsShowMessage = {
  missingAccessKey: "Chave de acesso está pendente de conferência.",
  missingNfeNumber: "Número da NF-e está pendente de conferência.",
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatProductSeq(seq: string | null): string {
  if (!seq) return "—";
  return seq.trim();
}

function formatProductDescription(item: NfeProductFields): string {
  if (item?.productDescription) return item.productDescription.trim();
  if (item?.productKey) return item.productKey.trim();
  if (item?.productBrand || item?.productModel) {
    return [item.productBrand, item.productModel].filter(Boolean).join(" / ");
  }
  return null;
}

function formatMoney(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

// ─── Component ─────────────────────────────────────────────────────────────

export type NfeReviewTableProps = {
  nfeFields: NfeDataFields | null;
  paradigm: OcrParadigm | "unknown";
  originalFileName: string | null;
  onGoNext?: () => void;
  onGoBack?: () => void;
  onSnackClassNotFound?: (className: string, error?: Error) => void;
  onSnackCodeTemplate?: (className: string) => void;
  onProductCodeError?: (productKey: string) => void;
};

export function NfeReviewTable({
  nfeFields,
  paradigm,
  originalFileName,
  onGoNext,
  onGoBack,
  onSnackClassNotFound,
  onSnackCodeTemplate,
  onProductCodeError,
}: NfeReviewTableProps) {
  const [snackbarSnackClassNotFound, setSnackbarSnackClassNotFound] = React.useState<string | null>(null);
  const [snackbarSnackCodeTemplate, setSnackbarSnackCodeTemplate] = React.useState<string | null>(null);

  const items = useMemo<NfeProductFields[]>(() => nfeFields?.products ?? [], [nfeFields]);

  const prepareGoNext = useCallback((): boolean => {
    if (!nfeFields) return false;
    if (!nfeFields.accessKey || nfeFields.accessKey.trim() === "") {
      onSnackClassNotFound?.call(null, "missingAccessKey");
      return false;
    }
    if (!nfeFields.nfeNumber || nfeFields.nfeNumber.trim() === "") {
      onSnackClassNotFound?.call(null, "missingNfeNumber");
      return false;
    }
    // Prune: we can optionally prune items here using legacy pruning rules,
    // but for now we leave them all.
    // NfeItemPruner.safeItems(items);
    return true;
  }, [nfeFields, onSnackClassNotFound]);

  const handleGo = useCallback(() => {
    if (!prepareGoNext()) return;
    onGoNext?.();
  }, [prepareGoNext, onGoNext]);

  const handleCodeTemplateRequest = useCallback((className: string) => {
    if (onSnackCodeTemplate) onSnackCodeTemplate(className);
    else setSnackbarSnackCodeTemplate(className);
  }, [onSnackCodeTemplate]);

  //
  // ── Render helpers ──────────────────────────────────────────────────────
  //

  if (!nfeFields) return null;

  return (
    <>
      <ClassNotFoundSnackbar
        className={snackbarSnackClassNotFound ?? undefined}
        onClose={() => setSnackbarSnackClassNotFound(null)}
      />
      <CodeTemplate className={snackbarSnackCodeTemplate ?? undefined} onClose={() => setSnackbarSnackCodeTemplate(null)} />

      <Card variant="outlined" tone="info">
        <CardHeader>
          <CardTitle>Conferência de NF-e — OCR</CardTitle>
          <CardDescription>
            Edite os campos abaixo antes de confirmar a importação.
            O acesso é necessário para evitar duplicidade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campo</TableHead>
                <TableHead>Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Access key */}
              <TableRow>
                <TableCell>Chave de acesso</TableCell>
                <TableCell>
                  <Text size="sm">
                    {nfeFields.accessKey ?? (
                      <Text color="red" weight="bold">Pendente</Text>
                    )}
                  </Text>
                </TableCell>
              </TableRow>
              {/* NFE number */}
              <TableRow>
                <TableCell>Número da NF-e</TableCell>
                <TableCell>
                  <Text size="sm">
                    {nfeFields.nfeNumber ?? (
                      <Text color="red" weight="bold">Pendente</Text>
                    )}
                  </Text>
                </TableCell>
              </TableRow>
              {/* Emitente */}
              <TableRow>
                <TableCell>Emitente (CNPJ)</TableCell>
                <TableCell>
                  <Text size="sm">
                    {nfeFields.emitentCnpj ?? "Pendente"}
                  </Text>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Emitente (Razão Social)</TableCell>
                <TableCell>
                  <Text size="sm">
                    {nfeFields.emitentLegalName ?? "Pendente"}
                  </Text>
                </TableCell>
              </TableRow>
              {/* Destinatário */}
              <TableRow>
                <TableCell>Destinatário (CNPJ)</TableCell>
                <TableCell>
                  <Text size="sm">
                    {nfeFields.receiverCnpj ?? "Pendente"}
                  </Text>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Destinatário (Razão Social)</TableCell>
                <TableCell>
                  <Text size="sm">
                    {nfeFields.receiverLegalName ?? "Pendente"}
                  </Text>
                </TableCell>
              </TableRow>
              {/* Valores */}
              <TableRow>
                <TableCell>Valor Total</TableCell>
                <TableCell>
                  <Text size="sm">{formatMoney(nfeFields.totalAmount ? parseFloat(nfeFields.totalAmount) : null)}</Text>
                </TableCell>
              </TableRow>
              {/* Data de emissão / etc */}
              <TableRow>
                <TableCell>Data de emissão</TableCell>
                <TableCell>
                  <Text size="sm">{nfeFields.issueDate ?? "Pendente"}</Text>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Nota de Emissão</TableCell>
                <TableCell>
                  <Text size="sm">{nfeFields.noteOfCharge ?? "—"}</Text>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Imposto de Embarque</TableCell>
                <TableCell>
                  <Text size="sm">{nfeFields.noteOfInCharge ?? "—"}</Text>
                </TableCell>
              </TableRow>
              {/* Produtos */}
            </TableBody>
          </Table>

          {/* Produtos */}
          <SectionProductList
            products={items}
            onSnackClassNotFound={handleCodeTemplateRequest}
          />
        </CardContent>
      </Card>

      {/* Aviso de dados pendentes */}
      {!nfeFields.accessKey && (
        <Card variant="outlined" tone="warning">
          <CardContent>
            <Text>{fieldsShowMessage.missingAccessKey}</Text>
          </CardContent>
        </Card>
      )}
      {!nfeFields.nfeNumber && (
        <Card variant="outlined" tone="warning">
          <CardContent>
            <Text>{fieldsShowMessage.missingNfeNumber}</Text>
          </CardContent>
        </Card>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <Button variant="subtle" onMouseDown={(e) => { e.preventDefault(); onGoBack?.(); }}>
          Voltar
        </Button>
        <Button variant="primary" onMouseDown={(e) => { e.preventDefault(); handleGo(); }}>
          Continuar
        </Button>
      </div>
    </>
  );
}

// ─── Sub-component: list of products ────────────────────────────────────────

function SectionProductList({
  products,
  onSnackClassNotFound,
}: {
  products: NfeProductFields[];
  onSnackClassNotFound: (className: string) => void;
}) {
  const [snackbarClassNotFound, setSnackbarClassNotFound] = React.useState<string | null>(null);

  const handleSnackClassNotFound = useCallback((className: string) => {
    onSnackClassNotFound(className);
    setSnackbarClassNotFound(className);
  }, [onSnackClassNotFound]);

  if (products.length === 0) {
    return (
      <Card variant="outlined" tone="warning">
        <CardContent>
          <Text muted>Nenhum produto identificado.</Text>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <ClassNotFoundSnackbar
        className={snackbarClassNotFound ?? undefined}
        onClose={() => setSnackbarClassNotFound(null)}
      />
      <Card variant="outlined">
        <CardHeader>
          <CardTitle>Produtos</CardTitle>
          <CardDescription>Produtos identificados no DANFE (via OCR)</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead style={{ width: 60 }}>#</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead style={{ width: 80 }}>Qtd</TableHead>
                <TableHead style={{ width: 80 }}>Un.</TableHead>
                <TableHead style={{ width: 120 }}>V. Unit.</TableHead>
                <TableHead style={{ width: 120 }}>V. Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((item, index) => (
                <TableRow key={index}>
                  <TableCell>{formatProductSeq(item.seq)}</TableCell>
                  <TableCell>
                    <Text size="sm">
                      {formatProductDescription(item) ?? (
                        <Text color="red" weight="bold">Sem descrição</Text>
                      )}
                    </Text>
                    {item.productBrand && (
                      <Text size="xs" color="gray">
                        Marca: {item.productBrand.trim()}
                      </Text>
                    )}
                    {item.productModel && (
                      <Text size="xs" color="gray">
                        Modelo: {item.productModel.trim()}
                      </Text>
                    )}
                  </TableCell>
                  <TableCell>{item.productQuantity}</TableCell>
                  <TableCell>{item.unitOfMeasure ?? "—"}</TableCell>
                  <TableCell>{formatMoney(item.productUnitAmount ?? null)}</TableCell>
                  <TableCell>{formatMoney(item.productTotalAmount ?? null)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
