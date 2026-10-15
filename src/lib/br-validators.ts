// Mascaras e validações de dados brasileiros (CNPJ/CPF/telefone/CEP/chave/moeda).

/** Retorna somente os dígitos de uma string. */
export function digitsOnly(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Formata CNPJ para exibição: XX.XXX.XXX/XXXX-XX. */
export const formatCnpj = (value: string | null | undefined): string => {
  const digits = digitsOnly(value);
  if (digits.length !== 14) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
};

/** Formata CPF para exibição: XXX.XXX.XXX-XX. */
export const formatCpf = (value: string | null | undefined): string => {
  const digits = digitsOnly(value);
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
};

/** Formata telefone para exibição: (XX) XXXXX-XXXX ou (XX) XXXXX-XXXX com dígito extra. */
export const formatPhone = (value: string | null | undefined): string => {
  return maskPhone(value);
};

/** Formata CEP para exibição: XXXXX-XXX. */
export const formatCep = (value: string | null | undefined): string => {
  const digits = digitsOnly(value);
  if (digits.length !== 8) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5, 8)}`;
};

/** Formata moeda para exibição: R$ X.XXX,XX. */
export const formatCurrency = (value: string | number | null | undefined): string => {
  const num = typeof value === "number" ? value : Number((value ?? "").replace(/\D/g, "").replace(/(\d{2})$/, ".$1")) || 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

/** Agrupa a chave de acesso NF-e (44 dígitos) em blocos de 4 com espaços. */
export const formatAccessKeyGrouped = (value: string | null | undefined): string => {
  const digits = digitsOnly(value);
  if (digits.length !== 44) return digits;
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 4) {
    groups.push(digits.slice(i, i + 4));
  }
  return groups.join(" ");
};

// ─── Normalização ────────────────────────────────────────────────────────────

/** Normaliza CNPJ para somente dígitos. */
export const normalizeCnpj = (value: string | null | undefined): string => digitsOnly(value);

/** Normaliza CPF para somente dígitos. */
export const normalizeCpf = (value: string | null | undefined): string => digitsOnly(value);

/** Normaliza telefone para somente dígitos. */
export const normalizePhone = (value: string | null | undefined): string => digitsOnly(value);

/** Normaliza CEP para somente dígitos. */
export const normalizeCep = (value: string | null | undefined): string => digitsOnly(value);

/** Normaliza moeda: remove tudo que não é dígito nem ponto decimal. */
export const normalizeCurrency = (value: string | null | undefined): string => {
  const cleaned = (value ?? "").replace(/\D/g, "").replace(/(\d{2})$/, ".$1");
  const num = Number(cleaned);
  if (!isFinite(num)) return "";
  return String(num);
};

/** Normaliza chave de acesso NF-e para somente dígitos 44. */
export const normalizeAccessKey = (value: string | null | undefined): string => {
  const digits = digitsOnly(value);
  return digits.slice(0, 44);
};

// ─── Validação ───────────────────────────────────────────────────────────────

/** Valida CPF pelos dígitos verificadores. */
export function isValidCpf(value: string | null | undefined): boolean {
  const digits = digitsOnly(value);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // repetido
  return cpfCheckDigit(digits) === digits.slice(9);
}

/** Valida CNPJ pelos dígitos verificadores. */
export function isValidCnpj(value: string | null | undefined): boolean {
  const digits = digitsOnly(value);
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false; // repetido
  return cnpjCheckDigit(digits) === digits.slice(12);
}

/**
 * Dígito verificador da chave de acesso NF-e (módulo 11).
 * pesos de 2 a 9 em ciclo, da direita para a esquerda (regra da SEFAZ).
 */
function accessKeyCheckDigit(base: string): string {
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    const posFromRight = base.length - 1 - i;
    const weight = 2 + (posFromRight % 8);
    sum += Number(base[i]) * weight;
  }
  const remainder = sum % 11;
  return remainder < 2 ? "0" : String(11 - remainder);
}

/** Valida chave de acesso NF-e (44 dígitos) com DV. */
export function isValidAccessKey(value: string | null | undefined): boolean {
  const digits = digitsOnly(value);
  if (digits.length !== 44) return false;
  if (!/^\d{44}$/.test(digits)) return false;
  if (!isValidUfCode(digits.slice(0, 2))) return false; // UF impossível não é chave
  if (digits.slice(20, 22) !== "55" && digits.slice(20, 22) !== "65") return false; // modelo NF-e/NFC-e
  return digits.slice(43) === accessKeyCheckDigit(digits.slice(0, 43));
}

/** Código IBGE de UF válido (chave de acesso começa pela UF emitente). */
export function isValidUfCode(code: string): boolean {
  const n = Number(code);
  if (!/^\d{2}$/.test(code)) return false;
  return (
    (n >= 11 && n <= 17) ||
    (n >= 21 && n <= 29) ||
    (n >= 31 && n <= 35) ||
    (n >= 41 && n <= 49) ||
    (n >= 50 && n <= 53)
  );
}

// ─── Máscaras dinâmicas ──────────────────────────────────────────────────────

export const maskCnpj = (value: string | null | undefined): string => {
  return applyCNPJ(digitsOnly(value));
};

export const maskCpf = (value: string | null | undefined): string => {
  return applyCPF(digitsOnly(value));
};

export const maskPhone = (value: string | null | undefined): string => {
  const digits = digitsOnly(value);
  // celular: 10 ou 11 dígitos
  if (digits.length <= 10) {
    if (digits.length < 6) return digits;
    if (digits.length <= 6) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    }
    if (digits.length <= 7) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }
    // 8-10 dígitos: fixo
    if (digits.length === 8) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  // 11 dígitos -> celular com dígito
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  // acima de 11 dígitos, apenas os 11 primeiros
  return maskPhone(digits.slice(0, 11));
};

export const maskCep = (value: string | null | undefined): string => {
  const digits = digitsOnly(value);
  if (digits.length <= 5) return digits;
  if (digits.length === 6) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  if (digits.length === 7) {
    return `${digits.slice(0, 5)}-${digits.slice(5, 7)}`;
  }
  return `${digits.slice(0, 5)}-${digits.slice(5, 8)}`;
};

export const maskCurrency = (value: string | null | undefined): string => {
  const raw = (value ?? "").trim();
  if (!raw) return "";

  // Máscara progressiva: o separador digitado (vírgula; ou ponto que não seja
  // milhar) delimita inteiros x decimais — o que foi digitado aparece como está.
  const separatorIndex = findCurrencySeparator(raw);
  let integer: string;
  let decimal: string;
  if (separatorIndex !== -1) {
    integer = raw.slice(0, separatorIndex).replace(/\D/g, "");
    decimal = raw.slice(separatorIndex + 1).replace(/\D/g, "");
  } else {
    const digits = raw.replace(/\D/g, "");
    if (digits.length <= 2) {
      integer = "";
      decimal = digits.padEnd(2, "0");
    } else {
      integer = digits.slice(0, digits.length - 2);
      decimal = digits.slice(digits.length - 2);
    }
  }

  const formatted = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (decimal ? `,${decimal}` : "");
  return `R$ ${formatted}`;
};

function findCurrencySeparator(raw: string): number {
  const comma = raw.indexOf(",");
  if (comma !== -1) return comma;
  const dot = raw.indexOf(".");
  // Ponto só é decimal quando não segue o padrão de milhar 1.234.567.
  if (dot !== -1 && !/^\d{1,3}(?:\.\d{3})+$/.test(raw)) return dot;
  return -1;
}

// ─── Internos ────────────────────────────────────────────────────────────────

function cpfCheckDigit(base: string): string {
  // primeiro DV
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(base[i]) * (10 - i);
  }
  let remainder = sum % 11;
  const dv1 = remainder < 2 ? "0" : String(11 - remainder);
  // segundo DV
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(base[i] ?? dv1[i - 9]) * (11 - i);
  }
  remainder = sum % 11;
  const dv2 = remainder < 2 ? "0" : String(11 - remainder);
  return dv1 + dv2;
}

function cnpjCheckDigit(base: string): string {
  const calc = (slice: string, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += Number(slice[i]) * weights[i];
    }
    const remainder = sum % 11;
    return remainder < 2 ? "0" : String(11 - remainder);
  };
  // 1º DV: pesos 5..2 cíclicos (12 dígitos); 2º DV: pesos 6..2 (13 dígitos).
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const dv1 = calc(base, weights1);
  return dv1 + calc(base + dv1, weights2);
}

function applyCNPJ(digits: string): string {
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  if (digits.length < 14) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

function applyCPF(digits: string): string {
  if (!digits) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  if (digits.length < 11) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

// ─── Exportação adicional para compatibilidade com módulos importadores ──────

export const DANFE_TRACKED_FIELDS = [
  { field: "nfeNumber", label: "Número da NF-e" },
  { field: "series", label: "Série" },
  { field: "emissionDate", label: "Data de emissão" },
  { field: "accessKey", label: "Chave de acesso" },
  { field: "emitterCnpj", label: "CNPJ emitente" },
  { field: "emitterName", label: "Razão social emitente" },
  { field: "receiverCnpj", label: "CNPJ receptor" },
  { field: "receiverName", label: "Razão social receptor" },
  { field: "issuerCnpj", label: "CNPJ expedidor" },
  { field: "issuerName", label: "Razão social expedidor" },
] as const;

export type DanfeTrackedField = typeof DANFE_TRACKED_FIELDS[number];
