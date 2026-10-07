import { useState, useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AddressTypeValues,
  type SupplierDraft,
  type SupplierPreFill,
  type AddressType,
} from "@/lib/supplier-form";
import { isValidCnpj } from "@/lib/br-validators";
import { cn } from "@/lib/utils";

interface SupplierFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  supplierId: string | null;
  preFilled?: SupplierPreFill | null;
}

export function SupplierForm({ open, onOpenChange, mode, supplierId, preFilled }: SupplierFormProps) {
  const saveMutation = useMutation(
    mode === "edit" ? api.suppliers.update : api.suppliers.create,
  );

  const [saving, setSaving] = useState(false);
  const [savingError, setSavingError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [form, setForm] = useState<SupplierDraft>({
    legalName: "",
    tradeName: "",
    cnpj: "",
    contactPerson: "",
    contact: "",
    phone: "",
    email: "",
    addressType: "rua",
    streetName: "",
    number: "",
    complement: "",
    district: "",
    postalCode: "",
    city: "",
    state: "",
    addressLegacy: preFilled?.addressLegacy ?? preFilled?.fullAddress ?? "",
    observation: "",
  });

  const [localId, setLocalId] = useState<string | null>(supplierId);

  // Pré-preenchimento a partir de dados extraídos pelo OCR (primeiro render)
  useEffect(() => {
    if (!preFilled || mode === "edit") return;
    setForm((prev) => ({
      ...prev,
      legalName: preFilled.legalName ?? prev.legalName,
      tradeName: preFilled.tradeName ?? prev.tradeName,
      cnpj: preFilled.cnpj ?? prev.cnpj,
      contactPerson: preFilled.contactPerson ?? prev.contactPerson,
      contact: preFilled.contact ?? prev.contact,
      phone: preFilled.phone ?? prev.phone,
      email: preFilled.email ?? prev.email,
      addressType: preFilled.addressType ?? prev.addressType,
      streetName: preFilled.streetName ?? prev.streetName,
      number: preFilled.number ?? prev.number,
      complement: preFilled.complement ?? prev.complement,
      district: preFilled.district ?? prev.district,
      postalCode: preFilled.postalCode ?? prev.postalCode,
      city: preFilled.city ?? prev.city,
      state: preFilled.state ?? prev.state,
      addressLegacy: preFilled.addressLegacy ?? prev.addressLegacy,
    }));
  }, [preFilled, mode]);

  // Quando se edita um fornecedor, carrega os dados
  useEffect(() => {
    if (mode !== "edit" || !supplierId) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await api.suppliers.findByIdForNfe(supplierId);
        if (cancelled || !s) return;

        setForm((prev) => ({
          ...prev,
          legalName: s?.legalName ?? prev.legalName,
          tradeName: s.tradeName ?? "",
          cnpj: s.cnpj ?? "",
          contactPerson: s.contactPerson ?? "",
          contact: s.contact ?? "",
          phone: s.phone ?? "",
          email: s.email ?? "",
          addressType: s.addressType ?? prev.addressType,
          streetName: s.streetName ?? "",
          number: s.number ?? "",
          complement: s.complement ?? "",
          district: s.district ?? "",
          postalCode: s.postalCode ?? "",
          city: s.city ?? "",
          state: s.state ?? "",
          addressLegacy: s.addressLegacy ?? prev.addressLegacy,
        }));
        setLocalId(supplierId);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supplierId, mode]);

  const updateField = (field: keyof SupplierDraft, value: string) => {
    setForm((f: SupplierDraft) => ({ ...f, [field]: value }));
  };  const fetchCep = async (cep: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.erro) {
          setForm((f: SupplierDraft) => ({
            ...f,
            streetName: data.logradouro?.trim() || f.streetName,
            district: data.bairro?.trim() || f.district,
            city: data.localidade?.trim() || f.city,
            state: data.uf?.trim() || f.state,
          }));
        }
      } catch {
        // falha silenciosa
      }
    }, 400);
  };

  const    handleCepInput = (cep: string) => {
    const digits = cep.replace(/\D/g, "").slice(0, 8);
    updateField("postalCode", digits);
    if (digits.length === 8) fetchCep(digits);
  };

  const handleSave = async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    setSaving(true);
    setSavingError(null);
    try {
      const args: any = {
        legalName: form.legalName.trim(),
        tradeName: form.tradeName.trim() || undefined,
        cnpj: form.cnpj.trim() || undefined,
        contactPerson: form.contactPerson.trim() || undefined,
        contact: form.contact.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        addressType: (form.addressType as AddressType) || undefined,
        streetName: form.streetName.trim() || undefined,
        number: form.number.trim() || undefined,
        complement: form.complement.trim() || undefined,
        district: form.district.trim() || undefined,
        postalCode: form.postalCode.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        addressLegacy: form.addressLegacy?.trim() || undefined,
        observation: form.observation.trim() || undefined,
      };
      if (mode === "edit" && localId) args.id = localId;
      await saveMutation(args);
      onOpenChange(false);
      setForm({
        legalName: "",
        tradeName: "",
        cnpj: "",
        contactPerson: "",
        contact: "",
        phone: "",
        email: "",
        addressType: "rua",
        streetName: "",
        number: "",
        complement: "",
        district: "",
        postalCode: "",
        city: "",
        state: "",
        addressLegacy: "",
        observation: "",
      });
    } catch (err: any) {
      setSavingError(err?.message ?? "Não foi possível salvar o fornecedor");
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit"
              ? "Editar fornecedor"
              : preFilled
                ? "Cadastrar fornecedor da NF-e"
                : "Novo fornecedor"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Razão social */}
          <div className="col-span-2">
            <Label>Razão Social *</Label>
            <Input
              value={form.legalName}
              onChange={(e) => updateField("legalName", e.target.value)}
              placeholder="Razão social"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Nome Fantasia</Label>
              <Input
                value={form.tradeName}
                onChange={(e) => updateField("tradeName", e.target.value)}
                placeholder="Nome fantasia"
              />
            </div>
            <div className="relative">
              <Label>CNPJ</Label>
              <Input
                value={form.cnpj}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 14);
                  updateField("cnpj", digits);
                }}
                placeholder="00000000000000"
              />
              {form.cnpj?.length === 14 && isValidCnpj(form.cnpj) ? (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600 text-[11px]">✓</span>
              ) : (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[10px]">
                  {form.cnpj?.length === 0 ? "14 dígitos" : "formato inválido"}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Pessoa de Contato</Label>
              <Input
                value={form.contactPerson}
                onChange={(e) => updateField("contactPerson", e.target.value)}
                placeholder="Pessoa de contato"
              />
            </div>
            <div>
              <Label>Contato</Label>
              <Input
                value={form.contact}
                onChange={(e) => updateField("contact", e.target.value)}
                placeholder="Departamento / e-mail de contato"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Telefone</Label>
              <Input
                value={form.phone}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 11);
                  updateField("phone", digits);
                }}
                placeholder="(00) 00000-0000"
              />
              <p className="text-[10px] text-muted-foreground mt-1">10 ou 11 dígitos</p>
            </div>
            <div>
              <Label>E-mail</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                placeholder="contato@exemplo.com"
              />
            </div>
          </div>

          {/* Endereço */}
          <div className="col-span-2 pt-2">
            <Label className="mb-2">Endereço</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <Label>Tipo de Logradouro</Label>
                <Select value={form.addressType} onValueChange={(v) => updateField("addressType", v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {    AddressTypeValues.map((t: string) => (
                      <SelectItem key={t} value={t}>{logradouros[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <Label>Logradouro</Label>
                <Input
                  value={form.streetName}
                  onChange={(e) => updateField("streetName", e.target.value)}
                  placeholder="Rua / Avenida / Travessa..."
                />
              </div>
              <div>
                <Label>Número</Label>
                <Input
                  value={form.number}
                  onChange={(e) => updateField("number", e.target.value)}
                  placeholder="S/N"
                />
              </div>
              <div>
                <Label>Complemento</Label>
                <Input
                  value={form.complement}
                  onChange={(e) => updateField("complement", e.target.value)}
                  placeholder="Apto, salão..."
                />
              </div>
              <div>
                <Label>Bairro</Label>
                <Input
                  value={form.district}
                  onChange={(e) => updateField("district", e.target.value)}
                  placeholder="Bairro"
                />
              </div>
              <div className="relative col-span-2 sm:col-span-1">
                <Label>CEP</Label>
                <Input
                  value={form.postalCode}
                  onChange={(e) => handleCepInput(e.target.value)}
                  placeholder="00000000"
                />
                {form.postalCode?.length === 8 ? (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600 text-[11px]">✓</span>
                ) : (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[10px]">
                    8 dígitos
                  </span>
                )}
              </div>
              <div>
                <Label>Cidade</Label>
                <Input
                  value={form.city}
                  onChange={(e) => updateField("city", e.target.value)}
                  placeholder="Cidade"
                />
              </div>
              <div>
                <Label>UF</Label>
                <Input
                  value={form.state}
                  onChange={(e) => updateField("state", e.target.value.toUpperCase().slice(0, 2))}
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
              value={form.addressLegacy}
              onChange={(e) => updateField("addressLegacy", e.target.value)}
              rows={2}
              placeholder="Para manter uma referência do endereço antigo..."
            />
          </div>

          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea
              value={form.observation}
              onChange={(e) => updateField("observation", e.target.value)}
              rows={2}
              placeholder="Informações internas..."
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Não inclua CPF, RG, telefone, endereço, dados de saúde ou dados pessoais desnecessários.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={handleSave}>
            {saving
              ? "Salvando..."
              : mode === "edit"
                ? "Salvar alterações"
                : "Cadastrar fornecedor"}
          </Button>
        </DialogFooter>

        {savingError && (
          <p className="text-sm text-destructive py-1">{savingError}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
