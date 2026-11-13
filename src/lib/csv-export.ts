/**
 * Serialização segura de CSV delimitado por ponto e vírgula (pt-BR).
 * Aspas protegem delimitadores/quebras de linha; prefixo apóstrofo neutraliza
 * fórmulas em dados textuais ao abrir o arquivo em planilhas.
 */
export function serializeSemicolonCsv(
  header: readonly unknown[],
  rows: readonly (readonly unknown[])[],
): string {
  const cell = (value: unknown): string => {
    const raw = value === null || value === undefined ? "" : String(value);
    const safe = typeof value === "string" && /^[\u0000-\u0020]*[=+\-@]/.test(raw)
      ? `'${raw}`
      : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [header, ...rows].map((row) => row.map(cell).join(";")).join("\r\n");
}
