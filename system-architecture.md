# SanitaryFlow ERP System Architecture

## Stack

- Frontend: HTML, CSS, and modular JavaScript.
- Database: Firebase Firestore for inventory, sales, purchasing, suppliers, customers, users, audit logs, notifications, and branches.
- Authentication: Firebase Authentication with role documents in `users/{uid}`.
- AI: External Node proxy for Anthropic plus local browser fallback. Firebase Functions are not required, so Firebase can stay on Spark.
- Hosting: Firebase Hosting.
- Files: No Firebase Storage. Product images and purchase-document uploads are intentionally unavailable on Spark; receipts and report exports are created locally in the browser.

## Core Firestore Collections

| Collection | Purpose |
| --- | --- |
| `products` | SKU, barcode, category, brand, variants, cost, selling price, stock levels, warehouse and shelf locations. |
| `inventoryMovements` | Adjustments, transfers, sale deductions, purchase receipts, and audit trail. |
| `sales` | POS transactions, payment splits, customer, cashier, receipt totals, and line items. |
| `purchaseOrders` | PO approval workflow, supplier invoices, partial deliveries, returns, and goods received notes. |
| `suppliers` | Contact details, payment terms, delivery performance, reliability score, and purchase history. |
| `customers` | Contractors, retail customers, credit limits, balances, and purchase history. |
| `warehouses` | Branch, rack, shelf, and bin definitions. |
| `branches` | Multi-store inventory and performance reporting. |
| `notifications` | In-app, email, SMS, WhatsApp, and push notification jobs. |
| `users` | Firebase Auth profile metadata and ERP role. |
| `auditLogs` | Immutable security and business activity logs. |

## Product Document Shape

```json
{
  "name": "PVC Pipe 1 inch",
  "sku": "PVC-1IN-001",
  "barcode": "600100000001",
  "qrCode": "products/PVC-1IN-001",
  "category": "PVC Pipes",
  "brand": "FlowMax",
  "supplier": "AquaLine Distributors",
  "description": "Class C pressure pipe, 6 meter length.",
  "images": [],
  "costPrice": 520,
  "sellingPrice": 760,
  "quantity": 12,
  "reorderLevel": 20,
  "warehouse": "Main Warehouse",
  "shelf": "A1-03",
  "variants": [
    { "name": "1/2 inch", "sku": "PVC-050", "quantity": 34, "reorderLevel": 20 },
    { "name": "1 inch", "sku": "PVC-100", "quantity": 12, "reorderLevel": 20 }
  ],
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

## AI Advisor Flow

1. User asks a business question in the AI Advisor.
2. Frontend sends the question and compact business snapshot to the external proxy from `ai-config.js`.
3. Proxy checks that the question is within SanitaryFlow ERP scope.
4. Proxy optionally verifies the Firebase ID token.
5. Proxy calls Anthropic with a strict ERP-only system prompt.
6. If the proxy is unavailable, the browser returns local reorder, stockout, profit, and supplier lead-time recommendations.

## Inventory Reorder Logic

Recommended quantity is calculated from:

- 90-day sales velocity.
- Current stock on hand.
- Product reorder level.
- Supplier lead time.
- Safety stock.

The local frontend includes deterministic recommendations. Claude can be added later for explanation, scenario planning, and cross-module recommendations when a secure backend is available.

## Security Model

- Firebase Auth protects all authenticated workflows.
- Firestore rules require Firebase Authentication.
- Anthropic API key is stored only as an environment variable on the external proxy.
- Spark-plan Firebase does not include Functions; the proxy is deployed separately.
- Writes that affect stock should also create `inventoryMovements` and `auditLogs` records.
- Sensitive reports should be generated server-side for permission checks.

## Deployment Notes

1. Copy `firebase-config.sample.js` to `firebase-config.js`.
2. Paste your Firebase web app config.
3. Deploy Firebase:

```bash
firebase deploy --only hosting,firestore:rules
```

4. Deploy `proxy/` to a Node hosting provider and set `ANTHROPIC_API_KEY` in that provider's secret manager.
5. Update `ai-config.js` with the deployed proxy URL.
