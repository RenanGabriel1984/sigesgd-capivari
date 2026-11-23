/**
 * Manifesto de origem para regularização da carga inicial.
 *
 * Fonte: docs/planilha-carga-inicial.csv, conferida na regularização de área/local.
 * A área foi atribuída por classificação do produto (Impressoras x TI Geral),
 * nunca pelo armário físico. Quantidades e unidades permanecem as da planilha.
 */
export type InitialStockAreaName = "TI Geral" | "Impressoras";

export type InitialStockManifestRow = {
  locationName: string;
  productName: string;
  brand: string;
  quantity: number;
  unitOfMeasure: string;
  areaName: InitialStockAreaName;
};

export const INITIAL_STOCK_MANIFEST: InitialStockManifestRow[] = [
  {
    "locationName": "Armário TI 01",
    "productName": "Cooler para processador Intel",
    "brand": "DEX-DX",
    "quantity": 15,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Teclado KB 110 com fio",
    "brand": "KB",
    "quantity": 2,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Teclado com fio",
    "brand": "Dell",
    "quantity": 1,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Kit teclado e mouse",
    "brand": "Logitech",
    "quantity": 1,
    "unitOfMeasure": "kit",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Teclado numérico",
    "brand": "Tomate",
    "quantity": 1,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Leitor de DVD",
    "brand": "Tomate",
    "quantity": 1,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Cartão PVC para crachá",
    "brand": "Extracard",
    "quantity": 700,
    "unitOfMeasure": "un",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Mouse com fio",
    "brand": "Goldentech",
    "quantity": 5,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Mouse wireless",
    "brand": "Xingling",
    "quantity": 2,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Pasta térmica",
    "brand": "Implastec",
    "quantity": 5,
    "unitOfMeasure": "pote",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Conector RJ45 Cat5E",
    "brand": "Atek",
    "quantity": 500,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Conector RJ45 blindado CAT5",
    "brand": "Exbom",
    "quantity": 200,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Conector RJ45",
    "brand": "Xinkling",
    "quantity": 1000,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Cadeado chave tetra",
    "brand": "Xingling",
    "quantity": 36,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Jogo de chaves — 6 peças",
    "brand": "Xingling",
    "quantity": 1,
    "unitOfMeasure": "kit",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Jogo de chaves — 8 peças",
    "brand": "Xingling",
    "quantity": 1,
    "unitOfMeasure": "kit",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Módulo para tomada",
    "brand": "Tramontina",
    "quantity": 11,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Caixa com tampa de sobrepor para tomada",
    "brand": "Tramontina",
    "quantity": 11,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Limpa contato",
    "brand": "Tekbond",
    "quantity": 7,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Keystone Jack para RJ45",
    "brand": "Xingling",
    "quantity": 20,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Conector linear de emenda para cabo RJ45 CAT6",
    "brand": "Xingling",
    "quantity": 28,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Hub USB 3.0",
    "brand": "Exbom",
    "quantity": 2,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Fita isolante",
    "brand": "Adelbras",
    "quantity": 4,
    "unitOfMeasure": "rolo",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Adaptador HDMI para VGA",
    "brand": "Exbom",
    "quantity": 2,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Cabo adaptador DisplayPort para VGA",
    "brand": "Exbom",
    "quantity": 8,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Pilha AAA",
    "brand": "Elgin",
    "quantity": 3,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Teclado",
    "brand": "Lenovo",
    "quantity": 5,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Switch JetStream 8 portas",
    "brand": "TP-Link",
    "quantity": 3,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Switch 26 portas",
    "brand": "Dell",
    "quantity": 1,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Switch 5 portas 10/100 PoE",
    "brand": "TP-Link",
    "quantity": 3,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Telefone VoIP TIP 125I",
    "brand": "Intelbras",
    "quantity": 14,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Telefone VoIP V5502",
    "brand": "Intelbras",
    "quantity": 1,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "RouterBoard",
    "brand": "MikroTik",
    "quantity": 2,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 01",
    "productName": "Telefone VoIP TIP 125I — Montado",
    "brand": "Intelbras",
    "quantity": 1,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Protetor de crachá — caixa fechada",
    "brand": "Reflex",
    "quantity": 13,
    "unitOfMeasure": "caixa",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Protetor de crachá — unidade avulsa",
    "brand": "Reflex",
    "quantity": 18,
    "unitOfMeasure": "un",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Mousepad",
    "brand": "Fênix",
    "quantity": 10,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Abraçadeira de nylon",
    "brand": "Stormtech",
    "quantity": 8,
    "unitOfMeasure": "pacote",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Telefone",
    "brand": "Attimo",
    "quantity": 4,
    "unitOfMeasure": "un",
    "areaName": "TI Geral"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Toner VersaLink — Preto",
    "brand": "Xerox",
    "quantity": 1,
    "unitOfMeasure": "un",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Toner VersaLink — Ciano",
    "brand": "Xerox",
    "quantity": 1,
    "unitOfMeasure": "un",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Toner VersaLink — Magenta",
    "brand": "Xerox",
    "quantity": 1,
    "unitOfMeasure": "un",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Toner VersaLink — Amarelo",
    "brand": "Xerox",
    "quantity": 1,
    "unitOfMeasure": "un",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Toner AltaLink — Preto",
    "brand": "Xerox",
    "quantity": 2,
    "unitOfMeasure": "un",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Toner AltaLink — Ciano",
    "brand": "Xerox",
    "quantity": 1,
    "unitOfMeasure": "un",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Toner AltaLink — Magenta",
    "brand": "Xerox",
    "quantity": 2,
    "unitOfMeasure": "un",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Toner AltaLink — Amarelo",
    "brand": "Xerox",
    "quantity": 4,
    "unitOfMeasure": "un",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Toner CX735 — Magenta",
    "brand": "Lexmark",
    "quantity": 1,
    "unitOfMeasure": "un",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Toner CX735 — Amarelo",
    "brand": "Lexmark",
    "quantity": 1,
    "unitOfMeasure": "un",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Etiqueta para impressão adesiva",
    "brand": "Sem marca",
    "quantity": 23,
    "unitOfMeasure": "rolo",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Ribbon para impressora de etiqueta adesiva",
    "brand": "Sem marca",
    "quantity": 24,
    "unitOfMeasure": "rolo",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Papel para impressora térmica",
    "brand": "Sem marca",
    "quantity": 90,
    "unitOfMeasure": "rolo",
    "areaName": "Impressoras"
  },
  {
    "locationName": "Armário TI 02",
    "productName": "Toner Lexmark XM5365",
    "brand": "Lexmark",
    "quantity": 1,
    "unitOfMeasure": "un",
    "areaName": "Impressoras"
  }
];

