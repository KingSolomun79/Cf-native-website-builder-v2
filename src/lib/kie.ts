import type { Env } from "../env.d";
import type { ImageTask, ImageResult, ImageProvider } from "../types";

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
