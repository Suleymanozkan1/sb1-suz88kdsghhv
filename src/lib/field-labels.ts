/**
 * English labels (translation keys) of record fields, by their name in the API and the audit trail: the audit diff and
 * validation messages show "Quantity" (Miktar) instead of "quantity" or "lines.0.quantity" (audit UX-02, FE-08).
 */
export const FIELD_LABEL: Record<string, string> = {
  qty: "Quantity", quantity: "Quantity", cost: "Cost", unit: "Unit", unitCost: "Unit cost", totalCost: "Total cost", portionCost: "Portion cost",
  sellingPrice: "Selling price", parQty: "Par level", roomType: "Room type", folio: "Folio", items: "Items", lines: "Lines", status: "Status", name: "Name",
  code: "Code", type: "Type", active: "Active", version: "Version", notes: "Notes", note: "Note", reason: "Reason", target: "Target", metric: "Metric",
  warnAt: "Warning level", period: "Period", priority: "Priority", validFrom: "Valid from", validTo: "Valid to", dueDate: "Due date", kind: "Type",
  rootCause: "Root cause", fileName: "File name", total: "Total", year: "Year", in: "In", out: "Out", driver: "Driver", boardBasis: "Board basis",
  serviceDate: "Service date", startTime: "Start time", endTime: "End time", expectedCovers: "Expected covers", actualCovers: "Actual covers",
  paidCovers: "Paid covers", includedCovers: "Included covers", inHouseGuests: "In-house guests", occupiedRooms: "Occupied rooms", foodCost: "Food cost",
  wasteCost: "Waste cost", remaining: "Remaining", actualSaving: "Actual saving", targetSaving: "Target saving", baselineCost: "Baseline cost",
  ownerName: "Owner", problem: "Problem", action: "Action", posted: "Posted", closedAt: "Closed at", txDate: "Date", wasteDate: "Date", wasteType: "Waste type",
  price: "Price", unitPrice: "Unit price", amount: "Amount", email: "E-mail", role: "Role", roleKey: "Role", requestedBy: "Requested by", decision: "Decision",
  password: "Password", description: "Description", category: "Category", subCategory: "Subcategory", sku: "SKU", covers: "Covers",
  receiptDate: "Date", orderDate: "Date", countDate: "Date", expenseDate: "Date", invoiceNo: "Invoice no.", portions: "Portions", yieldPct: "Yield %",
  product: "Product", recipe: "Recipe", supplier: "Supplier", department: "Department", warehouse: "Store", resultRef: "Result",
};

/** Field name to an English label key: the table above, else spelled out from camelCase ("unitCost" → "Unit cost"). */
export function fieldLabelKey(k: string): string {
  if (FIELD_LABEL[k]) return FIELD_LABEL[k]!;
  const s = k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
