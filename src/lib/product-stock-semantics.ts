export function validateProductStockSemanticsChange(input: {
  currentUnit: string;
  nextUnit?: string;
  currentHasSerial: boolean;
  nextHasSerial?: boolean;
  hasStockHistory: boolean;
}): string | null {
  const unitChanged = input.nextUnit !== undefined && input.nextUnit !== input.currentUnit;
  const serialChanged = input.nextHasSerial !== undefined &&
    input.nextHasSerial !== input.currentHasSerial;
  if (!unitChanged && !serialChanged) return null;
  if (input.nextUnit !== undefined && !input.nextUnit.trim()) {
    return "A unidade de medida não pode ficar vazia.";
  }
  if (input.hasStockHistory) {
    return (
      "Não é possível alterar a unidade de medida ou o controle por número de série " +
      "depois que o produto possui histórico de estoque, solicitações ou uso patrimonial. " +
      "Cadastre um novo produto com a classificação correta para preservar o histórico."
    );
  }
  return null;
}
