declare module "digital-link.js" {
  export interface DigitalLinkInstance {
    isValid(): boolean;
    getIdentifier(): Record<string, string>;
    getKeyQualifiers(): Record<string, string>;
    getAttributes(): Record<string, string>;
    toWebUriString(): string;
  }
  export function DigitalLink(
    input?: string | Record<string, unknown>,
  ): DigitalLinkInstance;
  export const Utils: Record<string, unknown>;
  export const CheckDigit: Record<string, unknown>;
  export const webVoc: Record<string, unknown>;
}
