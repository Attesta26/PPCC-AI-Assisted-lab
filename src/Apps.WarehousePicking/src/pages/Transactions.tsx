import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Lab_warehousetransactions } from "@/generated/models/Lab_warehousetransactionsModel";
import type { Lab_warehouseitems } from "@/generated/models/Lab_warehouseitemsModel";
import { transactionTypeOptionMetadata } from "@/utils/OptionSets";
import {
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";
import { ArrowSwapRegular } from "@fluentui/react-icons";
import type { IColumn } from "@talxis/client-libraries";
import { PageHeader } from "@/components/PageHeader";
import { RecordGrid } from "@/components/RecordGrid";
import { RecordFormDialog } from "@/components/RecordFormDialog";
import type { FormField } from "@/components/RecordFormFields";
import { useToast } from "@/hooks/use-toast";
import { useStyles } from "@/styles/Transactions.styles";
import { errorText } from "@/utils/ServicePayload";
import { createTransaction, listItems, listTransactions } from "@/utils/WarehouseData";
import { toNumber } from "@/utils/RecordValues";

const transactionTypeMetadata = {
  OptionSet: transactionTypeOptionMetadata,
} as IColumn["metadata"];

const columns: IColumn[] = [
  { name: "lab_name", displayName: "Name", dataType: "SingleLine.Text", isPrimary: true, visualSizeFactor: 240 },
  { name: "lab_quantity", displayName: "Quantity", dataType: "Whole.None", visualSizeFactor: 110 },
  { name: "lab_transactiontype", displayName: "Type", dataType: "OptionSet", visualSizeFactor: 130, metadata: transactionTypeMetadata },
  { name: "item", displayName: "Item", dataType: "SingleLine.Text", visualSizeFactor: 200 },
  { name: "lab_transactiondate", displayName: "Date", dataType: "DateAndTime.DateAndTime", visualSizeFactor: 120 },
];

const formFields: FormField[] = [
  { column: { name: "lab_name", displayName: "Name", dataType: "SingleLine.Text", isPrimary: true }, required: true },
  { column: { name: "lab_itemid", displayName: "Warehouse Item", dataType: "SingleLine.Text" }, required: true, lookupEntity: "lab_warehouseitem" },
  { column: { name: "lab_quantity", displayName: "Quantity", dataType: "Whole.None" }, required: true },
  { column: { name: "lab_transactiontype", displayName: "Transaction Type", dataType: "OptionSet", metadata: transactionTypeMetadata }, required: true },
];

export default function TransactionsPage() {
  const styles = useStyles();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: transactions, error } = useQuery({
    queryKey: ["allTransactions"],
    queryFn: () => listTransactions(),
  });

  const { data: items, error: itemsError } = useQuery({
    queryKey: ["warehouseItemsLookup"],
    queryFn: listItems,
  });

  const itemRecords = useMemo(
    () =>
      (items ?? [])
        .map((item: Lab_warehouseitems) => ({
          id: item.lab_warehouseitemid,
          name: item.lab_name ?? "",
        })),
    [items]
  );

  const itemNames = useMemo(
    () => new Map((items ?? []).map((item: Lab_warehouseitems) => [item.lab_warehouseitemid, item.lab_name ?? ""])),
    [items]
  );

  // Grid rows: numbers for numeric/option set columns, and the item lookup resolved to its name
  const rows = useMemo(
    () =>
      transactions?.map((tx: Lab_warehousetransactions) => ({
        ...tx,
        lab_quantity: toNumber(tx.lab_quantity),
        lab_transactiontype: toNumber(tx.lab_transactiontype),
        item: itemNames.get(tx._lab_itemid_value ?? "") ?? "",
      })),
    [transactions, itemNames]
  );

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => createTransaction(values),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success("Transaction created successfully");
    },
    onError: (err) => {
      toast.error(errorText(err));
    },
  });

  return (
    <div className={styles.page}>
      <PageHeader
        icon={<ArrowSwapRegular />}
        title="Transactions"
        subtitle="All warehouse transactions"
      />

      {(error || itemsError) && (
        <MessageBar intent="error">
          <MessageBarBody>{errorText(error || itemsError)}</MessageBarBody>
        </MessageBar>
      )}

      <RecordGrid
        rows={rows}
        columns={columns}
        entityName="lab_warehousetransaction"
        commands={[{ id: "new", label: "New Transaction", icon: "Add", onExecute: () => setDialogOpen(true) }]}
        onRefresh={() => queryClient.refetchQueries({ queryKey: ["allTransactions"] })}
      />

      <RecordFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Create New Transaction"
        entityName="lab_warehousetransaction"
        fields={formFields}
        lookupRecords={{ lab_itemid: itemRecords }}
        onCreate={(values) => createMutation.mutateAsync(values)}
        pending={createMutation.isPending}
      />
    </div>
  );
}
