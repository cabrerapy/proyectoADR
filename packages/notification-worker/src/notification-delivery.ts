import type { Notification } from "@gym-adr/domain";

export interface EmailMessage { readonly html: string; readonly subject: string; readonly text: string; readonly to: string }
export interface EmailProviderPort { send(message: EmailMessage): Promise<{ readonly messageId: string }> }
export interface NotificationLeasePort {
  acquireLease(input: { readonly expectedVersion: number; readonly leaseOwner: string; readonly leaseUntil: string; readonly notificationId: string; readonly startedAt: string }): Promise<Notification>;
  completeAttempt(input: { readonly attemptId: string; readonly completedAt: string; readonly errorCode?: string; readonly expectedVersion: number; readonly leaseOwner: string; readonly notificationId: string; readonly providerMessageId?: string; readonly retryAt?: string }): Promise<Notification>;
}
export class EmailDeliveryError extends Error {
  constructor(readonly code: "BOUNCED" | "PROVIDER_REJECTED" | "TRANSIENT", readonly retryable: boolean) { super("No fue posible entregar el correo."); this.name = "EmailDeliveryError"; }
}
const safeEmail = (value: string): string => {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new EmailDeliveryError("PROVIDER_REJECTED", false);
  return email;
};
export const renderNotification = (notification: Notification, recipientEmail: string): EmailMessage => {
  const to = safeEmail(recipientEmail);
  if (notification.type !== "MEMBERSHIP_EXPIRY") throw new EmailDeliveryError("PROVIDER_REJECTED", false);
  const subject = "Tu membresía de Gym ADR está próxima a vencer";
  const text = `Tu membresía vence el ${notification.dueDate}. Contacta al gimnasio para renovarla.`;
  return { html: `<p>Tu membresía vence el <strong>${notification.dueDate}</strong>.</p><p>Contacta al gimnasio para renovarla.</p>`, subject, text, to };
};
const retryAt = (now: Date, attempts: number): string => new Date(now.getTime() + Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000).toISOString();
export const deliverNotification = async (input: { readonly attemptId: string; readonly leaseOwner: string; readonly notification: Notification; readonly now: Date; readonly provider: EmailProviderPort; readonly recipientEmail: string; readonly repository: NotificationLeasePort }): Promise<Notification> => {
  const startedAt = input.now.toISOString();
  const leased = await input.repository.acquireLease({ expectedVersion: input.notification.version, leaseOwner: input.leaseOwner, leaseUntil: new Date(input.now.getTime() + 5 * 60_000).toISOString(), notificationId: input.notification.id, startedAt });
  try {
    const result = await input.provider.send(renderNotification(leased, input.recipientEmail));
    return input.repository.completeAttempt({ attemptId: input.attemptId, completedAt: startedAt, expectedVersion: leased.version, leaseOwner: input.leaseOwner, notificationId: leased.id, providerMessageId: result.messageId });
  } catch (reason) {
    const error = reason instanceof EmailDeliveryError ? reason : new EmailDeliveryError("TRANSIENT", true);
    const attempts = leased.attempts ?? 1;
    return input.repository.completeAttempt({ attemptId: input.attemptId, completedAt: startedAt, errorCode: error.code, expectedVersion: leased.version, leaseOwner: input.leaseOwner, notificationId: leased.id, ...(error.retryable && attempts < 3 ? { retryAt: retryAt(input.now, attempts) } : {}) });
  }
};
