const TABLE = /^gym-adr-platform-(?:development|production)(?:-restore-[0-9]{8}T[0-9]{6}Z)?$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

export const buildRestorePlan = ({ sourceTable, targetTable, restoreAt }) => {
  if (!TABLE.test(sourceTable) || !TABLE.test(targetTable) || sourceTable === targetTable || !targetTable.includes("-restore-") || !TIMESTAMP.test(restoreAt) || Number.isNaN(Date.parse(restoreAt))) throw new Error("Restore parameters are invalid");
  return Object.freeze({
    destructive: false,
    restore: ["dynamodb", "restore-table-to-point-in-time", "--source-table-name", sourceTable, "--target-table-name", targetTable, "--restore-date-time", restoreAt],
    requiredChecks: ["ACTIVE", "PK_SK", "GSI1_OPERATIONAL", "GSI2_RELATIONSHIPS", "SSE_KMS", "SAMPLE_STRONG_READS"],
    sourceTable,
    targetTable,
  });
};

if (process.argv[1]?.endsWith("dynamodb-restore-plan.mjs")) {
  const [sourceTable, targetTable, restoreAt] = process.argv.slice(2);
  process.stdout.write(`${JSON.stringify(buildRestorePlan({ sourceTable, targetTable, restoreAt }), null, 2)}\n`);
}
