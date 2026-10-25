const CREATE_FORM = 1;

export class TransactionForm {
    public static onLoad(executionContext: Xrm.Events.EventContext): void {
        const formContext = executionContext.getFormContext();
        const dateAttr = formContext.getAttribute<Xrm.Attributes.DateAttribute>("lab_transactiondate");
        if (formContext.ui.getFormType() === CREATE_FORM && dateAttr && !dateAttr.getValue()) {
            dateAttr.setValue(new Date());
        }
    }

    public static async onQuantityChange(executionContext: Xrm.Events.EventContext): Promise<void> {
        const formContext = executionContext.getFormContext();
        const quantity = formContext.getAttribute<Xrm.Attributes.NumberAttribute>("lab_quantity")?.getValue();
        const itemValue = formContext.getAttribute<Xrm.Attributes.LookupAttribute>("lab_itemid")?.getValue();
        if (quantity == null || !itemValue?.length) {
            return;
        }

        const itemId = itemValue[0].id.replace(/[{}]/g, "");
        let item: { lab_unitprice?: number | null };
        try {
            item = await Xrm.WebApi.retrieveRecord("lab_warehouseitem", itemId, "?$select=lab_unitprice");
        } catch (error) {
            // The specification leaves the total unchanged when the price cannot be read.
            console.warn("Could not retrieve the item's unit price.", error);
            return;
        }

        const currentItem = formContext.getAttribute<Xrm.Attributes.LookupAttribute>("lab_itemid")?.getValue();
        const currentQuantity = formContext.getAttribute<Xrm.Attributes.NumberAttribute>("lab_quantity")?.getValue();
        if (currentItem?.[0]?.id.replace(/[{}]/g, "") !== itemId || currentQuantity !== quantity) {
            return;
        }
        if (typeof item.lab_unitprice === "number") {
            formContext.getAttribute<Xrm.Attributes.NumberAttribute>("lab_totalvalue")
                ?.setValue(quantity * item.lab_unitprice);
        }
    }
}

export class RibbonActions {
    public static async checkStockLevels(formContext: Xrm.FormContext): Promise<void> {
        const name = formContext.getAttribute<Xrm.Attributes.StringAttribute>("lab_name")?.getValue() || "Unknown";
        const qty = formContext.getAttribute<Xrm.Attributes.NumberAttribute>("lab_availablequantity")?.getValue() ?? 0;
        const reorder = formContext.getAttribute<Xrm.Attributes.NumberAttribute>("lab_reorderpoint")?.getValue() ?? 0;

        let message = "Stock level for " + name + ": " + qty + " units.";
        if (qty <= reorder) {
            message += "\n⚠ Below reorder point (" + reorder + "). Consider restocking.";
        } else {
            message += "\n✓ Stock is above reorder point (" + reorder + ").";
        }

        await Xrm.Navigation.openAlertDialog({ text: message, title: "Stock Check" });
    }
}

export { GridApi, LocationForm } from './GridCustomizer';
