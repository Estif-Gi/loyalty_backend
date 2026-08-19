# End-to-End Ordering Flow Guide

This document describes the step-by-step lifecycle of the restaurant ordering system, starting from user roles provisioning, restaurant creation, operational configuration, employee onboarding, customer geofenced verification, up to customer order session creation, order placement, and staff workflow execution.

---

## High-Level Sequence

The backend enforces strict separation of concerns. Below is the operational sequence of the system:

```text
1. User Provisioning (Owner)
         ↓
2. Restaurant Creation (POST /api/restaurants)
         ↓
3. Employee Onboarding (POST /api/restaurants/:id/employees)
         ↓
4. Table Setup & Waiter Assignment (Owner restricted)
         ↓
5. Geofence & Workflow Configuration (PATCH /api/restaurants/:id/ordering-config)
         ↓
6. Customer Physical Session Verification (POST /api/order-sessions)
         ↓
7. Order Placement, Waiter Snapshotting & Auto-Advance (POST /api/orders)
         ↓
8. Queue Visibility & Dynamic Workflow Advancement (Employee restricted)
         ↓
9. Loyalty Stamp Accumulation (Cashier restricted; Planned Next Phase)
```

---

## Step 1: Owner Account Provisioning

### How to obtain an Owner token
1. **Public Registration Constraint**: The public sign-up route `POST /api/users/register` strictly restricts signups to the `'customer'` role. Payloads containing higher privilege roles (e.g. `'owner'` or `'admin'`) are explicitly rejected with a `PUBLIC_ROLE_ASSIGNMENT_NOT_ALLOWED` error.
2. **Promoting to Owner**: 
   - Register the account via the public endpoint (which creates a user with `role: "customer"`).
   - For **local development and testing**, promote the user to an owner directly in MongoDB:
     ```js
     db.users.updateOne(
       { phone: "+1234567890" },
       { $set: { role: "owner" } }
     );
     ```
3. **Login**: Authenticate at `POST /api/users/login` with the owner credentials to retrieve the **Owner JWT Token** (expires in 7 days).

---

## Step 2: Restaurant Creation

- **Endpoint**: `POST /api/restaurants`
- **Authentication**: Requires a valid **Owner JWT Token** in the authorization header:
  ```http
  Authorization: Bearer <ownerToken>
  ```
- **Action**: Creates the restaurant profile. The backend automatically associates the authenticated user's ID as the restaurant `owner`.
- **Response**: Returns the restaurant profile including the system-assigned `_id` (referred to below as `restaurantId`).

---

## Step 3: Employee Onboarding & Login

Owners onboard operational staff and assign them specific roles to process orders.

### 1. Registering Employees
- **Endpoint**: `POST /api/restaurants/:restaurantId/employees`
- **Authentication**: Requires the **Owner JWT Token** (must match the restaurant owner).
- **Body Payload**:
  ```json
  {
    "name": "Alex Chef",
    "password": "password123",
    "role": "chef"
  }
  ```
  *Allowed roles: `chef`, `waiter`, `cashier`.*
- **Action**: Validates the role and checks active staff limits against the restaurant's subscription tier. Saves the employee to the database (`isActive: true`).

### 2. Employee Login
- **Endpoint**: `POST /api/restaurants/employee/login`
- **Authentication**: Public endpoint.
- **Body Payload**:
  ```json
  {
    "employeeId": "<employeeId>",
    "password": "password123"
  }
  ```
- **Response**: The server verifies that `isActive === true` and returns the **Employee JWT Token** (`role: 'employee'`) and their assigned operational metadata.

---

## Step 4: Table Setup & Waiter Assignment

The owner maps physical tables and assigns waiters before customers can check in.

### 1. Creating Restaurant Tables
- **Endpoint**: `POST /api/restaurants/:restaurantId/tables`
- **Authentication**: Requires **Owner JWT Token**.
- **Body Payload**:
  ```json
  {
    "name": "Table 7",
    "code": "T7",
    "description": "Main hall window table"
  }
  ```
- **Action**: Trims and normalizes the code to uppercase (`T7`). Checks that the code is unique *within* the restaurant. Registers the table as active.

### 2. Assigning a Waiter to a Table
- **Endpoint**: `PATCH /api/restaurants/:restaurantId/tables/:tableId/waiter`
- **Authentication**: Requires **Owner JWT Token**.
- **Body Payload**:
  ```json
  {
    "waiterId": "<waiterEmployeeId>"
  }
  ```
- **Validation**: Verifies that the waiter exists, is active, has the role `'waiter'`, and belongs to the same restaurant. Supports unassignment (`waiterId: null`).

### 3. Bulk Table Assignments
- **Endpoint**: `PATCH /api/restaurants/:restaurantId/table-assignments`
- **Authentication**: Requires **Owner JWT Token**.
- **Body Payload**:
  ```json
  {
    "waiterId": "<waiterEmployeeId>",
    "tableIds": ["<tableId1>", "<tableId2>"]
  }
  ```

### 4. Waiter Deactivation Hook
When an employee's status is updated to inactive (`isActive: false`), the system automatically clears all table assignments matching `assignedWaiter: employeeId`.

### 5. Generating Table QR Codes
- **Endpoint**: `POST /api/restaurants/:restaurantId/tables/:tableId/qr`
- **Authentication**: Requires **Owner JWT Token**.
- **Action**: 
  - Generates a cryptographically random token (`crypto.randomBytes(32)`).
  - Hashes the token using SHA-256 and saves only the hash (`tokenHash`) in MongoDB.
- **Response**: Returns the raw token exactly **once** in the payload along with a redirect URL containing the raw token parameter (`?t=...`). The raw token is never saved or logged in cleartext.

