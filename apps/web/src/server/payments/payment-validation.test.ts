import { validateAdminPaymentQuery, validateOwnPaymentQuery, validatePaymentReceiptQuery, validatePaymentReceiptUpload, validateRecordPayment } from "@gym-adr/validation";
import { describe, expect, it } from "vitest";

describe("payment validation", () => {
  it("accepts a bounded manual payment and rejects unknown fields", () => {
    const payment = {
      amount: 250_000, membershipId: "membership-1", membershipStartDate: "2026-08-08",
      method: "BANK_TRANSFER", paidAt: "2026-08-08T13:00:00.000Z", periodEnd: "2026-09-08",
      periodStart: "2026-08-08", receiptKey: "payment-receipts/receipt-1.pdf",
      status: "CONFIRMED", userId: "student-1",
    };
    expect(validateRecordPayment(payment)).toMatchObject({ success: true });
    expect(validateRecordPayment({ ...payment, role: "ADMIN" })).toMatchObject({ success: false });
  });

  it("rejects oversized or unsupported receipt uploads", () => {
    expect(validatePaymentReceiptUpload({ contentType: "application/pdf", fileName: "recibo.pdf", size: 5_242_880 })).toMatchObject({ success: true });
    expect(validatePaymentReceiptUpload({ contentType: "text/html", fileName: "recibo.html", size: 10 })).toMatchObject({ success: false });
    expect(validatePaymentReceiptUpload({ contentType: "image/png", fileName: "recibo.png", size: 5_242_881 })).toMatchObject({ success: false });
  });

  it("validates bounded payment queries and rejects extra ownership parameters", () => {
    expect(validateOwnPaymentQuery(new URLSearchParams())).toMatchObject({ success: true });
    expect(validateOwnPaymentQuery(new URLSearchParams({ userId: "other" }))).toMatchObject({ success: false });
    expect(validateAdminPaymentQuery(new URLSearchParams({ filter: "date", value: "2026-08-08" }))).toMatchObject({ success: true });
    expect(validateAdminPaymentQuery(new URLSearchParams({ filter: "status", value: "UNKNOWN" }))).toMatchObject({ success: false });
    expect(validatePaymentReceiptQuery(new URLSearchParams({ paidAt: "2026-08-08T13:00:00.000Z", paymentId: "payment-1" }))).toMatchObject({ success: true });
  });
});
