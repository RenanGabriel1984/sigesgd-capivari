// Consulta de inventário dimensional — estritamente somente leitura.
const products = await ctx.db.query("products").collect();
const stock = await ctx.db.query("stock").collect();
const stockByLocation = await ctx.db.query("stockByLocation").collect();
const lots = await ctx.db.query("lots").collect();
const balances = await ctx.db.query("lotLocationBalances").collect();
const areas = await ctx.db.query("stockAreas").collect();
const locations = await ctx.db.query("storageLocations").collect();
const entries = await ctx.db.query("entries").collect();
return {
  readOnly: true,
  deploymentRequested: "first-herring-264",
  generatedAt: Date.now(),
  totals: {
    products: products.length,
    stockRows: stock.length,
    stockByLocationRows: stockByLocation.length,
    lots: lots.length,
    lotLocationBalanceRows: balances.length,
    areas: areas.length,
    locations: locations.length,
    entries: entries.length
  }
};
