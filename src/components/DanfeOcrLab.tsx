/**
 * RODADA 20 — "LAB" DO OCR DA DANFE (tela temporária e somente leitura).
 *
 * Recebe os relatórios JSON do OCR (colados no navegador ou carregados de
 * arquivo), valida a estrutura e executa o MESMO parser do diálogo de
 * importação (`src/lib/danfe-ocr.ts` → `parseDanfeText`), comparando o
 * resultado com os dados de referência do documento.
 *
 * SEGURANÇA:
 *   • nenhuma mutation do Convex, nenhum acesso a banco — a tela roda 100%
 *     no navegador sobre texto colado;
 *   • nada é gravado (nem em banco, nem em storage): o conteúdo existe só
 *     durante a sessão da página;
 *   • o parser não é alterado — a tela apenas o executa.
 */
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  danfeFieldNotes,
  danfeFieldSummary,
  danfeFieldWarnings,
  parseDanfeText,
  validateDanfeFields,
  type DanfeParseResult,
} from "@/lib/danfe-ocr";
import { digitsOnly } from "@/lib/br-validators";
import { buildReportText, parseReportInput, type OcrReportPayload } from "@/lib/ocr-report";

type RowStatus = "ok" | "erro" | "pendente" | "info";

interface ReferenceRow {
  label: string;
  expected: string;
  obtained: string;
  status: RowStatus;
}

interface ReportResult {
  label: string;
  textLength: number;
  textSource: string;
  parsed: DanfeParseResult;
  rows: ReferenceRow[];
}

/** Referência do documento (item 2 da Rodada 20) — nunca substitui o original. */
const REF_EMITTER = "INCOTECH COMPANY LTDA";
const REF_EMITER_CNPJ = "22.816.315/0001-44";
const REF_KEY = "42260922816315000144550010000029671515440064";
const REF_RECEIVER = "MUNICIPIO DE CAPIVARI";
const REF_RECEIVER_CNPJ = "44.723.674/0001-90";
const REF_TOTAL = 1323.5;
const REF_CARRIER_CNPJ = "38.306.164/0001-14";

function eqText(actual: string | undefined, expected: string): RowStatus {
  if (!actual || !actual.trim()) return "pendente";
  return actual.trim().toUpperCase() === expected.toUpperCase() ? "ok" : "erro";
}

function eqDigits(actual: string | undefined, expected: string): RowStatus {
  if (!actual || !digitsOnly(actual)) return "pendente";
  return digitsOnly(actual) === digitsOnly(expected) ? "ok" : "erro";
}

function eqNumber(actual: number | undefined, expected: number): RowStatus {
  if (actual === undefined || Number.isNaN(actual)) return "pendente";
  return Math.abs(actual - expected) < 0.011 ? "ok" : "erro";
}

