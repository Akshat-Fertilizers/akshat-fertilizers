// Tally Prime XML (Import Data -> Vouchers) builder for finalised B2B sales invoices.
// Sign convention: debit entries carry ISDEEMEDPOSITIVE=Yes and a negative AMOUNT.
import { round2 } from '@/lib/utils';

export interface TallyOrder {
  id: string;
  order_no: string;
  purchase_date: string; // YYYY-MM-DD
  ship_to_state: string;
  subtotal: number;
  freight: number;
  gst_amount: number;
  base_amount: number;
  buyer: { business_name: string | null; gstin: string | null; state: string | null } | null;
  godown: { name: string; state: string } | null;
  order_items: { sku: string; product_name: string; unit: string; qty: number; unit_price: number; line_total: number; gst_amount: number }[];
}

export interface TallyConfig {
  company: string;
  salesLedger: string;
  freightLedger: string;
  cgstLedger: string;
  sgstLedger: string;
  igstLedger: string;
}

export function tallyConfigFromEnv(): TallyConfig {
  return {
    company: process.env.TALLY_COMPANY_NAME || 'Akshat Fertilizer',
    salesLedger: process.env.TALLY_SALES_LEDGER || 'Sales - Fertilizers',
    freightLedger: process.env.TALLY_FREIGHT_LEDGER || 'Freight Outward',
    cgstLedger: process.env.TALLY_CGST_LEDGER || 'Output CGST',
    sgstLedger: process.env.TALLY_SGST_LEDGER || 'Output SGST',
    igstLedger: process.env.TALLY_IGST_LEDGER || 'Output IGST',
  };
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const amt = (n: number) => round2(Number(n)).toFixed(2);
const tallyDate = (d: string) => d.slice(0, 10).replace(/-/g, '');

function ledgerEntry(ledger: string, amount: number, debit: boolean, extra = '') {
  return `
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>${esc(ledger)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
          <ISPARTYLEDGER>${extra ? 'Yes' : 'No'}</ISPARTYLEDGER>
          <AMOUNT>${debit ? '-' : ''}${amt(amount)}</AMOUNT>${extra}
        </LEDGERENTRIES.LIST>`;
}

export function buildVoucher(o: TallyOrder, cfg: TallyConfig): string {
  const party = o.buyer?.business_name || o.buyer?.gstin || 'Unknown Party';
  const intraState = (o.godown?.state ?? '').toLowerCase() === (o.ship_to_state ?? '').toLowerCase();
  const gst = Number(o.gst_amount);
  const cgst = round2(gst / 2);
  const sgst = round2(gst - cgst);

  const inventory = o.order_items
    .map(
      (it) => `
        <ALLINVENTORYENTRIES.LIST>
          <STOCKITEMNAME>${esc(it.product_name)}</STOCKITEMNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <RATE>${amt(it.unit_price)}/${esc(it.unit)}</RATE>
          <AMOUNT>${amt(it.line_total)}</AMOUNT>
          <ACTUALQTY>${it.qty} ${esc(it.unit)}</ACTUALQTY>
          <BILLEDQTY>${it.qty} ${esc(it.unit)}</BILLEDQTY>
          <BATCHALLOCATIONS.LIST>
            <GODOWNNAME>${esc(o.godown?.name ?? 'Main Location')}</GODOWNNAME>
            <AMOUNT>${amt(it.line_total)}</AMOUNT>
            <ACTUALQTY>${it.qty} ${esc(it.unit)}</ACTUALQTY>
            <BILLEDQTY>${it.qty} ${esc(it.unit)}</BILLEDQTY>
          </BATCHALLOCATIONS.LIST>
          <ACCOUNTINGALLOCATIONS.LIST>
            <LEDGERNAME>${esc(cfg.salesLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${amt(it.line_total)}</AMOUNT>
          </ACCOUNTINGALLOCATIONS.LIST>
        </ALLINVENTORYENTRIES.LIST>`,
    )
    .join('');

  const partyBill = `
          <BILLALLOCATIONS.LIST>
            <NAME>${esc(o.order_no)}</NAME>
            <BILLTYPE>New Ref</BILLTYPE>
            <BILLCREDITPERIOD>15 Days</BILLCREDITPERIOD>
            <AMOUNT>-${amt(o.base_amount)}</AMOUNT>
          </BILLALLOCATIONS.LIST>`;

  const taxes = gst <= 0 ? '' : intraState
    ? ledgerEntry(cfg.cgstLedger, cgst, false) + ledgerEntry(cfg.sgstLedger, sgst, false)
    : ledgerEntry(cfg.igstLedger, gst, false);

  return `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER REMOTEID="${esc(o.id)}" VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
        <DATE>${tallyDate(o.purchase_date)}</DATE>
        <EFFECTIVEDATE>${tallyDate(o.purchase_date)}</EFFECTIVEDATE>
        <GUID>${esc(o.id)}</GUID>
        <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${esc(o.order_no)}</VOUCHERNUMBER>
        <REFERENCE>${esc(o.order_no)}</REFERENCE>
        <PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>
        <PARTYNAME>${esc(party)}</PARTYNAME>
        <PARTYGSTIN>${esc(o.buyer?.gstin)}</PARTYGSTIN>
        <STATENAME>${esc(o.buyer?.state)}</STATENAME>
        <PLACEOFSUPPLY>${esc(o.ship_to_state)}</PLACEOFSUPPLY>
        <BASICBUYERNAME>${esc(party)}</BASICBUYERNAME>
        <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
        <ISINVOICE>Yes</ISINVOICE>
        <NARRATION>${esc(`B2B portal indent ${o.order_no} | Godown: ${o.godown?.name ?? '-'} | 15-day credit`)}</NARRATION>${ledgerEntry(party, Number(o.base_amount), true, partyBill)}${inventory}${ledgerEntry(cfg.freightLedger, Number(o.freight), false)}${taxes}
      </VOUCHER>
    </TALLYMESSAGE>`;
}

export function buildEnvelope(orders: TallyOrder[], cfg: TallyConfig): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${esc(cfg.company)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>${orders.map((o) => buildVoucher(o, cfg)).join('')}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}
