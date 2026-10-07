import { useState, useRef, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MapPin, Phone, Mail, Copy } from "lucide-react";
import { parseDanfeText } from "../lib/danfe-ocr";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, FileText, Image, Loader2, CheckCircle, X, Upload, Eye, Download, Building, Package, Key, DollarSign, Calendar, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  formatAccessKeyGrouped,
  formatCnpj,
  formatPhone,
  formatCep,
  digitsOnly,
  isValidCnpj,
} from "@/lib/br-validators";

export type DanfeImportField = {
  field: string;
  label: string;
  value: string;
  icon?: React.ElementType;
};

export type DanfeParsedItem = {
  code: string;
  description: string;
  quantity: number;
  unit: string;
  unitValue?: number;
  totalValue?: number;
};

export interface DanfeParsedData {
  nfeNumber?: string;
  series?: string;
  emissionDate?: string;
  accessKey?: string;
  emitterCnpj?: string;
  emitterName?: string;
  emitterPhone?: string;
  emitterEmail?: string;
  emitterAddress?: string;
  emitterCity?: string;
  emitterState?: string;
  emitterPostalCode?: string;
  receiverCnpj?: string;
  receiverName?: string;
  totalValue?: number;
  items: DanfeParsedItem[];
  rawFile?: File | null;
}

interface DanfeImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (data: DanfeParsedData) => void;
  onClose: () => void;
}

