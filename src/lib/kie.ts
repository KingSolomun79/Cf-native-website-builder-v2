import type { Env } from "../env.d";
import type { ImageTask, ImageResult, ImageProvider } from "../types";
import { putObject, pageImageKey } from "./assets";

export class KieImageProvider implements ImageProvider {
  constructor(private env: Env) {}

  async createTask(task: ImageTask): Promise<string> {
    const assembledPrompt = this.assemblePrompt(task);

    const response = await fetch(`${this.env.KIE_API_URL}/api/v1/jobs/createTask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.env.KIE_API_KEY}`,
      },
      body: JSON.stringify({
        model: this.env.KIE_MODEL,
        callBackUrl: `${this.env.PUBLIC_APP_URL}/api/internal/kie-callback`,
        input: {
          prompt: assembledPrompt,
          aspect_ratio: task.aspectRatio,
          nsfw_checker: true,
        },
      }),
    });

    const result = (await response.json()) as { code: number; data: { taskId: string } };
    if (result.code !== 200) throw new Error(`Kie.ai task creation failed: ${JSON.stringify(result)}`);
    return result.data.taskId;
  }

  async pollResult(taskId: string): Promise<{ status: "pending" | "complete" | "failed"; url?: string }> {
    const response = await fetch(`${this.env.KIE_API_URL}/api/v1/jobs/recordInfo?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${this.env.KIE_API_KEY}` },
    });

    const body = (await response.json()) as {
      code: number;
      msg: string;
      data: {
        state: string;
        resultJson?: string;
        failMsg?: string;
      };
    };

    if (body.code === 422) return { status: "pending" };

    const state = body.data?.state;

    if (state === "success") {
      try {
        const parsed = JSON.parse(body.data.resultJson ?? "{}") as { resultUrls?: string[] };
        const url = parsed.resultUrls?.[0];
        return { status: "complete", url };
      } catch {
        return { status: "failed" };
      }
    }

    if (state === "fail") {
      console.error(`Kie.ai task ${taskId} failed: ${body.data?.failMsg}`);
      return { status: "failed" };
    }

    return { status: "pending" };
  }

  private assemblePrompt(task: ImageTask): string {
    return [
      "Create one natural editorial photograph intended to be placed inside a website, grounded in the supplied client facts and accepted design blueprint.",
      `Slot: ${task.slot}.`,
      `Aspect ratio: ${task.aspectRatio}.`,
      task.prompt,
      "Output only the photographic scene: no website, browser, application interface, screen, device frame, UI layout, wireframe, poster, infographic, collage, or mockup.",
      "Do not add text, letters, logos, navigation, buttons, badges, statistics, testimonials, awards, or unsupported factual claims.",
    ].join(" ");
  }
}

export async function createAllImageTasks(env: Env, tasks: ImageTask[]): Promise<Map<string, ImageTask>> {
  const provider = new KieImageProvider(env);
  const taskMap = new Map<string, ImageTask>();

  for (const task of tasks) {
    let created = false;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        const taskId = await provider.createTask(task);
        taskMap.set(taskId, task);
        created = true;
      } catch (err) {
        console.error(`Failed to create image task for slot ${task.slot} (attempt ${attempt + 1}):`, err);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    if (!created) throw new Error(`Failed to create required image task for slot ${task.slot}`);
  }

  return taskMap;
}

export async function pollAllTasks(
  env: Env,
  taskIds: string[],
  taskMap: Map<string, ImageTask>
): Promise<Array<{ taskId: string; status: "pending" | "complete" | "failed"; url?: string }>> {
  const provider = new KieImageProvider(env);
  const results = [];

  for (const taskId of taskIds) {
    try {
      const result = await provider.pollResult(taskId);
      results.push({ taskId, ...result });
    } catch (err) {
      console.error(`Failed to poll task ${taskId}:`, err);
      results.push({ taskId, status: "failed" as const });
    }
  }

  return results;
}

export async function downloadAndStoreImages(
  env: Env,
  results: Array<{ taskId: string; status: "pending" | "complete" | "failed"; url?: string }>,
  clientSlug: string,
  version: number,
  taskMap: Map<string, ImageTask>
): Promise<ImageResult[]> {
  const imageResults: ImageResult[] = [];

  for (const result of results) {
    const task = taskMap.get(result.taskId);
    if (!task) continue;

    if (result.status !== "complete" || !result.url) throw new Error(`Required image generation failed for slot ${task.slot}`);

    try {
      const imageResp = await fetch(result.url);
      if (!imageResp.ok) throw new Error(`Image fetch failed: ${imageResp.status}`);

      if (!imageResp.body) throw new Error("Image response body was empty");
      const transformed = await env.IMAGES.input(imageResp.body).output({ format: "image/webp", quality: 85 });
      const imageData = await transformed.response().arrayBuffer();
      const r2Key = pageImageKey(clientSlug, version, task.page, task.outputFilename);

      await putObject(env, r2Key, imageData, {
        httpMetadata: { contentType: "image/webp" },
      });

      imageResults.push({
        slot: task.slot,
        page: task.page,
        outputFilename: task.outputFilename,
        r2Key,
        mimeType: "image/webp",
        width: 1200,
        height: 675,
        sourceJobRef: result.taskId,
      });
    } catch (err) {
      console.error(`Failed to download image for task ${result.taskId}:`, err);
      throw new Error(`Required image download or conversion failed for slot ${task.slot}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return imageResults;
}

export async function runImageGenerationPollLoop(
  env: Env,
  taskMap: Map<string, ImageTask>,
  clientSlug: string,
  version: number,
  sleepMs = 15_000,
  maxAttempts = 20
): Promise<ImageResult[]> {
  const taskIds = Array.from(taskMap.keys());
  let attempts = 0;

  while (attempts < maxAttempts) {
    const results = await pollAllTasks(env, taskIds, taskMap);
    const allDone = results.every((r) => r.status !== "pending");

    if (allDone) {
      const failed = results.filter((r) => r.status === "failed");
      if (failed.length > 0) {
        throw new Error(`Image generation failed for required slots: ${failed.map((f) => taskMap.get(f.taskId)?.slot).join(", ")}`);
      }

      return downloadAndStoreImages(env, results, clientSlug, version, taskMap);
    }

    await new Promise((resolve) => setTimeout(resolve, sleepMs));
    attempts++;
  }

  throw new Error("Image generation timed out after 5 minutes");
}
