import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { CONDITIONS, type AiSuggestion, type ImageContentType } from '@campus-walk/shared';

export interface SuggestionAssetType {
  id: string;
  name: string;
  category: string;
}

export interface SuggestionInput {
  bytes: Uint8Array;
  contentType: ImageContentType;
  assetTypes: SuggestionAssetType[];
}

/** Turns a photo into a proposed asset type and condition, or null when it has nothing useful to say. */
export interface Suggester {
  suggest(input: SuggestionInput): Promise<AiSuggestion | null>;
}

/** Used when Bedrock is not configured: the form simply opens empty. */
export const noSuggester: Suggester = { suggest: async () => null };

/** What the model is asked to return. Kept flat so the schema is trivial for structured output. */
const ModelOutput = z.object({
  asset_type: z
    .string()
    .nullable()
    .describe('Exactly one name from the asset type list, or null if nothing in the list fits'),
  condition: z.int().min(1).max(5).nullable().describe('1 Critical to 5 Excellent, or null if not visible'),
  confidence: z.enum(['low', 'medium', 'high']),
  note: z.string().max(200).describe('Under 20 words: what is shown and any visible defect'),
});

const SYSTEM = `You help an architect inventory a school campus for a facility plan. You see one photo taken in a room, corridor, or on a roof.
Identify the single most prominent furniture item, piece of equipment, or building system in it and pick the matching asset type from the list the user gives. If nothing in the list fits, return null for asset_type.
Rate condition from visible wear, damage, and apparent age: ${CONDITIONS.map((c) => `${c.value} ${c.label}`).join(', ')}. Return null if condition is not judgeable from the photo.
Confidence is high only when both the object and its condition are clearly visible.`;

/** Anthropic's vision limit is 5 MB per image; the web app resizes before upload, this is the backstop. */
const MAX_IMAGE_BYTES = 4_500_000;

/**
 * The walker is standing in a room waiting on this. The SDK's defaults (10 minutes, two
 * retries) suit batch jobs, not a form; one retry inside a short budget, then the form opens
 * empty and the photo is still saved.
 */
export const SUGGESTION_TIMEOUT_MS = 20_000;
export const SUGGESTION_MAX_RETRIES = 1;

/**
 * Validates and resolves raw model output. Anything malformed, or an answer that names no
 * type and no condition, degrades to null rather than a half-filled form.
 */
export function normalizeSuggestion(raw: unknown, assetTypes: SuggestionAssetType[], model: string): AiSuggestion | null {
  const parsed = ModelOutput.safeParse(raw);
  if (!parsed.success) return null;
  const { asset_type, condition, confidence, note } = parsed.data;
  const type = asset_type ? assetTypes.find((t) => t.name.toLowerCase() === asset_type.trim().toLowerCase()) : undefined;
  if (!type && condition === null) return null;
  return {
    assetTypeId: type?.id ?? null,
    assetTypeName: type?.name ?? null,
    condition,
    note: note.trim(),
    confidence,
    model,
  };
}

export class BedrockSuggester implements Suggester {
  constructor(
    private readonly client: AnthropicBedrockMantle,
    private readonly model: string,
  ) {}

  async suggest({ bytes, contentType, assetTypes }: SuggestionInput): Promise<AiSuggestion | null> {
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      console.warn(`suggestion skipped: image is ${bytes.byteLength} bytes`);
      return null;
    }
    const list = assetTypes.map((t) => `- ${t.name} (${t.category})`).join('\n');
    try {
      const res = await this.client.messages.parse({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM,
        output_config: { effort: 'low', format: zodOutputFormat(ModelOutput) },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: contentType, data: Buffer.from(bytes).toString('base64') } },
              { type: 'text', text: `Asset types:\n${list}` },
            ],
          },
        ],
      });
      // A refusal or an unparseable answer is not an error for the walker; the form opens empty.
      if (res.stop_reason === 'refusal' || !res.parsed_output) return null;
      return normalizeSuggestion(res.parsed_output, assetTypes, res.model);
    } catch (err) {
      console.warn('suggestion failed', err);
      return null;
    }
  }
}

export function suggesterFromEnv(env = process.env): Suggester {
  if (!env.BEDROCK_MODEL) {
    console.warn('BEDROCK_MODEL not set: AI suggestions are disabled');
    return noSuggester;
  }
  const client = new AnthropicBedrockMantle({ awsRegion: env.AWS_REGION, timeout: SUGGESTION_TIMEOUT_MS, maxRetries: SUGGESTION_MAX_RETRIES });
  return new BedrockSuggester(client, env.BEDROCK_MODEL);
}
