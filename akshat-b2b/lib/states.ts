// Indian states / UTs with GST state codes (first two digits of a GSTIN).
export const INDIAN_STATES: { name: string; code: string }[] = [
  { name: 'Andaman and Nicobar Islands', code: '35' }, { name: 'Andhra Pradesh', code: '37' },
  { name: 'Arunachal Pradesh', code: '12' }, { name: 'Assam', code: '18' }, { name: 'Bihar', code: '10' },
  { name: 'Chandigarh', code: '04' }, { name: 'Chhattisgarh', code: '22' },
  { name: 'Dadra and Nagar Haveli and Daman and Diu', code: '26' }, { name: 'Delhi', code: '07' },
  { name: 'Goa', code: '30' }, { name: 'Gujarat', code: '24' }, { name: 'Haryana', code: '06' },
  { name: 'Himachal Pradesh', code: '02' }, { name: 'Jammu and Kashmir', code: '01' }, { name: 'Jharkhand', code: '20' },
  { name: 'Karnataka', code: '29' }, { name: 'Kerala', code: '32' }, { name: 'Ladakh', code: '38' },
  { name: 'Lakshadweep', code: '31' }, { name: 'Madhya Pradesh', code: '23' }, { name: 'Maharashtra', code: '27' },
  { name: 'Manipur', code: '14' }, { name: 'Meghalaya', code: '17' }, { name: 'Mizoram', code: '15' },
  { name: 'Nagaland', code: '13' }, { name: 'Odisha', code: '21' }, { name: 'Puducherry', code: '34' },
  { name: 'Punjab', code: '03' }, { name: 'Rajasthan', code: '08' }, { name: 'Sikkim', code: '11' },
  { name: 'Tamil Nadu', code: '33' }, { name: 'Telangana', code: '36' }, { name: 'Tripura', code: '16' },
  { name: 'Uttar Pradesh', code: '09' }, { name: 'Uttarakhand', code: '05' }, { name: 'West Bengal', code: '19' },
];

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function validateGstin(gstin: string, state: string): string | null {
  const g = gstin.trim().toUpperCase();
  if (!GSTIN_RE.test(g)) return 'GSTIN format is invalid (15 characters, e.g. 27ABCDE1234F1Z5).';
  const st = INDIAN_STATES.find((s) => s.name === state);
  if (!st) return 'Select a valid state.';
  if (g.slice(0, 2) !== st.code) return `GSTIN state code ${g.slice(0, 2)} does not match ${state} (${st.code}).`;
  return null;
}
