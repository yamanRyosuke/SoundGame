// Optional short WAV for manual/browser regression testing. No external tools needed.
import { mkdirSync, writeFileSync } from 'node:fs';
const rate = 22050, duration = 8;
const bytes = Buffer.alloc(44 + rate * duration * 2);
bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32);
bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
for (let i = 0; i < rate * duration; i++) {
  const time = i / rate, phase = (time - 1) % 0.5;
  const hz = [110, 440, 880, 660][Math.max(0, Math.floor((time - 1) * 2)) % 4];
  const value = time >= 1 && time < 7 && phase < 0.15 ? Math.sin(2 * Math.PI * hz * time) * Math.min(1, phase / 0.004) * Math.exp(-phase * 25) * 0.7 : 0;
  bytes.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
}
mkdirSync('.artifacts', { recursive: true });
writeFileSync('.artifacts/browser-fixture.wav', bytes);
