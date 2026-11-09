import { describe, expect, it } from "vitest";
import { planFifoAreaLotAllocation, type AreaLotCandidate } from "@/lib/area-stock";
const lot = (overrides: Partial<AreaLotCandidate>): AreaLotCandidate => ({
  lotId:"lot-default",lotNumber:"LOT-001",receivedAt:1,quantityAvailable:10,
  quantityReserved:0,areaId:"area-ti",locationId:"armario-ti",active:true,...overrides,
});
describe("alocação FIFO por área e local",()=>{
  it("não mistura lotes de outra área, local ou sem classificação",()=>{
    const result=planFifoAreaLotAllocation([
      lot({lotId:"ti",quantityAvailable:3}),
      lot({lotId:"printer",areaId:"area-impressoras",quantityAvailable:20}),
      lot({lotId:"other-location",locationId:"armario-02",quantityAvailable:20}),
      lot({lotId:"unclassified",areaId:undefined,locationId:undefined,quantityAvailable:20}),
    ],4,"area-ti","armario-ti");
    expect(result.allocations).toEqual([{lotId:"ti",quantity:3}]);
    expect(result.remaining).toBe(1);
  });
  it("respeita reservas e prioriza o lote mais antigo",()=>{
    const result=planFifoAreaLotAllocation([
      lot({lotId:"newer",lotNumber:"LOT-002",receivedAt:2,quantityAvailable:8}),
      lot({lotId:"older",lotNumber:"LOT-001",receivedAt:1,quantityAvailable:7,quantityReserved:5}),
    ],6,"area-ti","armario-ti");
    expect(result.allocations).toEqual([{lotId:"older",quantity:2},{lotId:"newer",quantity:4}]);
    expect(result.remaining).toBe(0);
  });
  it("ignora lotes inativos e totalmente reservados",()=>{
    const result=planFifoAreaLotAllocation([
      lot({lotId:"inactive",active:false}),lot({lotId:"reserved",quantityAvailable:4,quantityReserved:4}),
    ],1,"area-ti","armario-ti");
    expect(result.allocations).toEqual([]);
    expect(result.remaining).toBe(1);
  });
  it("rejeita quantidade não finita",()=>{
    expect(()=>planFifoAreaLotAllocation([],Number.NaN,"area-ti","armario-ti")).toThrow(/Quantidade solicitada inválida/);
  });
});
