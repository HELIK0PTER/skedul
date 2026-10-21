/**
 * An inline link in a sentence of the dashboard. `text-accent-foreground` is the brand colour darkened until it reads
 * 4.5:1 on the accent surface (brandTheme), whatever preset the pro chose: the raw `text-primary` is about 4.2:1 or
 * less on a light preset. The underline tells the link from the text around it by more than its colour.
 */
export const INLINE_LINK_CLASS =
  "rounded font-medium text-accent-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