export function DanfeImportDialog({ open, onOpenChange, onImport, onClose }: DanfeImportDialogProps) {
  const [step, setStep] = useState<"upload" | "ocr" | "review" | "confirm">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [parsed, setParsed] = useState<DanfeParsedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tesseractRef = useRef<any>(null);

  const loadSuppliers = useCallback(async () => {
    const { data: suppliersData } = await api.suppliers.listActive();
    setSuppliers(suppliersData ?? []);
  }, []);

  const handleFile = async (f: File) => {
    setFile(f);
    setError(null);
    // Aceita PDF, imagem (JPG/PNG), e até XML como fallback
    if (!f) return;
    setStep("ocr");
    setOcrProgress(0);
    setOcrStatus("Carregando motor de OCR...");
    try {
      // Tesseract.js + @tesseract.js/tessdata loads the traineddata for Brazilian
      // Portuguese; the OCR yields text we later parse to find NF fields.
      const Tesseract = (await import("tesseract.js")).default;
      tesseractRef.current = Tesseract;
      const result = await Tesseract.recognize(        f,
        "eng+por",
        {
          logger: (m: any) => {
            if (m.status === "recognizing text") {
              setOcrProgress(Math.round((m.progress ?? 0) * 100));
            }
          },
        },
      );
      setOcrProgress(100);
      setOcrStatus("OCR concluído. Analisando dados...");
      const text = result.data.text ?? "";
      const parsed = parseDanfeText(text);
      if (!parsed.accessKey && !parsed.nfeNumber) {
        setError("Não foi possível identificar os dados da NF-e nesta Danfe. Verifique se o documento é legível ou tente importar o XML da NF-e.");
        setStep("upload");
        return;
      }
      setParsed(parsed);
      setStep("review");
    } catch (err: any) {
      setError(err?.message ?? "Não foi possível ler o arquivo. Verifique se ele é um PDF, imagem ou XML válido.");
      setStep("upload");
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (!f) return;
      handleFile(f);
    },
    [handleFile],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    handleFile(f);
    e.target.value = "";
  };

  const retriggerFileInput = () => fileInputRef.current?.click();

  const handleSupplierSelect = (id: string) => {
    setSelectedSupplierId(id);
  };

  const openCreateSupplier = () => {
    setCreateSupplierOpen(true);
  };

  const handleCreateSupplier = async (preFilled: any) => {
    try {
      const s = await api.suppliers.create({
        legalName: preFilled.legalName,
        tradeName: preFilled.tradeName,
        cnpj: preFilled.cnpj,
        contactPerson: preFilled.contactPerson,
        contact: preFilled.contact,
        phone: preFilled.phone,
        email: preFilled.email,
        addressType: "rua",
        streetName: preFilled.streetName,
        number: preFilled.number,
        complement: preFilled.complement,
        district: preFilled.district,
        postalCode: preFilled.postalCode,
        city: preFilled.city,
        state: preFilled.state,
        addressLegacy: preFilled.fullAddress,
        observation: "",
      });
      setSelectedSupplierId(s as any);
      toast.success("Fornecedor criado com sucesso.");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível criar fornecedor.");
    }
    setCreateSupplierOpen(false);
  };

  const confirmImport = () => {
    if (!parsed) return;
    onImport(parsed);
    onClose();
  };

  const fields: DanfeImportField[] = parsed
    ? [
        { field: "nfeNumber", label: "Número da NF-e", value: parsed.nfeNumber ?? "—", icon: FileText },
        { field: "series", label: "Série", value: parsed.series ?? "—", icon: FileText },
        { field: "emissionDate", label: "Data de emissão", value: parsed.emissionDate ?? "—", icon: Calendar },
        { field: "accessKey", label: "Chave de acesso", value: parsed.accessKey ? formatAccessKeyGrouped(parsed.accessKey) : "—", icon: Key },
        { field: "emitterCnpj", label: "CNPJ do emitente", value: parsed.emitterCnpj ? formatCnpj(parsed.emitterCnpj) : "—", icon: Building },
        { field: "emitterName", label: "Razão social do emitente", value: parsed.emitterName ?? "—", icon: Building },
        { field: "emitterPhone", label: "Telefone do emitente", value: parsed.emitterPhone ? formatPhone(parsed.emitterPhone) : "—", icon: Phone },
        { field: "emitterEmail", label: "E-mail do emitente", value: parsed.emitterEmail ?? "—", icon: Mail },
        { field: "emitterAddress", label: "Endereço do emitente", value: parsed.emitterAddress ?? "—", icon: MapPin },
        { field: "emitterCity", label: "Cidade do emitente", value: parsed.emitterCity ?? "—", icon: MapPin },
        { field: "emitterState", label: "UF do emitente", value: parsed.emitterState ?? "—", icon: MapPin },
        { field: "emitterPostalCode", label: "CEP do emitente", value: parsed.emitterPostalCode ? formatCep(parsed.emitterPostalCode) : "—", icon: MapPin },
        { field: "receiverCnpj", label: "CNPJ do destinatário", value: parsed.receiverCnpj ? formatCnpj(parsed.receiverCnpj) : "—", icon: Building },
        { field: "receiverName", label: "Razão social do destinatário", value: parsed.receiverName ?? "—", icon: Building },
        { field: "totalValue", label: "Valor total", value: parsed.totalValue ? `R$ ${parsed.totalValue.toFixed(2).replace('.', ',')}` : "—", icon: DollarSign },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar NF-e por DANFE/PDF/Imagem</DialogTitle>
          <DialogDescription>
            Faça o upload de um DANFE em PDF, imagem (JPG/PNG) ou XML para importar automaticamente os dados da nota fiscal.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertTriangle className="mt-0.5 shrink-0 h-4 w-4" />
            {error}
          </div>
        )}

        {step === "upload" && (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="relative w-full max-w-sm rounded-lg border-2 border-dashed border-border/50 p-8 text-center hover:border-primary/50 transition-colors cursor-pointer" onClick={retriggerFileInput}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/*,application/xml,text/xml"
                onChange={handleFileInput}
                className="hidden"
              />
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Arraste um DANFE, PDF, imagem ou XML aqui</p>
              <p className="text-xs text-muted-foreground mt-1">ou clique para selecionar</p>
              <div className="flex justify-center gap-2 mt-2">
                <Badge variant="outline" className="text-xs">PDF</Badge>
                <Badge variant="outline" className="text-xs">JPG</Badge>
                <Badge variant="outline" className="text-xs">PNG</Badge>
                <Badge variant="outline" className="text-xs">XML</Badge>
              </div>
            </div>
          </div>
        )}

        {step === "ocr" && (
          <div className="py-6 space-y-4">
            <div className="flex items-center justify-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm">{ocrStatus ?? "Processando..."}</span>
            </div>
            <Progress value={ocrProgress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">Tempo estimado: 1–2 minutos (depois da primeira vez)</p>
          </div>
        )}

        {step === "review" && parsed && (
          <div className="px-2 py-4 space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">OCR</Badge>
              <Badge variant="outline" className="text-xs">{parsed.items.length} itens</Badge>
              <Badge variant="outline" className="text-xs">
                {parsed.accessKey
                  ? "Chave de acesso identificada"
                  : "Chave de acesso não identificada"}
              </Badge>
            </div>

            {/* Dados do emitente */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Emitente</CardTitle>
                <CardDescription>Fornecedor identificado na DANFE</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <Label className="text-xs">CNPJ</Label>
                    <p className="text-sm font-mono">{parsed.emitterCnpj ? formatCnpj(parsed.emitterCnpj) : "—"}</p>
                  </div>
                  <div>
                    <Label className="text-xs">Razão Social</Label>
                    <p className="text-sm font-medium">{parsed.emitterName ?? "—"}</p>
                  </div>
                  {parsed.emitterPhone && (
                    <div>
                      <Label className="text-xs">Telefone</Label>
                      <p className="text-sm font-mono">{formatPhone(parsed.emitterPhone)}</p>
                    </div>
                  )}
                  {parsed.emitterEmail && (
                    <div>
                      <Label className="text-xs">E-mail</Label>
                      <p className="text-sm">{parsed.emitterEmail}</p>
                    </div>
                  )}
                  {parsed.emitterAddress && (
                    <div className="col-span-2">
                      <Label className="text-xs">Endereço</Label>
                      <p className="text-sm">{parsed.emitterAddress}</p>
                    </div>
                  )}
                  {parsed.emitterCity && (
                    <div className="col-span-2 sm:col-span-1">
                      <Label className="text-xs">Cidade</Label>
                      <p className="text-sm">{parsed.emitterCity}</p>
                    </div>
                  )}
                  {parsed.emitterState && (
                    <div className="col-span-2 sm:col-span-1">
                      <Label className="text-xs">UF</Label>
                      <p className="text-sm font-medium">{parsed.emitterState}</p>
                    </div>
                  )}
                  {parsed.emitterPostalCode && (
                    <div className="col-span-2 sm:col-span-1">
                      <Label className="text-xs">CEP</Label>
                      <p className="text-sm font-mono">{formatCep(parsed.emitterPostalCode)}</p>
                    </div>
                  )}
                </div>
                <div className="mt-3 pt-3 border-t flex items-center justify-between gap-2">
                  <Button variant="outline" size="sm" className="gap-1" onClick={openCreateSupplier}>
                    <Building className="h-3.5 w-3.5" /> Novo fornecedor
                  </Button>
                  <Select value={selectedSupplierId} onValueChange={handleSupplierSelect}>
                    <SelectTrigger className="w-min">
                      <SelectValue placeholder="Fornecedor não cadastrado" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s._id} value={s._id}>
                          {s.cnpj ? `${s.legalName} — ${formatCnpj(s.cnpj)}` : s.legalName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Dados do destinatário */}
            {(parsed.receiverName || parsed.receiverCnpj) && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Destinatário</CardTitle>
                  <CardDescription>Você (ou o responsável pela entrada)</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <Label className="text-xs">CNPJ</Label>
                      <p className="text-sm font-mono">{parsed.receiverCnpj ? formatCnpj(parsed.receiverCnpj) : "—"}</p>
                    </div>
                    <div>
                      <Label className="text-xs">Razão Social</Label>
                      <p className="text-sm font-medium">{parsed.receiverName ?? "—"}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Itens */}
            {parsed.items.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Itens da NF-e</CardTitle>
                  <CardDescription>Produtos identificados na DANFE</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[30%]">Produto</TableHead>
                        <TableHead className="text-right">Quantidade</TableHead>
                        <TableHead className="text-right">Valor Unit.</TableHead>
                        <TableHead className="text-right">Valor Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsed.items.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-sm">
                            <div className="font-medium">{item.description}</div>
                            {item.code && <div className="text-xs text-muted-foreground font-mono">Cód. {item.code}</div>}
                          </TableCell>
                          <TableCell className="text-right font-mono">{item.quantity}</TableCell>
                          <TableCell className="text-right font-mono">
                            {item.unitValue != null ? `R$ ${item.unitValue.toFixed(2).replace('.', ',')}` : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {item.totalValue != null ? `R$ ${item.totalValue.toFixed(2).replace('.', ',')}` : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="mt-3 pt-3 border-t flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total geral:</span>
                    <span className="font-medium font-mono">
                      {parsed.totalValue != null ? `R$ ${parsed.totalValue.toFixed(2).replace('.', ',')}` : "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Chave de acesso */}
            {parsed.accessKey && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Chave de acesso</CardTitle>
                  <CardDescription>Identificador único da NF-e (44 dígitos)</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-muted-foreground" />
                    <Input value={parsed.accessKey} readOnly className="flex-1 font-mono text-xs tracking-wider" />
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => {
                      navigator.clipboard.writeText(parsed.accessKey ?? "");
                      toast.success("Chave copiada para a área de transferência.");
                    }}>
                      <Copy className="h-3.5 w-3.5" /> Copiar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Arquivo importado */}
            {parsed.rawFile && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Documento original</CardTitle>
                  <CardDescription>DANFE que foi utilizado para a importação</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm truncate">{parsed.rawFile.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({(parsed.rawFile.size / 1024 / 1024).toFixed(2)} MB)
                    </span>
                    <Button variant="outline" size="sm" className="ml-auto gap-1" asChild>
                      <a href={URL.createObjectURL(parsed.rawFile)} target="_blank" rel="noopener noreferrer">
                        <Eye className="h-3.5 w-3.5" /> Visualizar
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Ações */}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                <X className="h-4 w-4 mr-1" /> Cancelar
              </Button>
              <Button onClick={confirmImport}>
                Confirmar importação
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "confirm" && (
          <div className="py-6 space-y-4">
            <div className="flex items-center gap-3 text-success">
              <CheckCircle className="h-6 w-6" />
              <div>
                <p className="font-medium">Importação concluída</p>
                <p className="text-sm text-muted-foreground">{parsed?.nfeNumber ?? ""}</p>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Fechar</Button>
            </DialogFooter>
          </div>
        )}

        {/* Modal de novo fornecedor */}
        <Dialog open={createSupplierOpen} onOpenChange={setCreateSupplierOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Novo fornecedor (a partir da DANFE)</DialogTitle>
              <DialogDescription>
                Os dados abaixo foram extraídos da DANFE. Revise e complete as informações antes de salvar.
              </DialogDescription>
            </DialogHeader>
            <NewSupplierFromDanfe
              parsed={parsed}
              onSave={(supplier) => handleCreateSupplier(supplier)}
              onCancel={() => setCreateSupplierOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Interface para criação de fornecedor a partir dos dados extraídos da DANFE
 */
interface NewSupplierFromDanfeProps {
  parsed: DanfeParsedData | null;
  onSave: (supplier: any) => void;
  onCancel: () => void;
}

function NewSupplierFromDanfe({ parsed, onSave, onCancel }: NewSupplierFromDanfeProps) {
  const [name, setName] = useState(parsed?.emitterName ?? "");
  const [tradeName, setTradeName] = useState("");
  const [cnpj, setCnpj] = useState(parsed?.emitterCnpj ?? "");
  const [contactPerson, setContactPerson] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState(parsed?.emitterPhone ?? "");
  const [email, setEmail] = useState(parsed?.emitterEmail ?? "");
  const [street, setStreet] = useState(parsed?.emitterAddress ?? "");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [district, setDistrict] = useState("");
  const [city, setCity] = useState(parsed?.emitterCity ?? "");
  const [state, setState] = useState(parsed?.emitterState ?? "");
  const [postalCode, setPostalCode] = useState(parsed?.emitterPostalCode ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Razão social é obrigatória.");
      return;
    }

    const digits = cnpj.replace(/\D/g, "").slice(0, 14);
    if (digits.length === 14 && !isValidCnpj(digits)) {
      setError("CNPJ inválido. Confira os dígitos.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { data: createdSupplier } = await api.suppliers.create({
        legalName: name.trim(),
        tradeName: tradeName.trim() || undefined,
        cnpj: digits || undefined,
        contactPerson: contactPerson.trim() || undefined,
        contact: contact.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim().toLowerCase() || undefined,
        addressType: "rua",
        streetName: street.trim() || undefined,
        number: number.trim() || undefined,
        complement: complement.trim() || undefined,
        district: district.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim().toUpperCase() || undefined,
        addressLegacy: (street || number || district || city || state ? [street, number, district, city, state].filter(Boolean).join(", ") : undefined) ?? undefined,
        observation: "",
      });
      onSave(createdSupplier ?? null);
    } catch (err: any) {
      setError(err?.message ?? "Não foi possível salvar fornecedor.");
    } finally {
      setSaving(false);
    }
  };

  const logradouros: Record<string, string> = {
    rua: "Rua",
    avenida: "Avenida",
    travessa: "Travessa",
    alameda: "Alameda",
    rodovia: "Rodovia",
    estrada: "Estrada",
    outro: "Outro",
  };

  return (
    <div className="space-y-4 py-2">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="mt-0.5 shrink-0 h-4 w-4" />
          {error}
        </div>
      )}

      <div className="col-span-2">
        <Label>Razão Social *</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Razão social" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Nome Fantasia</Label>
          <Input value={tradeName} onChange={(e) => setTradeName(e.target.value)} placeholder="Nome fantasia" />
        </div>
        <div className="relative">
          <Label>CNPJ</Label>
          <Input
            value={cnpj}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 14);
              setCnpj(digits);
            }}
            placeholder="00.000.000/0000-00"
          />
          {cnpj?.length === 14 && isValidCnpj(cnpj) ? (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600 text-[11px]">
              ✓
            </span>
          ) : (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[10px]">
              {cnpj?.length === 0 ? "14 dígitos" : "formato inválido"}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Pessoa de Contato</Label>
          <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="Pessoa de contato" />
        </div>
        <div>
          <Label>Contato</Label>
          <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Departamento / e-mail de contato" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Telefone</Label>
          <Input
            value={phone}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 11);
              setPhone(digits);
            }}
            placeholder="(00) 00000-0000"
          />
          <p className="text-[10px] text-muted-foreground mt-1">10 ou 11 dígitos</p>
        </div>
        <div>
          <Label>E-mail</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contato@exemplo.com" />
        </div>
      </div>

      <div className="col-span-2 pt-2">
        <Label className="mb-2">Endereço</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <Label>Tipo de Logradouro</Label>
            <Select value="rua" onValueChange={() => {}}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(logradouros).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Label>Logradouro</Label>
            <Input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Rua / Avenida / Travessa..." />
          </div>
          <div>
            <Label>Número</Label>
            <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="S/N" />
          </div>
          <div>
            <Label>Complemento</Label>
            <Input value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Apto, salão..." />
          </div>
          <div>
            <Label>Bairro</Label>
            <Input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="Bairro" />
          </div>
          <div className="relative col-span-2 sm:col-span-1">
            <Label>CEP</Label>
            <Input
              value={postalCode}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
                setPostalCode(digits);
              }}
              placeholder="00000000"
            />
            {postalCode?.length === 8 ? (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600 text-[11px]">
                ✓
              </span>
            ) : (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[10px]">
                8 dígitos
              </span>
            )}
          </div>
          <div>
            <Label>Cidade</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cidade" />
          </div>
          <div>
            <Label>UF</Label>
            <Input
              value={state}
              onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
              placeholder="SP"
              maxLength={2}
            />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Você pode alterar o endereço depois se necessário.
        </p>
      </div>

      <div className="col-span-2">
        <Label>Endereço (texto legado — opcional)</Label>
        <Textarea
          value={(street || number || district || city || state ? [street, number, district, city, state].filter(Boolean).join(", ") : "")}
          onChange={(e) => {}}
          rows={2}
          placeholder="Para manter uma referência do endereço antigo..."
          readOnly
        />
      </div>

      <div className="col-span-2">
        <Label>Observações</Label>
        <Textarea value="" onChange={(e) => {}} rows={2} placeholder="Informações internas..." readOnly />
        <p className="text-[10px] text-muted-foreground mt-1">
          Não inclua CPF, RG, telefone, endereço, dados de saúde ou dados pessoais desnecessários.
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button disabled={saving} onClick={handleSave}>
          {saving ? "Salvando..." : "Cadastrar fornecedor"}
        </Button>
      </DialogFooter>
    </div>
  );
}