function buildRows(parsed: DanfeParseResult): ReferenceRow[] {
  const item = parsed.items[0];
  const rows: ReferenceRow[] = [
    {
      label: "Razão social do emitente",
      expected: REF_EMITTER,
      obtained: parsed.emitterName ?? "",
      status: eqText(parsed.emitterName, REF_EMITTER),
    },
    {
      label: "CNPJ do emitente",
      expected: REF_EMITER_CNPJ,
      obtained: parsed.emitterCnpj ?? "",
      status: eqDigits(parsed.emitterCnpj, REF_EMITER_CNPJ),
    },
    {
      label: "Número da NF-e",
      expected: "2967 (ou 000002967)",
      obtained: parsed.nfeNumber ?? "",
      status:
        parsed.nfeNumber && Number(digitsOnly(parsed.nfeNumber)) === 2967
          ? "ok"
          : parsed.nfeNumber
            ? "erro"
            : "pendente",
    },
    {
      label: "Série",
      expected: "001",
      obtained: parsed.series ?? "",
      status:
        parsed.series && Number(digitsOnly(parsed.series)) === 1 && parsed.series !== "55"
          ? "ok"
          : parsed.series
            ? "erro"
            : "pendente",
    },
    { label: "Modelo", expected: "55", obtained: "não exposto pelo parser", status: "info" },
    {
      label: "Data de emissão",
      expected: "2026-09-28 (28/09/2026)",
      obtained: parsed.emissionDate ?? "",
      status: eqText(parsed.emissionDate, "2026-09-28"),
    },
    {
      label: "Chave de acesso",
      expected: REF_KEY,
      obtained: parsed.accessKey ?? "",
      status: eqDigits(parsed.accessKey, REF_KEY),
    },
    {
      label: "Destinatário",
      expected: REF_RECEIVER,
      obtained: parsed.receiverName ?? "",
      status: eqText(parsed.receiverName, REF_RECEIVER),
    },
    {
      label: "CNPJ do destinatário",
      expected: REF_RECEIVER_CNPJ,
      obtained: parsed.receiverCnpj ?? "",
      status: eqDigits(parsed.receiverCnpj, REF_RECEIVER_CNPJ),
    },
    {
      label: "Código do item",
      expected: "231071",
      obtained: item?.code ?? "",
      status: eqDigits(item?.code, "231071"),
    },
    {
      label: "Descrição do item",
      expected: "KIT TECLADO E MOUSE USB SLIM CHOCO",
      obtained: item?.description ?? "",
      status: eqText(item?.description, "KIT TECLADO E MOUSE USB SLIM CHOCO"),
    },
    {
      label: "NCM",
      expected: "84716053",
      obtained: item?.ncm ?? "",
      status: eqDigits(item?.ncm, "84716053"),
    },
    {
      label: "Unidade",
      expected: "PC",
      obtained: item?.unit ?? "",
      status: eqText(item?.unit, "PC"),
    },
    {
      label: "Quantidade",
      expected: "25",
      obtained: item ? String(item.quantity) : "",
      status: item ? eqNumber(item.quantity, 25) : "pendente",
    },
    {
      label: "Valor unitário",
      expected: "52,94",
      obtained: item ? item.unitValue.toFixed(2).replace(".", ",") : "",
      status: item ? eqNumber(item.unitValue, 52.94) : "pendente",
    },
    {
      label: "Total do item",
      expected: "1.323,50",
      obtained: item ? item.totalValue.toFixed(2).replace(".", ",") : "",
      status: item ? eqNumber(item.totalValue, REF_TOTAL) : "pendente",
    },
    {
      label: "Total da NF-e",
      expected: "1.323,50",
      obtained:
        parsed.totalValue !== undefined
          ? parsed.totalValue.toFixed(2).replace(".", ",")
          : "",
      status: eqNumber(parsed.totalValue, REF_TOTAL),
    },
    {
      label: "AF",
      expected: "2223/2026",
      obtained: parsed.afNumber ?? "",
      status: eqDigits(parsed.afNumber, "2223/2026"),
    },
    {
      label: "Empenho (conferir visualmente)",
      expected: "7718/2026",
      obtained: parsed.empenhoNumber ?? "",
      status: eqDigits(parsed.empenhoNumber, "7718/2026"),
    },
    {
      label: "Transportadora × emitente/destinatário",
      expected: `${REF_CARRIER_CNPJ} nunca igual ao emitente/destinatário`,
      obtained: parsed.transporterCnpj ?? "(não lido)",
      status: !parsed.transporterCnpj
        ? "pendente"
        : digitsOnly(parsed.transporterCnpj) !== digitsOnly(parsed.emitterCnpj ?? "") &&
            digitsOnly(parsed.transporterCnpj) !== digitsOnly(parsed.receiverCnpj ?? "") &&
            digitsOnly(parsed.transporterCnpj) === digitsOnly(REF_CARRIER_CNPJ)
          ? "ok"
          : "erro",
    },
  ];
  return rows;
}

function statusBadge(status: RowStatus) {
  switch (status) {
    case "ok":
      return <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400">confere</Badge>;
    case "erro":
      return <Badge variant="destructive">diverge</Badge>;
    case "pendente":
      return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">pendente</Badge>;
    default:
      return <Badge variant="secondary">info</Badge>;
  }
}

