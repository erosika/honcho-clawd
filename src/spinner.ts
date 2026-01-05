/**
 * CLI loading animation for honcho-claudis
 * Minimal, wavy style - no emojis
 * Outputs to stderr so it doesn't interfere with hook output
 */

// Wavy/flow animation frames
const WAVE_FRAMES = [
  "~    ",
  " ~   ",
  "  ~  ",
  "   ~ ",
  "    ~",
  "   ~ ",
  "  ~  ",
  " ~   ",
];

const FLOW_FRAMES = [
  "·    ",
  "··   ",
  "···  ",
  " ··· ",
  "  ···",
  "   ··",
  "    ·",
  "   · ",
  "  ·  ",
  " ·   ",
];

const DOTS_FRAMES = [
  ".  ",
  ".. ",
  "...",
  " ..",
  "  .",
  "   ",
];

const PULSE_FRAMES = [
  "▪    ",
  " ▪   ",
  "  ▪  ",
  "   ▪ ",
  "    ▪",
  "   ▪ ",
  "  ▪  ",
  " ▪   ",
];

interface SpinnerOptions {
  text?: string;
  style?: "wave" | "flow" | "dots" | "pulse";
}

export class Spinner {
  private frameIndex = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private text: string;
  private frames: string[];
  private startTime: number = 0;

  constructor(options: SpinnerOptions = {}) {
    this.text = options.text || "Loading";

    switch (options.style) {
      case "wave":
        this.frames = WAVE_FRAMES;
        break;
      case "flow":
        this.frames = FLOW_FRAMES;
        break;
      case "pulse":
        this.frames = PULSE_FRAMES;
        break;
      case "dots":
      default:
        this.frames = DOTS_FRAMES;
    }
  }

  start(text?: string): void {
    if (text) this.text = text;
    this.startTime = Date.now();
    this.frameIndex = 0;

    if (this.interval) {
      clearInterval(this.interval);
    }

    this.render();

    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.render();
    }, 100);
  }

  private render(): void {
    const frame = this.frames[this.frameIndex];
    process.stderr.write(`\r  ${frame} ${this.text}`);
  }

  update(text: string): void {
    this.text = text;
  }

  stop(finalText?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Clear the line
    process.stderr.write("\r" + " ".repeat(60) + "\r");

    if (finalText) {
      process.stderr.write(`  [ok] ${finalText}\n`);
    }
  }

  fail(errorText?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    process.stderr.write("\r" + " ".repeat(60) + "\r");

    if (errorText) {
      process.stderr.write(`  [error] ${errorText}\n`);
    }
  }
}

/**
 * Simple status message
 */
export function showStatus(message: string): void {
  process.stderr.write(`  ${message}\n`);
}
