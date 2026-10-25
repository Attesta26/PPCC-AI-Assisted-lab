import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Lab_warehouseitems } from "@/generated/models/Lab_warehouseitemsModel";
import type { Lab_warehouselocations } from "@/generated/models/Lab_warehouselocationsModel";
import { categoryOptionMetadata, statusOptions } from "@/utils/OptionSets";
import {
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";
import { BoxRegular } from "@fluentui/react-icons";
import type { IColumn } from "@talxis/client-libraries";
import { PageHeader } from "@/components/PageHeader";
import { RecordGrid } from "@/components/RecordGrid";
import { RecordFormDialog } from "@/components/RecordFormDialog";
import type { FormField } from "@/components/RecordFormFields";
import { useToast } from "@/hooks/use-toast";
import { useStyles } from "@/styles/WarehouseItems.styles";
import { errorText } from "@/utils/ServicePayload";
import { createItem, listItems, listLocations } from "@/utils/WarehouseData";
import { toNumber } from "@/utils/RecordValues";

const columns: IColumn[] = [
  { name: "lab_name", displayName: "Name", dataType: "SingleLine.Text", isPrimary: true, visualSizeFactor: 220 },
  { name: "lab_sku", displayName: "SKU", dataType: "SingleLine.Text", visualSizeFactor: 130 },
  { name: "lab_availablequantity", displayName: "Available Qty", dataType: "Whole.None", visualSizeFactor: 120 },
  { name: "lab_category", displayName: "Category", dataType: "OptionSet", visualSizeFactor: 140, metadata: { OptionSet: categoryOptionMetadata } as IColumn["metadata"] },
  { name: "location", displayName: "Location", dataType: "SingleLine.Text", visualSizeFactor: 150 },
  { name: "statecode", displayName: "Status", dataType: "OptionSet", visualSizeFactor: 110, metadata: { OptionSet: statusOptions } as IColumn["metadata"] },
  { name: "createdon", displayName: "Created", dataType: "DateAndTime.DateOnly", visualSizeFactor: 120 },
];

const formFields: FormField[] = [
  { column: { name: "lab_name", displayName: "Name", dataType: "SingleLine.Text", isPrimary: true }, required: true },
  { column: { name: "lab_sku", displayName: "SKU", dataType: "SingleLine.Text" }, required: true },
  { column: { name: "lab_availablequantity", displayName: "Available Quantity", dataType: "Whole.None" }, required: true },
  { column: { name: "lab_category", displayName: "Category", dataType: "OptionSet", metadata: { OptionSet: categoryOptionMetadata } as IColumn["metadata"] }, required: true },
  { column: { name: "lab_locationid", displayName: "Location", dataType: "SingleLine.Text" }, lookupEntity: "lab_warehouselocation" },
];

export default function WarehouseItemsPage() {
  const styles = useStyles();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: items, error } = useQuery({
    queryKey: ["warehouseItems"],
    queryFn: listItems,
  });

  const { data: locations, error: locationsError } = useQuery({
    queryKey: ["warehouseLocations"],
    queryFn: listLocations,
  });

  const locationRecords = useMemo(
    () =>
      (locations ?? []).map((loc: Lab_warehouselocations) => ({
        id: loc.lab_warehouselocationid,
        name: loc.lab_name ?? "",
      })),
    [locations]
  );

  // Grid rows: numbers for numeric/option set columns, and the location lookup resolved to its name
  const rows = useMemo(() => {
    if (!items) return undefined;
    const locationNames = new Map(locationRecords.map((loc) => [loc.id, loc.name]));
    return items.map((item: Lab_warehouseitems) => ({
      ...item,
      lab_availablequantity: toNumber(item.lab_availablequantity),
      lab_category: toNumber(item.lab_category),
      statecode: toNumber(item.statecode),
      location: locationNames.get(item._lab_locationid_value ?? "") ?? "",
    }));
  }, [items, locationRecords]);

  const createMutation = useMutation({
    mutationFn: createItem,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success("Item created successfully");
    },
    onError: (err) => {
      toast.error(errorText(err));
    },
  });

  return (
    <div className={styles.page}>
      <PageHeader
        icon={<BoxRegular />}
        title="Warehouse Items"
        subtitle="Manage your warehouse inventory"
      />

      {(error || locationsError) && (
        <MessageBar intent="error">
          <MessageBarBody>{errorText(error || locationsError)}</MessageBarBody>
        </MessageBar>
      )}

      <RecordGrid
        rows={rows}
        columns={columns}
        entityName="lab_warehouseitem"
        rowClassName="warehouse-item-row"
        commands={[{ id: "new", label: "New Item", icon: "Add", onExecute: () => setDialogOpen(true) }]}
        onRefresh={() => queryClient.refetchQueries({ queryKey: ["warehouseItems"] })}
      />

      <RecordFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Create New Item"
        entityName="lab_warehouseitem"
        fields={formFields}
        lookupRecords={{ lab_locationid: locationRecords }}
        onCreate={(values) => createMutation.mutateAsync(values)}
        pending={createMutation.isPending}
      />
    </div>
  );
}
