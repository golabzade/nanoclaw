import textToSpeech from '@google-cloud/text-to-speech';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { readEnvFile } from './env.js';

const envConfig = readEnvFile(['GOOGLE_APPLICATION_CREDENTIALS']);
const GOOGLE_CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || envConfig.GOOGLE_APPLICATION_CREDENTIALS || '';
const TTS_VOICE = 'en-US-Chirp3-HD-Algenib';
const TTS_LANGUAGE = 'en-US';
const TTS_CHUNK_SIZE = 4500; // Google limit is 5000 bytes per request

let ttsClient: textToSpeech.TextToSpeechClient | null = null;

function getClient(): textToSpeech.TextToSpeechClient | null {
  if (!GOOGLE_CREDENTIALS_PATH || !fs.existsSync(GOOGLE_CREDENTIALS_PATH)) {
    logger.warn('GOOGLE_APPLICATION_CREDENTIALS not set or file not found, TTS disabled');
    return null;
  }
  if (!ttsClient) {
    ttsClient = new textToSpeech.TextToSpeechClient({
      keyFilename: GOOGLE_CREDENTIALS_PATH,
    });
  }
  return ttsClient;
}

export async function textToAudio(text: string): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const tmpDir = path.join(process.cwd(), 'data', 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const outputFile = path.join(tmpDir, `tts-${Date.now()}.ogg`);

    const chunks = [];
    for (let i = 0; i < text.length; i += TTS_CHUNK_SIZE) {
      chunks.push(text.slice(i, i + TTS_CHUNK_SIZE));
    }

    const audioBuffers: Buffer[] = [];
    for (const chunk of chunks) {
      const [response] = await client.synthesizeSpeech({
        input: { text: chunk },
        voice: { languageCode: TTS_LANGUAGE, name: TTS_VOICE },
        audioConfig: { audioEncoding: 'OGG_OPUS' as any },
      });
      if (response.audioContent) {
        audioBuffers.push(Buffer.from(response.audioContent as Uint8Array));
      }
    }

    if (audioBuffers.length === 0) return null;

    const combined = Buffer.concat(audioBuffers);
    fs.writeFileSync(outputFile, combined);
    logger.info({ chars: text.length, file: outputFile }, 'TTS audio generated');
    return outputFile;
  } catch (err) {
    logger.error({ err }, 'Google Cloud TTS failed');
    return null;
  }
}

export function cleanupTtsFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* ignore */ }
}
