import Groq from 'groq-sdk';
import { logger } from './logger.js';
import { readEnvFile } from './env.js';

const envConfig = readEnvFile(['GROQ_API_KEY']);
const GROQ_API_KEY = process.env.GROQ_API_KEY || envConfig.GROQ_API_KEY || '';

let groqClient: Groq | null = null;

function getGroqClient(): Groq | null {
  if (!GROQ_API_KEY) {
    logger.warn('GROQ_API_KEY not configured, voice transcription disabled');
    return null;
  }
  if (!groqClient) {
    groqClient = new Groq({ apiKey: GROQ_API_KEY });
  }
  return groqClient;
}

export async function transcribeAudio(audioBuffer: Buffer): Promise<string | null> {
  const client = getGroqClient();
  if (!client) return null;

  try {
    const file = new File([audioBuffer], 'voice.ogg', { type: 'audio/ogg' });

    const transcription = await client.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3',
      response_format: 'text',
    });

    const text = (transcription as unknown as string).trim();
    logger.info({ length: text.length }, 'Voice message transcribed');
    return text;
  } catch (err) {
    logger.error({ err }, 'Groq transcription failed');
    return null;
  }
}
