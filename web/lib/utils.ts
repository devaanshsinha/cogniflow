export function cn(
  ...inputs: Array<string | null | undefined | false | 0>
): string {
  return inputs.filter(Boolean).join(" ");
}
