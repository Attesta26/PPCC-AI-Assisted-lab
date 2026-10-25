import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Lab_warehouselocations } from "@/generated/models/Lab_warehouselocationsModel";
import type { Lab_warehouseitems } from "@/generated/models/Lab_warehouseitemsModel";
import {
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";
import { LocationRegular } from "@fluentui/react-icons";
import type { IColumn } from "@talxis/client-libraries";
import { PageHeader } from "@/components/PageHeader";
import { RecordFormDialog } from "@/components/RecordFormDialog";
import type { FormField } from "@/components/RecordFormFields";
import { RecordGrid } from "@/components/RecordGrid";
import { statusOptions } from "@/utils/OptionSets";
import { useToast } from "@/hooks/use-toast";
import { useStyles } from "@/styles/Locations.styles";
import { errorText } from "@/utils/ServicePayload";
import { createLocation, listItems, listLocations } from "@/utils/WarehouseData";
import { toNumber } from "@/utils/RecordValues";

const columns: IColumn[] = [
  { name: "lab_name", displayName: "Name", dataType: "SingleLine.Text", isPrimary: true, visualSizeFactor: 200 },
  { name: "lab_address", displayName: "Address", dataType: "SingleLine.Text", visualSizeFactor: 260 },
  { name: "lab_capacity", displayName: "Capacity", dataType: "Whole.None", visualSizeFactor: 110 },
  { name: "itemCount", displayName: "Items", dataType: "Whole.None", visualSizeFactor: 90 },
  { name: "active", displayName: "Active", dataType: "OptionSet", visualSizeFactor: 110, metadata: { OptionSet: statusOptions } as IColumn["metadata"] },
];

const formFields: FormField[] = [
  { column: { name: "lab_name", displayName: "Name", dataType: "SingleLine.Text", isPrimary: true }, required: true },
  { column: { name: "lab_address", displayName: "Address", dataType: "SingleLine.Text" } },
  { column: { name: "lab_capacity", displayName: "Capacity", dataType: "Whole.None" } },
];

export default function LocationsPage() {
  const styles = useStyles();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: locations, error } = useQuery({
    queryKey: ["warehouseLocationsList"],
    queryFn: listLocations,
  });

  const { data: items, error: itemsError } = useQuery({
    queryKey: ["itemsByLocation"],
    queryFn: listItems,
  });

  // Grid rows: per-location item counts, numeric capacity, and isactive as an Active/Inactive option
  const rows = useMemo(() => {
    if (!locations || !items) return undefined;
    const itemCounts = new Map<string, number>();
    items.forEach((item: Lab_warehouseitems) => {
      const locId = item._lab_locationid_value;
      if (locId) itemCounts.set(locId, (itemCounts.get(locId) ?? 0) + 1);
    });
    return locations.map((loc: Lab_warehouselocations) => ({
      ...loc,
      lab_capacity: toNumber(loc.lab_capacity),
      itemCount: itemCounts.get(loc.lab_warehouselocationid) ?? 0,
      active: String(loc.lab_isactive).toLowerCase() === "true" || String(loc.lab_isactive) === "1" ? 0 : 1,
    }));
  }, [locations, items]);

  const createMutation = useMutation({
    mutationFn: createLocation,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success("Location created successfully");
    },
    onError: (err) => {
      toast.error(errorText(err));
    },
  });

  return (
    <div className={styles.page}>
      <PageHeader
        icon={<LocationRegular />}
        title="Locations"
        subtitle="Warehouse locations and their stock"
      />

      {(error || itemsError) && (
        <MessageBar intent="error">
          <MessageBarBody>{errorText(error || itemsError)}</MessageBarBody>
        </MessageBar>
      )}

      <RecordGrid
        rows={rows}
        columns={columns}
        entityName="lab_warehouselocation"
        commands={[{ id: "new", label: "New Location", icon: "Add", onExecute: () => setDialogOpen(true) }]}
        onRefresh={() => Promise.all([
          queryClient.refetchQueries({ queryKey: ["warehouseLocationsList"] }),
          queryClient.refetchQueries({ queryKey: ["itemsByLocation"] }),
        ])}
      />

      <RecordFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Create New Location"
        entityName="lab_warehouselocation"
        fields={formFields}
        onCreate={(values) => createMutation.mutateAsync(values)}
        pending={createMutation.isPending}
      />
    </div>
  );
}
