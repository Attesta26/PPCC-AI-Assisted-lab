import type { IGetAllOptions } from "@/generated/models/CommonModels";
import type { IOperationResult } from "@microsoft/power-apps/data";
import { Lab_warehouseitemsService } from "@/generated/services/Lab_warehouseitemsService";
import { Lab_warehousetransactionsService } from "@/generated/services/Lab_warehousetransactionsService";
import { Lab_warehouselocationsService } from "@/generated/services/Lab_warehouselocationsService";
import { Lab_warehouseitemslab_category } from "@/generated/models/Lab_warehouseitemsModel";
import { Lab_warehousetransactionslab_transactiontype } from "@/generated/models/Lab_warehousetransactionsModel";
import { serviceData, serviceResult } from "@/utils/ServicePayload";

type PlatformFields = "ownerid" | "owneridtype" | "statecode";

// Generated create signatures require ownership/state fields that Dataverse supplies on create.
function platformDefaults<T>(record: Omit<T, PlatformFields>): T {
  return record as T;
}

export async function allRecords<T>(
  getPage: (options?: IGetAllOptions) => Promise<IOperationResult<T[]>>,
  options: IGetAllOptions = {},
): Promise<T[]> {
  const records: T[] = [];
  let skipToken: string | undefined;
  const seenTokens = new Set<string>();
  do {
    const result = await serviceResult(getPage({ ...options, skipToken }));
    if (!Array.isArray(result.data)) throw new Error("The service returned no records.");
    records.push(...result.data);
    skipToken = result.skipToken;
    if (skipToken) {
      if (seenTokens.has(skipToken)) throw new Error("The service repeated a pagination token.");
      seenTokens.add(skipToken);
    }
  } while (skipToken);
  return records;
}

export const listItems = () => allRecords(
  options => Lab_warehouseitemsService.getAll(options),
  { orderBy: ["lab_name asc", "lab_warehouseitemid asc"] },
);

export const listLocations = () => allRecords(
  options => Lab_warehouselocationsService.getAll(options),
  { orderBy: ["lab_name asc", "lab_warehouselocationid asc"] },
);

export const getItem = (id: string) => serviceData(Lab_warehouseitemsService.get(id));

export const listTransactions = (itemId?: string) => allRecords(
  options => Lab_warehousetransactionsService.getAll(options),
  {
    ...(itemId ? { filter: `_lab_itemid_value eq ${itemId.replace(/[{}]/g, "")}` } : {}),
    orderBy: ["createdon desc", "lab_warehousetransactionid desc"],
  },
);

function requiredValue(values: Record<string, unknown>, name: string): string {
  const value = values[name];
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error("Fill all required fields.");
  }
  return String(value);
}

function choiceValue<T extends number>(choices: Record<T, string>, value: string): T {
  const key = Number(value);
  if (!Object.hasOwn(choices, key)) throw new Error("Select a value from the list.");
  return key as T;
}

export function createTransaction(values: Record<string, unknown>, itemId?: string) {
  const payload = platformDefaults<Parameters<typeof Lab_warehousetransactionsService.create>[0]>({
    lab_name: requiredValue(values, "lab_name"),
    lab_quantity: requiredValue(values, "lab_quantity"),
    lab_transactiontype: choiceValue(
      Lab_warehousetransactionslab_transactiontype, requiredValue(values, "lab_transactiontype"),
    ),
    lab_transactiondate: new Date().toISOString(),
    "lab_itemid@odata.bind": `/lab_warehouseitems(${itemId ?? requiredValue(values, "lab_itemid")})`,
  });
  return serviceResult(Lab_warehousetransactionsService.create(payload));
}

export function createItem(values: Record<string, unknown>) {
  const payload = platformDefaults<Parameters<typeof Lab_warehouseitemsService.create>[0]>({
    lab_name: requiredValue(values, "lab_name"),
    lab_sku: requiredValue(values, "lab_sku"),
    lab_availablequantity: requiredValue(values, "lab_availablequantity"),
    lab_category: choiceValue(Lab_warehouseitemslab_category, requiredValue(values, "lab_category")),
    ...(values.lab_locationid
      ? { "lab_locationid@odata.bind": `/lab_warehouselocations(${values.lab_locationid})` }
      : {}),
  });
  return serviceResult(Lab_warehouseitemsService.create(payload));
}

export function createLocation(values: Record<string, unknown>) {
  const payload = platformDefaults<Parameters<typeof Lab_warehouselocationsService.create>[0]>({
    lab_name: requiredValue(values, "lab_name"),
    ...(values.lab_address ? { lab_address: String(values.lab_address) } : {}),
    ...(values.lab_capacity != null && values.lab_capacity !== ""
      ? { lab_capacity: String(values.lab_capacity) } : {}),
  });
  return serviceResult(Lab_warehouselocationsService.create(payload));
}

export function updateItem(id: string, values: Record<string, unknown>) {
  const payload: Parameters<typeof Lab_warehouseitemsService.update>[1] = {};
  if ("lab_name" in values) payload.lab_name = requiredValue(values, "lab_name");
  if ("lab_sku" in values) payload.lab_sku = requiredValue(values, "lab_sku");
  if ("lab_category" in values) {
    payload.lab_category = choiceValue(Lab_warehouseitemslab_category, requiredValue(values, "lab_category"));
  }
  if ("lab_locationid" in values) {
    // The generated model excludes null, which Dataverse requires to clear a lookup.
    const changedFields: Omit<typeof payload, "lab_locationid@odata.bind"> & {
      "lab_locationid@odata.bind": string | null;
    } = {
      ...payload,
      "lab_locationid@odata.bind": values.lab_locationid
        ? `/lab_warehouselocations(${values.lab_locationid})` : null,
    };
    return serviceResult(Lab_warehouseitemsService.update(id, changedFields as typeof payload));
  }
  return serviceResult(Lab_warehouseitemsService.update(id, payload));
}
