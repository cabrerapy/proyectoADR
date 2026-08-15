import { createDynamoDbAdapter, MembershipRepository, NotificationRepository } from "@gym-adr/data-access";
import { runExpiryReminderJob } from "./expiry-reminder-job";

export const handler = async (): Promise<{ readonly createdOrReplayed: number; readonly skipped: number; readonly targetDate: string }> => {
  const environment = process.env.APP_ENVIRONMENT;
  const tableName = process.env.DYNAMODB_TABLE_NAME;
  const region = process.env.AWS_REGION;
  if ((environment !== "local" && environment !== "development" && environment !== "production") || tableName === undefined || region === undefined) throw new Error("La configuración del job no es válida.");
  const adapter = createDynamoDbAdapter({ environment, region });
  try {
    return await runExpiryReminderJob({ memberships: new MembershipRepository(adapter, tableName), notifications: new NotificationRepository(adapter, tableName), now: new Date() });
  } finally { adapter.destroy(); }
};
