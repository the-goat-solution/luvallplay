// Prints Kubernetes CronJob manifests for the app's scheduled jobs
// (lib/cron.ts is the list), for a region that doesn't run on Vercel.
//
//   node --import ./tests/register.mjs scripts/cron/k8s.mjs \
//     --url https://club.example --secret-name app-secrets [--namespace luvallplay]
//
// Each job curls the same route Vercel Cron calls, with the same header.
// The secret itself is never printed: the manifest reads CRON_SECRET from
// the named Kubernetes Secret.
import { CRON_JOBS } from "../../lib/cron.ts";

export function cronManifests({ url, secretName, namespace = "default", image = "curlimages/curl:8.11.1" }) {
  const base = new URL(url);
  if (base.protocol !== "https:" && base.hostname !== "localhost") throw new Error("--url must be https");
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(secretName)) throw new Error("--secret-name must be a Kubernetes name");
  return CRON_JOBS.map((job) =>
    [
      "apiVersion: batch/v1",
      "kind: CronJob",
      "metadata:",
      `  name: ${job.id}`,
      `  namespace: ${namespace}`,
      "  annotations:",
      `    luvallplay.com/purpose: ${JSON.stringify(job.purpose)}`,
      "spec:",
      `  schedule: ${JSON.stringify(job.schedule)}`,
      '  timeZone: "Etc/UTC"',
      "  concurrencyPolicy: Forbid",
      "  successfulJobsHistoryLimit: 3",
      "  failedJobsHistoryLimit: 5",
      "  jobTemplate:",
      "    spec:",
      "      backoffLimit: 1",
      "      activeDeadlineSeconds: 600",
      "      template:",
      "        spec:",
      "          restartPolicy: Never",
      "          containers:",
      `            - name: ${job.id}`,
      `              image: ${image}`,
      "              env:",
      "                - name: CRON_SECRET",
      "                  valueFrom:",
      "                    secretKeyRef:",
      `                      name: ${secretName}`,
      "                      key: CRON_SECRET",
      "              command:",
      '                - "sh"',
      '                - "-c"',
      `                - ${JSON.stringify(`curl --fail --silent --show-error --max-time 300 -H "Authorization: Bearer $CRON_SECRET" ${new URL(job.path, base).href}`)}`,
    ].join("\n"),
  ).join("\n---\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const url = arg("url");
  const secretName = arg("secret-name");
  if (!url || !secretName) {
    console.error("usage: k8s.mjs --url https://… --secret-name <kubernetes secret> [--namespace ns] [--image image]");
    process.exit(2);
  }
  console.log(cronManifests({ url, secretName, namespace: arg("namespace"), image: arg("image") }));
}