export default function DanfeOcrLab() {
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [runToken, setRunToken] = useState(0);

  const analysis = useMemo(() => {
    if (runToken === 0 || !raw.trim()) return undefined;
    try {
      const parsedInput = parseReportInput(raw);
      const results: ReportResult[] = parsedInput.reports.map(
        (payload: OcrReportPayload) => {
          const { text, source } = buildReportText(payload);
          const parsed = parseDanfeText(text);
          return {
            label: payload.label,
            textLength: text.length,
            textSource: source,
            parsed,
            rows: buildRows(parsed),
          };
        },
      );
      return {
        structure: parsedInput.structure,
        isPlainText: parsedInput.isPlainText,
        results,
      };
    } catch (cause) {
      return { failure: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [raw, runToken]);

  const failure =
    error ??
    (analysis && "failure" in analysis ? analysis.failure : undefined);

  const onFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("Arquivo maior que 20 MB — cole o JSON do relatório em vez de subir o arquivo.");
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setRaw(text);
    setError(undefined);
    setRunToken((token) => token + 1);
  };

  const analyze = () => {
    setFileName((name) => name);
    setError(undefined);
    setRunToken((token) => token + 1);
  };

  const success = analysis && "results" in analysis ? analysis : undefined;
  const structure = success?.structure ?? [];
  const isPlainText = success?.isPlainText ?? false;
  const results = success?.results ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Laboratório do OCR da DANFE</h1>
        <p className="text-sm text-muted-foreground">
          Ferramenta temporária de desenvolvimento: cola/carrega o relatório JSON do OCR e
          executa o parser real do diálogo de importação, sem gravar nada.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Entrada do relatório</CardTitle>
          <CardDescription>
            Cole o JSON completo (objeto único, array com os dois relatórios ou o recorte com
            <code> rastreio.pageOcrText / regionTexts / mergedOcr</code>) — ou carregue o
            arquivo <code>.json</code>. Texto OCR puro também é aceito.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="ocr-json">Conteúdo do relatório</Label>
          <Textarea
            id="ocr-json"
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            placeholder='{"rastreio":{"pageOcrText":"…","regionTexts":["…"],"mergedOcr":"…"}}'
            className="min-h-52 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={analyze} disabled={!raw.trim()}>
              Analisar contra o parser real
            </Button>
            <label className="cursor-pointer text-sm text-muted-foreground underline underline-offset-4">
              Carregar arquivo .json
              <input
                type="file"
                accept=".json,.txt,application/json,text/plain"
                multiple
                className="hidden"
                onChange={(event) => void onFile(event.target.files)}
              />
            </label>
            {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
            <Badge variant="outline" className="ml-auto">
              somente leitura — nenhuma gravação
            </Badge>
          </div>
          {failure && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {failure}
            </p>
          )}
        </CardContent>
      </Card>

      {success && (
        <Card>
          <CardHeader>
            <CardTitle>2. Estrutura reconhecida</CardTitle>
            <CardDescription>
              {isPlainText
                ? "Entrada tratada como texto OCR puro (não JSON)."
                : "Chaves encontradas em qualquer nível do JSON:"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {structure.map((entry) => (
              <Badge
                key={entry.key}
                variant={entry.found ? "default" : "outline"}
                className={entry.found ? "" : "opacity-50"}
              >
                {entry.found ? "✓" : "—"} {entry.key}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {results.map((result) => {
        const summary = danfeFieldSummary(result.parsed);
        const pendencias = danfeFieldNotes(result.parsed);
        const avisos = danfeFieldWarnings(result.parsed);
        const divergencias = result.rows.filter((row) => row.status === "erro").length;
        return (
          <Card key={result.label}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                3. Resultado — {result.label}
                <Badge variant={divergencias === 0 ? "secondary" : "destructive"}>
                  {divergencias === 0 ? "sem divergências" : `${divergencias} divergência(s)`}
                </Badge>
              </CardTitle>
              <CardDescription>
                Texto: {result.textSource} ({result.textLength} caracteres) · campos válidos{" "}
                {summary.found}/{summary.total}
                {summary.missing.length > 0 && <> · ausentes: {summary.missing.join(", ")}</>}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-3">Campo</th>
                      <th className="py-2 pr-3">Esperado</th>
                      <th className="py-2 pr-3">Obtido</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={row.label} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-medium">{row.label}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{row.expected}</td>
                        <td className="py-2 pr-3 break-all">{row.obtained || "—"}</td>
                        <td className="py-2">{statusBadge(row.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-sm font-medium">
                    Pendentes de conferência humana ({pendencias.length})
                  </p>
                  {pendencias.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum.</p>
                  ) : (
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {pendencias.map((campo) => (
                        <li key={campo.campo}>
                          <span className="font-medium text-foreground">{campo.titulo}:</span>{" "}
                          {campo.note}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium">
                    Avisos de leitura ({avisos.length})
                  </p>
                  {avisos.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum.</p>
                  ) : (
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {avisos.map((aviso) => (
                        <li key={aviso.campo}>
                          <span className="font-medium text-foreground">{aviso.titulo}:</span>{" "}
                          {aviso.note}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  Notas por campo e valores crus do parser
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(
                    {
                      campos: validateDanfeFields(result.parsed),
                      notes: result.parsed.notes,
                      confidence: result.parsed.confidence,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