export const INITIAL_ENTRY_NUMBER = "ENT-2026-000001";
export const GOMAQ_ENTRY_NUMBER = "ENT-2026-000002";
export const GOMAQ_INVOICE_NUMBER = "372043";

export const INITIAL_ENTRY_UOM_REPAIRS: Record<string, string> = {
  "Kit teclado e mouse": "kit",
  "Pasta térmica": "pote",
  "Jogo de chaves — 6 peças": "kit",
  "Jogo de chaves — 8 peças": "kit",
  "Fita isolante": "rolo",
  "Protetor de crachá — caixa fechada": "caixa",
  "Abraçadeira de nylon": "pacote",
  "Etiqueta para impressão adesiva": "rolo",
  "Ribbon para impressora de etiqueta adesiva": "rolo",
  "Papel para impressora térmica": "rolo",
};

export function summarizeInitialStockManifest(rows = INITIAL_STOCK_MANIFEST) {
  return rows.reduce((result, row) => {
    result.totalRows += 1;
    result.totalQuantity += row.quantity;
    if (row.areaName === "Impressoras") {
      result.printerRows += 1;
      result.printerQuantity += row.quantity;
    } else {
      result.generalRows += 1;
      result.generalQuantity += row.quantity;
    }
    if (row.locationName === "Armário TI 01") {
      result.cabinet1Rows += 1;
      result.cabinet1Quantity += row.quantity;
    } else if (row.locationName === "Armário TI 02") {
      result.cabinet2Rows += 1;
      result.cabinet2Quantity += row.quantity;
    }
    return result;
  }, {
    totalRows: 0,
    totalQuantity: 0,
    printerRows: 0,
    printerQuantity: 0,
    generalRows: 0,
    generalQuantity: 0,
    cabinet1Rows: 0,
    cabinet1Quantity: 0,
    cabinet2Rows: 0,
    cabinet2Quantity: 0,
  });
}
