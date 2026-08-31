import { Context } from "hono";
import type { Env } from "../env.d";
import type { NormalizedIntake } from "../types";
import { verifyApprovalToken } from "../lib/crypto";
import { fetchJob, getClientById, updateJobStatus, updateClientReferenceSiteUrl } from "../lib/db";
import { persistFormScreenshot } from "../lib/reference-persist";
import { escapeHtml } from "../lib/html";
import { validateReferenceUrl } from "../lib/reference-input";

export async function submitInput(c: Context<{ Bindings: Env }>): Promise<Response> {
  const jobId = c.req.param("jobId");
  const body = await c.req.parseBody();
  const token = body["token"] as string;

  if (!token) {
    return c.text("Missing token", 401);
  }

  const payload = await verifyApprovalToken(c.env, token);
  if (!payload || payload.jobId !== jobId || payload.action !== "input") {
    return c.text("Invalid or expired token", 403);
  }

  const job = await fetchJob(c.env.DB, jobId);
  if (!job) {
    return c.text("Job not found", 404);
  }

  if (job.status !== "needs_input") {
    return c.text(`Job is in state '${job.status}' and cannot accept input.`, 400);
  }

  const client = await getClientById(c.env.DB, job.client_id);
  if (!client) {
    return c.text("Client not found", 404);
  }

  const referenceSiteUrlRaw =
    (body["referenceSiteUrl"] as string | undefined)?.trim() ||
    (body["inspirationUrl"] as string | undefined)?.trim();
  const screenshotFile = body["screenshot"];

  if (!referenceSiteUrlRaw) {
    return c.text("A reference site URL is required.", 400);
  }

  const finalUrl = validateReferenceUrl(referenceSiteUrlRaw);
  if (!finalUrl) {
    return c.text("The reference URL must be a public HTTP or HTTPS URL.", 400);
  }

  if (!(screenshotFile instanceof File) || screenshotFile.size <= 0) {
    return c.text("A full-page homepage screenshot is required.", 400);
  }

  let persisted;
  try {
    persisted = await persistFormScreenshot(c.env, {
      jobId,
      clientSlug: client.slug,
      file: screenshotFile,
      source: "manual_form",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.text(message, 415);
  }

  await updateClientReferenceSiteUrl(c.env.DB, client.id, finalUrl);

  const intake: NormalizedIntake = {
    companyName: client.company_name,
    clientEmail: client.client_email,
    businessType: client.business_type,
    businessDescription: client.business_description,
    idealClientProfile: client.ideal_client_profile,
    logoUrl: client.logo_url,
    preferredColour1: client.preferred_colour_1,
    preferredColour2: client.preferred_colour_2,
    mode: client.mode as "light" | "dark",
    addressLine1: client.address_line_1,
    addressLine2: client.address_line_2,
    city: client.city,
    county: client.county,
    zipCode: client.zip_code,
    country: client.country,
    facebookUrl: client.facebook_url,
    instagramUrl: client.instagram_url,
    twitterUrl: client.twitter_url,
    linkedinUrl: client.linkedin_url,
    otherSocialUrl: client.other_social_url,
    extraInformation: client.extra_information,
    whatsappNumber: client.whatsapp_number,
    referenceSiteUrl: finalUrl,
    referenceScreenshotR2Key: persisted.r2Key,
    referenceHomeScreenshotUploadId: null,
  };

  await updateJobStatus(c.env.DB, jobId, "queued");

  try {
    await c.env.SITE_BUILD_WORKFLOW.create({
      id: jobId,
      params: {
        jobId,
        siteId: job.site_id,
        clientId: client.id,
        clientSlug: client.slug,
        intake,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to start reference-input workflow", { jobId, message });
    await updateJobStatus(c.env.DB, jobId, "needs_input", {
      error_code: "WORKFLOW_START_FAILED",
      error_message: message,
    });
    return c.text("Failed to start workflow.", 500);
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workflow Started</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #f4f4f5; color: #18181b; padding: 2rem; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
    .container { max-width: 500px; text-align: center; background: white; padding: 3rem 2rem; border-radius: 8px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
    h1 { color: #10b981; margin-top: 0; }
    p { margin-bottom: 0; color: #52525b; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Build Workflow Started!</h1>
    <p>The workflow for <strong>${escapeHtml(client.company_name)}</strong> has successfully launched. You will be notified via email when the website is ready for review.</p>
  </div>
</body>
</html>
  `;

  return c.html(html);
}
