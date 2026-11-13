/** Regras puras para quantidade e atribuição de licenças. */
export function licenseQuantityError(quantity: number): string | null {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return "A quantidade de licenças deve ser um número inteiro maior que zero.";
  }
  return null;
}

/** Equipamentos baixados ou extraviados não recebem novos vínculos. */
export function canAssignLicenseToAsset(status: string | undefined): boolean {
  return status !== "disposed" && status !== "lost";
}
