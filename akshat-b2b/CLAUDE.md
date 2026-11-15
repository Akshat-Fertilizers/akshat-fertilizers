# AKSHAT FERTILIZERS — B2B Customer Portal & Website Specification

## 1. Role & Execution Objective
You are the Lead Full-Stack Web Engineer working inside the existing `akshat-fertilizers` Next.js (App Router) + Tailwind CSS + Supabase repository.
Refactor and build the complete production codebase according to the finalized Functional Requirements Document (FRD) below. 

**CRITICAL ARCHITECTURAL PIVOTS (Remove Legacy Logic):**
- **REMOVE** all Tally XML sync routes, scripts, and UI buttons.
- **REMOVE** multi-godown inventory tracking (MH/MP splits), godown stock transfers, and location-based stock filtering.
- **REMOVE** automated state-based transportation/freight charges at checkout.
- **REMOVE** online payment gateways, online KYC document uploaders, and online order approval gates.

---

## 2. Tech Stack & Folder Structure
- **Framework:** Next.js 14+ (App Router, TypeScript), Tailwind CSS, Lucide React
- **Backend/DB:** Supabase (PostgreSQL + Auth + RLS)
- **Key Routes to Build/Refactor:**
  - `/` (or `/home`): Public-facing company website + Landing Registration/Login Pop-up + Public Product Catalogue (prices hidden).
  - `/register`: Split registration flow for **Dealers** vs. **Farmers**.
  - `/login`: Unified customer login (blocks unapproved/rejected accounts).
  - `/portal`: Customer Dashboard (dynamically renders Dealer vs. Farmer pricing, cart rules, orders, and credit/payment ledger).
  - `/admin/dashboard`: Akshat Fertilizers Central Admin Console.

---

## 3. Core Functional Modules & Business Logic

### Module A: Public Website & Landing Pop-up (`/`)
1. **Unauthenticated Landing Pop-up:**
   - Triggers immediately on visit if user session is null/logged out (suppress once logged in; reappear for logged-out visitors on subsequent visits).
   - Introduces Akshat Fertilizers portal and prompts registration for pricing/offers.
   - Two primary CTAs: **Log In** and **Sign Up** (Sign Up splits into **"Register as a Dealer"** and **"Register as a Farmer"**).
2. **Homepage Content Cleanup & Layout:**
   - Replace placeholder flower imagery with a clean **Leadership / Directors** section.
   - **Remove** "Trending", "Soon Delivery", and "Key Strength" sections.
   - Display full product catalogue (names, descriptions, specs) from the brochure—**HIDE all prices** for logged-out visitors. Clicking "View Price" prompts Sign Up / Log In.
   - Prominent **Dealer Login**, **Become a Dealer**, and **Farmer Registration** buttons.
   - **Enquiry Form** + **Call to Order** CTA linking directly to official Phone & WhatsApp (`wa.me`).

### Module B: Split Customer Registration & Offline KYC (`/register`)
1. **Account Types:** `DEALER` | `FARMER`
2. **Form Fields:**
   - *Common:* Full Name, Mobile Number, WhatsApp Number, Email Address, State, City.
   - *Conditional:* **Business Name** (required if `DEALER`) | **Farm Name** (required if `FARMER`).
   - *Note:* Do NOT include file upload fields for KYC documents.
3. **Submission & Status Flow:**
   - Saves to `profiles` table with `status = 'PENDING'`.
   - Displays exact confirmation modal/message:
     > *"Thank you for registering with Akshat Fertilizers! Our team will contact you on WhatsApp or by phone to collect the required documents and complete your registration. In the meantime, you can continue browsing our website."*
   - Users cannot access `/portal` until an Admin changes status from `PENDING` to `APPROVED` (if `REJECTED`, deny portal login).

### Module C: Dual Pricing Engine & Customer Portal (`/portal`)
1. **Dual Pricing Lists:**
   - Each product in `products` maintains two distinct prices: `dealer_price` and `farmer_price`.
   - Backend/RLS ensures logged-out users see `null` for prices; `APPROVED` Dealers see `dealer_price`; `APPROVED` Farmers see `farmer_price`.
2. **Dealer Ordering & Discount Slabs:**
   - **Order-Value Discount Slabs** (configurable in Admin, initialized with):
     - Below ₹50,000: `0%` (Standard minimum order threshold not met)
     - ₹50,000 – ₹69,999: `0%`
     - ₹70,000 – ₹99,999: `10%`
     - ₹1,00,000 and above: `15%`
   - **₹50,000 Soft-Gate Pop-up:** If Dealer cart subtotal is `< ₹50,000` (e.g., ₹35,000), display a pop-up explaining the ₹50,000 standard minimum order requirement and discount tiers, offering two buttons:
     1. *"Add More Products"* (returns to catalogue)
     2. *"Submit Request Below ₹50,000"* (submits order flagged as `is_below_min_order = true` for offline commercial/transport review).
   - **15-Day Credit Facility:** Dealer orders default to 15-day credit terms (`due_date = order_date + 15 days`).
3. **Farmer Ordering (Advance Payment):**
   - Farmers see `farmer_price` and do **not** get Dealer volume discount slabs or 15-day credit.
   - Checkout submits the order as `ADVANCE_PAYMENT_PENDING` and prompts WhatsApp coordination for offline payment instructions.
