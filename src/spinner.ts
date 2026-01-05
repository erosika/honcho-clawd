/**
 * CLI loading animation for honcho-claudis
 * Minimal, wavy style - no emojis
 * Writes directly to /dev/tty to bypass Claude Code's output capture
 */

import * as fs from "fs";

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
  private ttyFd: number | null = null;

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

    // Try to open /dev/tty for direct terminal access
    try {
      this.ttyFd = fs.openSync("/dev/tty", "w");
    } catch {
      this.ttyFd = null;
    }
  }

  private write(text: string): void {
    if (this.ttyFd !== null) {
      try {
        fs.writeSync(this.ttyFd, text);
        return;
      } catch {
        // Fall through to stderr
      }
    }
    process.stderr.write(text);
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
    this.write(`\r  ${frame} ${this.text}`);
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
    this.write("\r" + " ".repeat(60) + "\r");

    if (finalText) {
      this.write(`  [ok] ${finalText}\n`);
    }

    this.closeTty();
  }

  fail(errorText?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.write("\r" + " ".repeat(60) + "\r");

    if (errorText) {
      this.write(`  [error] ${errorText}\n`);
    }

    this.closeTty();
  }

  private closeTty(): void {
    if (this.ttyFd !== null) {
      try {
        fs.closeSync(this.ttyFd);
      } catch {
        // Ignore close errors
      }
      this.ttyFd = null;
    }
  }
}

/**
 * Simple status message
 */
export function showStatus(message: string): void {
  try {
    const fd = fs.openSync("/dev/tty", "w");
    fs.writeSync(fd, `  ${message}\n`);
    fs.closeSync(fd);
  } catch {
    process.stderr.write(`  ${message}\n`);
  }
}
