/** Errors with messages meant to be read by a person in HotelCost's integration log. */

export class BotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The username/password was rejected, or the login page never let us in. */
export class LoginFailedError extends BotError {
  constructor(system: string, detail?: string) {
    super(`login failed${system ? ` (${system})` : ""}${detail ? `: ${detail}` : ""}`);
  }
}

/** An element the bot depends on is not on the page: the screen layout changed or the selector is wrong. */
export class ScreenChangedError extends BotError {
  constructor(public screen: string, public key: string, public selector: string) {
    super(`screen changed: selector ${selector} not found on ${screen} screen (${screen}.${key})`);
  }
}

/** A selector is still the TODO placeholder from the template: it was never set for this hotel. */
export class SelectorNotConfiguredError extends BotError {
  constructor(public screen: string, public key: string) {
    super(`selector not configured: ${screen}.${key} is still a TODO placeholder in the selectors file`);
  }
}

/** A value on the page could not be read (number / date in an unexpected format). */
export class ParseError extends BotError {}

/** HotelCost answered with an HTTP error. */
export class HttpError extends BotError {
  constructor(public status: number, public body: string, public url: string) {
    super(`HotelCost ${status} at ${new URL(url).pathname}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
}

/** Turn any thrown value (Playwright errors included) into a short, readable message. */
export function describeError(err: unknown, context?: string): string {
  const prefix = context ? `${context}: ` : "";
  if (err instanceof BotError) return prefix + err.message;
  const e = err as { name?: string; message?: string };
  const message = String(e?.message ?? err).split("\n")[0]!.trim();
  if (e?.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(message)) return `${prefix}timeout: ${message}`;
  const net = /net::(ERR_[A-Z_]+)/.exec(message);
  if (net) return `${prefix}network error: ${net[1]} (${message.replace(/^.*?net::ERR_[A-Z_]+\s*/, "") || "cannot reach the server"})`;
  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message)) return `${prefix}network error: ${message}`;
  return prefix + message;
}
