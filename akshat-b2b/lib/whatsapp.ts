// Official Akshat Fertilizers contact for offline coordination (KYC, orders, payments).
export const OFFICIAL_PHONE_DISPLAY = '+91 91312 83429';
export const OFFICIAL_PHONE = '919131283429'; // wa.me / tel digits only

/** wa.me deep-link with a pre-filled message. */
export function waLink(message: string, phone: string = OFFICIAL_PHONE): string {
  const digits = phone.replace(/[^0-9]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function telLink(phone: string = OFFICIAL_PHONE): string {
  return `tel:+${phone.replace(/[^0-9]/g, '')}`;
}

/** Pre-written messages for the milestones the FRD calls out. */
export const waMsg = {
  registration: (name: string, type: string) =>
    `Hello Akshat Fertilizers, I just registered as a ${type} (${name}). Please help me complete my KYC and activate my account.`,
  approval: (name: string) =>
    `Hello ${name}, your Akshat Fertilizers account has been APPROVED. You can now log in to the portal to see pricing and place orders.`,
  rejection: (name: string) =>
    `Hello ${name}, regarding your Akshat Fertilizers registration — we were unable to approve it. Please contact us to proceed.`,
  orderPlaced: (orderNo: string, amount: string) =>
    `Hello Akshat Fertilizers, I have placed order ${orderNo} (${amount}). Please confirm and share next steps.`,
  advanceCoordination: (orderNo: string, amount: string) =>
    `Hello Akshat Fertilizers, please share advance-payment instructions for my order ${orderNo} (${amount}).`,
  paymentReminder: (name: string, orderNo: string, due: string) =>
    `Hello ${name}, a reminder that order ${orderNo} has an outstanding balance of ${due}. Please arrange payment at your earliest.`,
};