4. **Customer Dashboard Tabs:**
   - Profile & Account Type badge (`Dealer` / `Farmer`).
   - Product Catalogue & Cart.
   - **Order History:** Order ID, Date, Items & Quantities, Subtotal, Applied Discount, Final Amount, Order Status, Payment Status, Amount Paid, Outstanding Balance, and Due Date (for Dealers).

### Module D: Dealer Credit & >90-Day Overdue Interest
- Track `order_amount`, `amount_paid`, `outstanding_amount`, `due_date` (+15 days), and remaining credit days.
- If `outstanding_amount > 0` and invoice is unpaid beyond **90 days**, calculate/display applicable overdue interest (`penalty_interest`) and total payable, with manual admin override/adjustment controls.

### Module E: Central Admin Dashboard (`/admin/dashboard`)
1. **Overview KPI Cards:** Total Registered Customers (Dealers vs. Farmers), Pending Registrations, Total Orders Received, Recent Orders, Total Outstanding Payments, Overdue Payments.
2. **Customer & Registration Management:**
   - Filter by `DEALER` / `FARMER` and status (`PENDING`, `APPROVED`, `REJECTED`).
   - One-click **Approve / Reject** buttons + direct **WhatsApp / Call** action links (`https://wa.me/...`) to collect offline KYC documents and send approval/rejection notifications.
   - View individual customer order & payment ledger.
3. **Product & Dual-Pricing Management:**
   - CRUD for Products (Name, Category, Description, Specs, Brochure details) with side-by-side editable **`dealer_price`** and **`farmer_price`** fields.
4. **Order Management:**
   - Search by Order ID or Customer Name; badge highlighting `Below ₹50k Request` orders.
   - View line items, discounts, and update Order Status (e.g., `Received`, `Confirmed Offline`, `Dispatched`, `Delivered`).
5. **Payment, Credit & Discount Management:**
   - **Manual Payment Recorder:** Form/modal per order or customer to log offline payments received (`amount_paid`), auto-recalculating `outstanding_amount` and updating payment status (`Unpaid`, `Partial`, `Paid`).
   - **Overdue & Interest Controls:** View >90-day overdue Dealer accounts, apply/adjust overdue interest, and manage discount slabs or customer-specific discount overrides.

---

## 4. Supabase PostgreSQL Schema (`supabase/migrations/002_frd_schema.sql`)
Generate clean, idempotent SQL migration creating/updating:
1. `profiles`: `id` (uuid, refs auth.users), `role` (`'ADMIN' | 'DEALER' | 'FARMER'`), `status` (`'PENDING' | 'APPROVED' | 'REJECTED'`), `full_name`, `mobile`, `whatsapp`, `email`, `state`, `city`, `entity_name` (Business Name or Farm Name), `custom_discount_pct` (numeric nullable), `created_at`.
2. `products`: `id`, `name`, `category`, `description`, `specifications`, `unit`, `dealer_price` (numeric), `farmer_price` (numeric), `is_active` (boolean), `created_at`.
3. `discount_slabs`: `id`, `min_amount` (numeric), `max_amount` (numeric nullable), `discount_pct` (numeric), `is_active` (boolean) — seeded with the ₹50k–₹69,999 (0%), ₹70k–₹99,999 (10%), ₹1,00,000+ (15%) slabs.
4. `orders`: `id`, `order_number` (readable serial e.g. `AKF-1001`), `user_id`, `customer_type` (`'DEALER' | 'FARMER'`), `subtotal`, `discount_amount`, `final_amount`, `is_below_min_order` (boolean), `order_status`, `payment_terms` (`'CREDIT_15D' | 'ADVANCE'`), `payment_status` (`'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE'`), `amount_paid` (numeric default 0), `due_date` (date nullable), `overdue_interest` (numeric default 0), `created_at`.
5. `order_items`: `id`, `order_id`, `product_id`, `product_name`, `quantity`, `unit_price`, `total_price`.
6. `payment_logs`: `id`, `order_id`, `user_id`, `amount`, `payment_mode`, `reference_note`, `recorded_at`.

Include RLS policies so:
- Public/unauthenticated users can read `products` (excluding price columns via a secure public view or server component filtering) and insert into `profiles` (registration).
- Approved customers can read their own `profiles`, `orders`, `order_items`, and `payment_logs`, and create new `orders`.
- `ADMIN` role has full read/write access across all tables.

---

## 5. Execution Instructions for Claude
1. Inspect the existing workspace files first so existing styling, branding assets, and Supabase config are preserved seamlessly.
2. Generate the SQL migration file `supabase/migrations/002_frd_schema.sql`.
3. Build/refactor the backend server actions / API routes (`app/api/orders/route.ts`, `app/api/admin/payments/route.ts`, `app/api/register/route.ts`) with full TypeScript types.
4. Build/refactor the UI components for `/`, `/register`, `/login`, `/portal`, and `/admin/dashboard` with responsive Tailwind styling and direct WhatsApp notification deep-links (`wa.me`) at key milestones (Registration, Approval, Order Confirmation, Payment/Overdue Reminders).