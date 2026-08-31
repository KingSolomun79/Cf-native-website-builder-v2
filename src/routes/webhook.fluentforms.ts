import { Context } from "hono";
import type { Env } from "../env.d";
import type { FluentFormsPayload, ClientRow, SiteRow, JobRow } from "../types";
import { verifyWebhookSignature, generateId, nowIso } from "../lib/crypto";
import { validateIntake, normalizeIntake } from "../lib/validation";
import { generateSlug, generateRandomSuffix } from "../lib/slug";
import { createClient, createSite, createJob, slugExists } from "../lib/db";
import { putObject, intakePayloadKey } from "../lib/assets";
import { sendInternalNotification } from "../lib/mail";

export async function handleFluentFormsWebhook(c: Context<{ Bindings: Env }>): Promise<Response> {
  try {
  const rawBody = await c.req.text();

  const signature = c.req.header("X-WF-Signature");
  if (!(await verifyWebhookSignature(c.env.WEBHOOK_SECRET, rawBody, signature ?? null))) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const payload = mapFluentFormsPayload(raw) as FluentFormsPayload;

  const validation = validateIntake(payload);
  if (!validation.valid) {
    return c.json({ error: "Validation failed", details: validation.errors }, 400);
  }

  const intake = normalizeIntake(payload);
  let clientSlug = generateSlug(intake.companyName);

  if (await slugExists(c.env.DB, clientSlug)) {
    clientSlug = `${clientSlug}-${generateRandomSuffix()}`;
  }

  const clientId = generateId();
  const siteId = generateId();
  const jobId = generateId();
  const now = nowIso();

  const clientRow: ClientRow = {
    id: clientId,
    slug: clientSlug,
    company_name: intake.companyName,
    client_email: intake.clientEmail,
    address_line_1: intake.addressLine1,
    address_line_2: intake.addressLine2,
    city: intake.city,
    county: intake.county,
    zip_code: intake.zipCode,
    country: intake.country,
    business_type: intake.businessType,
    business_description: intake.businessDescription,
    ideal_client_profile: intake.idealClientProfile,
    logo_url: intake.logoUrl,
    preferred_colour_1: intake.preferredColour1,
    preferred_colour_2: intake.preferredColour2,
    mode: intake.mode,
    website_overall_style: "reference-driven",
    facebook_url: intake.facebookUrl,
    instagram_url: intake.instagramUrl,
    twitter_url: intake.twitterUrl,
    linkedin_url: intake.linkedinUrl,
    other_social_url: intake.otherSocialUrl,
    extra_information: intake.extraInformation,
    whatsapp_number: intake.whatsappNumber,
    reference_site_url: intake.referenceSiteUrl,
    inspiration_url: intake.referenceSiteUrl,
    created_at: now,
    updated_at: now,
  };

  await createClient(c.env.DB, clientRow);

  const siteRow: SiteRow = {
    id: siteId,
    client_id: clientId,
    current_version_id: null,
    status: "pending",
    revisions_count: 0,
    preview_url: null,
    production_url: null,
    style_key: "blueprint-v2",
    style_version: "2.0.0",
    created_at: now,
    updated_at: now,
  };

  await createSite(c.env.DB, siteRow);

  const rawPayloadKey = intakePayloadKey(clientSlug, jobId);

  const jobRow: JobRow = {
    id: jobId,
    site_id: siteId,
    client_id: clientId,
    job_type: "initial_build",
    status: "needs_input",
    current_step: null,
    error_code: null,
    error_message: null,
    job_validation_errors: null,
    workflow_instance_id: null,
    agent_session_id: null,
    raw_payload_r2_key: rawPayloadKey,
    created_at: now,
    updated_at: now,
  };

  await createJob(c.env.DB, jobRow);

  await putObject(c.env, rawPayloadKey, rawBody, {
    httpMetadata: { contentType: "application/json" },
  });

  if (intake.logoUrl) {
    try {
      const logoResp = await fetch(intake.logoUrl);
      if (logoResp.ok) {
        const logoData = await logoResp.arrayBuffer();
        const contentType = logoResp.headers.get("content-type") ?? "image/png";
        await putObject(
          c.env,
          `${clientSlug}/branding/logo/original`,
          logoData,
          { httpMetadata: { contentType } }
        );
        await putObject(
          c.env,
          `${clientSlug}/branding/logo/normalized.webp`,
          logoData,
          { httpMetadata: { contentType: "image/webp" } }
        );
      }
    } catch {
      // logo fetch failed — non-blocking
    }
  }

  const formatField = (label: string, val?: string | null) => val ? `<p><strong>${label}:</strong> ${val}</p>` : "";

  const addressString = [
    intake.addressLine1,
    intake.addressLine2,
    intake.city,
    intake.county,
    intake.zipCode,
    intake.country
  ].filter(Boolean).join(", ");

  const screenshotUploadId = (payload.reference_homepage_screenshot ?? "").trim();
  const hasReferenceUrl = !!intake.referenceSiteUrl;
  const hasScreenshotRef = !!screenshotUploadId;

  let readyToQueue = hasReferenceUrl && hasScreenshotRef;
  let persistedScreenshotKey: string | null = null;

  if (readyToQueue) {
    const { updateJobStatus } = await import("../lib/db");
    const { promoteStagedScreenshot } = await import("../lib/reference-persist");
    try {
      const persisted = await promoteStagedScreenshot(c.env, {
        jobId,
        clientSlug,
        uploadId: screenshotUploadId,
        source: "webhook_upload",
      });
      persistedScreenshotKey = persisted.r2Key;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateJobStatus(c.env.DB, jobId, "needs_input", {
        error_code: "REFERENCE_SCREENSHOT_INVALID",
        error_message: message,
      });
      console.error("Reference screenshot promotion failed", { jobId, message });
      readyToQueue = false;
    }
  }

  if (readyToQueue && persistedScreenshotKey) {
    const { updateJobStatus } = await import("../lib/db");
    intake.referenceScreenshotR2Key = persistedScreenshotKey;
    await updateJobStatus(c.env.DB, jobId, "queued");

    try {
      await c.env.SITE_BUILD_WORKFLOW.create({
        id: jobId,
        params: {
          jobId,
          siteId: jobRow.site_id,
          clientId: clientRow.id,
          clientSlug,
          intake,
        },
      });

      await sendInternalNotification(c.env, {
        subject: `Workflow Auto-Started: ${intake.companyName}`,
        htmlBody: `
          <h2>Workflow Auto-Started</h2>
          <p style="color:#737373;font-size:12px;margin-bottom:16px;font-family:monospace;">Job ID: ${jobId}</p>
          ${formatField("Client", intake.companyName)}
          ${formatField("Reference URL", intake.referenceSiteUrl)}
          <hr style="margin: 20px 0; border: none; border-top: 1px solid #eaeaea;" />
          ${formatField("Design source", "Reference URL + homepage screenshot")}
          ${formatField("Mode", intake.mode)}
        `,
      });

      return c.json({ ok: true, jobId, status: "queued" }, 202);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateJobStatus(c.env.DB, jobId, "needs_input", {
        error_code: "WORKFLOW_START_FAILED",
        error_message: message,
      });
      console.error("Failed to auto-start workflow", { jobId, message });
      return c.json({ error: "Failed to auto-start workflow" }, 500);
    }
  }

  // Missing or invalid reference URL and/or homepage screenshot → request input
  const missingReasons: string[] = [];
  if (!hasReferenceUrl) missingReasons.push("a reference site URL");
  if (!hasScreenshotRef) missingReasons.push("a full-page homepage screenshot");

  const { signApprovalToken } = await import("../lib/crypto");
  const token = await signApprovalToken(c.env, {
    jobId,
    action: "input",
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  const baseUrl = new URL(c.req.url).origin;
  const inputUrl = `${baseUrl}/api/jobs/${jobId}/input?token=${token}`;

  await sendInternalNotification(c.env, {
    subject: `New Client Onboarding: ${intake.companyName}`,
    htmlBody: `
      <h2>New Client Onboarding</h2>
      <p style="color:#737373;font-size:12px;margin-bottom:16px;font-family:monospace;">Job ID: ${jobId}</p>
      ${formatField("Client", intake.companyName)}
      ${formatField("Email", intake.clientEmail)}
      ${formatField("Phone/WhatsApp", intake.whatsappNumber)}
      ${formatField("Address", addressString)}
      <hr style="margin: 20px 0; border: none; border-top: 1px solid #eaeaea;" />
      ${formatField("Business Type", intake.businessType)}
      ${formatField("Description", intake.businessDescription)}
      ${formatField("Ideal Client", intake.idealClientProfile)}
      <hr style="margin: 20px 0; border: none; border-top: 1px solid #eaeaea;" />
      ${formatField("Design source", "Reference URL + homepage screenshot")}
      ${formatField("Mode", intake.mode)}
      ${formatField("Preferred Color 1", intake.preferredColour1)}
      ${formatField("Preferred Color 2", intake.preferredColour2)}
      <hr style="margin: 20px 0; border: none; border-top: 1px solid #eaeaea;" />
      ${formatField("Facebook", intake.facebookUrl)}
      ${formatField("Instagram", intake.instagramUrl)}
      ${formatField("Twitter/X", intake.twitterUrl)}
      ${formatField("LinkedIn", intake.linkedinUrl)}
      ${formatField("Other Social", intake.otherSocialUrl)}
      <hr style="margin: 20px 0; border: none; border-top: 1px solid #eaeaea;" />
      ${formatField("Extra Information", intake.extraInformation)}
      <br />
      <p><strong>This job is awaiting ${missingReasons.join(" and ")} before the build can start.</strong></p>
      <p>Please scout a reference website <em>and</em> capture a full-page homepage screenshot, then provide both via the protected input form:</p>
      <a href="${inputUrl}" style="display:inline-block;padding:10px 20px;background-color:#0070f3;color:white;text-decoration:none;border-radius:5px;">Provide Reference URL &amp; Screenshot</a>
    `,
  });

  return c.json({ ok: true, jobId, status: "needs_input", missing: missingReasons }, 202);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Unhandled Fluent Forms webhook error", { message });
    return c.json({ error: "Unhandled webhook error" }, 500);
  }
}

function mapMode(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower.includes("dark")) return "dark";
  if (lower.includes("light")) return "light";
  return undefined;
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

interface FluentFormsRaw {
  input_text?: unknown;
  email?: unknown;
  dropdown?: unknown;
  description?: unknown;
  description_1?: unknown;
  description_2?: unknown;
  color_picker?: unknown;
  color_picker_1?: unknown;
  dropdown_1?: unknown;
  dropdown_2?: unknown;
  image_upload?: unknown;
  url?: unknown;
  url_1?: unknown;
  url_2?: unknown;
  url_3?: unknown;
  url_4?: unknown;
  url_5?: unknown;
  address_1?: unknown;
  company_name?: unknown;
  client_email?: unknown;
  business_type?: unknown;
  business_description?: unknown;
  ideal_client_profile?: unknown;
  logo_url?: unknown;
  preferred_colour_1?: unknown;
  preferred_colour_2?: unknown;
  mode?: unknown;
  address_line_1?: unknown;
  address_line_2?: unknown;
  city?: unknown;
  county?: unknown;
  zip_code?: unknown;
  country?: unknown;
  facebook_url?: unknown;
  instagram_url?: unknown;
  twitter_url?: unknown;
  linkedin_url?: unknown;
  other_social_url?: unknown;
  extra_information?: unknown;
  whatsapp_number?: unknown;
  reference_site_url?: unknown;
  inspiration_url?: unknown;
  reference_homepage_screenshot?: unknown;
}

function mapFluentFormsPayload(raw: Record<string, unknown>): FluentFormsRaw {
  const ff = raw as unknown as FluentFormsRaw;

  const address =
    ff.address_1 && typeof ff.address_1 === "object"
      ? (ff.address_1 as Record<string, unknown>)
      : {};

  const mapped: FluentFormsRaw = {
    company_name: str(ff.company_name) ?? str(ff.input_text),
    client_email: str(ff.client_email) ?? str(ff.email),
    business_type: str(ff.business_type) ?? str(ff.dropdown),
    business_description: str(ff.business_description) ?? str(ff.description),
    ideal_client_profile: str(ff.ideal_client_profile) ?? str(ff.description_1),
    logo_url: str(ff.logo_url),
    preferred_colour_1: str(ff.preferred_colour_1) ?? str(ff.color_picker),
    preferred_colour_2: str(ff.preferred_colour_2) ?? str(ff.color_picker_1),
    mode: mapMode(str(ff.mode) ?? str(ff.dropdown_1)),
    address_line_1: str(ff.address_line_1) ?? str(address.address_line_1),
    address_line_2: str(ff.address_line_2) ?? str(address.address_line_2),
    city: str(ff.city) ?? str(address.city),
    county: str(ff.county) ?? str(address.state),
    zip_code: str(ff.zip_code) ?? str(address.zip),
    country: str(ff.country) ?? str(address.country),
    facebook_url: str(ff.facebook_url) ?? str(ff.url),
    instagram_url: str(ff.instagram_url) ?? str(ff.url_1),
    twitter_url: str(ff.twitter_url) ?? str(ff.url_3),
    linkedin_url: str(ff.linkedin_url) ?? str(ff.url_4),
    other_social_url: str(ff.other_social_url) ?? str(ff.url_2),
    extra_information: str(ff.extra_information) ?? str(ff.description_2),
    whatsapp_number: str(ff.whatsapp_number),
    reference_site_url: str(ff.reference_site_url) ?? str(ff.inspiration_url) ?? str(ff.url_5),
    inspiration_url: str(ff.inspiration_url) ?? str(ff.url_5),
    reference_homepage_screenshot: str(ff.reference_homepage_screenshot),
  };

  return mapped;
}
