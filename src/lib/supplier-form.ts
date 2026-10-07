import { v } from "convex/values";

/**
 * Formulário de fornecedor: tipos e helpers de preenchimento.
 *
 * Mantido separado do componente para facilitar testes unitários e
 * compartilhamento com o OCR (pré-preenchimento).
 */

/** Tipos de logradouro (igual ao schema Convex). */
export const AddressTypeValues = [
  "rua",
  "avenida",
  "travessa",
  "alameda",
  "rodovia",
  "estrada",
  "outro",
] as const;

export type AddressType = (typeof AddressTypeValues)[number];

/** Forma de preencher o formulário a partir de dados externos (OCR/nova busca) */
export interface SupplierPreFill {
  legalName?: string;
  tradeName?: string;
  cnpj?: string;
  contactPerson?: string;
  contact?: string;
  phone?: string;
  email?: string;
  addressType?: AddressType;
  streetName?: string;
  number?: string;
  complement?: string;
  district?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  /** Endereço legado, se aplicável */
  addressLegacy?: string;
  /** Texto completo de endereço (opcional; pode ser usado como legado) */
  fullAddress?: string;
}

/** Estado do formulário controlado pelo componente */
export type SupplierDraft = {
  legalName: string;
  tradeName: string;
  cnpj: string;
  contactPerson: string;
  contact: string;
  phone: string;
  email: string;
  addressType: string;
  streetName: string;
  number: string;
  complement: string;
  district: string;
  postalCode: string;
  city: string;
  state: string;
  addressLegacy: string;
  observation: string;
};

/**
 * Máscara visuais de CNPJ para label/placeholder (não gravada no backend).
 * Exemplo: 22.816.315/0001-44
 */
export const MaskedCnpjPlaceholder = "00.000.000/0000-00";

/** Formata CNPJ para visualização na tela */
export const maskedCnpj = (raw: string | undefined | null): string => {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length !== 14) return raw ?? "";
  return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12,14)}`;
};

/** Formata telefone para visualização na tela */
export const maskedPhone = (raw: string | undefined | null): string => {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 11) {
    return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7,11)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6,10)}`;
  }
  return raw ?? "";
};

/** Formata CEP para visualização na tela */
export const maskedCep = (raw: string | undefined | null): string => {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length !== 8) return raw ?? "";
  return `${digits.slice(0,5)}-${digits.slice(5,8)}`;
};
