import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";

import { EmailDeliveryError, type EmailMessage, type EmailProviderPort } from "./notification-delivery";

export class SesEmailProvider implements EmailProviderPort {
  constructor(private readonly client: SESv2Client, private readonly fromAddress: string) {}
  async send(message: EmailMessage): Promise<{ readonly messageId: string }> {
    try {
      const result = await this.client.send(new SendEmailCommand({ Content: { Simple: { Body: { Html: { Charset: "UTF-8", Data: message.html }, Text: { Charset: "UTF-8", Data: message.text } }, Subject: { Charset: "UTF-8", Data: message.subject } } }, Destination: { ToAddresses: [message.to] }, FromEmailAddress: this.fromAddress }));
      if (result.MessageId === undefined) throw new EmailDeliveryError("PROVIDER_REJECTED", false);
      return { messageId: result.MessageId };
    } catch (reason) {
      if (reason instanceof EmailDeliveryError) throw reason;
      const name = typeof reason === "object" && reason !== null && "name" in reason ? String(reason.name) : "";
      throw new EmailDeliveryError(name === "TooManyRequestsException" || name === "ServiceUnavailableException" ? "TRANSIENT" : "PROVIDER_REJECTED", name === "TooManyRequestsException" || name === "ServiceUnavailableException");
    }
  }
}