---

## Step 5: Geofence and Workflow Configuration

The Owner must configure geographical boundaries and customize order-advancement rules.

### 1. Set Geofencing Parameters
- **Endpoint**: `PATCH /api/restaurants/:restaurantId/ordering-config`
- **Authentication**: Requires **Owner JWT Token**.
- **Body Payload**:
  ```json
  {
    "latitude": 9.0200,
    "longitude": 38.7500,
    "orderingRadiusMeters": 100,
    "orderingEnabled": true
  }
  ```
- **Validation rules**:
  - `latitude` must be between -90 and 90; `longitude` must be between -180 and 180.
  - `orderingRadiusMeters` must be between 30 and 200.
  - `orderingEnabled` cannot be set to `true` unless coordinates are configured.

### 2. Customize Workflow
- **Endpoint**: `PATCH /api/restaurants/:restaurantId/workflow`
- **Authentication**: Requires **Owner JWT Token**.
- **Body Payload**: Custom steps configuration list.
- **Rules**:
  - Owners cannot modify system-controlled fields (`key`, `systemState`, `required`). Attempting to do so returns `WORKFLOW_SYSTEM_FIELD_IMMUTABLE`.
  - Required steps (`placed` and `completed`) must remain enabled.

---

## Step 6: Customer Physical Session Verification

To prevent remote ordering, a customer must verify their presence at the table to receive a temporary `OrderSession`.

```text
Customer scans QR code (contains raw token 't')
                     ↓
Frontend requests device GPS coordinates (Lat, Lng) and accuracy
                     ↓
POST /api/order-sessions { qrToken, location: { latitude, longitude, accuracy } }
                     ↓
1. Validate token: Server hashes raw token and matches db.qrCodes
                     ↓
2. Validate GPS accuracy: Accuracy must be <= min(150, restaurant.radius) (LOCATION_ACCURACY_TOO_LOW)
                     ↓
3. Calculate distance: Haversine distance from coordinates to restaurant location
                     ↓
4. Verify radius: Distance must be <= Restaurant.orderingRadiusMeters
                     ↓
5. Conflict resolution: Cancel sessions at other restaurants
                     ↓
6. Table Waiter check: Table must have an assigned waiter
                     ↓
OrderSession created (expires in 90 minutes) -> Unlocks menu
```

---

## Step 7: Order Placement, Waiter Snapshotting & Auto-Advance

Once the session is active, the customer builds their cart and submits the order.

### 1. Submitting the Order
- **Endpoint**: `POST /api/orders`
- **Headers**:
  - `Authorization: Bearer <customerToken>`
  - `Idempotency-Key: <unique-uuid-or-string>` (avoids duplicate creations on retries)
- **Body Payload**:
  ```json
  {
    "orderSessionId": "<sessionId>",
    "location": {
      "latitude": 9.0201,
      "longitude": 38.7501,
      "accuracy": 15
    },
    "items": [
      {
        "menuItemId": "<menuItemId>",
        "quantity": 2,
        "notes": "No onions"
      }
    ],
    "customerNotes": "Please deliver together."
  }
  ```
- **Validation & Flow Rules**:
  - **Fresh Proximity Check**: Re-verifies customer presence at the table with the provided coordinates. Mismatch returns `ORDER_LOCATION_VERIFICATION_FAILED`.
  - **Waiter Resolution & Snapshot**: Reads the table's assigned waiter. If none is assigned, throws `TABLE_WAITER_NOT_ASSIGNED`. If the waiter is inactive, throws `TABLE_WAITER_UNAVAILABLE`. Otherwise, snapshots the waiter into the order `service` tracking.
  - **Pricing integrity**: Backend ignores any client-supplied pricing parameters and calculates total pricing server-side.
  - **Workflow Snapshotting**: Copies the restaurant's active workflow steps into the Order document.
  - **Auto-Advance**: The default workflow enables `autoAdvance` on the `placed` step. Order creation registers both `order_created` and `auto_started_preparation` in the timeline, immediately transitioning the order status to `preparing`.

---

## Step 8: Queue Visibility & Dynamic Workflow Advancement

Restaurant staff view and advance order states through the workflow snapshot.

### 1. Retrieving Queue
- **Endpoint**: `GET /api/employee/orders?status=active`
- **Authentication**: Requires **Employee JWT Token**.
- **Action**: Returns active orders of the employee's restaurant, sorted oldest-first.
  - **Chefs & Cashiers**: See all orders visible to their roles restaurant-wide.
  - **Waiters**: Isolated queue. Only returns active orders assigned to the authenticated waiter (`service.waiter === req.employee.id`).

### 2. Advancing Steps Dynamically
- **Endpoint**: `POST /api/employee/orders/:orderId/advance`
- **Authentication**: Requires **Employee JWT Token**.
- **Body Payload**:
  ```json
  {
    "expectedStep": "ready"
  }
  ```
- **Validation**:
  - Resolves next enabled workflow step dynamically.
  - Enforces role capabilities: employee role must match the step's `actionRoles` and have correct `ROLE_PERMISSIONS`.
  - **Assigned Waiter Control**: If employee is a waiter, they are blocked from advancing/serving orders assigned to another waiter (`ORDER_ASSIGNED_TO_ANOTHER_WAITER`).
  - **Concurrency protection**: Specifies `expectedStep`. Mismatches return `409 ORDER_STATE_CHANGED`.
  - **Decoupled Payment**: Waiters advance the order to `completed` (Mark Served) with `'orders:serve'` permission. Payment acts independently on the payment state without blocking order completion.
