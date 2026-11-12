/**
 * Mascaramento de chaves de licença.
 *
 * A chave completa só deve ser enviada a clientes autorizados. O helper é
 * puro para que consultas de licenças e detalhes de equipamentos apliquem
 * exatamente a mesma regra.
 */
export function maskLicenseKey(key: string): string {
  if (!key || key.length <= 8) return "****";
  return "*".repeat(key.length - 4) + key.slice(-4);
}
