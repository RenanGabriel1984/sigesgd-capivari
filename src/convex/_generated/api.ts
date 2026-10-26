/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi } from "convex/server";
import type * as assetMaintenances from "../assetMaintenances.js";
import type * as assetParts from "../assetParts.js";
import type * as assets from "../assets.js";
import type * as auditLogs from "../auditLogs.js";
import type * as auth from "../auth.js";
import type * as auth_credentials from "../auth/credentials.js";
import type * as auth_passwords from "../auth/passwords.js";
import type * as categories from "../categories.js";
import type * as dashboard from "../dashboard.js";
import type * as dataRepairs from "../dataRepairs.js";
import type * as diagnostics from "../diagnostics.js";
import type * as email from "../email.js";
import type * as entries from "../entries.js";
import type * as gomaQ from "../gomaQ.js";
import type * as http from "../http.js";
import type * as inventory from "../inventory.js";
import type * as licenses from "../licenses.js";
import type * as lots from "../lots.js";
import type * as nfeProductAliases from "../nfeProductAliases.js";
import type * as opsGoLive from "../opsGoLive.js";
import type * as organizations from "../organizations.js";
import type * as packagingParameters from "../packagingParameters.js";
import type * as passwords from "../passwords.js";
import type * as presentationFixes from "../presentationFixes.js";
import type * as printSupplies from "../printSupplies.js";
import type * as printers from "../printers.js";
import type * as productClassification from "../productClassification.js";
import type * as products from "../products.js";
import type * as pwResetHelpers from "../pwResetHelpers.js";
import type * as rbac from "../rbac.js";
import type * as requests from "../requests.js";
import type * as returns from "../returns.js";
import type * as securityAudit from "../securityAudit.js";
import type * as seed from "../seed.js";
import type * as seeds from "../seeds.js";
import type * as stockAreas from "../stockAreas.js";
import type * as stockHelpers from "../stockHelpers.js";
import type * as stockIntelligence from "../stockIntelligence.js";
import type * as stockLocations from "../stockLocations.js";
import type * as stockMovements from "../stockMovements.js";
import type * as stockParameters from "../stockParameters.js";
import type * as stockSetup from "../stockSetup.js";
import type * as stockTransfers from "../stockTransfers.js";
import type * as storage from "../storage.js";
import type * as storageLocations from "../storageLocations.js";
import type * as suppliers from "../suppliers.js";
import type * as supplyRequests from "../supplyRequests.js";
import type * as users from "../users.js";

const fullApi: ApiFromModules<{
  assetMaintenances: typeof assetMaintenances;
  assetParts: typeof assetParts;
  assets: typeof assets;
  auditLogs: typeof auditLogs;
  auth: typeof auth;
  "auth/credentials": typeof auth_credentials;
  "auth/passwords": typeof auth_passwords;
  categories: typeof categories;
  dashboard: typeof dashboard;
  dataRepairs: typeof dataRepairs;
  diagnostics: typeof diagnostics;
  email: typeof email;
  entries: typeof entries;
  gomaQ: typeof gomaQ;
  http: typeof http;
  inventory: typeof inventory;
  licenses: typeof licenses;
  lots: typeof lots;
  nfeProductAliases: typeof nfeProductAliases;
  opsGoLive: typeof opsGoLive;
  organizations: typeof organizations;
  packagingParameters: typeof packagingParameters;
  passwords: typeof passwords;
  presentationFixes: typeof presentationFixes;
  printSupplies: typeof printSupplies;
  printers: typeof printers;
  productClassification: typeof productClassification;
  products: typeof products;
  pwResetHelpers: typeof pwResetHelpers;
  rbac: typeof rbac;
  requests: typeof requests;
  returns: typeof returns;
  securityAudit: typeof securityAudit;
  seed: typeof seed;
  seeds: typeof seeds;
  stockAreas: typeof stockAreas;
  stockHelpers: typeof stockHelpers;
  stockIntelligence: typeof stockIntelligence;
  stockLocations: typeof stockLocations;
  stockMovements: typeof stockMovements;
  stockParameters: typeof stockParameters;
  stockSetup: typeof stockSetup;
  stockTransfers: typeof stockTransfers;
  storage: typeof storage;
  storageLocations: typeof storageLocations;
  suppliers: typeof suppliers;
  supplyRequests: typeof supplyRequests;
  users: typeof users;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;
